import { Attributes } from '@sailpoint/connector-sdk'

export class Review {
    identity: string
    uuid: string
    type: string
    attributes: Attributes

    constructor(id: string, name: string, entity: string, url: string) {
        this.attributes = {
            id,
            name,
            entity,
            url,
            description: url,
        }
        this.type = 'review'
        this.identity = this.attributes.id as string
        this.uuid = this.attributes.name as string
    }
}
