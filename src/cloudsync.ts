import Filesystem from "./filesystem.js";
import { File } from "./types";
import Utils from "./utils.js";
import { IMessage } from "./webhook";

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

        if (!msgId) {
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
        const remoteStream = await this.fsx.createWriteStream("/@@sync.dat");

        await this.fsx.writeDataToStream(remoteStream);

        await new Promise<void>(resolve => {
            remoteStream.once("finish", () => resolve());
        });

        const dataFilePtr = await this.fsx.getEntry("/@@sync.dat") as File;

        const link = await this.fsx.uploadFileEntry([
            { entry: dataFilePtr, entryName: "@@sync.dat" }
        ])

        this.fsx.rm("/@@sync.dat");

        await this.updatePointerMessage(link);
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
        const entry = JSON.parse((await Utils.fetchBlob(syncEntryUrl)).toString("utf-8")) as File;

        this.fsx.setEntry("/@@sync.dat", entry);

        const remoteStream = await this.fsx.createReadStream("/@@sync.dat");
        await this.fsx.loadDataFromStream(remoteStream);
    }
}