import fetch from 'cross-fetch'
import FormData from 'form-data'
import Utils from './utils.js'

export interface IMessageSendOptions {
    username?: string
    content: string
}

export interface IMessage {
    id: string,
    content: string
}

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
                const form = new FormData()

                form.append('payload_json', JSON.stringify({
                    files: [
                        { id: 0, filename: fileName }
                    ]
                }))

                form.append('files[0]', data, { filename: fileName, contentType: 'application/octet-stream' })

                msg = await fetch(this.webhookUrl + '?wait=true', {
                    method: 'POST',
                    headers: form.getHeaders(),
                    body: form.getBuffer()
                }).then(r => r.json())
            } catch(error) {
                console.error('Error while uploading file. Trying again.', error)
                await Utils.Wait(3000)
            }
        }

        return msg.attachments[0].url
    }

    async sendMessage(opts: IMessageSendOptions) {
        const response = await fetch(this.webhookUrl + '?wait=true', {
            method: 'POST',
            body: JSON.stringify(opts)
        })
        
        return (await response.json()) as IMessage
    }

    async editMessage(id: string, opts: IMessageSendOptions) {
        const response = await fetch(this.webhookUrl + '/messages/' + id + '?wait=true', {
            method: 'POST',
            body: JSON.stringify(opts)
        })

        return (await response.json()) as IMessage
    }

    async getMessage(id: string) {
        const response = await fetch(this.webhookUrl + '/messages/' + id, {
            method: 'GET',
        })
        
        return (await response.json()) as IMessage
    }
}