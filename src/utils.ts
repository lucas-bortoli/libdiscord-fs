import { File } from './types.js'

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
    public static async fetchBlob(resourceUrl: string): Promise<Buffer> {
        const arrayBuffer = await fetch(resourceUrl, {
            method: 'GET'
        }).then(r => r.arrayBuffer())

        return Buffer.from(arrayBuffer)
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