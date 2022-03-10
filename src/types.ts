export interface File {
    type: 'file',
    path: string,
    size: number,
    ctime: number,
    metaptr: string
}

export interface Directory {
    type: 'directory',
    path: string
}

export type Entry = File | Directory

export type NanoFileSystemHeaderKey = 'Filesystem-Version' | 'Description' | 'Author'