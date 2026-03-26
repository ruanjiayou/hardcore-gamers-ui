import { makeAutoObservable } from 'mobx';

export interface Game {
  _id: string;
  slug: string;
  title: string;
  icon: string;
  desc: string;
  rooms: number;
  players: number;
}

export interface Room {
  _id: string;
  slug: string;
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
  rooms: Room[] = [];
  leaderboard: any[] = [];
  stats: any = null;
  player: any = null;

  constructor() {
    makeAutoObservable(this);
  }

  get player_id() {
    return this.player ? this.player._id : '';
  }

  setGames(games: Game[]) {
    this.games = games;
  }

  setPlayer(player: any) {
    this.player = player;
  }
  changePlayer(data: { player_id: string, field: string, value: any }) {
    if (data.player_id === this.player_id) {
      this.player = { ...this.player, [data.field]: data.value }
    }
  }

  setRooms(rooms: Room[]) {
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

}