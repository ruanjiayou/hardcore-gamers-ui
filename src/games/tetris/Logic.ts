import EventEmitter from 'eventemitter3';
import type SocketTransport from '../../core/GameTransport';

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Cell = PieceType | 0;

export const COLS = 10;
export const ROWS = 20;
export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** 与棋盘配色一致，供场景绘制与 NEXT/HOLD 预览共用 */
export const PIECE_COLORS: Record<PieceType, string> = {
  I: '#31c7ef',
  O: '#f7d308',
  T: '#ad4d9c',
  S: '#42b642',
  Z: '#ef2029',
  J: '#5a65ad',
  L: '#ef7921',
};

/** 每个方块的 4 个旋转态（SRS 形状），用方框内 'X' 标出占位格 */
const SHAPES: Record<PieceType, string[][]> = {
  I: [
    ['....', 'XXXX', '....', '....'],
    ['..X.', '..X.', '..X.', '..X.'],
    ['....', '....', 'XXXX', '....'],
    ['.X..', '.X..', '.X..', '.X..'],
  ],
  O: [
    ['XX', 'XX'],
    ['XX', 'XX'],
    ['XX', 'XX'],
    ['XX', 'XX'],
  ],
  T: [
    ['.X.', 'XXX', '...'],
    ['.X.', '.XX', '.X.'],
    ['...', 'XXX', '.X.'],
    ['.X.', 'XX.', '.X.'],
  ],
  S: [
    ['.XX', 'XX.', '...'],
    ['.X.', '.XX', '..X'],
    ['...', '.XX', 'XX.'],
    ['X..', 'XX.', '.X.'],
  ],
  Z: [
    ['XX.', '.XX', '...'],
    ['..X', '.XX', '.X.'],
    ['...', 'XX.', '.XX'],
    ['.X.', 'XX.', 'X..'],
  ],
  J: [
    ['X..', 'XXX', '...'],
    ['.XX', '.X.', '.X.'],
    ['...', 'XXX', '..X'],
    ['.X.', '.X.', 'XX.'],
  ],
  L: [
    ['..X', 'XXX', '...'],
    ['.X.', '.X.', '.XX'],
    ['...', 'XXX', 'X..'],
    ['XX.', '.X.', '.X.'],
  ],
};

/** 预解析成 [row, col] 坐标，避免每次碰撞检测都解析字符串 */
export const PIECE_CELLS: Record<PieceType, [number, number][][]> = {} as any;
for (const t of PIECE_TYPES) {
  PIECE_CELLS[t] = SHAPES[t].map(box => {
    const cells: [number, number][] = [];
    box.forEach((line, r) => {
      [...line].forEach((ch, c) => {
        if (ch === 'X') cells.push([r, c]);
      });
    });
    return cells;
  });
}

