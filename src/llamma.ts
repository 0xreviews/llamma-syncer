import _ from 'lodash'
import { ethers, Contract, JsonRpcProvider, fromTwos, getNumber, formatEther, parseEther } from 'ethers'

import { Multicaller__factory, Multicaller, Llamma__factory } from './types'
import { Database, Band, Amm } from './datastore'
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
    private async fetchLlammaPools(fromBlock = 17257955): Promise<Record<string, Pool>> {
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

    private async fetchBands(address: string, blockNumber: number): Promise<Record<number, Band>> {
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
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        const ammAbi = [
            'event TokenExchange(address indexed buyer, uint256 sold_id, uint256 tokens_sold, uint256 bought_id, uint256 tokens_bought)',
            'event Deposit(address indexed provider, uint256 amount, int256 n1, int256 n2)',
            'event Withdraw(address indexed, uint256 amount_borrowed, uint256 amount_collateral)',
        ]
        const contract = new Contract(pool.address, ammAbi)
        const exchangeTopic = (await contract.filters.TokenExchange().getTopicFilter())[0] as string
        const depositTopic = (await contract.filters.Deposit().getTopicFilter())[0] as string
        const withdrawTopic = (await contract.filters.Withdraw().getTopicFilter())[0] as string

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const amm = await this.db.getLatestAmm(pool.address)

            const fromBlock = amm ? amm.blockNumber + 1 : pool.createdAtBlock
            const latestBlock = await this.provider.getBlockNumber()
            if (latestBlock < fromBlock + 300) {
                console.log(`waiting for new blocks in pool ${pool.address}`)
                await sleep(ONE_MINUTE)
                continue
            }
            const toBlock = latestBlock > fromBlock + 10000 ? fromBlock + 10000 : latestBlock

            const filter = {
                fromBlock,
                toBlock,
                address: pool.address,
                topics: [[exchangeTopic, depositTopic, withdrawTopic]],
            }
            const logs = await this.provider.getLogs(filter)
            console.log(`found ${logs.length} events in pool ${pool.address} from ${fromBlock} to ${toBlock}`)
            if (logs.length === 0) {
                await sleep(ONE_MINUTE)
                continue
            }

            const logsMap: Record<number, { blockNumber: number; logs: ethers.Log[] }> = {}
            logs.map(log => {
                if (!logsMap[log.blockNumber]) {
                    logsMap[log.blockNumber] = { blockNumber: log.blockNumber, logs: [] }
                }
                if ([depositTopic, withdrawTopic].includes(log.topics[0])) {
                    logsMap[log.blockNumber].logs.push(log)
                }
            })
            const blockNumbers = _(logsMap)
                .flatMap(log => log.blockNumber)
                .sort()
                .value()

            for (const blockNumber of blockNumbers) {
                const bands = await this.fetchBands(pool.address, blockNumber)
                const amm = { blockNumber, bands, totalShares: {}, userShares: {} } as Amm
                const lastAmm = await this.db.findAmmLeThanBlock(pool.address, blockNumber)
                if (lastAmm) {
                    amm.totalShares = lastAmm.totalShares
                    amm.userShares = lastAmm.userShares
                }

                const logsInBlock = _.sortBy(logsMap[blockNumber].logs, 'index')
                for (const log of logsInBlock) {
                    const logName = log.topics[0]
                    const user = '0x' + log.topics[1].substring(26)
                    if (logName == depositTopic) {
                        amm.userShares[user] = amm.userShares[user] ?? {}
                        const [amount, n1, n2] = abiCoder.decode(['uint256', 'int256', 'int256'], log.data)
                        const amountPerBand = (amount as bigint) / ((n2 as bigint) - (n1 as bigint) + BigInt(1))

                        for (let i = n1; i <= n2; i++) {
                            amm.totalShares[i] = amm.totalShares[i]
                                ? formatEther(parseEther(amm.totalShares[i]) + amountPerBand)
                                : formatEther(amountPerBand)
                            amm.userShares[user][i] = amm.userShares[user][i]
                                ? formatEther(parseEther(amm.userShares[user][i])) + amountPerBand
                                : formatEther(amountPerBand)
                        }
                    } else {
                        for (const [i, s] of Object.entries(amm.userShares[user])) {
                            amm.totalShares[i] = formatEther(parseEther(amm.totalShares[i]) - parseEther(s))
                        }
                        delete amm.userShares[user]
                    }
                }

                await this.db.storeAmm(amm, pool.address)
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
