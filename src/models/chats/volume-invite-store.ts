import { observable, action } from 'mobx';
import socket from '../../network/socket';
import { getVolumeStore } from '../../helpers/di-volume-store';
import contactStore from '../contacts/contact-store';
class VolumeInviteStore {
    constructor() {
        socket.onceStarted(() => {
            socket.subscribe(socket.APP_EVENTS.volumeInvitesUpdate, this.update);
            socket.onAuthenticated(this.update);
        });
    }

    @observable left = observable.map<string, Array<{ username: string }>>(null, { deep: false });

    updating = false;
    updateAgain = false;

    updateLeftUsers = () => {
        return socket.send('/auth/kegs/volume/users-left').then(
            action((res: { [kegDbId: string]: string[] }) => {
                this.left.clear();
                for (const kegDbId in res) {
                    const leavers = res[kegDbId];
                    if (!leavers || !leavers.length) continue;
                    this.left.set(
                        kegDbId,
                        leavers.map(l => {
                            return { username: l };
                        })
                    );
                    getVolumeStore()
                        .getVolumeWhenReady(kegDbId)
                        .then(volume => {
                            if (!volume.canIAdmin) return;
                            const contacts = contactStore.getContacts(leavers);
                            volume.removeParticipants(contacts);
                        })
                        .catch(err => {
                            console.error(err);
                        });
                }
            })
        );
    };

    update = () => {
        if (this.updating) {
            this.updateAgain = true;
            return;
        }
        this.updateAgain = false;
        if (!socket.authenticated) {
            this.updating = false;
            return;
        }
        this.updating = true;

        this.updateLeftUsers()
            .catch(err => {
                console.error('Error updating volume invite store', err);
            })
            .finally(() => {
                this.updating = false;
                if (this.updateAgain === false) return;
                setTimeout(this.update);
            });
    };
}

export default new VolumeInviteStore();
