import axiosRetry from 'axios-retry'
import {
    Configuration,
    CreateFormDefinitionRequestBeta,
    CreateFormInstanceRequestBeta,
    CustomFormsBetaApi,
    CustomFormsBetaApiFactory,
    FormDefinitionResponseBeta,
    FormInstanceCreatedByBeta,
    FormInstanceRecipientBeta,
    FormInstanceResponseBeta,
    FormInstanceResponseBetaStateEnum,
    Paginator,
    Search,
    SearchApi,
    SourcesApi,
    Account,
    WorkflowsBetaApi,
    WorkflowsBetaApiCreateWorkflowRequest,
    WorkflowBeta,
    TestWorkflowRequestBeta,
    PostExternalExecuteWorkflowRequestBeta,
    WorkflowOAuthClientBeta,
    IdentityProfilesBetaApi,
    IdentityAttributeConfigBeta,
} from 'sailpoint-api-client'
import { AxiosRequestConfig } from 'axios'
import {
    AccountsApi,
    AccountsApiListAccountsRequest,
    EntitlementDocument,
    IdentityDocument,
    JsonPatchOperation,
    Transform,
    TransformsApi,
} from 'sailpoint-api-client/dist/v3'
import { URL } from 'url'

const TOKEN_URL_PATH = '/oauth/token'

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// type API = BaseAPIV3 | BaseAPIBeta | BaseAPIV2 | BaseAPICC

export class SDKClient {
    private config: Configuration
    private batchSize = 250

    constructor(config: any) {
        const tokenUrl = new URL(config.baseurl).origin + TOKEN_URL_PATH
        this.config = new Configuration({ ...config, tokenUrl })
        this.config.retriesConfig = {
            retries: 5,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: axiosRetry.isRetryableError,
        }
    }

    // async *paginate(api: API, fnc: (this: any, args: PaginationParams) => Promise<AxiosResponse>) {
    //     const response = await Paginator.paginate(api, fnc, undefined, this.batchSize)
    //     for (const item of response.data) {
    //         yield item
    //     }
    // }

    // async *paginateSearch(api: SearchApi, fnc: Search) {
    //     const response = await Paginator.paginateSearchApi(api, fnc, undefined, this.batchSize)
    //     for (const item of response.data) {
    //         yield item
    //     }
    // }

