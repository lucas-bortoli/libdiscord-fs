import * as fs from 'fs'
import * as path from 'path/posix'
import * as readline from 'readline'

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
    public file: string
    constructor(file: string) {
        this.file = file
    }

    async readdir(targetDir): Promise<Entry[]> {
        // Remove trailing /
        if (targetDir.charAt(targetDir.length - 1) === '/')
            targetDir = targetDir.slice(0, -1)

        const directoryContents: Entry[] = []
        const scan = this.scanFileSystem()

        for await (const entry of scan) {
            const dirname = path.dirname(entry.path)

            if (path.dirname(entry.path) === targetDir) {
                if (entry.path.indexOf('/', dirname.length)) {
                    directoryContents.push({ type: 'directory', path: path.join(dirname, ) })
                }
            }
        }

        return directoryContents
    }

    async *scanFileSystem(): AsyncGenerator<File> {
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
    console.log('ohn')
    let f = new NanoFileSystem('fs.fdata')

    let dircontents = await f.readdir('/')

    console.log(dircontents)
}

main()