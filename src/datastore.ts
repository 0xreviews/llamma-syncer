import { Datastore } from '@google-cloud/datastore'

const KIND_PREFIX = 'LLAMMA'

export type Amm = {
    blockNumber: number
    bands: Record<number, Band>
}

export type Band = {
    x: string
    y: string
}

export class Database {
    private datastore = new Datastore()

    kind(address: string) {
        return `${KIND_PREFIX}-${address}`
    }

    async storeAmm(amm: Amm, address: string) {
        const key = this.datastore.key([this.kind(address), amm.blockNumber])
        const entity = {
            key,
            data: {
                ...amm,
            },
        }
        await this.datastore.save(entity)
    }

    async getLatestAmm(address: string): Promise<Amm | null> {
        const query = this.datastore.createQuery(this.kind(address)).order('blockNumber', { descending: true }).limit(1)
        const [entities] = await this.datastore.runQuery(query)
        return entities.length > 0 ? (entities[0] as Amm) : null
    }
}
