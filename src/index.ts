export function sleep(ms: number): Promise<unknown> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
    console.log('HEllo world')
     await sleep(10000)
}

main()
