import _ from 'lodash'
import { ethers, Contract, JsonRpcProvider, fromTwos, getNumber, formatEther } from 'ethers'

import { Multicaller__factory, Multicaller, Llamma__factory } from './types'
import { Database, Band } from './datastore'
import { sleep } from './utils'
import { MULTI_CALLER_ADDRESS, ONE_DAY, ONE_MINUTE } from './constants'

interface Pool {
    address: string
    createdAtBlock: number
}

function parseIn256(bytes: string, name?: string): number {
    return getNumber(fromTwos(bytes, 256), name)
}

export class LlammaFetcher {
    private readonly provider: JsonRpcProvider
    private readonly multicall: Multicaller
    private pools: Record<string, Pool> = {}

    constructor(
        rpcUrl: string,
        private readonly db: Database,
        private readonly llamma = Llamma__factory.createInterface(),
    ) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl)
        this.multicall = Multicaller__factory.connect(MULTI_CALLER_ADDRESS, this.provider)
    }

    // fetch from controller factory contract address: 0xC9332fdCB1C491Dcc683bAe86Fe3cb70360738BC
    // factory contract created at block 17257955
    async fetchLlammaPools(fromBlock = 17257955): Promise<Record<string, Pool>> {
        const factoryAbi = [
            'event AddMarket(address indexed collateral, address controller, address amm, address monetary_policy, uint256 id)',
        ]
        const contract = new Contract('0xC9332fdCB1C491Dcc683bAe86Fe3cb70360738BC', factoryAbi)
        const topics = await contract.filters.AddMarket().getTopicFilter()
        const filter = { fromBlock, topics }

        const logs = await this.provider.getLogs(filter)
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        const pools: Record<string, Pool> = {}
        logs.map(log => {
            const result = abiCoder.decode(['address', 'address', 'address', 'uint256'], log.data)
            const address = result[1]
            pools[address] = { address, createdAtBlock: log.blockNumber }
        })
        return pools
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
            const lastBlockNumber = amm ? amm.blockNumber + 1 : pool.createdAtBlock
            const latestBlock = await this.provider.getBlockNumber()
            if (latestBlock < lastBlockNumber + 300) {
                console.log(`waiting for new blocks in pool ${pool.address}`)
                await sleep(ONE_MINUTE)
                continue
            }

            const toBlockNumber = latestBlock > lastBlockNumber + 10000 ? lastBlockNumber + 10000 : latestBlock
            console.log(`fetching logs in pool ${pool.address} from ${lastBlockNumber} to ${toBlockNumber}`)

            const filter = { fromBlock: lastBlockNumber, toBlock: toBlockNumber, address: pool.address, topics: [] }
            const logs = await this.provider.getLogs(filter)
            const blockNumbers = _(logs).map('blockNumber').sort().uniq().value()
            console.log(`found events in pool ${pool.address} from ${blockNumbers[0]} to ${blockNumbers[1]}`)

            for (const blockNumber of blockNumbers) {
                const bands = await this.fetchBands(pool.address, blockNumber)
                await this.db.storeAmm({ blockNumber, bands }, pool.address)
            }
        }
    }

    async start() {
        let lastBlock: number | undefined

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const pools = await this.fetchLlammaPools(lastBlock)
            lastBlock = await this.provider.getBlockNumber()
            console.log(`Found LLAMMA pools: ${JSON.stringify(pools)}`)

            for (const [address, pool] of Object.entries(pools)) {
                if (this.pools[address]) {
                    continue
                }
                this.pools[address] = pool
                this.fetchAmmStates(pool)
            }

            await sleep(ONE_DAY)
        }
    }
}
