import { makeAutoObservable } from 'mobx';

/** 房间信息空壳：roomInfo 永远不为 null，避免各处读取 .status/.members 时崩溃 */
const emptyRoom = () => ({ members: [] as any[] });

export default class RoomStore {
  matchState: any = null;
  roomInfo: { [key: string]: any } = emptyRoom();
  messages: any[] = [];
  // 服务端时钟快照（象棋读秒制）。serverNow 用于校正客户端与服务器时间偏差。
  clock: {
    match_id: string;
    enabled: boolean;
    stepLimitMs: number;
    budgetMs: number;
    remaining: Record<string, number>;
    turnStartedAt: Record<string, number>;
    curr_turn: string;
    serverNow: number;
    clientOffsetMs: number; // 收到快照时 Date.now() - serverNow
  } | null = null;

  constructor() {
    makeAutoObservable(this);
  }
  get isOwner() {
    return false;
  }
  get status() {
    // 房间可能已被解散/不存在（服务端返回 room: null），这里必须容错
    return this.roomInfo?.status;
  }
  setCurrentRoom(roomInfo: any) {
    // 服务端在房间不存在时返回 room: null；直接落库会让所有 getter 崩在 null 上
    this.roomInfo = roomInfo || emptyRoom();
  }
  get members() {
    return this.roomInfo?.members || [];
  }
  get players() {
    return this.members.filter((m: any) => m.member_type === 'player');
  }
  setMatchState(state: any) {
    this.matchState = state;
  }
  setRoomStatus(status: 'ready' | 'waiting' | 'playing' | 'finished') {
    this.roomInfo = { ...(this.roomInfo || emptyRoom()), status };
  }
  changePlayer(data: { player_id: string, field: string, value: any }) {
    (this.roomInfo?.members || []).forEach((p: any) => {
      if (p._id === data.player_id) {
        p[data.field] = data.value;
      }
    })
  }
  addPlayer(player: any) {
    if (!player) return;
    if (!this.roomInfo) this.roomInfo = emptyRoom();
    if (!this.roomInfo.members) this.roomInfo.members = [];
    if (!this.roomInfo.members.find((p: any) => p.user_id === player.user_id)) {
      this.roomInfo.members.push(player);
    }
  }

  removePlayer(player_id: string) {
    if (!this.roomInfo) return;
    this.roomInfo.members = (this.roomInfo.members || []).filter((p: any) => p._id !== player_id);
  }

  addMessage(message: any) {
    this.messages.push(message);
  }

  setClock(data: {
    match_id: string; enabled: boolean; stepLimitMs: number; budgetMs: number;
    remaining: Record<string, number>; turnStartedAt: Record<string, number>;
    curr_turn: string; serverNow: number;
  }) {
    this.clock = { ...data, clientOffsetMs: Date.now() - (data.serverNow || Date.now()) };
  }

  clearClock() {
    this.clock = null;
  }

  /** 当前服务器时间（用本地时间 + 已测偏移校正） */
  serverNow() {
    return Date.now() - (this.clock?.clientOffsetMs || 0);
  }

  clear() {
    this.roomInfo = emptyRoom();
    this.messages = [];
    this.clock = null;
  }
}
