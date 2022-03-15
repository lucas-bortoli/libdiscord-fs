import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path/posix'
import * as readline from 'readline'
import fetch from 'node-fetch'
import Webhook from './upload.js'
import Utils from './utils.js'
import { FileSystemHeaderKey, File, Directory, Entry, WalkDirectoryAsyncCallback } from './types.js'
import { RemoteReadStream, RemoteWriteStream } from './streams.js'

export default class Filesystem {
    private webhook: Webhook
    
    public header: Map<FileSystemHeaderKey, string>
    public dataFile: string

    private root: Directory

    constructor(dataFile: string, webhookUrl: string) {
        this.dataFile = dataFile
        this.header = new Map()
        this.root = { type: 'directory', items: {} }
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
    
        this.root = { type: 'directory', items: {} }

        for await (const line of rl) {
            if (line.length === 0) {
                alreadyReadHeaders = true
                continue
            }
    
            if (!alreadyReadHeaders) {
                // Parse headers
                const elements = line.split(':')
                
                const key = elements.shift().trim() as FileSystemHeaderKey
                const value = elements.join(':').trim()
                
                this.header.set(key, value)
            } else {
                const parsed = this.parseFileEntry(line)
                this.setEntry(parsed.path, parsed.file)
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
        this.walkDirectory(this.root, async (fileEntry: File, filePath: string) => {
            const asString = this.serializeFileEntry(fileEntry, filePath)

            file.writeFile(Buffer.from(asString + '\n', 'utf-8'))
        })

        await file.close()
    }

    public async createReadStream(filePath: string): Promise<RemoteReadStream> {
        const file = await this.getEntry(filePath)

        if (!file || file.type !== 'file')
            throw new TypeError('createReadStream: ' + filePath + ' not found or isn\'t a file.')

        const piecesUrl = 'https://cdn.discordapp.com/attachments/' + file.metaptr
        const piecesBlob = await fetch(piecesUrl).then(r => r.arrayBuffer())
        const pieces = new TextDecoder('utf-8').decode(piecesBlob).split(',')

        const stream = new RemoteReadStream(pieces)
        
        return stream
    }

    public async createWriteStream(filePath: string): Promise<RemoteWriteStream> {
        if (filePath.endsWith('/'))
            filePath = filePath.slice(0, -1)
            
        // Extend writable stream with our own properties
        const stream = new RemoteWriteStream(this.webhook)

        stream.once('allUploadsDone', async (endStream) => {
            // Create file entry
            const fileEntry: File = {
                type: 'file',
                size: stream.writtenBytes,
                ctime: Date.now(),
                metaptr: stream.metaPtr.replace('https://cdn.discordapp.com/attachments/', '')
            }

            // Write it into the database
            await this.setEntry(filePath, fileEntry)

            endStream()
        })

        return stream
    }

    /**
     * Gets an entry. Returns null if the entry doesn't exist.
     * @param filePath Path to the file
     */
    public getEntry(filePath: string): Entry|null {
        const pathSegments = filePath.split('/').filter(l => l.length)

        let lastDir: Directory = this.root

        for (let i = 0; i < pathSegments.length; i++) {
            const segment = pathSegments[i]
            const isLastSegment = i === pathSegments.length - 1

            // Directory or file not found
            if (!lastDir.items[segment])
                return null

            if (isLastSegment)
                return lastDir.items[segment]

            lastDir = lastDir.items[segment] as Directory
        }

        return lastDir
    }

    public exists(path: string) {
        return !!this.getEntry(path)
    }

    public mv(fromPath: string, toPath: string) {
        if (toPath.endsWith('/'))
            toPath += path.basename(fromPath)

        const fromEntry = this.getEntry(fromPath)
        this.rm(fromPath)
        this.setEntry(toPath, fromEntry)
    }

    /**
     * Removes all matching files/directories from the index.
     * @param target Absolute path to directory/entry
     */
    public rm(target: string) {
        const pathSegments = target.split('/').filter(l => l.length)

        let lastDir: Directory = this.root

        for (let i = 0; i < pathSegments.length; i++) {
            const segment = pathSegments[i]
            const isLastSegment = i === pathSegments.length - 1

            // Is the last segment in path?
            if (isLastSegment) {
                delete lastDir.items[segment]
            } else {
                // Path doesn't exist
                if (!lastDir.items[segment])
                    throw new Error('rm: Path doesn\'t exist: ' + target)

                lastDir = lastDir.items[segment] as Directory
            }
        }
    }

    public setEntry(path: string, entry: Entry) {
        const pathSegments = path.split('/').filter(l => l.length)

        let lastDir: Directory = this.root

        for (let i = 0; i < pathSegments.length; i++) {
            const segment = pathSegments[i]
            const isLastSegment = i === pathSegments.length - 1

            // Is file basename?
            if (isLastSegment) {
                lastDir.items[segment] = entry
            } else {
                // Is directory
                if (!lastDir.items[segment])
                    lastDir.items[segment] = { type: 'directory', items: {} }

                lastDir = lastDir.items[segment] as Directory
            }
        }
    }

    /**
     * Walk a directory.
     * @param cb Callback called for each file in every subdirectory.
     */
    public async walkDirectory(root: Directory, cb: WalkDirectoryAsyncCallback, _prevPath: string = '/') {
        for (const [ name, entry ] of Object.entries(root.items)) {
            if (entry.type === 'directory') {
                this.walkDirectory(entry, cb, path.join(_prevPath, name))
            } else {
                await cb(entry, path.join(_prevPath, name))
            }
        }
    }

    private serializeFileEntry(file: File, path: string): string {
        return [ path, file.size.toString(), file.ctime.toString(), file.metaptr ].join(':')
    }

    private parseFileEntry(line: string): { path: string, file: File } {
        const elements = line.split(':') 
        return { path: elements[0], file: { type: 'file', size: parseInt(elements[1]), ctime: parseInt(elements[2]), metaptr: elements[3] } }
    }
}