    async listIdentities(): Promise<IdentityDocument[]> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: '*',
            },
            sort: ['name'],
            includeNested: true,
        }

        const response = await Paginator.paginateSearchApi(api, search)
        return response.data
    }

    async getIdentityByUID(uid: string): Promise<IdentityDocument | undefined> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `attributes.uid.exact:"${uid}"`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        return response.data[0]
    }

    async listIdentitiesBySource(id: string): Promise<IdentityDocument[]> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `@accounts(source.id.exact:"${id}")`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        return response.data
    }

    async getIdentity(id: string): Promise<IdentityDocument | undefined> {
        const api = new SearchApi(this.config)
        const search: Search = {
            indices: ['identities'],
            query: {
                query: `id:${id}`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        return response.data[0]
    }

    async listAccountsBySource(id: string): Promise<Account[]> {
        const api = new AccountsApi(this.config)
        const filters = `sourceId eq "${id}"`
        const search = async (
            requestParameters?: AccountsApiListAccountsRequest | undefined,
            axiosOptions?: AxiosRequestConfig<any> | undefined
        ) => {
            return await api.listAccounts({ ...requestParameters, filters })
        }

        const response = await Paginator.paginate(api, search, undefined, this.batchSize)

        return response.data
    }

    async listUncorrelatedAccounts(): Promise<Account[]> {
        const api = new AccountsApi(this.config)
        const filters = 'uncorrelated eq true'
        const search = async (
            requestParameters?: AccountsApiListAccountsRequest | undefined,
            axiosOptions?: AxiosRequestConfig<any> | undefined
        ) => {
            return await api.listAccounts({ ...requestParameters, filters })
        }

        const response = await Paginator.paginate(api, search, undefined, this.batchSize)

        return response.data
    }

    // async getIdenticalIdentities(sourceId: string, attributes: object): Promise<IdentityDocument[]> {
    //     if (Object.keys(attributes).length > 0) {
    //         const conditions: string[] = []
    //         conditions.push(`@accounts(source.id:${sourceId})`)
    //         // conditions.push(`NOT attributes.uid.exact:"${uid}"`)
    //         for (const [key, value] of Object.entries(attributes) as [string, string][]) {
    //             conditions.push(`attributes.${key}.exact:"${value}"`)
    //         }
    //         const query = conditions.join(' AND ')
    //         const api = new SearchApi(this.config)
    //         const search: Search = {
    //             indices: ['identities'],
    //             query: {
    //                 query,
    //             },
    //             sort: ['-name'],
    //             includeNested: false,
    //         }

    //         const response = await Paginator.paginateSearchApi(api, search, undefined, this.batchSize)
    //         return response.data
    //     } else {
    //         return []
    //     }
    // }

    // async getSimilarIdentities(sourceId: string, attributes: object): Promise<IdentityDocument[]> {
    //     if (Object.keys(attributes).length > 0) {
    //         const conditions: string[] = []
    //         // conditions.push(`NOT attributes.uid.exact:"${uid}"`)
    //         conditions.push(`@accounts(source.id:${sourceId})`)
    //         for (const [key, value] of Object.entries(attributes) as [string, string][]) {
    //             const subconditions: string[] = []
    //             subconditions.push(`attributes.${key}.exact:/.*${value}.*/`)
    //             subconditions.push(`attributes.${key}:"${value}"~1`)
    //             const subquery = subconditions.join(' OR ')
    //             conditions.push(subquery)
    //         }
    //         const query = conditions.map((x) => `(${x})`).join(' AND ')
    //         const api = new SearchApi(this.config)
    //         const search: Search = {
    //             indices: ['identities'],
    //             query: {
    //                 query,
    //             },
    //             sort: ['-name'],
    //             includeNested: false,
    //         }

    //         const response = await Paginator.paginateSearchApi(api, search, undefined, this.batchSize)
    //         return response.data
    //     } else {
    //         return []
    //     }
    // }

    async listSources() {
        const api = new SourcesApi(this.config)

        const response = await Paginator.paginate(api, api.listSources)

        return response.data
    }

    async listSourceSchemas(sourceId: string) {
        const api = new SourcesApi(this.config)

        const response = await api.listSourceSchemas({ sourceId })

        return response.data
    }

    async listForms(): Promise<FormDefinitionResponseBeta[]> {
        const api = new CustomFormsBetaApi(this.config)

        const response = await api.searchFormDefinitionsByTenant()

        return response.data.results ? response.data.results : []
    }

    async deleteForm(formDefinitionID: string): Promise<void> {
        const api = new CustomFormsBetaApi(this.config)

        const response = await api.deleteFormDefinition({ formDefinitionID })
    }

    async listFormInstances(): Promise<FormInstanceResponseBeta[]> {
        const api = new CustomFormsBetaApi(this.config)

        const response = await api.searchFormInstancesByTenant()

        return response.data.results ? response.data.results : []
    }

    async createTransform(transform: Transform): Promise<Transform> {
        const api = new TransformsApi(this.config)

        const response = await api.createTransform({ transform })

        return response.data
    }

    async listWorkflows(): Promise<WorkflowBeta[]> {
        const api = new WorkflowsBetaApi(this.config)

        const response = await api.listWorkflows()

        return response.data
    }

    async correlateAccount(identityId: string, id: string): Promise<object> {
        const api = new AccountsApi(this.config)
        const jsonPatchOperation: JsonPatchOperation[] = [
            {
                op: 'replace',
                path: '/identityId',
                value: identityId,
            },
        ]
        const response = await api.updateAccount({ id, jsonPatchOperation })

        return response.data
    }

    async createForm(form: CreateFormDefinitionRequestBeta): Promise<FormDefinitionResponseBeta> {
        const api = new CustomFormsBetaApi(this.config)

        const response = await api.createFormDefinition({
            body: form,
        })

        return response.data
    }

    async createFormInstance(
        formDefinitionId: string,
        formInput: { [key: string]: any },
        recipientList: string[],
        sourceId: string,
        expire: string
    ): Promise<FormInstanceResponseBeta> {
        const api = CustomFormsBetaApiFactory(this.config)

        const recipients: FormInstanceRecipientBeta[] = recipientList.map((x) => ({ id: x, type: 'IDENTITY' }))
        const createdBy: FormInstanceCreatedByBeta = {
            id: sourceId,
            type: 'SOURCE',
        }
        const body: CreateFormInstanceRequestBeta = {
            formDefinitionId,
            recipients,
            createdBy,
            expire,
            formInput,
            standAloneForm: true,
        }

        const response = await api.createFormInstance(body)

        return response.data
    }

    async setFormInstanceState(
        formInstanceId: string,
        state: FormInstanceResponseBetaStateEnum
    ): Promise<FormInstanceResponseBeta> {
        const api = CustomFormsBetaApiFactory(this.config)

        const body: { [key: string]: any }[] = [
            {
                op: 'replace',
                path: '/state',
                value: state,
            },
        ]
        const response = await api.patchFormInstance(formInstanceId, body)

        return response.data
    }

    async createWorkflow(workflow: WorkflowsBetaApiCreateWorkflowRequest): Promise<WorkflowBeta> {
        const api = new WorkflowsBetaApi(this.config)

        const response = await api.createWorkflow(workflow)

        return response.data
    }

    async createWorkflowExternalTrigger(id: string): Promise<WorkflowOAuthClientBeta> {
        const api = new WorkflowsBetaApi(this.config)

        const response = await api.postWorkflowExternalTrigger({ id })

        return response.data
    }

    async testWorkflow(id: string, testWorkflowRequestBeta: TestWorkflowRequestBeta) {
        const api = new WorkflowsBetaApi(this.config)

        const response = await api.testWorkflow({
            id,
            testWorkflowRequestBeta,
        })
    }

    async triggerWorkflowExternal(
        id: string,
        postExternalExecuteWorkflowRequestBeta: PostExternalExecuteWorkflowRequestBeta
    ) {
        const api = new WorkflowsBetaApi(this.config)

        const response = await api.postExternalExecuteWorkflow({
            id,
            postExternalExecuteWorkflowRequestBeta,
        })
    }

    async listEntitlementsBySource(sourceId: string): Promise<EntitlementDocument[]> {
        const api = new SearchApi(this.config)

        const search: Search = {
            indices: ['entitlements'],
            query: {
                query: `source.id:${sourceId}`,
            },
            includeNested: true,
        }

        const response = await api.searchPost({ search })

        return response.data
    }

    async getTransformByName(name: string): Promise<Transform | undefined> {
        const api = new TransformsApi(this.config)

        const response = await api.listTransforms()

        return response.data.find((x) => x.name === name)
    }

    async testTransform(
        identityId: string,
        identityAttributeConfig: IdentityAttributeConfigBeta
    ): Promise<string | undefined> {
        const api = new IdentityProfilesBetaApi(this.config)

        const response = await api.generateIdentityPreview({
            identityPreviewRequestBeta: { identityId, identityAttributeConfig },
        })
        const attributes = response.data.previewAttributes
        const testAttribute = attributes?.find((x) => x.name === 'uid')

        return testAttribute && testAttribute.value ? testAttribute.value.toString() : undefined
    }
}
