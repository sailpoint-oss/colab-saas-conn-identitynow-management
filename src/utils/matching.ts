import { Account, IdentityDocument } from 'sailpoint-api-client'
import { lig3 } from './lig'
import { buildAttributeObject } from '.'
import { Attributes } from '@sailpoint/connector-sdk'

export const findIdenticalMatch = (
    identity: IdentityDocument,
    candidates: IdentityDocument[],
    attributes: string[]
): IdentityDocument | undefined => {
    let match: IdentityDocument | undefined
    const identityAttributes = buildAttributeObject(identity, attributes)
    const identityStringAttributes = JSON.stringify(identityAttributes)
    const candidatesAttributes = candidates.map((x) => buildAttributeObject(x, attributes))
    const candidatesStringAttributes = candidatesAttributes.map((x) => JSON.stringify(x))

    const firstIndex = candidatesStringAttributes.indexOf(identityStringAttributes)
    const lastIndex = candidatesStringAttributes.lastIndexOf(identityStringAttributes)
    if (firstIndex && firstIndex === lastIndex) {
        match = candidates[firstIndex]
    }

    return match
}

export const findSimilarMatches = (
    identity: IdentityDocument,
    candidates: IdentityDocument[],
    attributes: string[],
    score: number
): IdentityDocument[] => {
    const similarMatches: IdentityDocument[] = []
    const length = attributes.length

    for (const candidate of candidates) {
        const scores: number[] = []
        for (const attribute of attributes) {
            let cValue, iValue
            iValue = identity.attributes![attribute] as string
            cValue = candidate.attributes![attribute] as string
            if (iValue && cValue) {
                const similarity = lig3(iValue, cValue)
                scores.push(similarity)
            }
        }

        const finalScore =
            scores.reduce((p, c) => {
                return p + c
            }, 0) / length

        if (finalScore * 100 >= score) {
            similarMatches.push(candidate)
        }
    }

    return similarMatches
}

export const findAccountSimilarMatches = (
    account: Account,
    candidates: IdentityDocument[],
    attributes: string[],
    score: number
): IdentityDocument[] => {
    const similarMatches: IdentityDocument[] = []
    const length = attributes.length

    for (const candidate of candidates) {
        const scores: number[] = []
        for (const attribute of attributes) {
            let cValue, aValue
            let similarity1 = 0
            let similarity2 = 0
            aValue = account.name
            cValue = candidate.attributes![attribute] as string
            if (aValue && cValue) {
                similarity1 = lig3(aValue, cValue)
            }
            aValue = account.nativeIdentity
            if (aValue && cValue) {
                similarity2 = lig3(aValue, cValue)
            }
            const similarity = Math.max(similarity1, similarity2)
            scores.push(similarity)
        }

        const finalScore =
            scores.reduce((p, c) => {
                return p + c
            }, 0) / length

        if (finalScore * 100 >= score) {
            similarMatches.push(candidate)
        }
    }

    return similarMatches
}
