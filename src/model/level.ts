import { Attributes } from '@sailpoint/connector-sdk'

export class Level {
    identity: string
    uuid: string
    type: string = 'level'
    attributes: Attributes

    constructor(object: any) {
        this.attributes = {
            type: 'Level',
            name: object.name,
            id: object.value,
            description: object.description,
        }
        this.identity = this.attributes.id as string
        this.uuid = this.attributes.name as string
    }
}
