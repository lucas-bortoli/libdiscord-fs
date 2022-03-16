import * as fsp from 'fs/promises'
import * as fs from 'fs'
import _FollowRedirects from 'follow-redirects'
const { https } = _FollowRedirects

export default class Utils {
    private constructor() { throw new Error("Don't instantiate me!") }

    public static Wait(ms: number) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }

    /**
     * Checks if a file exists in the filesystem.
     * @param path Path to file
     * @returns true if the file exists and is readable.
     */
    public static async fsp_fileExists(path: string): Promise<boolean> {
        try {
            await fsp.access(path, fs.constants.F_OK)
            return true
        } catch(error) {
            return false
        }
    }

    /**
     * Downloads a blob of data directly to memory.
     * @param url 
     * @returns 
     */
    public static fetchBlob(resourceUrl: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const url = new URL(resourceUrl)

            const req = https.request({
                protocol: url.protocol,
                hostname: url.hostname,
                path: url.pathname,
                port: url.port,
                method: 'GET'
            }, res => {
                let data: Buffer[] = []

                res.on('data', chunk => data.push(chunk))

                res.on('error', err => {
                    data = null
                    reject(err)
                })

                res.once('end', () => {
                    resolve(Buffer.concat(data))
                })
            })

            req.end()
        })
    }
}