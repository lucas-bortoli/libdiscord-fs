import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path/posix'
import * as readline from 'readline'
import { Readable } from 'stream'
import Webhook from './upload.js'

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

const BLOCK_SIZE: number = Math.floor(7.6 * 1024 * 1024)

class NanoFileSystem {
    private webhook: Webhook

    public header: Map<NanoFileSystemHeaderKey, string>
    public dataFile: string

    constructor(dataFile: string) {
        this.dataFile = dataFile
        this.header = new Map()
    }

    public async init() {
        const scan = this.scanFileSystem()

        for await (const entry of scan) {
            scan.return()
            break
        }

        this.webhook = new Webhook(this.header.get('Webhook-Url'))
    }

    /*public async createReadStream(file: File): Promise<ReadableStream> {
        const webhookUrl = this.header.get('Webhook-Url')
        const stream = new Duplex()

        const piecesUrl = this.header.get('Cdn-Base-Url') + file.piecesptr + '/pieces'
        const filePieces: string[]
        const pieces = await fetch(piecesUrl).then(r =>)
        
        return stream
    }*/

    public writeFileFromStream(stream: Readable, filePath: string): Promise<File> {
        return new Promise(async resolve => {
            const piecesPointers: string[] = []

            let uploadedPieces = 0
            let fileSize = 0
            let creationTime = Date.now()

            // Callback called when the full file upload finishes.
            const onUploadFinish = async () => {
                // Upload file pieces array to the CDN. It's a comma-separated string.
                const metaPtr = await this.webhook.uploadFile('meta', Buffer.from(piecesPointers.join(',')))

                // Create file entry
                const fileEntry: File = {
                    type: 'file',
                    path: filePath,
                    size: fileSize,
                    ctime: creationTime,
                    metaptr: metaPtr.replace('https://cdn.discordapp.com/attachments/', '')
                }

                // Write it into the database
                const entryAsString: string = this.serializeFileEntry(fileEntry)

                await this.addFileEntry(entryAsString)
            }

            stream.on('readable', async () => {
                let chunk: Buffer
                while (null !== (chunk = stream.read(BLOCK_SIZE))) {
                    console.log(`${chunk.length} bytes read.`)

                    // Increment trackers
                    fileSize += chunk.length
                    uploadedPieces++

                    // Upload chunk, retrying if it fails
                    const piecePointer = await this.webhook.uploadFile('chunk', chunk)

                    piecesPointers.push(piecePointer.replace('https://cdn.discordapp.com/attachments/', ''))

                    if (stream.readableEnded)
                        onUploadFinish()
                }
            })
        })
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
                yield this.parseFileEntry(line)
            }
        }
    }

    private async addFileEntry(line: string): Promise<void> {
        return fsp.appendFile(this.dataFile, line)
    }

    private serializeFileEntry(file: File): string {
        return [ file.path, file.size.toString(), file.ctime.toString(), file.metaptr ].join(':')
    }

    private parseFileEntry(line: string): File {
        const elements = line.split(':') 
        return { type: 'file', path: elements[0], size: parseInt(elements[1]), ctime: parseInt(elements[2]), metaptr: elements[3] }
    }
}

const main = async () => {
    let f = new NanoFileSystem('./fs.fdata')
    await f.init()
    const readStream = fs.createReadStream('./test.img')

    await f.writeFileFromStream(readStream, 'gaming.img')
}

main()