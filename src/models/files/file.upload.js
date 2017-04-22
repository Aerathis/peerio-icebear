/**
 * Upload module for File model, for code file length sake
 */
const config = require('../../config');
const warnings = require('./../warnings');
const FileUploader = require('./file-uploader');
const socket = require('../../network/socket');
const cryptoUtil = require('../../crypto/util');
const keys = require('../../crypto/keys');
const fileHelper = require('../../helpers/file');
const FileNonceGenerator = require('./file-nonce-generator');
const TinyDb = require('../../db/tiny-db');
const User = require('../user/user');

function _getUlResumeParams(path) {
    return config.FileStream.getStat(path)
        .then(stat => {
            if (stat.size !== this.size) {
                warnings.addSevere('error_fileSizeChanged', 'error', { fileName: this.name });
                throw new Error(`Upload file size mismatch. Was ${this.size} now ${stat.size}`);
            }
            // check file state on server
            return socket.send('/auth/file/state', { fileId: this.fileId });
        })
        .then(state => {
            console.log(state);
            if (state.status === 'ready' || state.chunksUploadComplete) {
                throw new Error('File already uploaded.');
            }
            return state.lastChunkNum + 1;
        })
        .catch(err => {
            console.log(err);
            this._saveUploadEndFact();
            this._resetUploadState();
            this.remove();
            return Promise.reject(); // do not upload
        });
}

function upload(filePath, fileName, resume) {
    if (this.downloading || this.uploading) {
        return Promise.reject(new Error(`File is already ${this.downloading ? 'downloading' : 'uploading'}`));
    }
    try {
        this.selected = false;
        this.progress = 0;
        this._resetUploadState();
        this.uploading = true;
        let p = Promise.resolve(null);
        if (resume) {
            p = this._getUlResumeParams(filePath);
        }
        let stream, nextChunkId, nonceGen;
        return p.then(nextChunk => {
            nextChunkId = nextChunk;
            // no need to set values when it's a resume
            if (nextChunkId === null) {
                this.uploadedAt = new Date(); // todo: should we update this when upload actually finishes?
                this.name = fileName || this.name || fileHelper.getFileName(filePath);
                this.key = cryptoUtil.bytesToB64(keys.generateEncryptionKey());
                this.fileId = cryptoUtil.getRandomUserSpecificIdB64(User.current.username);
            }
            stream = new config.FileStream(filePath, 'read');
            return stream.open();
        })
            .then(() => { // eslint-disable-line consistent-return
                console.log(`File read stream open. File size: ${stream.size}`);
                if (nextChunkId === null) {
                    this.size = stream.size;
                    if (!this.size) return Promise.reject('Can not upload zero size file.');
                    this.chunkSize = config.upload.getChunkSize(this.size);
                    nonceGen = new FileNonceGenerator(0, this.chunksCount - 1);
                    this.nonce = cryptoUtil.bytesToB64(nonceGen.nonce);
                    return this.saveToServer().catch(err => {
                        console.error(err);
                        this.remove();
                        return Promise.reject(err);
                    });
                }
                nonceGen = new FileNonceGenerator(0, this.chunksCount - 1, cryptoUtil.b64ToBytes(this.nonce));
            })
            .then(() => {
                if (nextChunkId === null) this._saveUploadStartFact(filePath);
                this.uploader = new FileUploader(this, stream, nonceGen, nextChunkId);
                return this.uploader.start();
            })
            .then(() => {
                this._saveUploadEndFact();
                this._resetUploadState(stream);
            })
            .catch(err => {
                console.error(err);
                !this.uploadCancelled && warnings.addSevere('error_uploadFailed', 'error', { fileName: this.name });
                this._resetUploadState();
                console.log('file.upload.js: stopped uploading');
                return Promise.reject(new Error(err));
            });
    } catch (ex) {
        this._resetUploadState();
        console.error(ex);
        return Promise.reject(ex);
    }
}

function cancelUpload() {
    if (this.readyForDownload) return Promise.reject();
    console.log('file.uploads.js: upload cancelled');
    this.uploadCancelled = true;
    this._saveUploadEndFact();
    this._resetUploadState();
    return this.remove();
}


function _saveUploadStartFact(path) {
    TinyDb.user.setValue(`UPLOAD:${this.fileId}`, {
        fileId: this.fileId,
        path
    });
}

function _saveUploadEndFact() {
    TinyDb.user.removeValue(`UPLOAD:${this.fileId}`);
}

function _resetUploadState(stream) {
    this.uploading = false;
    this.uploader && this.uploader.cancel();
    this.uploader = null;
    // this.progress = 0;
    try {
        if (stream) stream.close();
    } catch (ex) {
        console.error(ex);
    }
}

module.exports = function(File) {
    File.prototype._getUlResumeParams = _getUlResumeParams;
    File.prototype.upload = upload;
    File.prototype.cancelUpload = cancelUpload;
    File.prototype._saveUploadStartFact = _saveUploadStartFact;
    File.prototype._saveUploadEndFact = _saveUploadEndFact;
    File.prototype._resetUploadState = _resetUploadState;
};
