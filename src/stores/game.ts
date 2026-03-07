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
  gamePlayer: any = null;

  constructor() {
    makeAutoObservable(this);
  }

  setGames(games: Game[]) {
    this.games = games;
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

}