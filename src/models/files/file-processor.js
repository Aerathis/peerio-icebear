/**
 * Abstract parent class for FileDownloader and FileUploader
 */
const L = require('l.js');
const errors = require('../../errors');
const cryptoUtil = require('../../crypto/util');

class FileProcessor {
    // next queue processing calls will stop if stopped == true
    stopped = false;
    // process stopped and promise resolved/rejected
    processFinished = false;

    /**
     * @param {File} file
     * @param {FileStream} stream
     * @param {FileNonceGenerator} nonceGenerator
     * @param {string} processType - 'upload' or 'download'
     */
    constructor(file, stream, nonceGenerator, processType) {
        this.file = file;
        this.fileKey = cryptoUtil.b64ToBytes(file.key);
        this.stream = stream;
        this.nonceGenerator = nonceGenerator;
        this.processType = processType;
    }

    start() {
        L.info(`starting ${this.processType} for file id: ${this.file.id}`);
        this._tick();
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    cancel() {
        this._finishProcess(new Error(`${this.processType} cancelled`));
    }

    // stops process and resolves or rejects promise
    _finishProcess(err) {
        if (this.processFinished) return;
        this.processFinished = true;
        this.stopped = true; // bcs in case of error some calls might be scheduled
        try {
            this.stream.close();
        } catch (e) {
            // really don't care
        }
        this.cleanup();
        if (err) {
            L.info(`Failed to ${this.processType} file ${this.file.fileId}.`, err);
            this.reject(errors.normalize(err));
            return;
        }
        L.info(`${this.processType} success: ${this.file.fileId}`, this.toString());
        this.resolve();
    }

    // shortcut to finish process with error
    _error = err => {
        this._finishProcess(err || new Error(`${this.processType} failed`));
    };

    // override in child classes if cleanup needed on finish
    cleanup() {

    }


}


module.exports = FileProcessor;
