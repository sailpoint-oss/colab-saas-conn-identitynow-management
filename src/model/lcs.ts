import { Attributes } from '@sailpoint/connector-sdk'

export class LCS {
    identity: string
    uuid: string
    type: string = 'lcs'
    attributes: Attributes

    constructor(object: any) {
        this.attributes = {
            type: 'Lifecycle state',
            name: object.name,
            id: object.value,
            description: object.description,
        }
        this.identity = this.attributes.id as string
        this.uuid = this.attributes.name as string
    }
}
