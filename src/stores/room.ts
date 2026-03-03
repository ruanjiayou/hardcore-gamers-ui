import { makeAutoObservable } from 'mobx';

export default class RoomStore {
  currentRoomId: string = '';
  matchState: any = null;
  roomInfo: any = null;
  roomPlayer: any = null;
  members: any[] = [];
  players: any[] = [];
  messages: any[] = [];

  constructor() {
    makeAutoObservable(this);
  }
  get isOwner() {
    return false;
  }
  setCurrentRoom(roomInfo: any) {
    this.currentRoomId = roomInfo._id;
    this.roomInfo = roomInfo;
    this.members = roomInfo.members || [];
    this.players = this.members.filter(m => m.type === 'player');
  }
  setCurrentPlayer(player: any) {
    this.roomPlayer = player;
  }
  setMatchState(state: any) {
    this.matchState = state;
  }
  setRoomStatus(status: 'ready' | 'waiting' | 'playing') {
    this.roomInfo = { ...this.roomInfo, status };
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
    this.roomInfo = null;
    this.currentRoomId = ''
    this.players = [];
    this.messages = [];
  }
}