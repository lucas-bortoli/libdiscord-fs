import { Readable, Writable } from 'stream'
import Utils from './utils.js'
import Webhook from './webhook.js'
import { Cipher, createCipheriv, createDecipheriv } from 'node:crypto'
import { Decipher, createHash } from 'crypto'

const BLOCK_SIZE: number = Math.floor(7.6 * 1024 * 1024)

type EncryptionInformation = {
    enabled: boolean,
    iv: Buffer,
    key: string
}

export class RemoteWriteStream extends Writable {
    private queue: Buffer[]
    private piecePointers: string[]

    public uploadedBytes: number
    public writtenBytes: number
    public webhook: Webhook

    public metaPtr: string

    public encryption?: EncryptionInformation
    public cipher?: Cipher

    constructor(webhook: Webhook, encryption?: EncryptionInformation) {
        super({ decodeStrings: false })

        this.webhook = webhook
        this.encryption = encryption
        this.uploadedBytes = 0
        this.writtenBytes = 0
        this.queue = []
        this.piecePointers = []

        if (this.encryption && this.encryption.enabled && this.encryption.key && this.encryption.iv) {
            const key = createHash('sha256').update(this.encryption.key).digest()
            const iv = createHash('sha256').update(this.encryption.iv).digest().slice(0, 16)
            this.cipher = createCipheriv('aes-256-cbc', key, iv)
        }
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

        if (this.cipher) {
            // Encrypt the chunk
            chunk = this.cipher.update(chunk)
        }

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

        if (this.cipher) {
            // Use one more call for remaining data (I can't guarantee it won't exceed the 7.8mb limit on the queue)
            let remainingEncryptedData = this.cipher.final()
            await this.flush(remainingEncryptedData)
        }

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

    public encryption?: EncryptionInformation
    public decipher?: Decipher

    constructor(pieceList: string[], encryption?: EncryptionInformation) {
        super()

        this.pieceIndex = 0
        this.pieces = pieceList
        this.readBytes = 0
        
        if (encryption && encryption.enabled && encryption.key && encryption.iv) {
            const key = createHash('sha256').update(this.encryption.key).digest()
            const iv = createHash('sha256').update(this.encryption.iv).digest().slice(0, 16)
            this.encryption = encryption
            this.decipher = createDecipheriv('aes-256-cbc', key, iv)
        }
    }

    async _read() {
        // End stream
        if (this.pieceIndex >= this.pieces.length) {
            if (this.decipher)
                this.push(this.decipher.final())

            return this.push(null)
        }

        const chunkUrl = 'https://cdn.discordapp.com/attachments/' + this.pieces[this.pieceIndex]
        let chunk: Buffer
        
        do {
            try {
                chunk = await Utils.fetchBlob(chunkUrl)
            } catch(error) {
                console.error(`Error downloading chunk i=${this.pieceIndex} (${this.pieces[this.pieceIndex]}). Trying again...`)
                console.error(error)
                await Utils.Wait(5000)
            }
        } while (!chunk)
        
        let asBuffer = Buffer.from(chunk)

        if (this.decipher) {
            // Decrypt this chunk
            asBuffer = this.decipher.update(asBuffer)
        }

        this.push(asBuffer)

        this.readBytes += asBuffer.length
        this.pieceIndex++
    }
}