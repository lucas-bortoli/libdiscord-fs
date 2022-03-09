import * as fs from 'fs'
import * as path from 'path/posix'
import * as readline from 'readline'
import * as Repl from 'repl'

interface File {
    type: 'file',
    path: string,
    size: number,
    ctime: number,
    md5: string,
    msgid: string
}

interface Directory {
    type: 'directory',
    path: string
}

type Entry = File | Directory

class NanoFileSystem {
    public readonly file: string

    constructor(file: string) {
        this.file = file
    }

    public async createReadStream() {
        
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

    private async *scanFileSystem(): AsyncGenerator<File, void> {
        const stream = fs.createReadStream('fs.fdata')
        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        })
    
        const headers = new Map()
    
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
                
                const key = elements.pop().trim()
                const value = elements.join(':').trim()
    
                headers.set(key, value)
            } else {
                // Parse body
                const elements = line.split(':')

                const path: string = elements[0]
                const size: number = parseInt(elements[1])
                const ctime: number = parseInt(elements[2])
                const md5: string = elements[3]
                const msgid: string = elements[4]
                
                yield { type: 'file', path, size, ctime, md5, msgid }
            }
        }
    }
}

const main = async () => {
    let f = new NanoFileSystem('fs.fdata')

    Repl.start({
        prompt: 'fs$ ',
        eval: async (cmd: string, context, file, cb) => {
            const args = cmd.trim().split(' ')
            const cmdName = args.shift()
            
            if (typeof f[cmdName] === 'function') {
                console.time(cmdName)
                const result = await f[cmdName](args.join(' '))
                console.timeEnd(cmdName)
                return cb(null, result)
            } else {
                return cb(new Error('unknown command'), null)
            }
        }
    })
}

if (process.argv.includes('--fs-repl'))
    main()