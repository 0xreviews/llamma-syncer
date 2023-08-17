import _ from 'lodash'
import 'dotenv/config'
import { ethers, Contract, formatEther, formatUnits } from 'ethers'

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

// sfrxETH LLAMMA
// https://etherscan.io/tx/0x1ef2416f06f39fab6498b71ea409baf9b569c064aa3847015fc6e05f7cd68dd7
const llammaAddress = '0x136e783846ef68c8bd00a3369f787df8d683a696'
const chainlinkAggAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const tricryptoPoolAddress = '0xd51a44d3fae010294c616388b506acda1bfaae46'
const TOKENS = {
    0: 'crvUSD',
    1: 'sfrxETH',
}

const TRI_CRYPTO_TOKENS = {
    0: ['USDT', 6],
    1: ['WBTC', 8],
    2: ['WETH', 18],
}

// // wstETH LLAMMA
// // https://etherscan.io/tx/0xc3054cb818a625aa437c50b0f3998cb6fec4d63a611e18adcd44e46a063f473f
// const endBlock = 17480573
// const llammaAddress = '0x37417B2238AA52D0DD2D6252d989E728e8f706e4'
// const chainlinkAggAddress = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
// const tricryptoPoolAddress = '0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B'
// const TOKENS = {
//     0: 'crvUSD',
//     1: 'wstETH',
// }

// const TRI_CRYPTO_TOKENS = {
//     0: ['USDC', 6],
//     1: ['WBTC', 8],
//     2: ['WETH', 18],
// }

const aggregatorAddress = '0xe5afcf332a5457e8fafcd668bce3df953762dfe7'

const llamma = new Contract(llammaAddress, llammaAbi, provider)
const chainlinkAgg = new Contract(chainlinkAggAddress, chainlinkAggAbi, provider)
const tricryptoPool = new Contract(tricryptoPoolAddress, tricryptoPoolAbi, provider)
const aggregator = new Contract(aggregatorAddress, aggregatorAbi, provider)

const abiCoder = ethers.AbiCoder.defaultAbiCoder()
async function fetchDataByBlock(blockNumber: number) {
    const logTxt: string[] = []

    const tricryptoTopics = await tricryptoPool.filters.TokenExchange().getTopicFilter()
    const tricryptoFilter = {
        fromBlock: blockNumber,
        toBlock: blockNumber,
        address: tricryptoPoolAddress,
        topics: tricryptoTopics,
    }
    const tricryptoLogs = _.sortBy(await provider.getLogs(tricryptoFilter), 'index')

    const llammaTopics = await llamma.filters.TokenExchange().getTopicFilter()
    const llammaFilter = { fromBlock: blockNumber, toBlock: blockNumber, address: llammaAddress, topics: llammaTopics }
    const llammaLogs = await provider.getLogs(llammaFilter)

    if (llammaLogs.length === 0 && tricryptoLogs.length === 0) {
        return []
    }

    const block = await provider.getBlock(blockNumber)
    logTxt.push(`=============== block: ${blockNumber}, timestamp: ${block.timestamp} ===============`)

    const overrides = { blockTag: blockNumber }
    const results = await Promise.all([
        aggregator.price(overrides),
        tricryptoPool.price_oracle(1, overrides),
        tricryptoPool.last_prices(1, overrides),
        tricryptoPool.last_prices_timestamp(overrides),
        chainlinkAgg.latestRoundData(overrides),
        llamma.price_oracle(overrides),
        llamma.active_band(overrides),
        llamma.get_p(overrides),
    ])

    const crvusdPrice = formatEther(results[0])
    const tricryptoPoolPrice = formatEther(results[1])
    const tricryptoLastPrice = formatEther(results[2])
    const tricryptoLastPriceTimestamp = results[3].toString()
    const chainlinkPrice = formatUnits(results[4][1], 8)
    const llammaPrice = formatEther(results[5])
    const activeBand = results[6].toString()
    const p = formatEther(results[7])

    logTxt.push(`crvUSD price: ${crvusdPrice}`)
    logTxt.push(`chainlink ETH price: ${chainlinkPrice}`)
    logTxt.push(`tricrypto EMA Price: ${tricryptoPoolPrice}`)
    logTxt.push(`tricrypto last price: ${tricryptoLastPrice}`)
    logTxt.push(`tricrypto last price timestamp: ${tricryptoLastPriceTimestamp}`)
    logTxt.push(`LLAMMA price: ${llammaPrice} active band: ${activeBand.toString()}, p: ${p.toString()}}`)

    if (tricryptoLogs.length > 0) logTxt.push('3pool txs:')
    for (const log of tricryptoLogs) {
        const trader = ethers.getAddress('0x' + log.topics[1].slice(26))
        const [soldId, tokensSold, boughtId, tokensBought] = abiCoder.decode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            log.data,
        )

        logTxt.push(
            `txHash: ${log.transactionHash}, log index: ${log.index}, trader: ${trader}, swap ${formatUnits(
                tokensSold,
                TRI_CRYPTO_TOKENS[soldId][1],
            )} ${TRI_CRYPTO_TOKENS[soldId][0]} for ${formatUnits(tokensBought, TRI_CRYPTO_TOKENS[boughtId][1])} ${
                TRI_CRYPTO_TOKENS[boughtId][0]
            }`,
        )
    }

    if (llammaLogs.length > 0) logTxt.push('LLAMMA txs:')
    for (const log of llammaLogs) {
        const trader = ethers.getAddress('0x' + log.topics[1].slice(26))
        const [soldId, tokensSold, boughtId, tokensBought] = abiCoder.decode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            log.data,
        )
        logTxt.push(
            `txHash: ${log.transactionHash} trader: ${trader}, swap ${formatEther(tokensSold)} ${
                TOKENS[soldId]
            } for ${formatEther(tokensBought)} ${TOKENS[boughtId]}`,
        )
    }
    logTxt.push('\n')
    return logTxt
}

async function main() {
    const endBlock = 17466899
    const batch_size = 3
    const total_size = 100
    let blockNumber = endBlock - total_size
    for (let n = 0; n * batch_size <= total_size; n++) {
        const promises = []
        for (let i = 0; i < batch_size; i++) {
            if (blockNumber + i > endBlock) break
            promises.push(fetchDataByBlock(blockNumber + i))
        }
        const results = await Promise.all(promises)
        results.forEach(logs => {
            if (logs.length > 0) console.log(logs.join('\n'))
        })
        blockNumber += batch_size
    }
}

if (require.main === module) {
    main()
}
