import fetch from 'node-fetch'
import { FormData, File } from 'formdata-node'
import { FormDataEncoder } from "form-data-encoder"
import { Readable } from 'stream'

const Wait = (ms: number) => new Promise(resolve => {
    setTimeout(resolve, ms)
})

const DiscordUpload = async (file_name: string, data: Buffer, webhook_url: string): Promise<string> => {
    const form_data = new FormData()
    
    form_data.append('files[0]', new File(data, file_name), file_name)
    form_data.append('payload_json', JSON.stringify({
        "attachments": [
            { "id": 0, "description": "file_upload", "filename": file_name }
        ]
    }))

    const response = await fetch(webhook_url, {
        method: 'POST',
        body: Readable.from(new FormDataEncoder(form_data).encode())
    })

    const body = await response.json()

    const ratelimit_remaining = parseInt(response.headers.get('x-ratelimit-remaining'))
    const ratelimit_reset_after = parseFloat(response.headers.get('x-ratelimit-reset-after'))

    // if ratelimit reached, wait until we can proceed
    if (ratelimit_remaining === 0)
        await Wait(ratelimit_reset_after * 1200)

    //@ts-ignore
    return body.attachments[0].url as string
}

export default DiscordUpload