/**
 * Base class for kegs
 * @module models/keg
 */
const socket = require('../../network/socket');
const secret = require('../../crypto/secret');
const { AntiTamperError } = require('../../errors');

let temporaryKegId = 0;
function getTemporaryKegId() {
    return `tempKegId_${temporaryKegId++}`;
}
/**
 * Base class with common metadata and operations.
 */
class Keg {
    /**
     * @param {[string]} id - kegId, or null for new kegs
     * @param {string} type - keg type
     * @param {KegDb} db - keg database owning this keg
     * @param {[boolean]} plaintext - should keg be encrypted
     */
    constructor(id, type, db, plaintext) {
        this.id = id;
        this.type = type;
        this.db = db;
        this.plaintext = !!plaintext;
        this.keyId = 0; // @type {string} reserved for future keys change feature
        this.overrideKey = null; // @type {[Uint8Array]} separate key for this keg, overrides regular keg key
        this.version = 0; // @type {number} keg version
        this.collectionVersion = 0; // @type {number} kegType-wide last update id for this keg
        this.props = {};
    }

    /**
     * Kegs with version==1 were just created and don't have any data
     * @returns {boolean}
     */
    get isEmpty() {
        return this.version === 1;
    }

    assignTemporaryId() {
        this.tempId = getTemporaryKegId();
    }

    /**
     * Saves keg to server, creates keg (reserves id) first if needed
     * @returns {Promise<Keg>}
     */
    saveToServer() {
        if (this.id) return this._internalSave();

        return socket.send('/auth/kegs/create', {
            collectionId: this.db.id,
            type: this.type
        }).then(resp => {
            this.id = resp.kegId;
            this.version = resp.version;
            this.collectionVersion = resp.collectionVersion;
            return this._internalSave();
        });
    }

    /**
     * Updates existing server keg with new data.
     * This function assumes keg id exists so always use 'saveToServer()' to be safe.
     * todo: reconcile optimistic concurrency failures
     * @returns {Promise}
     * @private
     */
    _internalSave() {
        let payload;
        try {
            payload = this.serializeKegPayload();
            // anti-tamper protection, we do it here, so we don't have to remember to do it somewhere else
            if (!this.plaintext) {
                payload._sys = {
                    kegId: this.id,
                    type: this.type
                };
            }
            // server expects string or binary
            payload = JSON.stringify(payload);
            // should we encrypt the string?
            if (!this.plaintext) {
                payload = secret.encryptString(payload, this.overrideKey || this.db.key).buffer;
            }
        } catch (err) {
            console.error('Fail preparing keg to save.', err);
            return Promise.reject(err);
        }
        return socket.send('/auth/kegs/update', {
            collectionId: this.db.id, // todo: rename to dbId on server and here
            update: {
                kegId: this.id,
                keyId: '0',
                type: this.type,
                payload,
                props: this.props,
                // todo: this should be done smarter when we have save retry, keg edit and reconcile
                version: ++this.version
            }
        }).then(resp => {
            this.collectionVersion = resp.collectionVersion;
        });
    }

    /**
     * Populates this keg instance with data from server
     * @returns {Promise.<Keg>}
     */
    load() {
        return socket.send('/auth/kegs/get', {
            collectionId: this.db.id,
            kegId: this.id
        }).then(keg => this.loadFromKeg(keg));
    }

    loadFromKeg(keg) {
        if (this.id && this.id !== keg.kegId) {
            throw new Error(`Attempt to rehydrate keg(${this.id}) with data from another keg(${keg.kegId}).`);
        }
        this.id = keg.kegId;
        this.version = keg.version;
        this.collectionVersion = keg.collectionVersion;
        this.props = keg.props;
        //  is this an empty keg? probably just created.
        if (!keg.payload) return this;
        let payload = keg.payload;
        // should we decrypt?
        if (!this.plaintext) {
            payload = new Uint8Array(keg.payload);
            payload = secret.decryptString(payload, this.overrideKey || this.db.key);
        }
        payload = JSON.parse(payload);
        if (!this.plaintext) this.detectTampering(payload);
        this.deserializeKegPayload(payload);

        return this;
    }

    /**
     * Generic version that provides empty keg payload.
     * Override in child classes to.
     */
    serializeKegPayload() {
        return {};
    }

    /**
     * Generic version that does nothing..
     * Override in child classes to convert raw keg data into object properties.
     */
    deserializeKegPayload(payload) {}


    /**
     * Compares keg metadata with encrypted payload to make sure server didn't change metadata.
     * @param payload {Object} - decrypted keg payload
     * @throws AntiTamperError
     */
    detectTampering(payload) {
        if (payload._sys.kegId !== this.id) {
            throw new AntiTamperError(`Inner ${payload._sys.kegId} and outer ${this.id} keg id mismatch.`);
        }
        if (payload._sys.type !== this.type) {
            throw new AntiTamperError(`Inner ${payload._sys.type} and outer ${this.type} keg type mismatch.`);
        }
    }

}

module.exports = Keg;
