# Discord-FS
Quickly share files and store them on Discord

## Install
```
$ npm install @lucas-bortoli/libdiscord-fs
```

## Usage

```
NanoFS Command Line Interface

Commands are given as command line arguments. For example:

    $ node index.js --upload-file=/mnt/c/file.dat:/uploads/file.dat --ls=/uploads/

    First, it uploads the local file /mnt/c/file.dat to /uploads/file.dat in the server.
    Then, it lists the /uploads directory.

Available commands:
    --upload-file=LOCAL:REMOTE
            Uploads a file to the server.
    --download-file=LOCAL:REMOTE
            Downloads a file from the server.
    --ls=DIRECTORY,   --readdir=DIRECTORY
            Lists the files in a given directory.
    --rm=PATH
            Deletes a file or an entire directory.
    --mv=FROM:TO,     --rename=FROM:TO
            Move/rename a file or directory.

All local paths SHOULD be absolute.
All remote paths MUST be absolute.

The environment variable WEBHOOK must be set to the Discord webhook url where files will be sent to, e.g:
    $ export WEBHOOK="https://discord.com/api/webhooks/854112906251402616/KBd5RggV22hYTggRpLo5WyfMey9VHABlu7cZ8l7EhGt6GsjiuPgqh2negcHW08i7RV2f"

NanoFS (c) 2022 Lucas Bortoli
```