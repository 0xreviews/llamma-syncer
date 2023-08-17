import _, { lte } from 'lodash'
import 'dotenv/config'
import { ethers, Contract, formatEther, formatUnits, parseEther } from 'ethers'

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)

const llammaAbi = [
    'function active_band() external view returns(int256)',
    'function get_p() external view returns(uint256)',
    'function price_oracle() external view returns(uint256)',
    'event TokenExchange(address indexed buyer, uint256 sold_id, uint256 tokens_sold, uint256 bought_id, uint256 tokens_bought)',
]
const aggregatorAbi = ['function price() external view returns(uint256)']
const chainlinkAggAbi = ['function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80)']
const tricryptoPoolAbi = [
    'function price_oracle(uint256) external view returns(uint256)',
    'function last_prices(uint256) external view returns(uint256)',
    'function last_prices_timestamp() external view returns(uint256)',
    'event TokenExchange(address indexed buyer, uint256 sold_id, uint256 tokens_sold, uint256 bought_id, uint256 tokens_bought)',
]

const llammaAddress = '0x136e783846ef68c8bd00a3369f787df8d683a696'
const llamma = new Contract(llammaAddress, llammaAbi, provider)

const aggregatorAddress = '0xe5afcf332a5457e8fafcd668bce3df953762dfe7'
const aggregator = new Contract(aggregatorAddress, aggregatorAbi, provider)

const chainlinkAggAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const chainlinkAgg = new Contract(chainlinkAggAddress, chainlinkAggAbi, provider)

const tricryptoPoolAddress = '0xd51a44d3fae010294c616388b506acda1bfaae46'
const tricryptoPool = new Contract(tricryptoPoolAddress, tricryptoPoolAbi, provider)

const TOKENS = {
    0: 'crvUSD',
    1: 'sfrxETH',
}

const TRI_CRYPTO_TOKENS = {
    0: ['USDT', 6],
    1: ['WBTC', 8],
    2: ['WETH', 18],
}

async function main() {
    let fromBlock = 17480570
    const currentBlock = await provider.getBlockNumber()
    let lastTradeAbnormal = false
    let lastTimestamp = 0

    const tricryptoTopics = await tricryptoPool.filters.TokenExchange().getTopicFilter()
    const llammaTopics = await llamma.filters.TokenExchange().getTopicFilter()

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const toBlock = fromBlock + 2000 > currentBlock ? currentBlock : fromBlock + 2000

        console.log(`from block: ${fromBlock}, to block: ${toBlock}`)

        const tricryptoFilter = {
            fromBlock,
            toBlock,
            address: tricryptoPoolAddress,
            topics: tricryptoTopics,
        }

        const tricryptoLogs = await provider.getLogs(tricryptoFilter)
        const triCryptoLogsMap: Record<number, ethers.Log[]> = {}
        tricryptoLogs.reduce((triCryptoLogsMap, log) => {
            triCryptoLogsMap[log.blockNumber] ??= [log]
            triCryptoLogsMap[log.blockNumber].push(log)
            return triCryptoLogsMap
        }, triCryptoLogsMap)
        const blockNumbers = _(tricryptoLogs).map('blockNumber').uniq().sort().value()

        console.log(`scanning ${blockNumbers.length} blocks`)

        for (const blockNumber of blockNumbers) {
            const results = await Promise.all([
                tricryptoPool.price_oracle(1, { blockTag: blockNumber }),
                tricryptoPool.last_prices(1, { blockTag: blockNumber }),
                tricryptoPool.last_prices_timestamp({ blockTag: blockNumber }),
                chainlinkAgg.latestRoundData({ blockTag: blockNumber }),
                llamma.get_p({ blockTag: blockNumber }),
            ])

            const tricryptoPoolPrice = formatEther(results[0])
            const tricryptoLastPrice = formatEther(results[1])
            const tricryptoLastPriceTimestamp = Number(results[2])
            const chainlinkPrice = formatUnits(results[3][1], 8)
            const llammaPrice = formatEther(results[4])

            const normalPrice =
                parseFloat(chainlinkPrice) * 1.01 > parseFloat(tricryptoLastPrice) &&
                parseFloat(chainlinkPrice) * 0.99 < parseFloat(tricryptoLastPrice)

            if (normalPrice) {
                if (!lastTradeAbnormal) {
                    lastTimestamp = tricryptoLastPriceTimestamp
                    continue
                } else {
                    lastTradeAbnormal = false
                }
            } else {
                lastTradeAbnormal = true
            }

            console.log(
                `=============== block: ${blockNumber} ${
                    !normalPrice ? ', abnormal price! ' : '=================='
                }===============`,
            )
            console.log(
                `tricrypto EMA Price: ${tricryptoPoolPrice}, last price: ${tricryptoLastPrice}, last price timestamp: ${tricryptoLastPriceTimestamp}, time delta = ${
                    tricryptoLastPriceTimestamp - lastTimestamp
                }`,
            )
            console.log(`chainlink ETH price: ${chainlinkPrice}`)
            console.log(`LLAMMA frax ETH price: ${llammaPrice}}`)
            const trades = _.uniq(triCryptoLogsMap[blockNumber].map(log => log.transactionHash))
            console.log('Tricrypto trades:', trades)
            if (normalPrice) {
                const llammaFilter = {
                    fromBlock: blockNumber,
                    toBlock: blockNumber + 5,
                    address: llammaAddress,
                    topics: llammaTopics,
                }
                const llammaLogs = _.uniq((await provider.getLogs(llammaFilter)).map(log => log.transactionHash))
                console.log('LLAMMA trades in next 5 blocks: ', llammaLogs)
            }

            lastTimestamp = tricryptoLastPriceTimestamp
            console.log()
        }

        fromBlock = toBlock
        if (toBlock === currentBlock) {
            break
        }
        console.log()
    }
}

if (require.main === module) {
    main()
}
