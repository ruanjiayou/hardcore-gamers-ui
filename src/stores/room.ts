import { makeAutoObservable } from 'mobx';

export default class RoomStore {
  currentRoomId: string | null = null;
  roomInfo: any = null;
  players: any[] = [];
  messages: any[] = [];

  constructor() {
    makeAutoObservable(this);
  }
  get isOwner() {
    return false;
  }
  setCurrentRoom(roomId: string, roomInfo: any) {
    this.currentRoomId = roomId;
    this.roomInfo = roomInfo;
    this.players = roomInfo?.players || [];
  }

  setReady() {
    if (this.roomInfo) {
      this.roomInfo.status = 'ready'
    }
  }
  setPlayerNetwork(user_id: string, online: boolean) {
    this.players.forEach(p => {
      if (p.user_id === user_id) {
        p.online = online;
      }
    })
  }
  addPlayer(player: any) {
    if (!this.players.find(p => p.user_id === player.user_id)) {
      this.players.push(player);
    }
  }

  removePlayer(player_id: string) {
    this.players = this.players.filter(p => p._id !== player_id);
  }

  addMessage(message: any) {
    this.messages.push(message);
  }

  clear() {
    this.currentRoomId = null;
    this.roomInfo = null;
    this.players = [];
    this.messages = [];
  }
}