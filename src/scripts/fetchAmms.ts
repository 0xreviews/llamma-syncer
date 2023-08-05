import 'dotenv/config'
import { ethers, Contract } from 'ethers'

const abi = [
    'event AddMarket(address indexed collateral, address controller, address amm, address monetary_policy, uint256 id)',
]
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
const contract = new Contract('0xC9332fdCB1C491Dcc683bAe86Fe3cb70360738BC', abi)

async function main() {
    const topics = await contract.filters.AddMarket().getTopicFilter()
    const filter = { fromBlock: 17257955, topics }
    const logs = await provider.getLogs(filter)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    for (const log of logs) {
        const result = abiCoder.decode(['address', 'address', 'address', 'uint256'], log.data)
        console.log('amm: ', result[1], 'block: ', log.blockNumber)
    }
}

if (require.main === module) {
    main()
}
