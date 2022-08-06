import Filesystem from "./filesystem.js";
import { File } from "./types";
import Utils from "./utils.js";
import { IMessage } from "./webhook";
import { Readable, Writable } from "node:stream";

export default class CloudSync {
    private fsx: Filesystem

    constructor(fsx: Filesystem) {
        this.fsx = fsx;
    }

    private async createPointerMessage(): Promise<IMessage> {
        const msg = await this.fsx.webhook.sendMessage({
            content: "cloudsync " + Date.now() + " --> []"
        });

        this.fsx.header.set('Sync-Message', msg.id.toString());

        return msg;
    }

    private async getPointerMessage(): Promise<IMessage | null> {
        const msgId = this.fsx.header.get('Sync-Message');

        if (!msgId || msgId === 'null') {
            return null;
        }

        const msg = await this.fsx.webhook.getMessage(parseInt(msgId));

        // Invalid message
        if (!msg.id) {
            return null;
        }

        return msg;
    }

    private async getOrCreatePointerMessage(): Promise<IMessage> {
        const ptr = await this.getPointerMessage();

        if (ptr !== null) {
            return ptr;
        }

        return await this.createPointerMessage();
    }

    private async updatePointerMessage(dataFileLink: string) {
        const msg = await this.getOrCreatePointerMessage();

        await this.fsx.webhook.editMessage(msg.id, {
            content: "cloudsync " + Date.now() + " --> [" + dataFileLink + "]"
        });
    }

    /**
     * Overwrites the remote data file with the local state.
     */
    async upload() {
        // Collect fragments into memory
        const dataFileBlob: Buffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];

            const collectorStream = new Writable({
                write(chunk, encoding, cb) {
                    chunks.push(chunk);
                    cb();
                },
                final(cb) {
                    resolve(Buffer.concat(chunks));
                    cb();
                }
            });

            this.fsx.writeDataToStream(collectorStream);
        });

        const dataFileLink = await this.fsx.webhook.uploadFile("sync", dataFileBlob);
        await this.updatePointerMessage(dataFileLink);
    }

    /**
     * Overwrites the local state with the remote data.
     */
    async download() {
        const msg = await this.getOrCreatePointerMessage();
        const match = msg.content.match(/\[(\.+)\]/);

        // Sync data doesn't exist
        if (!match) {
            return;
        }

        const syncEntryUrl = match[1];
        const blob = await Utils.fetchBlob(syncEntryUrl);

        const memoryStream = new Readable({
            read() {
                this.push(blob);
                this.push(null);
            }
        });

        await this.fsx.loadDataFromStream(memoryStream);
    }
}