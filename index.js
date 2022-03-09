import Filesystem from './dist/filesystem.js'
import * as fs from 'fs'

const main = async () => {
    const nFS = new Filesystem('data.nfs', process.env.WEBHOOK)

    await nFS.init()

    const uploadFile = async (localPath, nfsPath) => {
        const stream = fs.createReadStream(localPath, { encoding: 'binary' })
        const entry = await nFS.writeFileFromStream(stream, nfsPath)

        return entry
    }

    uploadFile('index.js', '/dev/index.js')
}

main()