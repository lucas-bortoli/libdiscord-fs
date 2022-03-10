import Filesystem from './dist/filesystem.js'
import * as fs from 'fs'
import { basename } from 'path/posix'

// https://stackoverflow.com/a/28120564
const sizeOf = function (bytes) {
    if (bytes == 0) { return "0.00 B"; }
    var e = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes/Math.pow(1024, e)).toFixed(2)+' '+' KMGTP'.charAt(e)+'B';
}

const main = async () => {
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

    const downloadFile = (nfsPath, localPath) => {
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

        if (key === '--upload-file') {
            const [ localPath, targetPath ] = value.split(':')
            console.log(`Source file: ${localPath}\nTarget file: ${targetPath}`)
            await uploadFile(localPath, targetPath)
        } else if (key === '--download-file') {
            const [ nfsPath, targetPath ] = value.split(':')
            console.log(`Remote path: ${nfsPath}\nLocal path: ${targetPath}`)
            await downloadFile(nfsPath, targetPath)
        } else if (key === '--ls' || key === '--readdir') {
            const entries = await nFS.readdir(value)
            console.log(entries.map(entry => {
                if (entry.type === 'directory') {
                    return `${(basename(entry.path) + '/').padEnd(32, ' ')} DIR `
                } else {
                    return `${basename(entry.path).padEnd(32, ' ')} FILE ${sizeOf(entry.size).padStart(8, ' ')}`
                }
            }).join('\n'))
        }
    }

    await nFS.writeDataFile()
}

main()