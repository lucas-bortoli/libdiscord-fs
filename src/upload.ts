import { MessageAttachment, WebhookClient } from 'discord.js'
import Utils from './utils.js'

export default class Webhook {
    private readonly webhook: WebhookClient

    /**
     * @param webhookUrl The webhook where data will be sent to.
     */
    constructor(webhookUrl: string) {
        this.webhook = new WebhookClient({ url: webhookUrl })
    }

    /**
     * Uploads a file (buffer) to the given Discord webhook. If it fails, it tries again.
     * @param fileName The name of the file.
     * @param data The blob (buffer) of data to be uploaded.
     * @returns The link to the uploaded file.
     */
    async uploadFile(fileName: string, data: Buffer): Promise<string> {
        let msg
        console.log(Buffer.isBuffer(data))
        while (!msg) {
            try {
                msg = await this.webhook.send({
                    files: [ new MessageAttachment(data, fileName) ]
                })
            } catch(error) {
                console.error('Error while uploading file. Trying again.', error)
                await Utils.Wait(1000)
            }
        }

        return msg.attachments[0].url
    }
}