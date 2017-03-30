/**
 * @module models/user
 */
const socket = require('../../network/socket');
const mixUserProfileModule = require('./user.profile.js');
const mixUserRegisterModule = require('./user.register.js');
const mixUserAuthModule = require('./user.auth.js');
const KegDb = require('./../kegs/keg-db');
const TinyDb = require('../../db/tiny-db');
const { observable, when, computed } = require('mobx');
const currentUserHelper = require('./../../helpers/di-current-user');
const { publicCrypto } = require('../../crypto/index');
const { formatBytes } = require('../../util');

let currentUser;

class User {

    _username = '';
    get username() {
        return this._username;
    }

    set username(v) {
        this._username = typeof (v) === 'string' ? v.trim().toLowerCase() : '';
    }
    // -- profile data
    @observable firstName = '';
    @observable lastName = '';
    @observable email = '';
    @observable locale = 'en';
    @observable passcodeIsSet = false;
    @observable quota = null;
    @observable profileLoaded = false;

    createdAt = null;
    deleted = false;
    blacklisted = false;
    // -- key data
    passphrase;
    authSalt;
    bootKey;
    authKeys;
    signKeys;
    encryptionKeys;
    kegKey;
    // -- flags
    _firstLoginInSession = true;


    constructor() {
        this.createAccountAndLogin = this.createAccountAndLogin.bind(this);
        this.setReauthOnReconnect = this.setReauthOnReconnect.bind(this);
        this.login = this.login.bind(this);
        this.kegDb = new KegDb('SELF');
        // this is not really extending prototype, but we don't care because User is almost a singleton
        // (new instance created on every initial login attempt only)
        mixUserProfileModule.call(this);
        mixUserAuthModule.call(this);
        mixUserRegisterModule.call(this);
    }

    @computed get fileQuotaTotal() {
        if (this.quota == null || !this.quota.resultingQuotas
            || !this.quota.resultingQuotas.file || !this.quota.resultingQuotas.file.length) return 0;

        const found = this.quota.resultingQuotas.file.find(
            item => item.period === 'total' && item.metric === 'storage');
        if (!found) return 0;
        // we are unlikely to have real-life unlimited accounts, but for test accounts it's fine
        if (found.limit == null) return Number.MAX_SAFE_INTEGER;
        return found.limit;
    }

    @computed get fileQuotaTotalFmt() {
        return formatBytes(this.fileQuotaTotal);
    }

    @computed get fileQuotaLeft() {
        if (this.quota == null || !this.quota.quotasLeft
            || !this.quota.quotasLeft.file || !this.quota.quotasLeft.file.length) return 0;

        const found = this.quota.quotasLeft.file.find(item => item.period === 'total' && item.metric === 'storage');
        if (!found) return 0;
        // we are unlikely to have real-life unlimited accounts, but for test accounts it's fine
        if (found.limit == null) return Number.MAX_SAFE_INTEGER;
        return found.limit;
    }

    @computed get fileQuotaLeftFmt() {
        return formatBytes(this.fileQuotaLeft);
    }

    @computed get fileQuotaUsed() {
        return this.fileQuotaTotal - this.fileQuotaLeft;
    }

    @computed get fileQuotaUsedFmt() {
        return formatBytes(this.fileQuotaUsed);
    }

    @computed get fileQuotaUsedPercent() {
        return this.fileQuotaTotal === 0 ? 0 : `${Math.round(this.fileQuotaUsed / (this.fileQuotaTotal / 100))}%`;
    }


    /**
     * Full registration process.
     * Initial login after registration differs a little.
     * @returns {Promise}
     */
    createAccountAndLogin() {
        console.log('Starting account registration sequence.');
        return this._createAccount()
            .then(() => this._authenticateConnection())
            .then(() => {
                console.log('Creating boot keg.');
                return this.kegDb.createBootKeg(this.bootKey, this.signKeys,
                    this.encryptionKeys, this.kegKey);
            })
            .then(() => this._postAuth());
    }

    /**
     * Before login.
     *
     * @returns {*}
     * @private
     */
    _preAuth() {
        if (this._firstLoginInSession) {
            return this._checkForPasscode();
        }
        return Promise.resolve();
    }

    /**
     * Authenticates connection and makes necessary initial requests.
     */
    login() {
        console.log('Starting login sequence');
        return this._preAuth()
            .then(() => this._authenticateConnection())
            .then(() => this.kegDb.loadBootKeg(this.bootKey))
            .then(() => {
                this.encryptionKeys = this.kegDb.boot.encryptionKeys;
                this.signKeys = this.kegDb.boot.signKeys;
            })
            .then(() => this._postAuth())
            .catch(err => {
                socket.reset();
                return Promise.reject(err);
            });
    }

    /**
     * Subscribe to events after auth
     *
     * @returns {Promise}
     */
    _postAuth() {
        socket.setAuthenticatedState();
        if (this._firstLoginInSession) {
            this._firstLoginInSession = false;
            TinyDb.openUserDb(this.username, this.kegDb.key);
            this.setReauthOnReconnect();
            this.loadProfile(true);
            this.loadQuota(true);
            when(() => this.profileLoaded, () => {
                this.setAsLastAuthenticated()
                    .catch(err => console.error(err)); // not critical, we can ignore this error
            });
        }
    }

    setReauthOnReconnect() {
        // only need to set reauth listener once
        if (this.stopReauthenticator) return;
        this.stopReauthenticator = socket.subscribe(socket.SOCKET_EVENTS.connect, this.login);
    }

    static validateUsername(username) {
        if (typeof (username) === 'string' && username.trim().length === 0) return Promise.resolve(false);
        return socket.send('/noauth/validateUsername', { username })
            .then(resp => !!resp && resp.available)
            .catch(err => {
                console.error(err);
                return false;
            });
    }

    static get current() {
        return currentUser;
    }

    static set current(val) {
        currentUser = val;
        currentUserHelper.setUser(val);
    }

    /**
     * (Eventually) gets the username of the last authenticated user.
     *
     * @returns {Promise<String>}
     */
    static getLastAuthenticated() {
        return TinyDb.system.getValue(`last_user_authenticated`)
            .then(obj => {
                return obj;
            });
    }

    /**
     * Saves the data of the last authenticated user.
     * @returns {Promise}
     */
    setAsLastAuthenticated() {
        return TinyDb.system.setValue(`last_user_authenticated`, {
            username: this.username,
            firstName: this.firstName,
            lastName: this.lastName
        });
    }

    /**
     * (Eventually) removes the username of the last authenticated user.
     * @returns {Promise<String>}
     */
    static removeLastAuthenticated() {
        return TinyDb.system.removeValue(`last_user_authenticated`);
    }

    // Cache for precomputed asymmetric encryption shared keys,
    // where secretKey == this.encryptionKeypair.secretKey.
    // We don't place this into crypto module to avoid shooting ourselves in the knee in numerous ways
    _sharedKeyCache = {};

    /**
     * @param {Uint8Array} theirPublicKey
     * @return {Uint8Array}
     */
    getSharedKey(theirPublicKey) {
        const cacheKey = theirPublicKey.join(',');
        let cachedValue = this._sharedKeyCache[cacheKey];
        if (cachedValue) return cachedValue;
        cachedValue = publicCrypto.computeSharedKey(theirPublicKey, this.encryptionKeys.secretKey);
        this._sharedKeyCache[cacheKey] = cachedValue;
        return cachedValue;
    }
}

module.exports = User;
