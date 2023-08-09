import _ from 'lodash'
import express, { Request, Response } from 'express'
import { getAddress } from 'ethers'
import { Amm, Database } from './datastore'
import { LlammaFetcher } from './llamma'

export class RestApi {
    private app = express()

    constructor(
        private readonly port: number,
        private readonly db: Database,
        private readonly llammaFetcher: LlammaFetcher,
    ) {
        this.setup()
    }

    setup() {
        this.app.use(express.json())

        this.app.get('/', async (req: Request, res: Response) => {
            res.json(_.sortBy(Object.values(this.llammaFetcher.markets), 'id'))
        })

        this.app.get('/pool/:address', async (req: Request, res: Response) => {
            const address = getAddress(req.params.address)
            const amm = await this.db.getLatestAmm(address)
            if (!amm) {
                res.status(404).send(`Amm(${address}) not found`)
                return
            }
            res.json(amm)
        })

        this.app.get('/pool/:address/block_number/:blockNumber', async (req: Request, res: Response) => {
            const address = getAddress(req.params.address)
            const blockNumber = req.params.blockNumber
            let amm: Amm | null
            try {
                if (blockNumber === 'latest') {
                    amm = await this.db.getLatestAmm(address)
                } else {
                    const blockNumber = parseInt(req.params.blockNumber)
                    amm = await this.db.findAmmLeThanBlock(address, blockNumber)
                }

                if (!amm) {
                    res.status(404).send(`Amm(${address}) not found at block: ${blockNumber}`)
                    return
                }
                res.json(amm)
            } catch (e) {
                res.status(502).send(e.message)
            }
        })

        this.app.get('*', (req: Request, res: Response) => {
            res.status(403).send('')
        })
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`Rest api listening on port ${this.port}`)
        })
    }
}
