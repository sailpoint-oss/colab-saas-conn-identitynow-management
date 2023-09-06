import { Attributes } from '@sailpoint/connector-sdk'

const isDisabled = (object: any): boolean => {
    const status = object.identityStatus || object.status
    return status === 'DISABLED'
}

export class Account {
    identity: string
    uuid: string
    attributes: Attributes
    disabled: boolean

    constructor(object: any) {
        this.attributes = {
            id: object.id,
            name: object.alias || object.name,
            firstName: object.attributes.firstname,
            lastName: object.attributes.lastname,
            displayName: object.attributes.displayname,
        }
        this.disabled = isDisabled(object)
        this.identity = this.attributes.id as string
        this.uuid = this.attributes.name as string
    }
}
