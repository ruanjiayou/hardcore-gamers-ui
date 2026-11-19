// 黑白棋 2D 棋盘（纯 Canvas 2D，无 Babylon）
// 棋盘 8×8，棋子落在格子中心。点击己方回合的合法格落子；翻转动画 + 最后落子高亮。
// 无合法落子时显示"跳过回合"按钮提示（由 index.ts 的 UI 处理，这里只高亮可落点）。

import OthelloLogic, { OthelloColor, Pos } from "./Logic";

const CELL = 70;
const MARGIN = 30;
const SIZE = 8;
const BOARD_W = SIZE * CELL + MARGIN * 2;  // 620
const BOARD_H = SIZE * CELL + MARGIN * 2;

interface Point { x: number; y: number }
interface View { scale: number; offsetX: number; offsetY: number; cssW: number; cssH: number }

type Anim = {
  placed: Pos;
  flips: Pos[];
  color: OthelloColor;
  start: number;
  duration: number;
  raf: number;
};

export default class OthelloScene2D {
  logic: OthelloLogic;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inited = false;
  dpr = 1;
  view: View = { scale: 1, offsetX: 0, offsetY: 0, cssW: BOARD_W, cssH: BOARD_H };

  highlighted: Pos | null = null;       // 最后落子高亮
  hintMoves: Pos[] = [];                 // 己方可落点提示
  anim: Anim | null = null;
  passAvailable = false;                 // 当前是否无合法落子需跳过

