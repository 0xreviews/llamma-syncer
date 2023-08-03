import express, { Request, Response } from 'express'
export function sleep(ms: number): Promise<unknown> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
    if (!process.env.PORT) {
        process.exit(1)
    }

    const PORT = parseInt(process.env.PORT as string, 10)

    const app = express()
    app.use(express.json())

    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Hello World!')
    })

    app.listen(PORT, () => {
        console.log(`Listening on port ${PORT}`)
    })

    // eslint-disable-next-line no-constant-condition
    while (true) {
        console.log('HEllo world')
        await sleep(10000)
    }
}

main()
