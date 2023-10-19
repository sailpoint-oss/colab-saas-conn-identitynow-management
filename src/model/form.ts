import {
    Account,
    BaseAccount,
    ConditionEffectBeta,
    CreateFormDefinitionRequestBeta,
    FormConditionBeta,
    FormDefinitionInputBeta,
    FormDefinitionInputBetaTypeEnum,
    FormElementBeta,
    FormOwnerBeta,
    IdentityDocument,
    Owner,
    SourceOwner,
} from 'sailpoint-api-client'

type Option = { label: string; value: string; subLabel?: string | null }

const buildFormDefinitionInput = (name: any, description?: any): FormDefinitionInputBeta => {
    let id = null
    if (name) {
        id = name.toString()
    }
    let desc = null
    if (description) {
        desc = description.toString()
    }
    const input: FormDefinitionInputBeta = {
        id,
        type: FormDefinitionInputBetaTypeEnum.String,
        label: name,
        description: desc,
    }

    return input
}

const buildFormDefinitionTextElement = (key: string, label: any): FormElementBeta => {
    const element: FormElementBeta = {
        id: key,
        key,
        elementType: 'TEXT',
        config: {
            label,
        },
    }

    return element
}

const buildFormDefinitionSelectElement = (key: string, label: any, options: Option[]): FormElementBeta => {
    const element: FormElementBeta = {
        config: {
            dataSource: {
                config: {
                    options,
                },
                dataSourceType: 'STATIC',
            },
            forceSelect: true as any,
            label,
            maximum: 1 as any,
            required: true as any,
        },
        elementType: 'SELECT',
        id: key,
        key,
        validations: [
            {
                validationType: 'REQUIRED',
            },
        ],
    }

    return element
}

const buildTopSection = (label: string, description: string, attributes: string[]): FormElementBeta => {
    return {
        id: 'topSection',
        key: 'topSection',
        elementType: 'SECTION',
        config: {
            alignment: 'CENTER' as any,
            description: description as any,
            label: label as any,
            labelStyle: 'h2' as any,
            showLabel: true as any,
            formElements: attributes.map((x) => buildFormDefinitionTextElement(x, x)),
        },
    }
}

const buildSelectionSection = (attributes: string[]): FormElementBeta => {
    return {
        id: 'selectionSection',
        key: 'selectionSection',
        elementType: 'SECTION',
        config: {
            alignment: 'CENTER' as any,
            label: 'Identity details' as any,
            labelStyle: 'h4' as any,
            showLabel: true as any,
            formElements: attributes.map((x) => buildFormDefinitionTextElement(`${x}.selected`, x)),
        },
    }
}

const buildIdentitiesSection = (options: Option[]): FormElementBeta => {
    return {
        id: 'identitiesSection',
        key: 'identitiesSection',
        elementType: 'SECTION',
        config: {
            alignment: 'CENTER' as any,
            label: 'Existing identities' as any,
            labelStyle: 'h3' as any,
            showLabel: true as any,
            formElements: [buildFormDefinitionSelectElement('identities', 'Identities', options)],
        },
    }
}

const buildOptions = (targets: IdentityDocument[], label: string, value: string): Option[] => {
    const options: Option[] = targets.map((x) => ({
        label: x.displayName ? x.displayName : x.name,
        value: x.id,
    }))
    options.push({ label, value })

    return options
}

const buildUniqueFormConditions = (
    attributes: string[],
    targets: IdentityDocument[],
    value: string
): FormConditionBeta[] => {
    const formConditions: FormConditionBeta[] = [
        {
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'ELEMENT',
                    source: 'identities',
                    operator: 'EQ',
                    valueType: 'STRING',
                    value: value as any,
                },
            ],
            effects: [
                {
                    effectType: 'HIDE',
                    config: {
                        element: 'selectionSection' as any,
                    },
                },
            ],
        },
        {
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'ELEMENT',
                    source: 'identities',
                    operator: 'EM',
                    valueType: 'STRING',
                    value: null as any,
                },
            ],
            effects: [
                {
                    effectType: 'HIDE',
                    config: {
                        element: 'selectionSection' as any,
                    },
                },
            ],
        },
        {
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'ELEMENT',
                    source: 'identities',
                    operator: 'NOT_EM',
                    valueType: 'STRING',
                    value: null as any,
                },
            ],
            effects: attributes.map((x) => ({
                effectType: 'DISABLE',
                config: {
                    element: `${x}.selected`,
                },
            })) as any[],
        },
    ]

    for (const attribute of attributes) {
        formConditions.push({
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'INPUT',
                    source: `${value}.${attribute}`,
                    operator: 'NOT_EM',
                    valueType: 'STRING',
                    value: null as any,
                },
            ],
            effects: [
                {
                    effectType: 'SET_DEFAULT_VALUE',
                    config: {
                        defaultValueLabel: `${value}.${attribute}` as any,
                        element: attribute as any,
                    },
                },
                {
                    effectType: 'DISABLE',
                    config: {
                        element: attribute as any,
                    },
                },
            ],
        })
    }

    for (const target of targets) {
        const attrs = attributes.filter((x) => x in target.attributes!)
        formConditions.push({
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'ELEMENT',
                    source: 'identities',
                    operator: 'EQ',
                    valueType: 'STRING',
                    value: target.id as any,
                },
            ],
            effects: [
                {
                    effectType: 'SHOW',
                    config: {
                        element: 'selectionSection' as any,
                    },
                },
                ...attrs.map<ConditionEffectBeta>((attribute) => ({
                    effectType: 'SET_DEFAULT_VALUE',
                    config: {
                        defaultValueLabel: `${target.id}.${attribute}` as any,
                        element: `${attribute}.selected` as any,
                    },
                })),
            ],
        })
    }

    return formConditions
}

