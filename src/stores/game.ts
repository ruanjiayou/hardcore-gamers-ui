import { makeAutoObservable } from 'mobx';

export interface Game {
  _id: string;
  name: string;
  icon: string;
  desc: string;
  rooms: number;
  players: number;
}

export interface Room {
  _id: string;
  gameId: string;
  name: string;
  ownerId: string;
  members: any[];
  players?: any[];
  numbers: { min: number, max: number };
  isPrivate: boolean;
  status: string;
  createdAt: number;
}

export default class GameStore {
  games: Game[] = [];
  selectedGameId: string | null = null;
  rooms: Room[] = [];
  leaderboard: any[] = [];
  stats: any = null;
  gamePlayer: any = null;

  constructor() {
    makeAutoObservable(this);
  }

  setGames(games: Game[]) {
    this.games = games;
  }

  selectGame(gameId: string) {
    this.selectedGameId = gameId;
  }

  setGamePlayer(gamePlayer: any) {
    this.gamePlayer = gamePlayer;
  }

  setRooms(rooms: Room[]) {
    rooms.forEach(room => {
      room.players = room.members.filter(m => m.type === 'player');
    })
    this.rooms = rooms;
  }

  addRoom(room: Room) {
    this.rooms.push(room);
  }

  removeRoom(room_id: string) {
    this.rooms = this.rooms.filter(r => r._id !== room_id);
  }

  setLeaderboard(leaderboard: any[]) {
    this.leaderboard = leaderboard;
  }

  setStats(stats: any) {
    this.stats = stats;
  }

  get selectedGame() {
    return this.games.find(g => g._id === this.selectedGameId);
  }

}