  private onState = () => this.handleState();
  private onMove = (data: any) => this.handleMove(data);
  private onClick = (e: PointerEvent) => this.handleClick(e);
  private onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, logic: OthelloLogic) {
    this.logic = logic;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.logic.on('state', this.onState);
    this.logic.on('move', this.onMove);
  }

  async init() {
    if (this.inited) return;
    this.inited = true;
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('pointerdown', this.onClick);
    this.resize();
    this.render();
  }

  private key(p: Pos): string { return `${p[0]}-${p[1]}`; }

  /** 格子中心 -> 棋盘逻辑像素 */
  private cellCenter(p: Pos): Point {
    return { x: MARGIN + p[1] * CELL + CELL / 2, y: MARGIN + p[0] * CELL + CELL / 2 };
  }

  private toCell(bx: number, by: number): Pos | null {
    const col = Math.floor((bx - MARGIN) / CELL);
    const row = Math.floor((by - MARGIN) / CELL);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    return [row, col];
  }

  private resize() {
    if (!this.inited) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || BOARD_W;
    const cssH = rect.height || BOARD_H;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    const scale = Math.min(cssW / BOARD_W, cssH / BOARD_H);
    this.view = {
      scale,
      offsetX: (cssW - BOARD_W * scale) / 2,
      offsetY: (cssH - BOARD_H * scale) / 2,
      cssW, cssH,
    };
    this.recomputeHints();
    this.render();
  }

  /** 轮到自己时计算可落点与是否需跳过（用轻量本地规则，不依赖服务端） */
  private recomputeHints() {
    this.hintMoves = [];
    this.passAvailable = false;
    if (!this.logic.isMyTurn() || !this.logic.board?.length) return;
    const color = this.logic.player?.role;
    if (!color) return;
    const dirs: [number, number][] = [
      [-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1],
    ];
    const foe = color === 'black' ? 'white' : 'black';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.logic.board[r][c] !== null) continue;
        let legal = false;
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc, seenFoe = 0;
          while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && this.logic.board[rr][cc] === foe) {
            seenFoe++; rr += dr; cc += dc;
          }
          if (seenFoe > 0 && rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && this.logic.board[rr][cc] === color) {
            legal = true; break;
          }
        }
        if (legal) this.hintMoves.push([r, c]);
      }
    }
    this.passAvailable = this.hintMoves.length === 0;
    this.onPassChange?.(this.passAvailable);
  }

  /** 由 index.ts 注入：无合法落子时显示/隐藏"跳过回合"按钮 */
  onPassChange?: (pass: boolean) => void;

  private handleState() {
    this.highlighted = null;
    this.anim = null;
    this.recomputeHints();
    this.render();
  }

  private handleMove(data: { to: Pos; flips?: Pos[]; color: OthelloColor; pass?: boolean }) {
    this.highlighted = data.pass ? null : data.to;
    if (!data.pass && data.to && data.to[0] >= 0 && data.flips?.length) {
      const anim: Anim = {
        placed: data.to, flips: data.flips, color: data.color,
        start: performance.now(), duration: 260, raf: 0,
      };
      this.anim = anim;
      const tick = (now: number) => {
        if (this.anim !== anim) return;
        const t = Math.min(1, (now - anim.start) / anim.duration);
        this.render();
        if (t < 1) anim.raf = requestAnimationFrame(tick);
        else { this.anim = null; this.render(); }
      };
      anim.raf = requestAnimationFrame(tick);
    } else {
      this.render();
    }
    // 棋盘已由 Logic 同步，重算提示
    this.recomputeHints();
  }

  private handleClick(e: PointerEvent) {
    if (this.logic.isPendding || !this.logic.isMyTurn()) return;
    const rect = this.canvas.getBoundingClientRect();
    const bx = (e.clientX - rect.left - this.view.offsetX) / this.view.scale;
    const by = (e.clientY - rect.top - this.view.offsetY) / this.view.scale;
    const cell = this.toCell(bx, by);
    if (!cell) return;
    // 无合法落子：点击棋盘任意处即跳过回合（服务端会校验确实无子可下）
    if (this.passAvailable) {
      this.logic.move([-1, -1]);
      return;
    }
    // 只接受有提示的合法落子点（前端预校验，服务端仍权威校验）
    if (!this.hintMoves.some(p => p[0] === cell[0] && p[1] === cell[1])) return;
    this.logic.move(cell);
  }

  private render() {
    const ctx = this.ctx;
    if (!ctx || !this.inited) return;
    const { scale, offsetX, offsetY, cssW, cssH } = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * offsetX, this.dpr * offsetY);

    this.drawBoard();
    this.drawHints();
    this.drawPieces();
    if (this.passAvailable && this.logic.isMyTurn()) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(BOARD_W / 2 - 95, BOARD_H / 2 - 22, 190, 44);
      ctx.fillStyle = '#ffe680';
      ctx.font = 'bold 18px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('无子可下 · 点击跳过回合', BOARD_W / 2, BOARD_H / 2);
      ctx.restore();
    }
  }

  private drawBoard() {
    const ctx = this.ctx;
    ctx.fillStyle = '#1f6b4f';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    // 网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(MARGIN + i * CELL, MARGIN);
      ctx.lineTo(MARGIN + i * CELL, MARGIN + SIZE * CELL);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MARGIN, MARGIN + i * CELL);
      ctx.lineTo(MARGIN + SIZE * CELL, MARGIN + i * CELL);
      ctx.stroke();
    }
    // 四个星位小点
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const [r, c] of [[2,2],[2,6],[6,2],[6,6]]) {
      const p = this.cellCenter([r, c] as Pos);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHints() {
    if (!this.logic.isMyTurn()) return;
    const ctx = this.ctx;
    for (const [r, c] of this.hintMoves) {
      const p = this.cellCenter([r, c]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,235,120,0.75)';
      ctx.fill();
    }
  }

  private drawPieces() {
    const anim = this.anim;
    const t = anim ? Math.min(1, (performance.now() - anim.start) / anim.duration) : 1;
    const e = t * t * (3 - 2 * t);
    const flipping = new Set(anim?.flips.map(p => this.key(p)) ?? []);
    const placedKey = anim ? this.key(anim.placed) : '';

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const color = this.logic.board?.[r]?.[c];
        if (!color) continue;
        const key = `${r}-${c}`;
        const p = this.cellCenter([r, c]);
        let scale = 1;
        let drawColor: OthelloColor = color;

        if (anim && key === placedKey) {
          scale = 0.4 + 0.6 * e; // 落子从小到大
          drawColor = anim.color;
        } else if (anim && flipping.has(key)) {
          // 翻转动画：先缩小到 0 再放大，中点换色
          scale = Math.abs(1 - 2 * e);
          drawColor = e < 0.5 ? (color === 'black' ? 'white' : 'black') : color;
        }

        const isLast = this.highlighted && this.highlighted[0] === r && this.highlighted[1] === c;
        this.drawDisc(p, drawColor, scale, !!isLast);
      }
    }
  }

  private drawDisc(p: Point, color: OthelloColor, scale: number, highlight: boolean) {
    const ctx = this.ctx;
    const r = CELL * 0.42 * Math.max(scale, 0.001);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    const grad = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.1, p.x, p.y, r);
    if (color === 'black') {
      grad.addColorStop(0, '#5a5a5a');
      grad.addColorStop(1, '#0a0a0a');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#d8d8d0');
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color === 'black' ? '#000' : '#999';
    ctx.stroke();
    if (highlight) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, CELL * 0.46, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 当前是否轮到自己且需跳过，供 index.ts 定时检查 */
  shouldShowPass(): boolean {
    return this.logic.isMyTurn() && this.passAvailable;
  }

  dispose() {
    this.inited = false;
    this.logic.off('state', this.onState);
    this.logic.off('move', this.onMove);
    this.canvas.removeEventListener('pointerdown', this.onClick);
    window.removeEventListener('resize', this.onResize);
    if (this.anim) cancelAnimationFrame(this.anim.raf);
    this.anim = null;
  }
}
