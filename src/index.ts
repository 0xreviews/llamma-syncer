import 'dotenv/config'
import { Database } from './datastore'
import { LlammaFetcher } from './llamma'
import { RestApi } from './api'

const POOLS = [
    {
        name: 'sfrxETH',
        address: '0x136e783846ef68C8Bd00a3369F787dF8d683a696',
        createdBlockNumber: 17258064,
    },
]

async function main() {
    if (!process.env.PORT) {
        console.error('PORT not set')
        process.exit(1)
    }
    if (!process.env.RPC_URL) {
        console.error('RPC_URL not set')
        process.exit(1)
    }

    const PORT = parseInt(process.env.PORT as string, 10)
    const RPC_URL = process.env.RPC_URL as string

    const db = new Database()

    const api = new RestApi(PORT, db)
    api.start()

    // const llammaFetcher = new LlammaFetcher(RPC_URL, db, POOLS)
    // await llammaFetcher.start()
}

main()
