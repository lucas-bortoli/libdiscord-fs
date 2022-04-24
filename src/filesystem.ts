import * as path from 'path/posix'
import * as readline from 'readline'
import Webhook from './webhook.js'
import Utils from './utils.js'
import { FileSystemHeaderKey, File, Directory, Entry, WalkDirectoryAsyncCallback } from './types.js'
import { RemoteReadStream, RemoteWriteStream } from './streams.js'
import { TextDecoder } from 'util'
import { Readable, Writable } from 'stream'

export default class Filesystem {
    public webhook: Webhook
    public header: Map<FileSystemHeaderKey, string>
    public root: Directory

    constructor(webhookUrl: string) {
        this.header = new Map()
        this.root = { type: 'directory', items: {} }
        this.webhook = new Webhook(webhookUrl)

        // Default properties; can be overriden by the data file
        this.header.set('Filesystem-Version', '1.1')
        this.header.set('Description', 'File system')
        this.header.set('Author', process.env.USER || 'null')
    }

    public async loadDataFromStream(stream: Readable) {
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
                const parsed = Utils.parseFileEntry(line)
                this.setEntry(parsed.path, parsed.file)
            }
        }
    }

    public async writeDataToStream(writable: Writable) {
        // Write header entries
        for (const [ key, value ] of this.header)
            writable.write(Buffer.from(`${key}: ${value}\n`, 'utf-8'))
        
        writable.write(Buffer.from('\n', 'utf-8'))

        // Write file entries
        await this.walkDirectory(this.root, async (fileEntry: File, filePath: string) => {
            const asString = Utils.serializeFileEntry(fileEntry, filePath)

            writable.write(Buffer.from(asString + '\n', 'utf-8'))
        })

        writable.end()
    }

    public async createReadStream(filePath: string): Promise<RemoteReadStream> {
        const file = await this.getEntry(filePath)

        if (!file || file.type !== 'file')
            throw new TypeError('createReadStream: ' + filePath + ' not found or isn\'t a file.')

        const piecesUrl = 'https://cdn.discordapp.com/attachments/' + file.metaptr
        const piecesBlob = await Utils.fetchBlob(piecesUrl)
        const pieces = new TextDecoder('utf-8').decode(piecesBlob).split(',')

        const stream = new RemoteReadStream(pieces)
        
        return stream
    }

    /**
     * Creates a remote write stream. If `createEntry == true` (default), the
     * resulting file entry is added to the filesystem. If not, the file is
     * uploaded, but it is not added to the filesystem tree.
     * @param filePath Where the file entry will be stored.
     * @param createEntry 
     * @param customEntryProperties Optional overrides for the filesystem entry
     */
    public async createWriteStream(filePath: string, createEntry: boolean = true, customEntryProperties: Partial<File> = {}): Promise<RemoteWriteStream> {
        if (filePath.endsWith('/'))
            filePath = filePath.slice(0, -1)
            
        // Extend writable stream with our own properties
        const stream = new RemoteWriteStream(this.webhook)

        stream.once('allUploadsDone', async (endStream) => {
            // Create file entry
            const fileEntry: File = Object.assign({}, {
                type: 'file',
                size: stream.writtenBytes,
                ctime: Date.now(),
                metaptr: stream.metaPtr.replace('https://cdn.discordapp.com/attachments/', '')
            }, customEntryProperties)

            // Write it into the database
            if (createEntry)
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

    /**
     * Checks wether a file or directory exists in a given path.
     * @param path 
     * @returns 
     */
    public exists(path: string) {
        return !!this.getEntry(path)
    }

    /**
     * Moves a file or directory to a new location.
     * If the 'to' argument is a directory, the new entry will be created
     * in that directory with the same name it had before.
     */
    public mv(from: string, to: string) {
        if (to.endsWith('/'))
            to += path.basename(from)

        const fromEntry = this.getEntry(from)
        this.rm(from)
        this.setEntry(to, fromEntry)
    }

    /**
     * Copies a file or directory to a new location.
     * If the 'to' argument is a directory, the new entry will be created
     * in that directory with the same name it had before.
     */
    public cp(fromPath: string, toPath: string) {
        if (toPath.endsWith('/'))
            toPath += path.basename(fromPath)

        const fromEntry = JSON.parse(JSON.stringify(this.getEntry(fromPath)))
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

    /**
     * Sets an entry at the given path. Used internally in the createWriteStream
     * function, and when the filesystem is loaded.
     */
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
                await this.walkDirectory(entry, cb, path.join(_prevPath, name))
            } else {
                await cb(entry, path.join(_prevPath, name))
            }
        }
    }

    /**
     * Uploads the file entry, as JSON, to the webhook. It can be used for sharing files or directories.
     * @param entryName The name of the entry - it is added to the "name" property in the serialized JSON.
     * @param entry The entry to be shared.
     * @returns The link to the shared entry.
     */
    public async uploadFileEntry(entryName: string, entry: Entry): Promise<string> {
        entry = Object.assign({ name: entryName }, entry)
        const asBufferData = Buffer.from(JSON.stringify(entry), 'utf-8')
        return await this.webhook.uploadFile('entry', asBufferData)
    }
}