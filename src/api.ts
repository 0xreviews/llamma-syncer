import express, { Request, Response } from 'express'
import { Amm, Database } from './datastore'

export class RestApi {
    private app = express()

    constructor(
        private readonly port: number,
        private readonly db: Database,
    ) {
        this.setup()
    }

    setup() {
        this.app.use(express.json())
        this.app.get('/pool/:address/block_number/:blockNumber', async (req: Request, res: Response) => {
            const address = req.params.address
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
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`Rest api listening on port ${this.port}`)
        })
    }
}
