import { Attributes } from '@sailpoint/connector-sdk'

export class Account {
    identity: string
    uuid: string
    attributes: Attributes
    disabled: boolean

    constructor(object: any) {
        this.attributes = {
            id: object.id,
            name: object.name,
            firstName: object.attributes.firstname,
            lastName: object.attributes.lastname,
            displayName: object.attributes.displayName,
        }
        this.disabled = object.inactive
        this.identity = this.attributes.name as string
        this.uuid = this.attributes.name as string
    }
}