const buildOrphanFormConditions = (
    attributes: string[],
    targets: IdentityDocument[],
    value: string
): FormConditionBeta[] => {
    const formConditions: FormConditionBeta[] = []

    for (const attribute of attributes) {
        formConditions.push({
            ruleOperator: 'AND',
            rules: [
                {
                    sourceType: 'INPUT',
                    source: `${value}.${attribute}`,
                    operator: 'NOT_EM',
                    valueType: 'STRING',
                    value: null as any,
                },
            ],
            effects: [
                {
                    effectType: 'SET_DEFAULT_VALUE',
                    config: {
                        defaultValueLabel: `${value}.${attribute}` as any,
                        element: attribute as any,
                    },
                },
                {
                    effectType: 'DISABLE',
                    config: {
                        element: attribute as any,
                    },
                },
                {
                    effectType: 'SET_DEFAULT_VALUE',
                    config: {
                        defaultValueLabel: `${value}.${attribute}` as any,
                        element: attribute as any,
                    },
                },
            ],
        })
    }

    return formConditions
}

export class UniqueForm implements CreateFormDefinitionRequestBeta {
    public static NEW_IDENTITY = '#newIdentity#'
    name: string
    formInput: FormDefinitionInputBeta[] | undefined
    formElements: FormElementBeta[] | undefined
    formConditions: FormConditionBeta[] | undefined
    owner: FormOwnerBeta

    constructor(
        name: string,
        owner: SourceOwner,
        identity: IdentityDocument,
        targets: IdentityDocument[],
        attributes: string[]
    ) {
        this.name = name
        this.owner = owner
        this.formInput = []
        for (const attribute of attributes) {
            for (const target of targets) {
                if (attribute in target.attributes!) {
                    const name = `${target.id}.${attribute}`
                    this.formInput.push(buildFormDefinitionInput(name, target.attributes![attribute]))
                }
            }
            const name = `${UniqueForm.NEW_IDENTITY}.${attribute}`
            this.formInput.push(buildFormDefinitionInput(name, identity.attributes![attribute]))
        }
        const nativeAccount = identity.accounts!.find(
            (x) => x.source!.id === identity.attributes!.cloudAuthoritativeSource
        ) as BaseAccount

        this.formInput.push(buildFormDefinitionInput('id', identity.id))
        this.formInput.push(buildFormDefinitionInput('account', nativeAccount.name))
        this.formInput.push(buildFormDefinitionInput('source', nativeAccount.source?.name))

        const options = buildOptions(targets, 'This is a new identy', UniqueForm.NEW_IDENTITY)
        const label = 'Identity merge request'
        const description =
            'Potentially duplicated identity was found. Please review the list of possible matches from existing identities and select the right one.'

        const topSection = buildTopSection(label, description, attributes)
        const identitiesSection = buildIdentitiesSection(options)
        const selectionSection = buildSelectionSection(attributes)

        this.formElements = [topSection, identitiesSection, selectionSection]
        this.formConditions = buildUniqueFormConditions(attributes, targets, UniqueForm.NEW_IDENTITY)
    }
}

export class OrphanForm implements CreateFormDefinitionRequestBeta {
    public static ORPHAN_ACCOUNT = '#orphanAccount#'
    name: string
    description: string
    formInput: FormDefinitionInputBeta[] | undefined
    formElements: FormElementBeta[] | undefined
    formConditions: FormConditionBeta[] | undefined
    owner: FormOwnerBeta

    constructor(name: string, owner: Owner, account: Account, targets: IdentityDocument[], attributes: string[]) {
        const friendlyName = `${account.name}@${account.sourceName}`
        this.name = name
        this.owner = owner as FormOwnerBeta
        this.description = friendlyName
        this.formInput = []
        for (const attribute of attributes) {
            for (const target of targets) {
                if (attribute in target.attributes!) {
                    const name = `${target.id}.${attribute}`
                    this.formInput.push(buildFormDefinitionInput(name, target.attributes![attribute]))
                }
            }
            const name = `${OrphanForm.ORPHAN_ACCOUNT}.${attribute}`
            this.formInput.push(buildFormDefinitionInput(name, account.attributes![attribute]))
        }
        this.formInput.push(buildFormDefinitionInput('id', account.id))
        this.formInput.push(buildFormDefinitionInput('account', account.name))
        this.formInput.push(buildFormDefinitionInput('source', account.sourceName))

        const options = buildOptions(targets, 'I cannot find a match', OrphanForm.ORPHAN_ACCOUNT)
        const label = `${friendlyName} orphan account assignment request`
        const description = `Orphan account was found. Please review the list of possible matches from existing identities and select the right one.`

        const topSection = buildTopSection(label, description, attributes)
        const identitiesSection = buildIdentitiesSection(options)

        this.formElements = [topSection, identitiesSection]
        this.formConditions = buildOrphanFormConditions(attributes, targets, OrphanForm.ORPHAN_ACCOUNT)
    }
}
