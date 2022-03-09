import * as fs from 'fs'
import * as path from 'path/posix'
import * as readline from 'readline'
import * as Repl from 'repl'
import fetch from 'node-fetch'
import { Writable, Readable } from 'stream'
import DiscordUpload from './discordUpload.js'

interface File {
    type: 'file',
    path: string,
    size: number,
    ctime: number,
    metaptr: string
}

interface Directory {
    type: 'directory',
    path: string
}

type Entry = File | Directory

type NanoFileSystemHeaderKey = 'Filesystem-Version'|'Webhook-Url'|'Cdn-Base-Url'


class NanoFileSystem {
    private readonly blockSize: number = Math.floor(7.6 * 1024 * 1024)

    public header: Map<NanoFileSystemHeaderKey, string>
    public readonly dataFile: string

    constructor(dataFile: string) {
        this.dataFile = dataFile
        this.header = new Map()
    }

    /*public async createReadStream(file: File): Promise<ReadableStream> {
        const webhookUrl = this.header.get('Webhook-Url')
        const stream = new Duplex()

        const piecesUrl = this.header.get('Cdn-Base-Url') + file.piecesptr + '/pieces'
        const filePieces: string[]
        const pieces = await fetch(piecesUrl).then(r =>)
        
        return stream
    }*/

    public async writeFileFromStream(stream: Readable, props: { filePath: string, size: number, ctime: number }): Promise<void> {
        const webhookUrl = this.header.get('Webhook-Url')
        const piecesPointers: string[] = []

        stream.on('readable', async () => {
            let chunk: Buffer
            while (null !== (chunk = stream.read(this.blockSize))) {
                console.log(`Read ${chunk.length} bytes of data...`);

                // upload chunk
                const piecePointer = await DiscordUpload('chunk', chunk, webhookUrl)
                piecesPointers.push(piecePointer.replace('https://cdn.discordapp.com/attachments/', ''))
            }
        })

        console.log(piecesPointers)

        // return stream
    }

    public async getFile(filePath: string): Promise<File> {
        // Remove trailing /
        if (filePath.charAt(filePath.length - 1) === '/')
            filePath = filePath.slice(0, -1)

        const scan = this.scanFileSystem()

        for await (const entry of scan) {
            if (entry.path === filePath) {
                scan.return()
                return entry
            }
        }

        throw new Error('File doesn\'t exist')
    }

    public async exists(targetPath: string): Promise<boolean> {
        // Remove trailing /
        if (targetPath.charAt(targetPath.length - 1) === '/')
            targetPath = targetPath.slice(0, -1)

        const scan = this.scanFileSystem()

        for await (const entry of scan) {
            if (entry.path === targetPath || entry.path.startsWith(targetPath + '/')) {
                scan.return()
                return true
            }
        }

        return false
    }

    public async readdir(targetDir): Promise<Entry[]> {
        // Remove trailing /
        if (targetDir.charAt(targetDir.length - 1) === '/')
            targetDir = targetDir.slice(0, -1)

        const subdirs: string[] = []
        const directoryContents: Entry[] = []
        const scan = this.scanFileSystem()

        // Scan every entry in the filesystem
        for await (const entry of scan) {
            const dirname = path.dirname(entry.path)

            // Checks if entry is a child (or grandchild, etc.) of the given path
            if (dirname.startsWith(targetDir)) {
                const nextDelimiterIndex = entry.path.indexOf('/', targetDir.length + 1)

                // Check if entry is a direct child of the given path (isn't in a subdirectory)
                if (nextDelimiterIndex < 0) {
                    directoryContents.push(entry)
                } else {
                    // The entry isn't a direct child, so we find its nearest parent in the given directory
                    const subdirPath = entry.path.slice(0, nextDelimiterIndex)

                    if (!subdirs.includes(subdirPath)) {
                        subdirs.push(subdirPath)
                        directoryContents.push({ type: 'directory', path: subdirPath })
                    }
                }
            }
        }

        return directoryContents
    }

    /**
     * Util generator function that yields for each file of the filesystem.
     */
    private async *scanFileSystem(): AsyncGenerator<File, void> {
        const stream = fs.createReadStream(this.dataFile)
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        })
    
        this.header = this.header || new Map()
    
        let alreadyReadHeaders = false
        let lineIndex = 0
    
        for await (const line of rl) {
            lineIndex++
    
            if (line.length === 0) {
                alreadyReadHeaders = true
                continue
            }
    
            if (!alreadyReadHeaders) {
                // Parse headers
                const elements = line.split(':')
                
                const key = elements.shift().trim() as NanoFileSystemHeaderKey
                const value = elements.join(':').trim()
                console.log(key, value)
                this.header.set(key, value)
            } else {
                // Parse body
                const elements = line.split(':')

                const path: string = elements[0]
                const size: number = parseInt(elements[1])
                const ctime: number = parseInt(elements[2])
                const metaptr: string = elements[3]
                
                yield { type: 'file', path, size, ctime, metaptr }
            }
        }
    }
}

const main = async () => {
    let f = new NanoFileSystem('./fs.fdata')
    await f.readdir('/')
    const readStream = fs.createReadStream('./test.img')

    await f.writeFileFromStream(readStream, null)
    console.log('wrote')
}

main()