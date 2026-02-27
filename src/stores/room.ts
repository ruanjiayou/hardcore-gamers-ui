import { makeAutoObservable } from 'mobx';

class RoomStore {
  currentRoomId: string | null = null;
  roomInfo: any = null;
  players: any[] = [];
  isOwner = false;
  messages: any[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  setCurrentRoom(roomId: string, roomInfo: any) {
    this.currentRoomId = roomId;
    this.roomInfo = roomInfo;
    this.players = roomInfo.players || [];
  }

  setIsOwner(isOwner: boolean) {
    this.isOwner = isOwner;
  }

  addPlayer(player: any) {
    if (!this.players.find(p => p.user_id === player.user_id)) {
      this.players.push(player);
    }
  }

  removePlayer(user_id: string) {
    this.players = this.players.filter(p => p.user_id !== user_id);
  }

  addMessage(message: any) {
    this.messages.push(message);
  }

  clear() {
    this.currentRoomId = null;
    this.roomInfo = null;
    this.players = [];
    this.isOwner = false;
    this.messages = [];
  }
}

export const roomStore = new RoomStore();