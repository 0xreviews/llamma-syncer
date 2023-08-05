import express, { Request, Response } from 'express'
import { Database } from './datastore'

const app = express()
app.use(express.json())

export class RestApi {
    private app = express()

    constructor(
        private readonly port: number,
        private readonly db: Database,
    ) {
        this.setup()
    }

    setup() {
        app.get('/pools/:addr', (req: Request, res: Response) => {
            res.status(200).send(`Hello ${req.params.addr}!`)
        })
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`Rest api listening on port ${this.port}`)
        })
    }
}
