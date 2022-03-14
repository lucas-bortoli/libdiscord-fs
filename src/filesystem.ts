import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path/posix'
import * as readline from 'readline'
import { Readable, Writable } from 'stream'
import fetch from 'node-fetch'
import Webhook from './upload.js'
import Utils from './utils.js'
import { FileSystemHeaderKey, File, Directory, Entry } from './types.js'
import { RemoteReadStream, RemoteWriteStream } from './streams.js'

export default class Filesystem {
    private webhook: Webhook
    private cache: string[]

    public header: Map<FileSystemHeaderKey, string>
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

    public async createReadStream(filePath: string): Promise<RemoteReadStream> {
        const file = await this.getFileEntry(filePath)

        const piecesUrl = 'https://cdn.discordapp.com/attachments/' + file.metaptr
        const piecesBlob = await fetch(piecesUrl).then(r => r.arrayBuffer())
        const pieces = new TextDecoder('utf-8').decode(piecesBlob).split(',')

        const stream = new RemoteReadStream(pieces)
        
        return stream
    }

    public async createWriteStream(filePath: string): Promise<RemoteWriteStream> {
        // Extend writable stream with our own properties
        const stream = new RemoteWriteStream(this.webhook)

        stream.once('allUploadsDone', async (endStream) => {
            // Create file entry
            const fileEntry: File = {
                type: 'file',
                path: filePath,
                size: stream.writtenBytes,
                ctime: Date.now(),
                metaptr: stream.metaPtr.replace('https://cdn.discordapp.com/attachments/', '')
            }

            // Write it into the database
            const entryAsString: string = this.serializeFileEntry(fileEntry)
            await this.addFileEntry(entryAsString)

            endStream()
        })

        return stream
    }

    /**
     * Get the file entry. Returns null if the file doesn't exist.
     * @param filePath Path to the file
     */
    public async getFileEntry(filePath: string): Promise<File|null> {
        // Remove trailing /
        if (filePath.charAt(filePath.length - 1) === '/')
            filePath = filePath.slice(0, -1)

        for (const line of this.cache) {
            const entry = this.parseFileEntry(line)

            if (entry.path === filePath) 
                return entry
        }

        return null
    }

    public async exists(targetPath: string): Promise<boolean> {
        // Remove trailing /
        if (targetPath.charAt(targetPath.length - 1) === '/')
            targetPath = targetPath.slice(0, -1)

        for (const line of this.cache) {
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
        for (const line of this.cache) {
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

    public async mv(from: string, to: string) {
        // Remove trailing /
        if (from.charAt(from.length - 1) === '/') from = from.slice(0, -1)
        if (to.charAt(to.length - 1) === '/') to = to.slice(0, -1)

        // Scan every entry in the filesystem
        for (let i = 0; i < this.cache.length; i++) {
            const line = this.cache[i]
            const entry = this.parseFileEntry(line)
            const entryname = entry.path

            // Checks if entry is a child (or grandchild, etc.) of the given path
            if ((entryname + '/').startsWith(from + '/')) {
                entry.path = entry.path.replace(from, to)
                console.log('moving', entryname, 'to', entry.path)
                this.cache[i] = this.serializeFileEntry(entry)
            }
        }
    }

    /**
     * Removes all matching files/directories from the index.
     * @param target Absolute path to directory/entry
     * @returns an array containing the affected entries.
     */
    public async rm(target): Promise<Entry[]> {
        // Remove trailing /
        if (target.charAt(target.length - 1) === '/')
            target = target.slice(0, -1)

        const survivingEntries: string[] = []
        const affectedEntries: Entry[] = []

        // Scan every entry in the filesystem
        for (const line of this.cache) {
            const entry = this.parseFileEntry(line)
            const entryname = entry.path

            // Checks if entry is a child (or grandchild, etc.) of the given path
            if (!(entryname + '/').startsWith(target + '/')) {
                survivingEntries.push(line)
            } else {
                affectedEntries.push(entry)
            }
        }

        this.cache = survivingEntries

        return affectedEntries
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