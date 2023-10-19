import {
    logger,
    ConnectorError,
    createConnector,
    StdAccountListHandler,
    StdTestConnectionHandler,
    StdAccountDiscoverSchemaHandler,
    StdEntitlementListHandler,
    Context,
} from '@sailpoint/connector-sdk'
import { SDKClient } from './sdk-client'
import { MergedAccount } from './model/account'
import { UniqueForm } from './model/form'
import {
    Account,
    BaseAccount,
    FormDefinitionInputBeta,
    FormDefinitionResponseBeta,
    FormInstanceResponseBeta,
    IdentityDocument,
    WorkflowBeta,
} from 'sailpoint-api-client'
import { Review } from './model/review'
import { Email, ErrorEmail } from './model/email'
import {
    findIdenticalMatch,
    findSimilarMatches,
    getAccountFromIdentity,
    getCurrentSource,
    getEmailWorkflow,
    getIdentities,
    getOwnerFromSource,
    MSDAY,
    WORKFLOW_NAME,
} from './utils'

const buildReviewerAccount = (identity: IdentityDocument): MergedAccount => {
    const name = identity.name
    const source = identity.source!.name as string
    return {
        identity: name,
        uuid: name,
        attributes: {
            id: name,
            name,
            source,
            history: [],
            reviews: [],
            status: ['reviewer'],
        },
    }
}

const updateAccounts = (account: MergedAccount, accounts: MergedAccount[]) => {
    const existingAccount = accounts.find((x) => x.identity === account.identity)
    if (existingAccount) {
        const status = new Set([
            ...(existingAccount.attributes.status as string[]),
            ...(account.attributes.status as string[]),
        ])
        existingAccount.attributes.status = [...status]

        existingAccount.attributes.history = [
            ...(existingAccount.attributes.history as string[]),
            ...(account.attributes.history as string[]),
        ]
    } else {
        accounts.push(account)
    }
}

