import _FollowRedirects from 'follow-redirects'
import { File } from './types.js'
const { https } = _FollowRedirects

export default class Utils {
    private constructor() { throw new Error("Don't instantiate me!") }

    public static Wait(ms: number) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
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

    public static serializeFileEntry(file: File, path: string): string {
        let comment = file.comment || ''
        comment = comment.replaceAll(':', 'ː')
        return [ path, file.size.toString(), file.ctime.toString(), file.metaptr, file.comment || '' ].join(':')
    }

    public static parseFileEntry(line: string): { path: string, file: File } {
        const elements = line.split(':')

        const fileEntry: File = { 
            type: 'file', 
            size: parseInt(elements[1]), 
            ctime: parseInt(elements[2]), 
            metaptr: elements[3],
            comment: elements[4] ? elements[4] : ''
        }

        return { path: elements[0], file: fileEntry }
    }
}