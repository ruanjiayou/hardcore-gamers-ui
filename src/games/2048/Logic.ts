import EventEmitter from "eventemitter3";
import type SocketTransport from "../../core/GameTransport";

export type Dir = 'up' | 'down' | 'left' | 'right';
export interface TileMove {
  value: number;      // 移动前的数值
  from: [number, number]; // [row, col]
  to: [number, number];
  merged: boolean;    // 该块是否在目标格与另一块合并
}
export interface MoveEvent {
  board: number[][];
  score: number;
  gained: number;
  moves: TileMove[];
  spawn: { r: number; c: number; value: number } | null;
  changed: boolean;
}

const SIZE = 4;
const BEST_KEY = 'game2048_best';

/**
 * 2048 逻辑：棋盘与合并全部在本地实时计算（不走网络）。
 * 仅在游戏结束时通过 socket 把本局分数上报服务端记入排行榜。
 */
/** 进度上报节流间隔（毫秒）：分数上涨时最多这么频繁地同步最高分到服务端 */
const REPORT_THROTTLE_MS = 1200;

export default class Logic2048 extends EventEmitter {
  socket: SocketTransport;
  player: any;
  match_id: string = '';
  board: number[][] = [];
  score = 0;
  best = 0;
  finished = false;
  private lastReportAt = 0;
  private lastReportScore = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: SocketTransport, player: any) {
    super();
    this.socket = socket;
    this.player = player;
    this.best = this.loadBest();
    this.reset();
  }

  private loadBest(): number {
    try {
      const v = Number(localStorage.getItem(BEST_KEY) || '0');
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0;
    }
  }

  private saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* ignore */ }
    }
  }

  setPlayer(player: any) { if (player) this.player = player; }

  /** 开局：从服务端 state 初始化分数（通常 0），重置棋盘。 */
  setState(state: any) {
    if (!state) return;
    this.match_id = state.match_id || this.match_id;
    this.score = 0;
    this.finished = false;
    this.lastReportAt = 0;
    this.lastReportScore = 0;
    this.reset();
    this.emit('state', { board: this.board, score: this.score, best: this.best });
  }

  setMatchId(id: string) { this.match_id = id; }

  /** 重置为空盘并生成两个初始块 */
  reset() {
    this.board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    this.score = 0;
    this.finished = false;
    const s1 = this.spawn();
    const s2 = this.spawn();
    this.emit('reset', { board: this.board, score: this.score, best: this.best, spawns: [s1, s2].filter(Boolean) });
  }

  private spawn(): { r: number; c: number; value: number } | null {
    const empty: [number, number][] = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] === 0) empty.push([r, c]);
      }
    }
    if (empty.length === 0) return null;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    this.board[r][c] = value;
    return { r, c, value };
  }

  /** 按方向移动；返回本次事件（同时通过 move 事件广播给场景）。 */
  move(dir: Dir): MoveEvent | null {
    if (this.finished) return null;
    const before = this.board.map(row => row.slice());
    const moves: TileMove[] = [];
    let gained = 0;

    // 按移动方向确定遍历顺序与坐标映射：把每条"线"抽成一维数组处理。
    const lines: number[][] = [];
    const idxMap: [number, number][][] = []; // line -> 每个位置对应的 [r,c]
    for (let i = 0; i < SIZE; i++) {
      const vals: number[] = [];
      const coords: [number, number][] = [];
      for (let j = 0; j < SIZE; j++) {
        const [r, c] = this.coord(dir, i, j);
        vals.push(before[r][c]);
        coords.push([r, c]);
      }
      lines.push(vals);
      idxMap.push(coords);
    }

    for (let li = 0; li < SIZE; li++) {
      const vals = lines[li];
      const coords = idxMap[li];
      // 先清空整条线，再按合并结果写回，避免残留旧值
      coords.forEach(([r, c]) => { this.board[r][c] = 0; });
      const tiles = vals.map((v, j) => ({ v, j })).filter(t => t.v !== 0);
      const outValues: number[] = [];
      for (let k = 0; k < tiles.length; k++) {
        const cur = tiles[k];
        const next = tiles[k + 1];
        if (next && next.v === cur.v) {
          // 两个相同块合并：目标位置为 out.length
          const targetPos = outValues.length;
          const to = coords[targetPos];
          moves.push({ value: cur.v, from: coords[cur.j], to, merged: true });
          moves.push({ value: next.v, from: coords[next.j], to, merged: true });
          outValues.push(cur.v * 2);
          gained += cur.v * 2;
          k++; // 跳过被合并的下一块
        } else {
          const targetPos = outValues.length;
          moves.push({ value: cur.v, from: coords[cur.j], to: coords[targetPos], merged: false });
          outValues.push(cur.v);
        }
      }
      outValues.forEach((value, pos) => {
        const [r, c] = coords[pos];
        this.board[r][c] = value;
      });
    }

    // 判断棋盘是否变化
    const changed = before.some((row, r) => row.some((v, c) => v !== this.board[r][c]));
    if (!changed) {
      // 无变化：还原（理论上上面写入等价于 before，但保险起见）
      this.board = before;
      return null;
    }

    this.score += gained;
    this.saveBest();
    const spawn = this.spawn();
    const ev: MoveEvent = { board: this.board.map(r => r.slice()), score: this.score, gained, moves, spawn, changed };
    this.emit('move', ev);

    if (!this.hasMoves()) {
      this.finished = true;
      this.clearPendingReport();
      this.emit('gameover', { score: this.score });
      this.reportScore(this.score); // 终局：done=true 触发结算
    } else {
      this.maybeReportProgress(); // 进行中：节流同步最高分，中途退出不丢分
    }
    return ev;
  }

  /** dir 下第 i 条线的第 j 个格子的坐标（j=0 为移动方向最先到达的一端） */
  private coord(dir: Dir, i: number, j: number): [number, number] {
    switch (dir) {
      case 'left': return [i, j];
      case 'right': return [i, SIZE - 1 - j];
      case 'up': return [j, i];
      case 'down': return [SIZE - 1 - j, i];
    }
  }

  /** 是否还有可移动/可合并的格子 */
  private hasMoves(): boolean {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = this.board[r][c];
        if (v === 0) return true;
        if (c + 1 < SIZE && this.board[r][c + 1] === v) return true;
        if (r + 1 < SIZE && this.board[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  /** 发送一次上报（done=false 为进度最高分同步；done=true 为终局结算） */
  private sendScore(score: number, done: boolean) {
    if (!this.match_id || !this.socket?.socket || !this.player?._id) return;
    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.player._id,
      score,
      done,
    }, () => { /* ack：终局结算由服务端 room:game-over 广播驱动 UI */ });
  }

  /** 进度同步：分数较上次有增长时，按节流间隔上报最高分（服务端 $max 记录） */
  private maybeReportProgress() {
    if (this.score <= this.lastReportScore) return;
    const now = Date.now();
    const elapsed = now - this.lastReportAt;
    if (elapsed >= REPORT_THROTTLE_MS) {
      this.lastReportAt = now;
      this.lastReportScore = this.score;
      this.sendScore(this.score, false);
    } else if (!this.pendingTimer) {
      // 未到间隔：安排一次尾随上报，保证最后一次增长也能落库
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        if (this.finished) return;
        if (this.score > this.lastReportScore) {
          this.lastReportAt = Date.now();
          this.lastReportScore = this.score;
          this.sendScore(this.score, false);
        }
      }, REPORT_THROTTLE_MS - elapsed);
    }
  }

  private clearPendingReport() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** 游戏结束：上报本局分数到服务端（服务端权威记入排行榜） */
  private reportScore(score: number) {
    this.sendScore(score, true);
  }

  /** 认输/中途放弃也上报当前分数并结束 */
  giveUp() {
    if (this.finished) return;
    this.finished = true;
    this.clearPendingReport();
    this.saveBest();
    this.emit('gameover', { score: this.score, givenUp: true });
    this.reportScore(this.score);
  }

  /** 页面卸载/离开时兜底上报当前最高分（进度语义，保证不丢分） */
  flushScore() {
    this.clearPendingReport();
    if (this.score > 0) this.sendScore(this.score, false);
  }
}
