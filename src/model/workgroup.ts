import { Attributes } from '@sailpoint/connector-sdk'

export class Workgroup {
    identity: string
    uuid: string
    type: string = 'workgroup'
    attributes: Attributes

    constructor(object: any) {
        this.attributes = {
            type: 'Governance group',
            name: object.name,
            id: object.id,
            description: object.description,
        }
        this.identity = this.attributes.id as string
        this.uuid = this.attributes.name as string
    }
}
