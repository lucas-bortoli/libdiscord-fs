import Filesystem from './dist/filesystem.js'
import * as fs from 'fs'
import Utils from './dist/utils.js'

const main = async () => {
    const nFS = new Filesystem('data.nfs', process.env.WEBHOOK)

    await nFS.loadDataFile()
    
    const uploadFile = async (localPath, nfsPath) => {
        const stream = fs.createReadStream(localPath, { encoding: 'binary' })
        const entry = await nFS.writeFileFromStream(stream, nfsPath)

        return entry
    }

    const downloadFile = (nfsPath, localPath) => {
        return new Promise(async resolve => {
            const entry = await nFS.getFile(nfsPath)
            const localFileStream = fs.createWriteStream(localPath)
            const downloadStream = await nFS.getFileStream(entry)
            let byteCount = 0

            downloadStream.pipe(localFileStream)

            downloadStream.on('data', chunk => process.stdout.write(`\r${byteCount += chunk.length} bytes downloaded`))

            downloadStream.once('end', () => {
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
        }
    }

    await Utils.Wait(100)

    console.log('Finishing')

    await nFS.writeDataFile()
}

main()