import { ethers, JsonRpcProvider, fromTwos, getNumber, formatEther } from 'ethers'
import _ from 'lodash'

import { Multicaller__factory, Multicaller, Llamma__factory } from './types'
import { Database, Band } from './datastore'
import { sleep } from './utils'

interface Pool {
    name: string
    address: string
    createdBlockNumber: number
}

const MULTI_CALLER_ADDRESS = '0x000000000088228fCF7b8af41Faf3955bD0B3A41'
const ONE_MINUTE = 60 * 1000

function parseIn256(bytes: string, name?: string): number {
    return getNumber(fromTwos(bytes, 256), name)
}

export class LlammaFetcher {
    private provider: JsonRpcProvider
    private multicall: Multicaller

    constructor(
        rpcUrl: string,
        private db: Database,
        private pools: Pool[],
        private llamma = Llamma__factory.createInterface(),
    ) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl)
        this.multicall = Multicaller__factory.connect(MULTI_CALLER_ADDRESS, this.provider)
    }

    async fetchBands(address: string, blockNumber: number): Promise<Record<number, Band>> {
        const bandRange = await this.multicall.aggregate.staticCall(
            [address, address],
            [this.llamma.encodeFunctionData('min_band'), this.llamma.encodeFunctionData('max_band')],
            [0, 0],
            { blockTag: blockNumber },
        )
        const [minBand, maxBand] = [parseIn256(bandRange[0], 'min band'), parseIn256(bandRange[1]), 'max band']

        const count = maxBand - minBand + 1
        const addresses = Array(count * 2).fill(address)
        const calldatas: Array<string> = []
        for (let i = minBand; i <= maxBand; i++) {
            calldatas.push(this.llamma.encodeFunctionData('bands_x', [i]))
            calldatas.push(this.llamma.encodeFunctionData('bands_y', [i]))
        }

        const bands: Record<number, Band> = {}
        const results = await this.multicall.aggregate.staticCall(addresses, calldatas, Array(count * 2).fill(0), {
            blockTag: blockNumber,
        })
        for (let i = 0; i < results.length; ) {
            const x = fromTwos(results[i], 256)
            const y = fromTwos(results[i + 1], 256)
            if (x.toString() !== '0' || y.toString() !== '0') {
                bands[minBand + i / 2] = { x: formatEther(x), y: formatEther(y) }
            }
            i += 2
        }
        return bands
    }

    async fetchAmmStates(pool: Pool) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const amm = await this.db.getLatestAmm(pool.address)
            const lastBlockNumber = amm ? amm.blockNumber + 1 : pool.createdBlockNumber
            const latestBlock = await this.provider.getBlockNumber()
            if (latestBlock < lastBlockNumber + 300) {
                console.log(`waiting for new blocks in pool ${pool.name}`)
                await sleep(ONE_MINUTE)
                continue
            }

            const toBlockNumber = latestBlock > lastBlockNumber + 10000 ? lastBlockNumber + 10000 : latestBlock
            console.log(`fetching logs in pool ${pool.name} from ${lastBlockNumber} to ${toBlockNumber}`)

            const filter = { fromBlock: lastBlockNumber, toBlock: toBlockNumber, address: pool.address, topics: [] }
            const logs = await this.provider.getLogs(filter)
            const blockNumbers = _(logs).map('blockNumber').sort().uniq().value()
            console.log(`found events in pool ${pool.name} from ${blockNumbers[0]} to ${blockNumbers[1]}`)

            for (const blockNumber of blockNumbers) {
                const bands = await this.fetchBands(pool.address, blockNumber)
                await this.db.storeAmm({ blockNumber, bands }, pool.address)
            }
        }
    }

    async start() {
        for (const pool of this.pools) {
            this.fetchAmmStates(pool)
        }
    }
}
