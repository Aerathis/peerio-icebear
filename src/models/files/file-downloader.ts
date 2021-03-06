import socket from '../../network/socket';
import * as secret from '../../crypto/secret';
import config from '../../config';
import FileProcessor from './file-processor';
import { DisconnectedError } from '../../errors';
import { retryUntilSuccess } from '../../helpers/retry';
import FileStreamBase from './file-stream-base';
import FileNonceGenerator from './file-nonce-generator';
import File from './file';

const { CHUNK_OVERHEAD } = config;

/**
 * Manages file download process.
 */
export default class FileDownloader extends FileProcessor {
    constructor(
        file: File,
        stream: FileStreamBase,
        nonceGenerator: FileNonceGenerator,
        resumeParams?: { partialChunkSize: number; wholeChunks: number } | boolean
    ) {
        super(file, stream, nonceGenerator, 'download');

        // total amount to download and save to disk
        this.file.progressMax = file.sizeWithOverhead;
        this.getUrlParams = { fileId: file.fileId };
        this.chunkSizeWithOverhead = file.chunkSize + CHUNK_OVERHEAD;
        this.downloadChunkSize =
            Math.floor(config.download.maxDownloadChunkSize / this.chunkSizeWithOverhead) *
            this.chunkSizeWithOverhead;

        if (resumeParams && typeof resumeParams === 'object') {
            this.partialChunkSize = resumeParams.partialChunkSize;
            nonceGenerator.chunkId = resumeParams.wholeChunks;
            this.file.progress = this.chunkSizeWithOverhead * resumeParams.wholeChunks;
            this.downloadPos = this.chunkSizeWithOverhead * resumeParams.wholeChunks;
        }
    }

    getUrlParams: { fileId: string };
    chunkSizeWithOverhead: number;
    downloadChunkSize: number;
    partialChunkSize: number;

    /**
     * Chunks as they were uploaded
     */
    decryptQueue: Uint8Array[] = [];
    /**
     * Number of active downloads.
     */
    activeDownloads = 0;
    /**
     * Download processing chain.
     */
    downloadChain = Promise.resolve();
    /**
     * Flag to indicate that chunk is currently waiting for write promise resolve to avoid parallel writes.
     */
    writing = false;
    /**
     *  position of the blob as it is stored in the cloud
     */
    downloadPos = 0;
    /**
     * Indicates that there are no more chunks to download.
     */
    noMoreChunks = false;
    /**
     * blob was fully read
     */
    downloadEof = false;
    /**
     * Array of active XMLHttpRequests.
     */
    currentXhrs: XMLHttpRequest[] = [];

    get _isDecryptQueueFull() {
        return (
            this.decryptQueue.length * (this.chunkSizeWithOverhead + 1) >
            config.download.maxDecryptBufferSize * config.download.parallelism
        );
    }

    _abortXhr = () => {
        this.currentXhrs.forEach(xhr => xhr.abort());
    };

    cleanup() {
        this._abortXhr();
    }

    _downloadChunk() {
        if (this.stopped || this.noMoreChunks || this.downloadEof || this._isDecryptQueueFull)
            return;

        if (this.activeDownloads >= config.download.parallelism) return;

        const pos = this.downloadPos;
        const size = Math.min(this.downloadChunkSize, this.file.sizeWithOverhead - pos);
        if (size === 0) {
            this.noMoreChunks = true;
            this.downloadChain = this.downloadChain.then(() => {
                this.downloadEof = true;
                this._tick();
            });
            return;
        }
        console.log(`Downloading chunk at ${pos} (size: ${size}))`);
        this.downloadPos += size;

        // Start download.
        this.activeDownloads++;
        const promise = retryUntilSuccess(
            () => {
                if (this.stopped) return Promise.reject(new Error('User cancelled download'));
                return this._getChunkUrl(pos, pos + size - 1).then(url =>
                    this._download(url, size)
                );
            },
            { maxRetries: 5 }
        );

        // Add download result processing to the chain.
        this.downloadChain = this.downloadChain
            .then(() => promise)
            .then(dlChunk => {
                if (this.stopped) return; // download was cancelled or errored
                if (dlChunk.byteLength === 0) {
                    throw new Error('Unexpected zero-length chunk');
                }
                for (let i = 0; i < dlChunk.byteLength; i += this.chunkSizeWithOverhead) {
                    const chunk = new Uint8Array(
                        dlChunk,
                        i,
                        Math.min(this.chunkSizeWithOverhead, dlChunk.byteLength - i)
                    );
                    this.decryptQueue.push(chunk);
                }
                this.activeDownloads--;
                this._tick();
            })
            .catch(this._error);
    }

