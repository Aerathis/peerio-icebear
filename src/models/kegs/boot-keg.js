const Keg = require('./keg');
const util = require('../../crypto/util');

class BootKeg extends Keg {
    /**
     * @param {KegDb} db - owner instance
     * @param {Uint8Array} bootKey
     */
    constructor(db, bootKey) {
        // named kegs are pre-created, so we know the id already and only going to update boot keg
        super('boot', 'boot', db);
        this.overrideKey = bootKey;
        this.version = 1; // pre-created named keg
    }

    deserializeKegPayload(data) {
        this.signKeys = {};
        this.signKeys.publicKey = util.b64ToBytes(data.signKeys.publicKey);
        this.signKeys.secretKey = util.b64ToBytes(data.signKeys.secretKey);
        this.encryptionKeys = {};
        this.encryptionKeys.publicKey = util.b64ToBytes(data.encryptionKeys.publicKey);
        this.encryptionKeys.secretKey = util.b64ToBytes(data.encryptionKeys.secretKey);
        this.kegKey = util.b64ToBytes(data.kegKey);
    }

    serializeKegPayload() {
        return {
            signKeys: {
                publicKey: util.bytesToB64(this.signKeys.publicKey),
                secretKey: util.bytesToB64(this.signKeys.secretKey)
            },
            encryptionKeys: {
                publicKey: util.bytesToB64(this.encryptionKeys.publicKey),
                secretKey: util.bytesToB64(this.encryptionKeys.secretKey)
            },
            kegKey: util.bytesToB64(this.kegKey)
        };
    }
}

module.exports = BootKeg;
