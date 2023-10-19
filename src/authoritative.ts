import {
    logger,
    ConnectorError,
    createConnector,
    StdAccountListHandler,
    StdTestConnectionHandler,
    StdAccountDiscoverSchemaHandler,
    SchemaAttribute,
    StdAccountReadHandler,
    ConnectorErrorType,
    Context,
} from '@sailpoint/connector-sdk'
import { SDKClient } from './sdk-client'
import { Account, IdentityAttributeConfigBeta, IdentityDocument, Source, WorkflowBeta } from 'sailpoint-api-client'
import { UniqueIDTransform } from './model/transform'
import { getOwnerFromSource, getCurrentSource, WORKFLOW_NAME, getEmailWorkflow, getIdentities } from './utils'
import { Email, ErrorEmail } from './model/email'
import { UniqueAccount } from './model/account'

const buildUniqueAccount = (account: Account): UniqueAccount => {
    return {
        identity: account.nativeIdentity,
        uuid: account.name,
        attributes: account.attributes,
    }
}

export const authoritative = async (config: any) => {
    const { baseurl, clientId, clientSecret, 'authoritative.transform': transform, id } = config
    const client = new SDKClient({ baseurl, clientId, clientSecret })
    const source = await getCurrentSource(client, config)

    if (!source) {
        throw new Error('No connector source was found on the tenant.')
    }

    const owner = getOwnerFromSource(source)
    const name = `${id} - ${WORKFLOW_NAME}`
    const workflow = await getEmailWorkflow(client, name, owner)

    if (!workflow) {
        throw new Error('Unable to instantiate email workflow')
    }

    const sendEmail = async (email: Email) => {
        await client.testWorkflow(workflow.id!, email)
    }

    const logErrors = async (workflow: WorkflowBeta | undefined, context: Context, input: any, errors: string[]) => {
        let lines = []
        lines.push(`Context: ${JSON.stringify(context)}`)
        lines.push(`Input: ${JSON.stringify(input)}`)
        lines.push('Errors:')
        lines = [...lines, ...errors]
        const message = lines.join('\n')
        const recipient = await client.getIdentity(source!.id!)
        const email = new ErrorEmail(source, recipient!.attributes!.email, message)

        if (workflow) {
            await client.testWorkflow(workflow!.id!, email)
        }
    }

    const getUniqueID = async (
        identity: IdentityDocument,
        currentIDs: string[],
        transformName: string | undefined,
        source: Source
    ): Promise<string | undefined> => {
        const transformRequest = new UniqueIDTransform(source.name)
        let name: string

        if (transformName) {
            name = transformName
        } else {
            name = transformRequest.name
        }

        let transform = await client.getTransformByName(name)
        if (!transform) {
            const transformRequest = new UniqueIDTransform(source.name)
            transform = await client.createTransform(transformRequest)
        }

        const transformDefinition = {
            type: 'accountAttribute',
            attributes: {
                applicationId: source.id,
                attributeName: 'id',
                sourceName: source.name,
                id: name,
                type: 'reference',
            },
        }
        const config: IdentityAttributeConfigBeta = {
            attributeTransforms: [{ identityAttributeName: 'uid', transformDefinition }],
            enabled: true,
        }

        let counter = 1
        let id = await client.testTransform(identity.id, config)
        let candidate = id
        if (id) {
            while (currentIDs.includes(candidate!)) {
                candidate = id + counter++
            }
        }

        return candidate
    }

    //==============================================================================================================

    const stdTest: StdTestConnectionHandler = async (context, input, res) => {
        if (source) {
            logger.info('Test successful!')
            res.send({})
        } else {
            throw new ConnectorError('Unable to connect to IdentityNow! Please check your Username and Password')
        }
    }

    const stdAccountList: StdAccountListHandler = async (context, input, res) => {
        const accounts: UniqueAccount[] = []
        const errors: string[] = []

        const { identities } = await getIdentities(client, source)
        const currentAccounts = await client.listAccountsBySource(source.id!)
        const currentIDs = currentAccounts.filter((x) => x.uncorrelated === false).map((x) => x.nativeIdentity)

        for (const identity of identities) {
            try {
                const currentAccount = currentAccounts.find((x) => x.identityId === identity.id)
                if (currentAccount) {
                    const account = buildUniqueAccount(currentAccount)
                    accounts.push(account)
                } else {
                    const uniqueID = await getUniqueID(identity, currentIDs, transform, source)
                    if (uniqueID) {
                        currentIDs.push(uniqueID)
                        const account: UniqueAccount = {
                            identity: uniqueID,
                            uuid: identity.attributes!.uid,
                            attributes: {
                                id: uniqueID,
                                name: identity.attributes!.uid,
                                email: identity.attributes!.email,
                            },
                        }
                        accounts.push(account)
                    } else {
                        const error = `Failed to generate unique ID for ${identity.attributes!.uid}`
                        logger.error(error)
                        errors.push(error)
                    }
                }
            } catch (error) {
                if (error instanceof Error) {
                    logger.error(error)
                    errors.push(error.message)
                }
            }
        }

        for (const account of accounts) {
            logger.info(account)
            res.send(account)
        }

        if (errors.length > 0) {
            await logErrors(workflow, context, input, errors)
        }
    }

    const stdAccountRead: StdAccountReadHandler = async (context, input, res) => {
        logger.info(input)
        const currentAccounts = await client.listAccountsBySource(source.id!)
        const currentAccount = currentAccounts.find((x) => x.nativeIdentity === input.identity)
        if (currentAccount) {
            const account = {
                identity: currentAccount.nativeIdentity,
                uuid: currentAccount.name,
                attributes: currentAccount.attributes,
            }
            logger.info(account)
            res.send(account)
        } else {
            throw new ConnectorError('Account not found', ConnectorErrorType.NotFound)
        }
    }

    const stdAccountDiscoverSchema: StdAccountDiscoverSchemaHandler = async (context, input, res) => {
        const attributes: SchemaAttribute[] = [
            {
                name: 'id',
                description: 'Unique ID',
                type: 'string',
            },
            {
                name: 'name',
                description: 'Name',
                type: 'string',
            },
            {
                name: 'email',
                description: 'Email',
                type: 'string',
            },
        ]

        const schema: any = {
            attributes,
            displayAttribute: 'name',
            identityAttribute: 'id',
        }

        logger.info(schema)
        res.send(schema)
    }

    return createConnector()
        .stdTestConnection(stdTest)
        .stdAccountList(stdAccountList)
        .stdAccountRead(stdAccountRead)
        .stdAccountDiscoverSchema(stdAccountDiscoverSchema)
}