    _decryptChunk() {
        if (this.stopped || this.writing || !this.decryptQueue.length) return;

        let chunk = this.decryptQueue.shift();
        const nonce = this.nonceGenerator.getNextNonce();
        chunk = secret.decrypt(chunk, this.fileKey, nonce, false);
        this.writing = true;
        if (this.partialChunkSize) {
            chunk = new Uint8Array(
                chunk.buffer,
                chunk.byteOffset + this.partialChunkSize,
                chunk.length - this.partialChunkSize
            );
            this.partialChunkSize = 0;
        }
        this.stream
            .write(chunk)
            .then(this._onWriteEnd)
            .catch(this._error);
    }

    _onWriteEnd = () => {
        this.writing = false;
        this._tick();
    };

    _checkIfFinished() {
        if (this.downloadEof && !this.decryptQueue.length && !this.writing) {
            this._finishProcess();
            return true;
        }
        return false;
    }
    _tick = () => {
        if (this.processFinished || this._checkIfFinished()) return;
        setTimeout(() => {
            try {
                this._downloadChunk();
                this._decryptChunk();
            } catch (err) {
                this._error(err);
            }
        });
    };

    _getChunkUrl(from: number, to: number): Promise<string> {
        return socket
            .send('/auth/file/url', this.getUrlParams, false)
            .then(f => `${f.url}?rangeStart=${from}&rangeEnd=${to}`);
    }

    _download = (url: string, expectedSize: number): Promise<ArrayBuffer> => {
        const LOADING = 3,
            DONE = 4; // XMLHttpRequest readyState constants.
        const self = this;
        let lastLoaded = 0;
        let retryCount = 0;
        let xhr;
        // For refactoring lovers: (yes, @anri, you)
        // - don't convert event handlers to arrow functions
        const p = new Promise<ArrayBuffer>((resolve, reject) => {
            xhr = new XMLHttpRequest();
            self.currentXhrs.push(xhr);

            const trySend = () => {
                // had to do this bcs uploaded blob takes some time to propagate through cloud
                if (self.stopped || retryCount++ >= 5) return false;
                if (retryCount > 0) {
                    console.log('Blob download retry attempt: ', retryCount, url);
                }
                setTimeout(() => {
                    xhr.open('GET', url);
                    xhr.responseType = 'arraybuffer';
                    xhr.send();
                }, 3000);
                return true;
            };

            // HACK: if there was no progress event fired
            // calculate the file progress from completion handler
            let progressEventFired = false;

            xhr.onreadystatechange = function(this: XMLHttpRequest) {
                if (this.readyState === LOADING) {
                    // Download started, maybe start
                    // other parallel downloads now.
                    self._tick();
                    return;
                }
                if (this.readyState !== DONE) {
                    // We're interested only in download completion now.
                    return;
                }
                if (this.status === 0) {
                    console.error('Blob download cancelled.');
                    reject(new Error(`Blob download cancelled: ${url}`));
                    return;
                }
                if (this.status === 423) {
                    // Reject and do not retry XHR request, since this chunk
                    // download should be retried from the beginning by getting
                    // a new URL token.
                    reject(new Error(`Blob download got 423 error: ${url}`));
                    return;
                }
                if (
                    (this.status === 200 || this.status === 206) &&
                    this.response.byteLength === expectedSize
                ) {
                    if (!progressEventFired) {
                        self.file.progress += expectedSize;
                    }
                    resolve(this.response as ArrayBuffer); // success
                    return;
                }
                if (
                    (this.status === 200 || this.status === 206) &&
                    this.response.byteLength !== expectedSize
                ) {
                    console.error(
                        `Download blob error: size ${
                            this.response.byteLength
                        }, expected ${expectedSize}`
                    );
                } else {
                    console.error('Download blob error: ', this.status);
                }
                if (!p.isRejected()) {
                    if (!trySend()) {
                        const reason = socket.authenticated
                            ? new Error(`Blob download error: ${url}`)
                            : new DisconnectedError();
                        reject(reason);
                    }
                }
            };

            xhr.onprogress = function(event) {
                // in mobile and in node with polyfill weird things can happen
                // sometimes onprogress is never called, sometimes 'loaded' is always zero
                if (event.loaded > 0) progressEventFired = true;
                if (p.isRejected()) return;
                if (event.loaded > lastLoaded) {
                    self.file.progress += event.loaded - lastLoaded;
                    lastLoaded = event.loaded;
                }
            };

            xhr.ontimeout = xhr.onabort = xhr.onerror = function() {
                if (!p.isRejected() && !trySend()) reject(new Error(`Blob download error: ${url}`));
            };

            trySend();
        }).finally(() => {
            if (xhr) {
                const index = self.currentXhrs.indexOf(xhr);
                if (index >= 0) self.currentXhrs.splice(index, 1);
            }
        });

        return p;
    };
}
