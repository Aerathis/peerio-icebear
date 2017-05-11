const Keg = require('../kegs/keg');

class Profile extends Keg {
    constructor(user) {
        super('profile', 'profile', user.kegDb, true);
        this.user = user;
    }

    serializeKegPayload() {
        return {
            firstName: this.user.firstName.trim(),
            lastName: this.user.lastName.trim(),
            locale: this.user.locale.trim()
        };
    }

    deserializeKegPayload(data) {
        this.user.firstName = data.firstName;
        this.user.lastName = data.lastName;
        this.user.createdAt = data.created;
        this.user.locale = data.locale;
        this.user.isDeleted = data.deleted;
        this.user.primaryAddress = data.primaryAddressValue;
        this.user.primaryAddressType = data.primaryAddressType;
        (data.addresses || []).forEach(a => {
            if (a.address === data.primaryAddressValue) a.primary = true;
        });
        // this is observable so we assign it after all modifications
        this.user.addresses = data.addresses || [];
        this.user.primaryAddressConfirmed = false;
        for (let i = 0; i < this.user.addresses.length; i++) {
            const a = this.user.addresses[i];
            if (!a.primary) continue;
            this.user.primaryAddressConfirmed = a.confirmed;
            break;
        }
        this.user.isBlacklisted = data.isBlackListed;
        this.user.use2fa = data.user2fa;
        this.user.profileLoaded = true;
    }
}

module.exports = Profile;
