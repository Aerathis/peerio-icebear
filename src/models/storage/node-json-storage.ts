import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { normalize } from '../../errors';
import { TinyDBStorageEngine } from '../../defs/tiny-db';

const fileOptions = { encoding: 'utf8' };

/**
 * This is a StorageEngine implementation that can be used in any nodejs-based apps (cli, electron).
 *
 * It uses os.homedir() or NodeJsonStorage.storageFolder to store JSON files.
 */
export default class NodeJsonStorage implements TinyDBStorageEngine {
    constructor(name: string) {
        this.name = name;
        this.folder = path.join(NodeJsonStorage.storageFolder || os.homedir());
        this.filePath = path.join(this.folder, `${name}_tinydb.json`);
        this._createDbFile();
    }

    name: string;
    folder: string;
    filePath: string;

    static storageFolder: string = null;

    _createDbFile() {
        if (!fs.existsSync(this.filePath)) {
            if (!fs.existsSync(this.folder)) fs.mkdirSync(this.folder);
            fs.writeFileSync(this.filePath, '{}', fileOptions);
        }
    }

    // should return null if value doesn't exist
    getValue(key) {
        const data = this.load();
        // eslint-disable-next-line no-prototype-builtins
        return Promise.resolve(data.hasOwnProperty(key) ? data[key] : null);
    }

    setValue(key, value) {
        const data = this.load();
        data[key] = value;
        this.save(data);
        return Promise.resolve();
    }

    removeValue(key) {
        const data = this.load();
        delete data[key];
        this.save(data);
        return Promise.resolve();
    }

    getAllKeys() {
        const data = this.load();
        const keys = Object.keys(data);
        return Promise.resolve(keys);
    }

    load() {
        try {
            return JSON.parse(fs.readFileSync(this.filePath, fileOptions));
        } catch (err) {
            console.error(err);
            console.log(`Failed to read tinydb file ${this.filePath}`);
            return {};
        }
    }

    save(data) {
        fs.writeFileSync(this.filePath, JSON.stringify(data), fileOptions);
    }

    clear() {
        try {
            if (fs.existsSync(this.filePath)) {
                fs.unlinkSync(this.filePath);
            }
            this._createDbFile();
        } catch (err) {
            return Promise.reject(normalize(err, 'Failed to delete database'));
        }
        return Promise.resolve();
    }
}
