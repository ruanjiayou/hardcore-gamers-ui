import { makeAutoObservable } from 'mobx';

export default class RoomStore {
  matchState: any = null;
  roomInfo: { [key: string]: any } = {
    members: [],
  };
  messages: any[] = [];

  constructor() {
    makeAutoObservable(this);
  }
  get isOwner() {
    return false;
  }
  get status() {
    return this.roomInfo.status;
  }
  setCurrentRoom(roomInfo: any) {
    this.roomInfo = roomInfo;
  }
  get members() {
    return this.roomInfo.members || [];
  }
  get players() {
    return this.roomInfo.members.filter((m: any) => m.member_type === 'player');
  }
  setMatchState(state: any) {
    this.matchState = state;
  }
  setRoomStatus(status: 'ready' | 'waiting' | 'playing' | 'finished') {
    this.roomInfo = { ...this.roomInfo, status };
  }
  changePlayer(data: { player_id: string, field: string, value: any }) {
    (this.roomInfo.members || []).forEach((p: any) => {
      if (p._id === data.player_id) {
        p[data.field] = data.value;
      }
    })
  }
  addPlayer(player: any) {
    if (!this.roomInfo.members.find((p: any) => p.user_id === player.user_id)) {
      this.roomInfo.members.push(player);
    }
  }

  removePlayer(player_id: string) {
    this.roomInfo.members = this.roomInfo.members.filter((p: any) => p._id !== player_id);
  }

  addMessage(message: any) {
    this.messages.push(message);
  }

  clear() {
    this.roomInfo = { members: [] };
    this.messages = [];
  }
}