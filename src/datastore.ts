import { Datastore } from '@google-cloud/datastore'

const KIND_PREFIX = 'LLAMMA'

export type Amm = {
    blockNumber: number
    bands: Record<number, Band>
    totalShares: Record<number, string>
    userShares: Record<string, Record<number, string>>
}

export type Band = {
    x: string
    y: string
    users: Array<string>
}

export type Metadata = {
    blockNumbers: number[]
}

export class Database {
    private datastore = new Datastore()

    private kind(address: string) {
        return `${KIND_PREFIX}-${address}`
    }

    private key(address: string, blockNumber: number) {
        return this.datastore.key([this.kind(address), blockNumber])
    }

    async storeAmm(amm: Amm, address: string) {
        const entity = {
            key: this.key(address, amm.blockNumber),
            data: {
                ...amm,
            },
        }
        await this.datastore.save(entity)
    }

    async getLatestAmm(address: string): Promise<Amm | null> {
        const query = this.datastore.createQuery(this.kind(address)).order('blockNumber', { descending: true }).limit(1)
        const [amms] = await this.datastore.runQuery(query)
        return amms.length > 0 ? (amms[0] as Amm) : null
    }

    async getAmm(address: string, blockNumber: number): Promise<Amm | null> {
        const amms = await this.datastore.get(this.key(address, blockNumber))
        return amms.length > 0 ? (amms[0] as Amm) : null
    }

    async findAmmLeThanBlock(address: string, blockNumber: number): Promise<Amm | null> {
        const query = this.datastore
            .createQuery(this.kind(address))
            .filter('blockNumber', '<=', blockNumber)
            .order('blockNumber', { descending: true })
            .limit(1)
        const [amms] = await this.datastore.runQuery(query)
        return amms.length > 0 ? (amms[0] as Amm) : null
    }
}
