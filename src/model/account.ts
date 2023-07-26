import { Attributes } from '@sailpoint/connector-sdk'

export class Account {
    identity: string
    uuid: string
    attributes: Attributes
    disabled: boolean

    constructor(object: any) {
        this.attributes = {
            id: object.externalId,
            name: object.alias,
            firstName: object.attributes.firstname,
            lastName: object.attributes.lastname,
            displayName: object.attributes.displayName,
        }
        this.disabled = !object.enabled
        this.identity = this.attributes.name as string
        this.uuid = this.attributes.name as string
    }
}
