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
  players: any[];
  numbers: { min: number, max: number };
  isPrivate: boolean;
  status: string;
  createdAt: number;
}

class GameStore {
  games: Game[] = [];
  selectedGameId: string | null = null;
  rooms: Room[] = [];
  leaderboard: any[] = [];
  stats: any = null;

  constructor() {
    makeAutoObservable(this);
  }

  setGames(games: Game[]) {
    this.games = games;
  }

  selectGame(gameId: string) {
    this.selectedGameId = gameId;
  }

  setRooms(rooms: Room[]) {
    this.rooms = rooms;
  }

  addRoom(room: Room) {
    this.rooms.push(room);
  }

  removeRoom(roomId: string) {
    this.rooms = this.rooms.filter(r => r._id !== roomId);
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

  get availableRooms() {
    return this.rooms.filter(r =>
      r.status === 'waiting' && r.players.length < r.numbers.max
    );
  }
}

export const gameStore = new GameStore();