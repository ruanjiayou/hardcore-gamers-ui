import { makeAutoObservable } from 'mobx';

export interface Game {
  _id: string;
  slug: string;
  title: string;
  icon: string;
  desc: string;
  rooms: number;
  players: number;
  /** 游戏主页形态：solo=单人直接开局（无需房间）；room=房间制（棋类/组队） */
  mode?: 'solo' | 'room';
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
  /** 官方公共房（种子预建）：只能退出，不可解散 */
  official?: boolean;
  /** 是否允许观战（关闭时隐藏"观看"入口） */
  allowSpectate?: boolean;
  /** 单人快开临时房（不进列表） */
  transient?: boolean;
}

export default class GameStore {
  games: Game[] = [];
  gamesLoading: boolean = true;
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
    this.gamesLoading = false;
  }

  setGamesLoading(loading: boolean) {
    this.gamesLoading = loading;
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