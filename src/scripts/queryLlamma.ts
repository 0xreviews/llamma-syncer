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
const endBlock = 17466899
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
async function fetchDataByBlock(blockNumber:number) {
    const block = await provider.getBlock(blockNumber)
    let logTxt: string[] = []
    logTxt.push(`=============== block: ${blockNumber}, timestamp: ${block.timestamp} ===============`)

    const crvusdPrice = formatEther(await aggregator.price({ blockTag: blockNumber }))
    const tricryptoPoolPrice = formatEther(await tricryptoPool.price_oracle(1, { blockTag: blockNumber }))
    const tricryptoLastPrice = formatEther(await tricryptoPool.last_prices(1, { blockTag: blockNumber }))
    const tricryptoLastPriceTimestamp = (
        await tricryptoPool.last_prices_timestamp({ blockTag: blockNumber })
    ).toString()
    const chainlinkPrice = formatUnits((await chainlinkAgg.latestRoundData({ blockTag: blockNumber }))[1], 8)
    const llammaPrice = formatEther(await llamma.price_oracle({ blockTag: blockNumber }))

    logTxt.push(`crvUSD price: ${crvusdPrice}`)
    logTxt.push(`chainlink ETH price: ${chainlinkPrice}`)
    logTxt.push(`tricrypto EMA Price: ${tricryptoPoolPrice}`)
    logTxt.push(`tricrypto last price: ${tricryptoLastPrice}`)
    logTxt.push(`tricrypto last price timestamp: ${tricryptoLastPriceTimestamp}`)
    logTxt.push(`llamma price: ${llammaPrice}`)

    const tricryptoTopics = await tricryptoPool.filters.TokenExchange().getTopicFilter()
    const tricryptoFilter = {
        fromBlock: blockNumber,
        toBlock: blockNumber,
        address: tricryptoPoolAddress,
        topics: tricryptoTopics,
    }
    const tricryptoLogs = _.sortBy(await provider.getLogs(tricryptoFilter), 'index')
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

    const activeBand = await llamma.active_band({ blockTag: blockNumber })
    const p = formatEther(await llamma.get_p({ blockTag: blockNumber }))
    logTxt.push(`LLAMMA: active band: ${activeBand.toString()}, p: ${p.toString()}}`)

    const topics = await llamma.filters.TokenExchange().getTopicFilter()
    const filter = { fromBlock: blockNumber, toBlock: blockNumber, address: llammaAddress, topics }
    const logs = await provider.getLogs(filter)

    for (const log of logs) {
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
    logTxt.push("\n")
    return logTxt
}

async function main() {

    const batch_size = 10
    const total_size = 100;
    let blockNumber = endBlock - total_size;
    for (let n = 0; n * batch_size <= total_size; n++) {
        let promises = []
        for (let i = 0; i < batch_size; i++) {
            if (blockNumber+i > endBlock) break; 
            promises.push(fetchDataByBlock(blockNumber+i))
        }
        const results = await Promise.all(promises);
        results.forEach(logs => {
            console.log(logs.join("\n"))
        })
        blockNumber += batch_size;
    }
}

if (require.main === module) {
    main()
}
