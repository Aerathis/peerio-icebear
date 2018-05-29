const SyncedKeg = require('../kegs/synced-keg');
const { observable } = require('mobx');

/**
 * Chat head keg is open for any chat participant to update.
 * @param {ChatKegDb} db
 * @extends SyncedKeg
 * @public
 */
class ChatHead extends SyncedKeg {
    constructor(db) {
        super('chat_head', db);
    }

    /**
     * @member {string} chatName
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable chatName = '';
    /**
     * @member {string} purpose
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable purpose = '';


    /** SPACE PROPERTIES */
    /**
     * @member {string} spaceId
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable spaceId = null;

    /**
     * @member {string} spaceName
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable spaceName = null;

    /**
     * @member {string} spaceDescription
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable spaceDescription = null;

    /**
     * @member {enum: internal / patient} spaceRoomType
     * @memberof ChatHead
     * @instance
     * @public
     */
    @observable spaceRoomType = null;


    serializeKegPayload() {
        return {
            chatName: this.chatName,
            purpose: this.purpose,
            spaceId: this.spaceId,
            spaceName: this.spaceName,
            spaceDescription: this.spaceDescription,
            spaceRoomType: this.spaceRoomType
        };
    }

    deserializeKegPayload(payload) {
        this.chatName = payload.chatName || '';
        this.purpose = payload.purpose || '';
        this.spaceId = payload.spaceId;
        this.spaceName = payload.spaceName;
        this.spaceDescription = payload.spaceDescription;
        this.spaceRoomType = payload.spaceRoomType;
    }
}


module.exports = ChatHead;
