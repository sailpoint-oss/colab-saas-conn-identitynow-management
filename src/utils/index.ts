import { BaseAccount, IdentityDocument, Owner, Source, WorkflowBeta, WorkflowBodyOwnerBeta } from 'sailpoint-api-client'
import { SDKClient } from '../sdk-client'
import { EmailWorkflow } from '../model/emailWorkflow'
import { findIdenticalMatch, findSimilarMatches, findAccountSimilarMatches } from './matching'

export const WORKFLOW_NAME = 'Email Sender'
export const MSDAY = 86400000

export const getOwnerFromSource = (source: Source): Owner => {
    return {
        type: 'IDENTITY',
        id: source.owner.id,
    }
}

export const buildAttributeObject = (
    identity: IdentityDocument,
    attributes: string[]
): {
    [key: string]: any
} => {
    const attributeObject: {
        [key: string]: any
    } = {}
    if (identity.attributes) {
        Object.keys(identity.attributes)
            .filter((x: string) => attributes.includes(x))
            .map((x: string) => (attributeObject[x] = identity.attributes![x]))
    }

    return attributeObject
}

export const getCurrentSource = async (client: SDKClient, config: any): Promise<Source | undefined> => {
    const sources = await client.listSources()
    const source = sources.find((x) => (x.connectorAttributes as any).id === config.id)

    return source
}

export const getEmailWorkflow = async (
    client: SDKClient,
    name: string,
    owner: Owner
): Promise<WorkflowBeta | undefined> => {
    const workflows = await client.listWorkflows()
    let workflow = workflows.find((x) => x.name === name)
    if (!workflow) {
        const emailWorkflow = new EmailWorkflow(name, owner)
        workflow = await client.createWorkflow(emailWorkflow)
    }

    return workflow
}

export const getAccountFromIdentity = (identity: IdentityDocument, sourceID: string): BaseAccount | undefined => {
    return identity.accounts!.find((x) => x.source!.id === sourceID)
}

export const getIdentities = async (
    client: SDKClient,
    source: Source
): Promise<{ [key: string]: IdentityDocument[] }> => {
    const identities = (await client.listIdentities()).filter((x) => !x.protected)
    const processedIdentities: IdentityDocument[] = []
    const unprocessedIdentities: IdentityDocument[] = []
    for (const identity of identities) {
        if (identity.accounts!.find((x) => x.source!.id === source.id)) {
            processedIdentities.push(identity)
        } else if (identity.attributes!.cloudAuthoritativeSource) {
            unprocessedIdentities.push(identity)
        }
    }

    return { identities, processedIdentities, unprocessedIdentities }
}

export { findIdenticalMatch, findSimilarMatches, findAccountSimilarMatches }
