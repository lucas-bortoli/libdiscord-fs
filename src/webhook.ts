import _FollowRedirects from 'follow-redirects'
const { https } = _FollowRedirects
import FormData from 'form-data'
import Utils from './utils.js'

export default class Webhook {
    public webhookUrl: string

    /**
     * @param webhookUrl The webhook where data will be sent to.
     */
    constructor(webhookUrl: string) {
        this.webhookUrl = webhookUrl
    }

    /**
     * Uploads a file (buffer) to the given Discord webhook. If it fails, it tries again.
     * @param fileName The name of the file.
     * @param data The blob (buffer) of data to be uploaded.
     * @returns The link to the uploaded file.
     */
    async uploadFile(fileName: string, data: Buffer): Promise<string> {
        let msg
        
        while (!msg) {
            try {
                const body = await new Promise<Buffer>((resolve, reject) => {
                    const url = new URL(this.webhookUrl + '?wait=true')
                    let form = new FormData()
        
                    form.append('payload_json', JSON.stringify({
                        files: [
                            { id: 0, filename: fileName }
                        ]
                    }))
        
                    form.append('files[0]', data, { filename: fileName, contentType: 'application/octet-stream' })
        
                    const req = https.request({
                        protocol: url.protocol,
                        hostname: url.hostname,
                        path: url.pathname,
                        port: url.port,
                        method: 'POST',
                        headers: form.getHeaders()
                    }, res => {
                        let data: Buffer[] = []
        
                        res.on('data', chunk => data.push(chunk))

                        res.on('error', err => {
                            data = null
                            form.destroy()
                            form = null
                            data = null
                            reject(err)
                        })

                        res.once('end', () => {
                            resolve(Buffer.concat(data))
                            data = null
                            form.destroy()
                            form = null
                            data = null
                        })
                    })
            
                    form.pipe(req)
                })

                msg = JSON.parse(body.toString('utf-8'))
            } catch(error) {
                console.error('Error while uploading file. Trying again.', error)
                await Utils.Wait(3000)
            }
        }

        return msg.attachments[0].url
    }
}