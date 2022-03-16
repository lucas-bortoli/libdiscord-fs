import { Readable, Writable } from 'stream'
import Utils from './utils.js'
import Webhook from './webhook.js'

const BLOCK_SIZE: number = Math.floor(7.6 * 1024 * 1024)

export class RemoteWriteStream extends Writable {
    private queue: Buffer[]
    private piecePointers: string[]

    public uploadedBytes: number
    public writtenBytes: number
    public webhook: Webhook

    public metaPtr: string

    constructor(webhook: Webhook) {
        super({ decodeStrings: false })

        this.webhook = webhook
        this.uploadedBytes = 0
        this.writtenBytes = 0
        this.queue = []
        this.piecePointers = []
    }

    /**
     * Flushes (uploads) a block of data to the webhook.
     */
    private async flush(chunk: Buffer) {
        if (chunk.length > BLOCK_SIZE)
            console.warn(`Chunk length (${chunk.length} bytes) is bigger than maximum block size (${BLOCK_SIZE} bytes)!`)

        const piecePointer = await this.webhook.uploadFile('chunk', chunk)
        this.piecePointers.push(piecePointer.replace('https://cdn.discordapp.com/attachments/', ''))
        this.uploadedBytes += chunk.length
        chunk = null
    }

    async _write(chunk: Buffer, encoding, cb) {
        if (!Buffer.isBuffer(chunk))
            return cb(new TypeError('Provided chunk isn\'t a Buffer! Make sure to not specify any encoding on the stream piped to Filesystem#createWriteStream.'))

        this.writtenBytes += chunk.length

        // If adding this buffer to the queue would exceed the block size, then it's time to
        // upload all queued chunks.
        // If not, add it to the queue.
        if (this.queue.map(b => b.length).reduce((a,b) => a+b, 0) + chunk.length >= BLOCK_SIZE) {
            let buffer = Buffer.concat(this.queue)
            await this.flush(buffer)
            this.queue = [ chunk ]
            buffer = null
        } else {
            this.queue.push(chunk)
        }

        cb()
    }

    // Called before stream closes, used to write any remaining buffered data.
    async _final(cb) {
        // Flush remaining data in queue
        let buffer = Buffer.concat(this.queue)
        await this.flush(buffer)

        buffer = null
        this.queue = []

        // Upload file pieces array to the CDN. It's a comma-separated string.
        this.metaPtr = await this.webhook.uploadFile('meta', Buffer.from(this.piecePointers.join(',')))

        // Let the handler to allUploadsDone() finish the stream.
        this.emit('allUploadsDone', () => cb())
    }
}

export class RemoteReadStream extends Readable {
    private pieceIndex: number
    public pieces: string[]

    public readBytes: number

    constructor(pieceList: string[]) {
        super()

        this.pieceIndex = 0
        this.pieces = pieceList
        this.readBytes = 0
    }

    async _read() {
        // End stream
        if (this.pieceIndex >= this.pieces.length)
            this.push(null)

        const chunkUrl = 'https://cdn.discordapp.com/attachments/' + this.pieces[this.pieceIndex]
        const chunk = await Utils.fetchBlob(chunkUrl)
        const asBuffer = Buffer.from(chunk)

        this.push(asBuffer)

        this.readBytes += asBuffer.length
        this.pieceIndex++
    }
}