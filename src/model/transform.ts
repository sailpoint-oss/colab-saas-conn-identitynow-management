import { Transform, TransformAttributes, TransformTypeEnum } from 'sailpoint-api-client'

export class LCSTransform implements Transform {
    name: string
    type: TransformTypeEnum
    attributes: any

    constructor(sourceName: string) {
        this.name = `${sourceName} LCS`
        this.type = 'conditional'
        this.attributes = {
            expression: '$status eq -',
            positiveCondition: 'onboarding',
            negativeCondition: 'active',
            status: {
                type: 'firstValid',
                attributes: {
                    values: [
                        {
                            type: 'trim',
                        },
                        '-',
                    ],
                },
            },
        }
    }
}

export class SelectUniqueIDTransform implements Transform {
    name: string
    type: TransformTypeEnum
    attributes: TransformAttributes

    constructor(sourceName: string) {
        this.name = `Select ${sourceName} ID`
        this.type = 'firstValid'
        this.attributes = {
            values: [
                {
                    type: 'accountAttribute',
                    attributes: {
                        sourceName,
                        attributeName: 'id',
                    },
                },
                {
                    type: 'trim',
                },
            ],
        }
    }
}

export class UniqueIDTransform implements Transform {
    name: string
    type: TransformTypeEnum
    attributes: any

    constructor(sourceName: string) {
        this.name = `${sourceName} ID`
        this.type = 'static'
        this.attributes = {
            value: '$firstname.$lastname',
            firstname: {
                type: 'identityAttribute',
                attributes: {
                    name: 'firstname',
                },
            },
            lastname: {
                type: 'identityAttribute',
                attributes: {
                    name: 'lastname',
                },
            },
        }
    }
}
