import {
    Context,
    createConnector,
    readConfig,
    Response,
    logger,
    StdAccountListOutput,
    StdAccountReadInput,
    StdAccountReadOutput,
    StdTestConnectionOutput,
    ConnectorError,
    StdEntitlementListOutput,
    StdEntitlementReadInput,
    StdEntitlementReadOutput,
    AttributeChangeOp,
    StdAccountUpdateInput,
    StdAccountUpdateOutput,
    StdAccountCreateInput,
    StdAccountCreateOutput,
    StdAccountListInput,
    StdEntitlementListInput,
} from '@sailpoint/connector-sdk'
import { AxiosResponse } from 'axios'
import { IDNClient } from './idn-client'
import { Account } from './model/account'
import { Level } from './model/level'
import { Workgroup } from './model/workgroup'
import { levels } from './data/levels'
import { LCS } from './model/lcs'

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Connector must be exported as module property named connector
export const connector = async () => {
    // Get connector source config
    const config = await readConfig()
    const { removeGroups, enableLevels, enableWorkgroups, enableLCS } = config

    // Use the vendor SDK, or implement own client as necessary, to initialize a client
    const client = new IDNClient(config)

    const safeList = (object: any) => {
        let safeList: any[]
        if (typeof object === 'string') {
            safeList = [object]
        } else if (object === undefined) {
            safeList = []
        } else {
            safeList = object
        }
        return safeList
    }

    const getWorkgroupEntitlements = async (): Promise<Workgroup[]> => {
        const entitlements = []
        for await (const response of client.workgroupAggregation()) {
            for (const w of response.data) {
                entitlements.push(new Workgroup(w))
            }
        }

        return entitlements
    }

    const getLCSEntitlements = async (): Promise<LCS[]> => {
        const entitlements = []
        const response1 = await client.getIdentityProfiles()
        for (const ip of response1.data) {
            const response2 = await client.getLifecycleStates(ip.id)
            for (const s of response2.data) {
                const state = {
                    name: `${ip.name} - ${s.name}`,
                    value: s.id,
                    description: `${s.name} lifecycle state for ${ip.name} identity profile`,
                }
                entitlements.push(new LCS(state))
            }
        }

        return entitlements
    }

    const getLevelEntitlements = (): Level[] => {
        return levels.map((x) => new Level(x))
    }

    const getWorkgroupsWithMembers = async (): Promise<any> => {
        const workgroups: any[] = []
        for await (const response1 of client.workgroupAggregation()) {
            for (const workgroup of response1.data) {
                const response2 = await client.getWorkgroupMembership(workgroup.id)
                workgroup.members = response2.data
                workgroups.push(workgroup)
            }
        }

        return workgroups
    }

    const getAssignedWorkgroups = async (id: string, groups?: any[]): Promise<string[]> => {
        logger.info('Fetching workgroups')
        let workgroups: any[]
        if (groups) {
            workgroups = groups
        } else {
            workgroups = await getWorkgroupsWithMembers()
        }
        const assignedWorkgroups =
            workgroups
                .filter((w) => w.members.find((a: { externalId: string }) => a.externalId == id))
                .map((w) => w.id) || []

        return assignedWorkgroups
    }

    const getAssignedLevels = async (id: string, privilegedUsers?: any[]): Promise<string[]> => {
        logger.info('Fetching levels')
        let levels: string[]
        let accounts: any[]
        if (privilegedUsers) {
            const privilegedUser = privilegedUsers.find((x) => x.id === id)
            if (privilegedUser) {
                accounts = privilegedUser.accounts
            } else {
                accounts = []
            }
        } else {
            const response = await client.getIdentityAccounts(id)
            accounts = response.data
        }
        const idnAccount = accounts.find(
            (x) => x.sourceName === 'IdentityNow' || (x.source && x.source.name === 'IdentityNow')
        )
        if (idnAccount) {
            const attributes = idnAccount.attributes || idnAccount.entitlementAttributes
            levels = safeList(attributes ? attributes.assignedGroups : undefined)
        } else {
            levels = []
        }

        levels.push('user')

        return levels
    }

    const getAssignedLCS = async (rawAccount: any): Promise<string | null> => {
        logger.info('Fetching LCS')
        let lcs: string | null = null
        if (rawAccount.lifecycleState && rawAccount.lifecycleState.manuallyUpdated) {
            lcs = await getLCSByName(
                rawAccount.lifecycleState.stateName,
                rawAccount.attributes.cloudAuthoritativeSource
            )
        }

        return lcs
    }

    const getLCSByName = async (name: string, source: string): Promise<string | null> => {
        let lcs: string | null = null
        const response1 = await client.getIdentityProfiles()
        const identityProfile = response1.data.find(
            (x: { authoritativeSource: { id: string } }) => x.authoritativeSource.id === source
        )
        if (identityProfile) {
            const response2 = await client.getLifecycleStates(identityProfile.id)
            const lcsObject = response2.data.find((x: { technicalName: string }) => x.technicalName === name)
            if (lcsObject) lcs = lcsObject.id
        }

        return lcs
    }

    const isValidLCS = async (id: string, source: string): Promise<boolean> => {
        let found = false
        const response1 = await client.getIdentityProfiles()
        const identityProfile = response1.data.find(
            (x: { authoritativeSource: { id: string } }) => x.authoritativeSource.id === source
        )
        if (identityProfile) {
            const response2 = await client.getLifecycleStates(identityProfile.id)
            found = response2.data.indexOf((x: { id: string }) => x.id === id) >= 0
        }

        return found
    }

    const buildAccount = async (rawAccount: any, workgroups?: any[], privilegedUsers?: any[]): Promise<Account> => {
        logger.info(`Building account with uid ${rawAccount.attributes.uid}`)
        const account: Account = new Account(rawAccount)

        if (enableLevels) {
            account.attributes.levels = await getAssignedLevels(account.identity, privilegedUsers)
        }

        if (enableWorkgroups) {
            account.attributes.workgroups = await getAssignedWorkgroups(account.identity, workgroups)
        }

        if (enableLCS) {
            account.attributes.lcs = await getAssignedLCS(rawAccount)
        }

        return account
    }

    const provisionWorkgroups = async (action: AttributeChangeOp, id: string, workgroups: string[]) => {
        for (const workgroup of workgroups) {
            logger.info(`Governance Group| Executing ${action} operation for ${id}/${workgroup}`)
            if (action === AttributeChangeOp.Add) {
                await client.addWorkgroup(id, workgroup)
            } else if (action === AttributeChangeOp.Remove) {
                await client.removeWorkgroup(id, workgroup)
            }
        }
    }

    const provisionLevels = async (action: AttributeChangeOp, id: string, levels: string[]) => {
        logger.info(`Levels| Executing ${action} operation for ${id}/${levels}`)
        const response = await client.getCapabilities(id)
        const capabilities: string[] = response.data.capabilities || []
        let resultingRoles: string[] = []
        if (action === AttributeChangeOp.Add) {
            resultingRoles = [...levels, ...capabilities]
        } else if (action === AttributeChangeOp.Remove) {
            resultingRoles = capabilities.filter((x) => !levels.includes(x))
        }

        await client.provisionLevels(id, resultingRoles)
    }

    const provisionLCS = async (action: AttributeChangeOp, id: string, lcs: string) => {
        logger.info(`LCS| Executing ${action} operation for ${id}/${lcs}`)

        if (action === AttributeChangeOp.Remove) {
            // const response = await client.getAccountDetails(id)
            // const rawAccount = response.data
            // if (rawAccount.attributes.cloudLifecycleState) {
            //     const defaultLCS = await getLCSByName(
            //         rawAccount.attributes.cloudLifecycleState,
            //         rawAccount.attributes.cloudAuthoritativeSource
            //     )
            //     if (defaultLCS) {
            //         await client.setLifecycleState(id, defaultLCS)
            //     }
            // }
        } else {
            await client.setLifecycleState(id, lcs)
        }
    }

    const getAccount = async (id: string): Promise<Account> => {
        logger.info(`Getting details for account ID ${id}`)
        const response = await client.getAccountDetails(id)
        const account = await buildAccount(response.data)
        return account
    }

    return createConnector()
        .stdTestConnection(async (context: Context, input: undefined, res: Response<StdTestConnectionOutput>) => {
            const response1: AxiosResponse = await client.testConnection()
            const response2 = await client.getOathkeeperToken()
            if (response1.status != 200 || typeof response2 !== 'string') {
                throw new ConnectorError('Unable to connect to IdentityNow! Please check your Username and Password')
            } else {
                logger.info('Test successful!')
                res.send({})
            }
        })
        .stdAccountList(async (context: Context, input: StdAccountListInput, res: Response<StdAccountListOutput>) => {
            const groups: any[] = await getWorkgroupsWithMembers()
            let privilegedUsers: any[] = []

            for await (const response of client.getPrivilegedIdentities()) {
                privilegedUsers = [...privilegedUsers, ...response.data]
            }

            for await (const response of client.accountAggregation()) {
                for (const identity of response.data) {
                    const account = await buildAccount(identity, groups, privilegedUsers)
                    const levels = account.attributes.levels as string[]
                    const workgroups = account.attributes.workgroups as string[]
                    const lcs = account.attributes.lcs as string | null
                    if (levels.length > 1 || workgroups.length > 0 || lcs) {
                        logger.info(account)
                        res.send(account)
                    }
                }
            }
        })
        .stdAccountRead(async (context: Context, input: StdAccountReadInput, res: Response<StdAccountReadOutput>) => {
            logger.info(input)
            const account = await getAccount(input.identity)

            logger.info(account)
            res.send(account)
        })
        .stdEntitlementList(
            async (context: Context, input: StdEntitlementListInput, res: Response<StdEntitlementListOutput>) => {
                logger.info(input)
                let entitlements: StdEntitlementListOutput[] = []
                switch (input.type) {
                    case 'level':
                        if (enableLevels) {
                            entitlements = getLevelEntitlements()
                        }
                        break

                    case 'workgroup':
                        if (enableWorkgroups) {
                            entitlements = await getWorkgroupEntitlements()
                        }
                        break

                    case 'lcs':
                        if (enableLCS) {
                            entitlements = await getLCSEntitlements()
                        }
                        break

                    default:
                        throw new Error(`Unsupported entitlement type ${input.type}`)
                }
                for (const e of entitlements) {
                    logger.info(e)
                    res.send(e)
                }
            }
        )
        .stdEntitlementRead(
            async (context: Context, input: StdEntitlementReadInput, res: Response<StdEntitlementReadOutput>) => {
                logger.info(input)
                let entitlement

                switch (input.type) {
                    case 'level':
                        entitlement = getLevelEntitlements().find((x) => input.identity === x.identity)
                        break

                    case 'workgroup':
                        const response = await client.getWorkgroup(input.identity)
                        entitlement = new Workgroup(response.data)
                        break

                    case 'lcs':
                        entitlement = (await getLCSEntitlements()).find((x) => input.identity === x.identity)
                        break

                    default:
                        throw new Error(`Unsupported entitlement type ${input.type}`)
                }

                if (entitlement) {
                    logger.info(entitlement)
                    res.send(entitlement)
                }
            }
        )
        .stdAccountCreate(
            async (context: Context, input: StdAccountCreateInput, res: Response<StdAccountCreateOutput>) => {
                logger.info(input)
                const response = await client.getIdentityByUID(input.attributes.uid as string)
                let rawAccount = response.data

                if ('levels' in input.attributes) {
                    const levels = [].concat(input.attributes.levels).filter((x) => x !== 'user')
                    await provisionLevels(AttributeChangeOp.Add, rawAccount.id, levels)
                }

                if ('workgroups' in input.attributes) {
                    const workgroups = [].concat(input.attributes.workgroups)
                    await provisionWorkgroups(AttributeChangeOp.Add, rawAccount.id, workgroups)
                }

                if ('lcs' in input.attributes) {
                    if (await isValidLCS(input.attributes.lcs, rawAccount.attributes.cloudAuthoritativeSource)) {
                        await provisionLCS(AttributeChangeOp.Add, rawAccount.id, input.attributes.lcs)
                    } else {
                        logger.info(`Invalid lcs ${input.attributes.lcs}. Skipping.`)
                    }
                }

                const account = await getAccount(rawAccount.id)

                logger.info(account)
                res.send(account)
            }
        )
        .stdAccountUpdate(
            async (context: Context, input: StdAccountUpdateInput, res: Response<StdAccountUpdateOutput>) => {
                logger.info(input)

                if (input.changes) {
                    for (const change of input.changes) {
                        switch (change.attribute) {
                            case 'levels':
                                const levels = [].concat(change.value).filter((x) => x !== 'user')
                                await provisionLevels(change.op, input.identity, levels)
                                break
                            case 'workgroups':
                                const workgroups = [].concat(change.value)
                                await provisionWorkgroups(change.op, input.identity, workgroups)
                                break
                            case 'lcs':
                                const response = await client.getAccountDetails(input.identity)
                                const rawAccount = response.data
                                if (await isValidLCS(change.value, rawAccount.attributes.cloudAuthoritativeSource)) {
                                    await provisionLCS(change.op, input.identity, change.value)
                                } else {
                                    logger.info(`Invalid lcs ${change.value}. Skipping.`)
                                }
                                break
                            default:
                                break
                        }
                    }
                    //Need to investigate about std:account:update operations without changes but adding this for the moment
                } else if ('attributes' in input) {
                    logger.warn(
                        'No changes detected in account update. Please report unless you used attribute sync which is not supported.'
                    )
                }

                const account = await getAccount(input.identity)

                logger.info(account)
                res.send(account)
            }
        )
        .stdAccountDisable(async (context: Context, input: any, res: Response<any>) => {
            logger.info(input)
            let account = await getAccount(input.identity)

            await client.disableAccount(input.identity)
            //await sleep(5000)
            if (removeGroups) {
                const levels = (account.attributes.levels as string[]) || []
                await provisionLevels(AttributeChangeOp.Remove, input.identity, levels)
                const workgroups = (account.attributes.workgroups as string[]) || []
                await provisionWorkgroups(AttributeChangeOp.Remove, input.identity, workgroups)
            }
            account = await getAccount(input.identity)

            logger.info(account)
            res.send(account)
        })

        .stdAccountEnable(async (context: Context, input: any, res: Response<any>) => {
            logger.info(input)

            await client.enableAccount(input.identity)
            const account = await getAccount(input.identity)
            logger.info(account)
            res.send(account)
        })
}