/** 生成位置：3 格宽的方块从第 3 列起，O（2 格宽）居中到第 4 列 */
const SPAWN_X: Record<PieceType, number> = { I: 3, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

/** 消行基础分（与 server/src/games/tetris/rules.ts 保持一致） */
const LINE_POINTS = [0, 100, 300, 500, 800];
const LINES_PER_LEVEL = 10;
/** 进度上报节流间隔（毫秒） */
const REPORT_THROTTLE_MS = 1200;
const BEST_KEY = 'game_tetris_best';

export interface Piece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

export interface TetrisSnapshot {
  board: Cell[][];
  current: Piece | null;
  ghostY: number;
  next: PieceType[];
  hold: PieceType | null;
  score: number;
  lines: number;
  level: number;
  finished: boolean;
  paused: boolean;
}

function levelFor(lines: number) {
  return 1 + Math.floor(Math.max(0, lines) / LINES_PER_LEVEL);
}

/** 重力间隔（毫秒）：等级越高下落越快，最低 60ms */
export function gravityMs(level: number) {
  return Math.max(60, 800 - (Math.max(1, level) - 1) * 70);
}

export function lineClearScore(cleared: number, level: number) {
  if (cleared <= 0) return 0;
  return LINE_POINTS[Math.min(cleared, 4)] * Math.max(1, level);
}

/**
 * 俄罗斯方块逻辑：棋盘 / 旋转 / 消行 / 计分全部本地实时计算。
 * 仅在分数上涨时节流上报最高分、终局时上报结算（服务端权威记分）。
 */
export default class LogicTetris extends EventEmitter {
  socket: SocketTransport;
  player: any;
  match_id = '';
  board: Cell[][] = [];
  current: Piece | null = null;
  next: PieceType[] = [];
  holdType: PieceType | null = null;
  holdUsed = false;
  score = 0;
  lines = 0;
  level = 1;
  best = 0;
  finished = false;
  paused = false;
  started = false;

  private bag: PieceType[] = [];
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReportAt = 0;
  private lastReportScore = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(socket: SocketTransport, player: any) {
    super();
    this.socket = socket;
    this.player = player;
    this.best = this.loadBest();
    // 构造时只出静态盘面，计时器等 setState（真正开局）再启动
    this.reset(false);
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

  /** 开局：服务端下发 state 后重置棋盘并启动重力计时 */
  setState(state: any) {
    if (state) this.match_id = state.match_id || this.match_id;
    this.reset(true);
  }

  setMatchId(id: string) { this.match_id = id; }

  reset(start = true) {
    this.board = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(0));
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.holdType = null;
    this.holdUsed = false;
    this.finished = false;
    this.paused = false;
    this.started = start;
    this.bag = [];
    this.lastReportAt = 0;
    this.lastReportScore = 0;
    this.clearPendingReport();
    this.next = [this.nextType(), this.nextType(), this.nextType()];
    this.spawn();
    if (start) this.loop();
    else this.clearTimer();
    this.emitState();
  }

  // ===== 方块生成（7-bag 随机） =====
  private refillBag() {
    const bag = [...PIECE_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.bag.push(...bag);
  }

  private nextType(): PieceType {
    if (this.bag.length === 0) this.refillBag();
    return this.bag.shift()!;
  }

  private makePiece(type: PieceType): Piece {
    const cells = PIECE_CELLS[type][0];
    const minRow = Math.min(...cells.map(c => c[0]));
    return { type, rot: 0, x: SPAWN_X[type], y: -minRow };
  }

  /** 取 NEXT 队列头生成新方块；放不下即游戏结束 */
  private spawn(): boolean {
    const type = this.next.shift() ?? this.nextType();
    this.next.push(this.nextType());
    this.current = this.makePiece(type);
    this.holdUsed = false;
    if (this.collides(this.current)) {
      this.current = null;
      this.finishGame();
      return false;
    }
    return true;
  }

  // ===== 碰撞 / 操作 =====
  private collides(p: Piece, x = p.x, y = p.y, rot = p.rot): boolean {
    for (const [r, c] of PIECE_CELLS[p.type][rot]) {
      const rr = y + r;
      const cc = x + c;
      if (cc < 0 || cc >= COLS || rr >= ROWS) return true;
      if (rr >= 0 && this.board[rr][cc]) return true;
    }
    return false;
  }

  /** 左右移动；成功返回 true */
  move(dx: number): boolean {
    if (this.finished || this.paused || !this.current) return false;
    if (this.collides(this.current, this.current.x + dx, this.current.y)) return false;
    this.current.x += dx;
    this.emitState();
    return true;
  }

  /** 旋转（dir=1 顺时针，-1 逆时针），带简化墙踢 */
  rotate(dir: 1 | -1 = 1): boolean {
    if (this.finished || this.paused || !this.current) return false;
    const cur = this.current;
    const rot = (cur.rot + (dir === 1 ? 1 : 3)) % 4;
    const kicks: [number, number][] = [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]];
    for (const [dx, dy] of kicks) {
      if (!this.collides(cur, cur.x + dx, cur.y + dy, rot)) {
        cur.rot = rot;
        cur.x += dx;
        cur.y += dy;
        this.emitState();
        return true;
      }
    }
    return false;
  }

  /** 下移一格（gravity=false 时玩家软降，加 1 分） */
  private descend(gravity: boolean): boolean {
    if (!this.current) return false;
    if (this.collides(this.current, this.current.x, this.current.y + 1)) return false;
    this.current.y += 1;
    if (!gravity) {
      this.score += 1;
      this.saveBest();
    }
    this.emitState();
    return true;
  }

  /** 软降：按下一格；到底则锁定 */
  softDrop() {
    if (this.finished || this.paused || !this.current) return;
    if (!this.descend(false)) {
      this.lockPiece();
      this.loop();
    }
  }

  /** 硬降：直落到底，每格 +2 分 */
  hardDrop() {
    if (this.finished || this.paused || !this.current) return;
    let dist = 0;
    while (!this.collides(this.current, this.current.x, this.current.y + 1)) {
      this.current.y += 1;
      dist++;
    }
    this.score += dist * 2;
    this.saveBest();
    this.lockPiece();
    this.loop();
  }

  /** 暂存（每个方块只能用一次） */
  hold() {
    if (this.finished || this.paused || !this.current || this.holdUsed) return;
    const curType = this.current.type;
    if (this.holdType) {
      const swapped = this.holdType;
      this.holdType = curType;
      this.current = this.makePiece(swapped);
      if (this.collides(this.current)) {
        this.current = null;
        this.finishGame();
        return;
      }
    } else {
      this.holdType = curType;
      if (!this.spawn()) return;
    }
    this.holdUsed = true;
    this.emitState();
  }

  togglePause() {
    if (this.finished || !this.started) return;
    this.paused = !this.paused;
    if (this.paused) this.clearTimer();
    else this.loop();
    this.emitState();
  }

  /** 当前方块落到底后的 y（用于幽灵投影） */
  ghostY(): number {
    if (!this.current) return 0;
    let y = this.current.y;
    while (!this.collides(this.current, this.current.x, y + 1)) y++;
    return y;
  }

  // ===== 锁定 / 消行 =====
  private lockPiece() {
    const cur = this.current;
    if (!cur) return;
    for (const [r, c] of PIECE_CELLS[cur.type][cur.rot]) {
      const rr = cur.y + r;
      const cc = cur.x + c;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) this.board[rr][cc] = cur.type;
    }
    this.current = null;
    const cleared = this.clearLines();
    this.saveBest();
    if (cleared > 0) this.emit('clear', { cleared, lines: this.lines, level: this.level });
    if (this.spawn()) {
      this.emitState();
      this.maybeReportProgress();
    }
  }

  private clearLines(): number {
    const remain = this.board.filter(row => row.some(v => v === 0));
    const cleared = ROWS - remain.length;
    if (cleared > 0) {
      while (remain.length < ROWS) {
        remain.unshift(Array<Cell>(COLS).fill(0));
      }
      this.board = remain;
      this.score += lineClearScore(cleared, this.level);
      this.lines += cleared;
      this.level = levelFor(this.lines);
    }
    return cleared;
  }

  // ===== 重力循环 =====
  private clearTimer() {
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
  }

  private loop() {
    this.clearTimer();
    if (this.finished || this.paused || !this.started) return;
    this.dropTimer = setTimeout(() => {
      this.dropTimer = null;
      if (this.finished || this.paused || !this.started) return;
      if (!this.descend(true)) this.lockPiece();
      this.loop();
    }, gravityMs(this.level));
  }

  private finishGame() {
    this.finished = true;
    this.clearTimer();
    this.saveBest();
    this.emitState();
    this.emit('gameover', { score: this.score, lines: this.lines });
    this.reportScore(this.score);
  }

  /** 认输/中途放弃：上报当前分数并结束 */
  giveUp() {
    if (this.finished) return;
    this.finishGame();
  }

  // ===== 状态同步 =====
  snapshot(): TetrisSnapshot {
    return {
      board: this.board,
      current: this.current,
      ghostY: this.ghostY(),
      next: this.next,
      hold: this.holdType,
      score: this.score,
      lines: this.lines,
      level: this.level,
      finished: this.finished,
      paused: this.paused,
    };
  }

  private emitState() {
    this.emit('state', this.snapshot());
  }

  // ===== 分数上报（与 2048 同一协议） =====
  private sendScore(score: number, done: boolean) {
    if (!this.match_id || !this.socket?.socket || !this.player?._id) return;
    this.socket.socket.emit('room:player-action', this.match_id, {
      player_id: this.player._id,
      score,
      done,
    }, () => { /* ack：终局结算由服务端 room:game-over 广播驱动 UI */ });
  }

  private maybeReportProgress() {
    if (this.score <= this.lastReportScore) return;
    const now = Date.now();
    const elapsed = now - this.lastReportAt;
    if (elapsed >= REPORT_THROTTLE_MS) {
      this.lastReportAt = now;
      this.lastReportScore = this.score;
      this.sendScore(this.score, false);
    } else if (!this.pendingTimer) {
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

  private reportScore(score: number) {
    this.sendScore(score, true);
  }

  /** 离开页面兜底上报当前最高分（进度语义，中途退出不丢分） */
  flushScore() {
    this.clearPendingReport();
    if (this.score > 0) this.sendScore(this.score, false);
  }

  destroy() {
    this.clearTimer();
    this.clearPendingReport();
    this.removeAllListeners();
  }
}
