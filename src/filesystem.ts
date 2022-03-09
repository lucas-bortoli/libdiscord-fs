import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path/posix'
import * as readline from 'readline'
import { Readable } from 'stream'
import Webhook from './upload.js'
import Utils from './utils.js'

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

type NanoFileSystemHeaderKey = 'Filesystem-Version' | 'Description' | 'Author'

const BLOCK_SIZE: number = Math.floor(7.6 * 1024 * 1024)

export default class NanoFileSystem {
    private webhook: Webhook
    private cache: string[]

    public header: Map<NanoFileSystemHeaderKey, string>
    public dataFile: string

    constructor(dataFile: string, webhookUrl: string) {
        this.dataFile = dataFile
        this.header = new Map()
        this.cache = []
        this.webhook = new Webhook(webhookUrl)

        // Default properties; can be overriden by the data file
        this.header.set('Filesystem-Version', '1.1')
        this.header.set('Description', 'File system')
        this.header.set('Author', process.env.USER || 'null')
    }

    public async loadDataFile() {
        // Noop if file doesn't exist
        if (!await Utils.fsp_fileExists(this.dataFile))
            return

        const stream = fs.createReadStream(this.dataFile)
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        })
    
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
                
                this.header.set(key, value)
            } else {
                // Add file entry to cache
                this.cache.push(line)
            }
        }
    }

    public async writeDataFile() {
        // Create, or replace, data file
        const file = await fsp.open(this.dataFile, 'w+')

        // Write header entries
        for (const [ key, value ] of this.header)
            file.write(Buffer.from(`${key}: ${value}\n`, 'utf-8'))
        
        file.write(Buffer.from('\n', 'utf-8'))

        // Write file entries
        for (const line of this.cache)
            file.write(Buffer.from(line + '\n', 'utf-8'))

        await file.close()
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

                resolve(fileEntry)
            }

            // Make sure we're dealing with Buffer objects, and not strings.
            stream.setEncoding(null)

            stream.on('readable', async () => {
                let chunk: Buffer
                while (null !== (chunk = stream.read(BLOCK_SIZE))) {
                    if (!Buffer.isBuffer(chunk))
                        chunk = Buffer.from(chunk)
                        
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

        for (const line of this.cache) {
            const entry = this.parseFileEntry(line)

            if (entry.path === filePath) 
                return entry
        }

        throw new Error('File doesn\'t exist')
    }

    public async exists(targetPath: string): Promise<boolean> {
        // Remove trailing /
        if (targetPath.charAt(targetPath.length - 1) === '/')
            targetPath = targetPath.slice(0, -1)

        for await (const line of this.cache) {
            const entry = this.parseFileEntry(line)

            if (entry.path === targetPath || entry.path.startsWith(targetPath + '/'))
                return true
        }

        return false
    }

    public async readdir(targetDir): Promise<Entry[]> {
        // Remove trailing /
        if (targetDir.charAt(targetDir.length - 1) === '/')
            targetDir = targetDir.slice(0, -1)

        const subdirs: string[] = []
        const directoryContents: Entry[] = []

        // Scan every entry in the filesystem
        for await (const line of this.cache) {
            const entry = this.parseFileEntry(line)
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

    private async addFileEntry(line: string): Promise<void> {
        const newEntryPath = line.slice(0, line.indexOf(':'))

        // If entry already exists, replace it
        for (let i = 0; i < this.cache.length; i++) {
            const oldEntryPath = this.cache[i].slice(0, this.cache[i].indexOf(':'))
            if (newEntryPath === oldEntryPath) {
                this.cache[i] = line
                return
            }
        }

        // If we're here, then it's a new entry. Add it to the cache
        this.cache.push(line)

        return
    }

    private serializeFileEntry(file: File): string {
        return [ file.path, file.size.toString(), file.ctime.toString(), file.metaptr ].join(':')
    }

    private parseFileEntry(line: string): File {
        const elements = line.split(':') 
        return { type: 'file', path: elements[0], size: parseInt(elements[1]), ctime: parseInt(elements[2]), metaptr: elements[3] }
    }
}