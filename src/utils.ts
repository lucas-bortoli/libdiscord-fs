import _FollowRedirects from 'follow-redirects'
import { File } from './types.js'
const { https } = _FollowRedirects

export const UtilEscapeMapping: { [key: string]: string } = {
    ':': '[[Begin--COLON--End',
    ' ': '[[Begin--SPACE--End',
    '\n': '[[Begin--SLASHN--End',
    '\r': '[[Begin--SLASHR--End'
}

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

    public static escape(original: string): string {
        let target = original

        for (const [ token, replace ] of Object.entries(UtilEscapeMapping)) {
            target = target.replaceAll(token, replace)
        }

        return target
    }
    
    public static unescape(escaped: string): string {
        let target = escaped
        
        for (const [ token, replace ] of Object.entries(UtilEscapeMapping)) {
            target = target.replaceAll(replace, token)
        }

        return target
    }

    public static serializeFileEntry(file: File, path: string): string {
        let comment = Utils.escape(file.comment || '')

        return [ path, file.size.toString(), file.ctime.toString(), file.metaptr, comment ].join(':')
    }

    public static parseFileEntry(line: string): { path: string, file: File } {
        const elements = line.split(':')

        const fileEntry: File = { 
            type: 'file', 
            size: parseInt(elements[1]), 
            ctime: parseInt(elements[2]), 
            metaptr: elements[3],
            comment: Utils.unescape(elements[4] ? elements[4] : '')
        }

        return { path: elements[0], file: fileEntry }
    }
}