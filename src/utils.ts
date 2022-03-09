import * as fsp from 'fs/promises'
import * as fs from 'fs'

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
}