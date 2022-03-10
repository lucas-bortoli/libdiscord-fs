import Filesystem from './dist/filesystem.js'
import * as fs from 'fs'

const main = async () => {
    const nFS = new Filesystem('data.nfs', process.env.WEBHOOK)

    await nFS.loadDataFile()
    
    const uploadFile = async (localPath, nfsPath) => {
        const stream = fs.createReadStream(localPath, { encoding: 'binary' })
        const entry = await nFS.writeFileFromStream(stream, nfsPath)

        return entry
    }

    for (const arg of process.argv.slice(2)) {
        const [ key, value ] = arg.split('=')

        if (key === '--file') {
            const [ localPath, targetPath ] = value.split(':')
            console.log(`Source file: ${localPath}\nTarget file: ${targetPath}`)
            await uploadFile(localPath, targetPath)
        }
    }

    await nFS.writeDataFile()
}

main()