export const merging = async (config: any) => {
    const FORM_NAME = 'Identity Merge'

    const {
        baseurl,
        clientId,
        clientSecret,
        'merging.attributes': attributes,
        'merging.reviewers': reviewers,
        'merging.expirationDays': expirationDays,
        'merging.score': score,
        id,
    } = config
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

    const getFormName = (identity: IdentityDocument): string => {
        return `${FORM_NAME} - ${identity.name}`
    }

    const processManualReviews = async (
        currentFormInstance: FormInstanceResponseBeta
    ): Promise<{ [key: string]: any }> => {
        let id: string | undefined
        let message: string | undefined
        let state = currentFormInstance.state
        let error: string | undefined

        if (state === 'COMPLETED') {
            const decision = currentFormInstance.formData!['identities'].toString()
            const reviewer = await client.getIdentity(currentFormInstance.recipients![0].id!)
            if (reviewer) {
                const reviewerName = reviewer.displayName ? reviewer.displayName : reviewer.name
                if (decision === UniqueForm.NEW_IDENTITY) {
                    id = currentFormInstance.formInput!.id.toString()
                    message = `New identity approved by ${reviewerName}`
                } else {
                    id = decision
                    const account = currentFormInstance.formInput!.account.toString()
                    const source = currentFormInstance.formInput!.source.toString()
                    message = `Assignment of ${account} from ${source} approved by ${reviewerName}`
                }
            } else {
                error = `Recipient for form not found (${decision})`
            }
        }

        return { id, message, state, error }
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
        const accounts: MergedAccount[] = []
        const errors: string[] = []

        const { identities, processedIdentities, unprocessedIdentities } = await getIdentities(client, source)

        const processedAccounts: Account[] = await client.listAccountsBySource(source.id!)

        for (const pa of processedAccounts) {
            const account = new MergedAccount(pa)
            accounts.push(account)
        }

        const reviewerIdentities = identities.filter((x) => reviewers.includes(x.attributes!.uid))
        if (reviewerIdentities.length === 0) {
            const error = 'No reviewers were found'
            logger.error(error)
            errors.push(error)
            await logErrors(workflow, context, input, errors)
            throw new ConnectorError(
                'Unable to find any reviewer from the list. Please check the values exist and try again.'
            )
        } else if (reviewerIdentities.length < reviewers.length) {
            const error = 'Some reviewers were not found'
            logger.error(error)
            errors.push(error)
        }

        for (const ri of reviewerIdentities) {
            const account = buildReviewerAccount(ri)
            updateAccounts(account, accounts)
        }

        const outstandingReviews: string[] = []
        const forms = await client.listForms()
        const formInstances = await client.listFormInstances()
        const reviews = await client.listEntitlementsBySource(source.id!)

        for (const ui of unprocessedIdentities) {
            const formName = getFormName(ui)
            const currentReview = reviews.find((x) => x.name === formName)
            const currentForm = forms.find((x) => x.name === formName)

            if (processedIdentities.length > 0) {
                try {
                    const unprocessedAccount = getAccountFromIdentity(
                        ui,
                        ui.attributes!.cloudAuthoritativeSource
                    ) as BaseAccount
                    const identicalMatch = findIdenticalMatch(ui, processedIdentities, attributes)

                    if (identicalMatch) {
                        const uniqueAccount = processedAccounts.find(
                            (x) => x.identityId === identicalMatch.id
                        ) as Account

                        await client.correlateAccount(identicalMatch.id, unprocessedAccount.id!)
                        const message = 'Identical match found'
                        const account = new MergedAccount(uniqueAccount.name, message, 'auto')
                        updateAccounts(account, accounts)
                        continue
                    } else if (currentReview && currentForm) {
                        const currentFormInstance = formInstances.find(
                            (x) => x.formDefinitionId === currentReview.value
                        )
                        let finished = false
                        if (currentFormInstance) {
                            const {
                                id: identityMatchId,
                                message,
                                state,
                                error,
                            } = await processManualReviews(currentFormInstance)
                            if (error) {
                                logger.error(error)
                                errors.push(error)
                            }

                            switch (state) {
                                case 'COMPLETED':
                                    const identityMatch = processedIdentities.find((x) => x.id === identityMatchId)
                                    let account: MergedAccount
                                    if (identityMatch) {
                                        const uniqueAccount = processedAccounts.find(
                                            (x) => x.identityId === identityMatch.id
                                        ) as Account
                                        await client.correlateAccount(identityMatch.id, unprocessedAccount.id!)
                                        account = new MergedAccount(uniqueAccount.name, message, 'manual')
                                    } else {
                                        const uniqueID = ui.attributes!.uid
                                        account = new MergedAccount(uniqueID, message, 'authorized')
                                    }

                                    updateAccounts(account, accounts)
                                    finished = true
                                    break

                                case 'CANCELLED':
                                    logger.info(`${formName} was cancelled`)
                                    finished = true
                                    break

                                case 'ASSIGNED':
                                    logger.info(`Sending email notifications for ${formName}`)
                                    const reviewerEmails = reviewerIdentities.map(
                                        (x) => x.attributes!.email
                                    ) as string[]
                                    const email = new Email(reviewerEmails, formName, currentFormInstance)
                                    await sendEmail(email)

                                    await client.setFormInstanceState(currentFormInstance.id!, 'IN_PROGRESS')
                                    break

                                default:
                                    logger.info(`No decision made yet for ${formName}`)
                            }

                            if (finished) {
                                try {
                                    logger.info(`Deleting form ${currentForm.name}`)
                                    await client.deleteForm(currentReview!.value!)
                                } catch (e) {
                                    const error = `Error deleting form with ID ${currentReview!.value!}`
                                    logger.error(error)
                                    errors.push(error)
                                }
                            } else {
                                outstandingReviews.push(currentReview.value!)
                            }
                        }
                    }
                } catch (e) {
                    if (e instanceof Error) {
                        logger.error(e.message)
                        errors.push(e.message)
                    }
                }
            } else {
                const message = 'Found on first run'
                const account = new MergedAccount(ui.attributes!.uid, message, 'initial')

                updateAccounts(account, accounts)
            }
        }

        for (const account of accounts) {
            if (reviewers.includes(account.identity)) {
                account.attributes.reviews = outstandingReviews
            }
            logger.info(account)
            res.send(account)
        }

        if (errors.length > 0) {
            await logErrors(workflow, context, input, errors)
        }
    }

    const stdEntitlementList: StdEntitlementListHandler = async (context, input, res) => {
        logger.info(input)
        const errors: string[] = []
        if (input.type === 'review') {
            const { identities, processedIdentities, unprocessedIdentities } = await getIdentities(client, source)

            const reviewerIdentities = identities.filter((x) => reviewers.includes(x.attributes!.uid))
            if (reviewerIdentities.length === 0) {
                const error = 'No reviewers were found'
                logger.error(error)
                errors.push(error)
                await logErrors(workflow, context, input, errors)
                throw new ConnectorError(
                    'Unable to find any reviewer from the list. Please check the values exist and try again.'
                )
            } else if (reviewerIdentities.length < reviewers.length) {
                const error = 'Some reviewers were not found'
                logger.error(error)
                errors.push(error)
            }

            if (processedIdentities.length > 0 && reviewerIdentities.length > 0) {
                const getInputFromDescription = (
                    p: { [key: string]: string },
                    c: FormDefinitionInputBeta
                ): { [key: string]: string } => {
                    p[c.id!] = c.description!
                    return p
                }
                const formOwner = { id: source.owner.id, type: source.owner.type }
                const expire = new Date(new Date().valueOf() + MSDAY * expirationDays).toISOString()
                const forms = await client.listForms()
                const formInstances = await client.listFormInstances()

                let form: FormDefinitionResponseBeta | undefined
                for (const ui of unprocessedIdentities) {
                    try {
                        let currentFormInstance: FormInstanceResponseBeta | undefined
                        const formName = getFormName(ui)
                        form = forms.find((x) => x.name! === formName)
                        if (form) {
                            currentFormInstance = formInstances.find(
                                (x) => x.formDefinitionId === form!.id && !['COMPLETED', 'CANCELLED'].includes(x.state!)
                            )
                        } else {
                            const similarMatches = findSimilarMatches(ui, processedIdentities, attributes, score)
                            if (similarMatches.length === 0) {
                                continue
                            }
                            const inputForm = new UniqueForm(formName, formOwner, ui, similarMatches, attributes)
                            form = await client.createForm(inputForm)
                        }

                        if (currentFormInstance) {
                            logger.info(`Previous form instance found for ${formName}`)
                        } else {
                            const formInput = form.formInput?.reduce(getInputFromDescription, {})
                            currentFormInstance = await client.createFormInstance(
                                form.id!,
                                formInput!,
                                reviewerIdentities.map((x) => x.id),
                                source.id!,
                                expire
                            )
                            logger.info(
                                `Form URL for ${reviewerIdentities.map((x) => x.name)}: ${
                                    currentFormInstance.standAloneFormUrl
                                }`
                            )
                        }

                        const review = new Review(
                            currentFormInstance.formDefinitionId!,
                            formName,
                            ui.attributes!.uid,
                            currentFormInstance.standAloneFormUrl!
                        )

                        logger.info(review)
                        res.send(review)
                    } catch (e) {
                        if (e instanceof Error) {
                            logger.error(e.message)
                            errors.push(e.message)
                        }
                    }
                }
            }
        }
        if (errors.length > 0) {
            await logErrors(workflow, context, input, errors)
        }
    }

    const stdAccountDiscoverSchema: StdAccountDiscoverSchemaHandler = async (context, input, res) => {
        const schema: any = {
            attributes: [
                {
                    name: 'id',
                    description: 'ID',
                    type: 'string',
                },
                {
                    name: 'name',
                    description: 'Name',
                    type: 'string',
                },
                {
                    name: 'history',
                    description: 'History',
                    type: 'string',
                    multi: true,
                },
                {
                    name: 'status',
                    description: 'Status',
                    type: 'string',
                    multi: true,
                    entitlement: true,
                },
                {
                    name: 'reviews',
                    description: 'Reviews',
                    type: 'string',
                    multi: true,
                    entitlement: true,
                    schemaObjectType: 'review',
                },
            ],
            displayAttribute: 'name',
            identityAttribute: 'id',
        }

        logger.info(schema)
        res.send(schema)
    }

    return createConnector()
        .stdTestConnection(stdTest)
        .stdAccountList(stdAccountList)
        .stdEntitlementList(stdEntitlementList)
        .stdAccountDiscoverSchema(stdAccountDiscoverSchema)
}
