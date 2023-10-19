import { readConfig } from '@sailpoint/connector-sdk'
import { merging } from './merging'
import { authoritative } from './authoritative'
import { orphan } from './orphan'
// Connector must be exported as module property named connector
export const connector = async () => {
    // Get connector source config
    const config = await readConfig()

    switch (config.mode) {
        case 'authoritative':
            return await authoritative(config)

        case 'merging':
            return await merging(config)

        case 'orphan':
            return await orphan(config)

        default:
            break
    }
}
