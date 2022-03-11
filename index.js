import Filesystem from './lib/filesystem.js'
import * as fs from 'fs'
import { basename } from 'path/posix'

// https://stackoverflow.com/a/28120564
const sizeOf = function (bytes) {
    if (bytes == 0) { return "0.00 B"; }
    var e = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes/Math.pow(1024, e)).toFixed(2)+' '+' KMGTP'.charAt(e)+'B';
}

const main = async () => {
    if (!process.env.WEBHOOK) {
        console.error('Environment variable $WEBHOOK not set! See the help page for more information.')
        return
    }

    const args = process.argv.slice(2)

    if (args.includes('--help') || args.includes('-h')) {
        console.log(
`NanoFS Command Line Interface

Commands are given as command line arguments. For example:

    $ node index.js --upload-file=/mnt/c/file.dat:/uploads/file.dat --ls=/uploads/

    First, it uploads the local file /mnt/c/file.dat to /uploads/file.dat in the server.
    Then, it lists the /uploads directory.

Available commands:
    --upload-file=LOCAL:REMOTE
            Uploads a file to the server.
    --download-file=LOCAL:REMOTE
            Downloads a file from the server.
    --ls=DIRECTORY,   --readdir=DIRECTORY
            Lists the files in a given directory.
    --rm=PATH
            Deletes a file or an entire directory.
    --mv=FROM:TO,     --rename=FROM:TO
            Move/rename a file or directory.
    --exists=TARGET
            Checks if a file or directory exists.

All local paths SHOULD be absolute.
All remote paths MUST be absolute.

The environment variable WEBHOOK must be set to the Discord webhook url where files will be sent to, e.g:
    $ export WEBHOOK="https://discord.com/api/webhooks/854112906251402616/KBd5RggV22hYTggRpLo5WyfMey9VHABlu7cZ8l7EhGt6GsjiuPgqh2negcHW08i7RV2f"

NanoFS (c) 2022 Lucas Bortoli`)
        return
    }

    const nFS = new Filesystem('data.nfs', process.env.WEBHOOK)

    await nFS.loadDataFile()
    
    const uploadFile = (localPath, nfsPath) => {
        return new Promise(async resolve => {
            const localStream = fs.createReadStream(localPath)
            const remoteStream = await nFS.createWriteStream(nfsPath)
    
            localStream.pipe(remoteStream)

            remoteStream.on('error', err => { throw err })
            remoteStream.once('finish', () => resolve())
        })
    }

    const downloadFile = (localPath, nfsPath) => {
        return new Promise(async resolve => {
            const remoteStream = await nFS.createReadStream(nfsPath)
            const localStream = fs.createWriteStream(localPath)

            let byteCount = 0

            remoteStream.pipe(localStream)

            remoteStream.on('data', chunk => process.stdout.write(`\r${byteCount += chunk.length} bytes downloaded`))
            remoteStream.on('error', err => { throw err })

            localStream.once('finish', () => {
                console.log('\nWrote file ' + localPath)
                resolve()
            })
        })  
    }

    for (const arg of process.argv.slice(2)) {
        const [ key, value ] = arg.split('=')

        console.log(key)

        if (key === '--upload-file') {
            const [ localPath, nfsPath ] = value.split(':')

            console.log(`local ${localPath} -> ${nfsPath} remote`)

            await uploadFile(localPath, nfsPath)
        } else if (key === '--download-file') {
            const [ localPath, nfsPath ] = value.split(':')

            console.log(`local ${nfsPath} <- ${nfsPath} remote`)

            await downloadFile(localPath, nfsPath)
        } else if (key === '--ls' || key === '--readdir') {
            const entries = await nFS.readdir(value)

            console.log(entries.map(entry => {
                if (entry.type === 'directory') {
                    return `${(basename(entry.path) + '/').padEnd(24, ' ')} DIR `
                } else {
                    return `${basename(entry.path).padEnd(24, ' ')} FILE ${sizeOf(entry.size).padStart(8, ' ')}`
                }
            }).join('\n'))
        } else if (key === '--rm') {
            const affectedEntries = await nFS.rm(value)

            console.log('affected:')

            affectedEntries.forEach(entry =>
                console.log(`${basename(entry.path).padEnd(24, ' ')} FILE ${sizeOf(entry.size).padStart(8, ' ')}`
            ))
        } else if (key === '--mv' || key === '--rename') {
            const [ from, to ] = value.split(':')
            await nFS.mv(from, to)
        } else if (key === '--exists') {
            if (await nFS.exists(value)) {
                console.log('Exists')
            } else {
                console.log('Doesn\'t exist')
            }
        } else {
            console.log('Unknown command')
        }

        console.log('')
    }

    await nFS.writeDataFile()
}

main()