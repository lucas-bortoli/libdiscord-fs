import { Readable, Writable } from 'stream'

export interface File {
    type: 'file',
    size: number,
    ctime: number,
    metaptr: string
}

export interface Directory {
    type: 'directory',
    items: {
        [key: string]: Entry
    }
}

export type Entry = File | Directory

export type FileSystemHeaderKey = 'Filesystem-Version' | 'Description' | 'Author' | string

export type WalkDirectoryAsyncCallback = (file: File, path: string) => Promise<void>