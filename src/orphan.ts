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
import { OrphanAccount } from './model/account'
import { OrphanForm } from './model/form'
import {
    Account,
    FormDefinitionInputBeta,
    FormDefinitionResponseBeta,
    FormInstanceResponseBeta,
    IdentityDocument,
    WorkflowBeta,
} from 'sailpoint-api-client'
import { Review } from './model/review'
import { Email, ErrorEmail } from './model/email'
import {
    findAccountSimilarMatches,
    getCurrentSource,
    getEmailWorkflow,
    getIdentities,
    getOwnerFromSource,
    MSDAY,
    WORKFLOW_NAME,
} from './utils'

const rebuildOrphanAccount = (account: Account): OrphanAccount => {
    return {
        identity: account.nativeIdentity,
        uuid: account.name,
        attributes: account.attributes,
    }
}

const buildReviewerAccount = (identity: IdentityDocument): OrphanAccount => {
    const name = identity.attributes!.uid
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
            status: 'reviewer',
        },
    }
}

const updateAccounts = (account: OrphanAccount, accounts: OrphanAccount[]) => {
    const existingAccount = accounts.find((x) => x.identity === account.identity)
    if (existingAccount) {
        const history = (existingAccount.attributes.history ? existingAccount.attributes.history : []) as string[]
        existingAccount.attributes.history = [...history, ...(account.attributes.history as string[])]
        existingAccount.attributes.status = account.attributes.status
    } else {
        accounts.push(account)
    }
}

export const orphan = async (config: any) => {
    const FORM_NAME = 'Orphan account assignment'

    const {
        baseurl,
        clientId,
        clientSecret,
        'orphan.reviewers': reviewers,
        'orphan.expirationDays': expirationDays,
        'orphan.score': score,
        'orphan.attributes': attributes,
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

    const getFormName = (account: Account): string => {
        return `${FORM_NAME} - ${account.nativeIdentity} (${account.sourceName})`
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
                if (decision === OrphanForm.ORPHAN_ACCOUNT) {
                    id = currentFormInstance.formInput!.id.toString()
                    message = `Orphan account confirmed by ${reviewerName}`
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
        const accounts: OrphanAccount[] = []
        const errors: string[] = []

        const { identities } = await getIdentities(client, source)

        const processedAccounts: Account[] = await client.listAccountsBySource(source.id!)

        for (const pa of processedAccounts) {
            const account = rebuildOrphanAccount(pa)
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
        const uncorrelatedAccounts = await client.listUncorrelatedAccounts()

        for (const uncorrelatedAccount of uncorrelatedAccounts) {
            if (uncorrelatedAccount.name) {
                let finished = false
                const formName = getFormName(uncorrelatedAccount)
                const currentReview = reviews.find((x) => x.name === formName)
                const currentForm = forms.find((x) => x.name === formName)

                if (currentReview && currentForm) {
                    const currentFormInstance = formInstances.find((x) => x.formDefinitionId === currentReview.value)
                    if (currentFormInstance) {
                        try {
                            const {
                                id: identityMatchId,
                                message,
                                state,
                                error,
                            } = await processManualReviews(currentFormInstance)
                            let account: OrphanAccount
                            let status: string
                            if (error) {
                                logger.error(error)
                                errors.push(error)
                            }

                            switch (state) {
                                case 'COMPLETED':
                                    const identityMatch = identities.find((x) => x.id === identityMatchId)
                                    if (identityMatch) {
                                        await client.correlateAccount(identityMatch.id, uncorrelatedAccount.id!)
                                        status = 'correlated'
                                    } else {
                                        status = 'orphan'
                                    }
                                    account = new OrphanAccount(uncorrelatedAccount, message, status)
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

                                    status = 'pending'
                                    account = new OrphanAccount(uncorrelatedAccount, message, status)
                                    updateAccounts(account, accounts)
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
                        } catch (e) {
                            if (e instanceof Error) {
                                logger.error(e.message)
                                errors.push(e.message)
                            }
                        }
                    }
                }
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
            const processedAccounts: Account[] = await client.listAccountsBySource(source.id!)
            const { identities } = await getIdentities(client, source)

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

            const getInputFromDescription = (
                p: { [key: string]: string },
                c: FormDefinitionInputBeta
            ): { [key: string]: string } => {
                p[c.id!] = c.description!
                return p
            }
            const formOwner = getOwnerFromSource(source)
            const expire = new Date(new Date().valueOf() + MSDAY * expirationDays).toISOString()
            const forms = await client.listForms()
            const formInstances = await client.listFormInstances()

            let form: FormDefinitionResponseBeta | undefined
            const uncorrelatedAccounts = await client.listUncorrelatedAccounts()
            for (const uncorrelatedAccount of uncorrelatedAccounts) {
                try {
                    const processedAccount = processedAccounts.find(
                        (x) =>
                            x.nativeIdentity === uncorrelatedAccount.nativeIdentity &&
                            x.attributes.source === uncorrelatedAccount.sourceName
                    )
                    if (!uncorrelatedAccount.name || processedAccount || uncorrelatedAccount.sourceId === source.id) {
                        continue
                    }
                    let currentFormInstance: FormInstanceResponseBeta | undefined
                    const formName = getFormName(uncorrelatedAccount)
                    form = forms.find((x) => x.name! === formName)
                    if (form) {
                        currentFormInstance = formInstances.find(
                            (x) => x.formDefinitionId === form!.id && !['COMPLETED', 'CANCELLED'].includes(x.state!)
                        )
                    } else {
                        const similarMatches = findAccountSimilarMatches(
                            uncorrelatedAccount,
                            identities,
                            attributes,
                            score
                        )

                        if (similarMatches.length === 0) {
                            continue
                        }

                        const inputForm = new OrphanForm(
                            formName,
                            formOwner,
                            uncorrelatedAccount,
                            similarMatches,
                            attributes
                        )
                        logger.info(`Creating form ${formName}`)
                        form = await client.createForm(inputForm)
                    }

                    if (currentFormInstance) {
                        logger.info(`Previous form instance found for ${formName}`)
                    } else {
                        const formInput = form.formInput?.reduce(getInputFromDescription, {})
                        logger.info(`Creating form instance for ${formName}`)
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
                        uncorrelatedAccount.name,
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
                    name: 'source',
                    description: 'Source name',
                    type: 'string',
                },
                {
                    name: 'history',
                    description: 'History',
                    type: 'string',
                    multi: true,
                },
                {
                    name: 'reviews',
                    description: 'Reviews',
                    type: 'string',
                    multi: true,
                    entitlement: true,
                    schemaObjectType: 'review',
                },
                {
                    name: 'status',
                    description: 'Status',
                    type: 'string',
                    entitlement: true,
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
