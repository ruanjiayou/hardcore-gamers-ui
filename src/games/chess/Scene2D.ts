// 国际象棋 2D 棋盘（纯 Canvas 2D，无 Babylon）
// 黑白格棋盘 + Unicode 棋子。点击选中己方棋子 → 高亮可落点 → 点击目标落子。
// 可落点用简化的伪合法生成（服务端仍权威校验）；升变默认升后（与服务端一致）。
// 视角：白方在下；黑方棋盘旋转 180°，棋子符号始终正向。

import InternationalChessLogic, { Cell, Color, Pos } from "./Logic";

const CELL = 66;
const MARGIN = 24;
const SIZE = 8;
const BOARD_W = SIZE * CELL + MARGIN * 2;
const BOARD_H = SIZE * CELL + MARGIN * 2;

interface Point { x: number; y: number }
interface View { scale: number; offsetX: number; offsetY: number; cssW: number; cssH: number }
type Anim = { from: Pos; to: Pos; start: number; duration: number; raf: number };

// Unicode 棋子：白/黑
const GLYPH: Record<Color, Record<string, string>> = {
  white: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  black: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

export default class InternationalChessScene2D {
  logic: InternationalChessLogic;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inited = false;
  dpr = 1;
  view: View = { scale: 1, offsetX: 0, offsetY: 0, cssW: BOARD_W, cssH: BOARD_H };

  selected: Pos | null = null;
  hintSquares: Pos[] = [];
  highlighted: Pos | null = null;   // 最后落子目标
  anim: Anim | null = null;

  private onState = () => this.handleState();
  private onMove = (data: any) => this.handleMove(data);
  private onClick = (e: PointerEvent) => this.handleClick(e);
  private onResize = () => this.resize();

  constructor(canvas: HTMLCanvasElement, logic: InternationalChessLogic) {
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

  private isFlipped() { return this.logic.player?.role === 'black'; }

  /** 逻辑格 -> 棋盘逻辑像素（含视角翻转） */
  private toBoard(p: Pos): Point {
    const col = this.isFlipped() ? SIZE - 1 - p[1] : p[1];
    const row = this.isFlipped() ? SIZE - 1 - p[0] : p[0];
    return { x: MARGIN + col * CELL, y: MARGIN + row * CELL };
  }

  private toCell(bx: number, by: number): Pos | null {
    const col = Math.floor((bx - MARGIN) / CELL);
    const row = Math.floor((by - MARGIN) / CELL);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return null;
    return this.isFlipped() ? [SIZE - 1 - row, SIZE - 1 - col] : [row, col];
  }

  private key(p: Pos) { return `${p[0]}-${p[1]}`; }

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
    this.render();
  }

  /** 简化的伪合法落点：只按棋子走法规则，不含将军校验（服务端权威）。易位/吃过路兵不在此提示。 */
  private computeHints(from: Pos): Pos[] {
    const b = this.logic.board;
    const piece = b?.[from[0]]?.[from[1]];
    if (!piece) return [];
    const color = piece.color;
    const [r, c] = from;
    const out: Pos[] = [];
    const own = (p: Cell) => p?.color === color;
    const push = (rr: number, cc: number) => {
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return false;
      if (own(b[rr][cc])) return false;
      out.push([rr, cc]);
      return !b[rr][cc]; // 空格可继续滑行
    };
    switch (piece.type) {
      case 'p': {
        const dir = color === 'white' ? -1 : 1;
        const start = color === 'white' ? 6 : 1;
        if (!b[r + dir]?.[c] && r + dir >= 0 && r + dir < SIZE) {
          out.push([r + dir, c]);
          if (r === start && !b[r + 2 * dir]?.[c]) out.push([r + 2 * dir, c]);
        }
        for (const dc of [-1, 1]) {
          const rr = r + dir, cc = c + dc;
          if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && b[rr][cc] && !own(b[rr][cc])) out.push([rr, cc]);
        }
        break;
      }
      case 'n':
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) push(r + dr, c + dc);
        break;
      case 'k':
        for (const dr of [-1,0,1]) for (const dc of [-1,0,1]) {
          if (dr || dc) push(r + dr, c + dc);
        }
        break;
      default: {
        let dirs: [number, number][];
        if (piece.type === 'r') dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        else if (piece.type === 'b') dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
        else dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) {
            if (!push(rr, cc)) break;
            rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }

  private handleState() {
    this.selected = null;
    this.highlighted = null;
    this.hintSquares = [];
    this.anim = null;
    this.render();
  }

  private handleMove(data: { from: Pos; to: Pos }) {
    this.selected = null;
    this.hintSquares = [];
    this.highlighted = data.to;
    const anim: Anim = { from: data.from, to: data.to, start: performance.now(), duration: 220, raf: 0 };
    this.anim = anim;
    const tick = (now: number) => {
      if (this.anim !== anim) return;
      const t = Math.min(1, (now - anim.start) / anim.duration);
      this.render();
      if (t < 1) anim.raf = requestAnimationFrame(tick);
      else { this.anim = null; this.render(); }
    };
    anim.raf = requestAnimationFrame(tick);
  }

  private handleClick(e: PointerEvent) {
    if (this.logic.isPendding || !this.logic.isMyTurn()) return;
    const rect = this.canvas.getBoundingClientRect();
    const bx = (e.clientX - rect.left - this.view.offsetX) / this.view.scale;
    const by = (e.clientY - rect.top - this.view.offsetY) / this.view.scale;
    const cell = this.toCell(bx, by);
    if (!cell) return;

    if (!this.selected) {
      const piece = this.logic.board?.[cell[0]]?.[cell[1]];
      if (piece && piece.color === this.logic.player?.role) {
        this.selected = cell;
        this.hintSquares = this.computeHints(cell);
        this.render();
      }
      return;
    }
    // 点己方另一子 → 切换选中
    const piece = this.logic.board?.[cell[0]]?.[cell[1]];
    if (piece && piece.color === this.logic.player?.role) {
      this.selected = cell;
      this.hintSquares = this.computeHints(cell);
      this.render();
      return;
    }
    // 点合法目标 → 落子（升变默认后）
    if (this.hintSquares.some(p => p[0] === cell[0] && p[1] === cell[1])) {
      const moving = this.logic.board[this.selected[0]][this.selected[1]];
      const promo = moving?.type === 'p' && (cell[0] === 0 || cell[0] === 7) ? 'q' : undefined;
      this.logic.move(this.selected, cell, promo);
    }
  }

  private render() {
    const ctx = this.ctx;
    if (!ctx || !this.inited) return;
    const { scale, offsetX, offsetY, cssW, cssH } = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * offsetX, this.dpr * offsetY);

    this.drawBoard();
    this.drawHighlights();
    this.drawPieces();
  }

  private drawBoard() {
    const ctx = this.ctx;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const p = this.toBoard([r, c]);
        ctx.fillStyle = (r + c) % 2 === 0 ? '#eeeed2' : '#769656';
        ctx.fillRect(p.x, p.y, CELL, CELL);
      }
    }
    // 坐标标记（a-h / 1-8），按视角翻转
    ctx.fillStyle = '#555';
    ctx.font = '11px Arial';
    ctx.textBaseline = 'top';
    for (let i = 0; i < SIZE; i++) {
      const colLetter = String.fromCharCode(97 + i);
      const bottomRow = this.toBoard([7, i]);
      ctx.textAlign = 'center';
      ctx.fillText(colLetter, bottomRow.x + CELL / 2, MARGIN + SIZE * CELL + 4);
      const leftCell = this.toBoard([i, 0]);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.isFlipped() ? String(i + 1) : String(SIZE - i), MARGIN + SIZE * CELL + 4, leftCell.y + CELL / 2);
    }
  }

  private drawHighlights() {
    const ctx = this.ctx;
    // 选中格
    if (this.selected) {
      const p = this.toBoard(this.selected);
      ctx.fillStyle = 'rgba(255,255,0,0.45)';
      ctx.fillRect(p.x, p.y, CELL, CELL);
    }
    // 可落点
    for (const cell of this.hintSquares) {
      const p = this.toBoard(cell);
      const occupied = !!this.logic.board?.[cell[0]]?.[cell[1]];
      ctx.beginPath();
      if (occupied) {
        ctx.strokeStyle = 'rgba(200,40,40,0.8)';
        ctx.lineWidth = 3;
        ctx.arc(p.x + CELL / 2, p.y + CELL / 2, CELL * 0.42, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(40,90,40,0.35)';
        ctx.arc(p.x + CELL / 2, p.y + CELL / 2, CELL * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 最后落子格外框
    if (this.highlighted) {
      const p = this.toBoard(this.highlighted);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x + 1, p.y + 1, CELL - 2, CELL - 2);
    }
  }

  private drawPieces() {
    const anim = this.anim;
    const t = anim ? Math.min(1, (performance.now() - anim.start) / anim.duration) : 1;
    const e = t * t * (3 - 2 * t);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const piece = this.logic.board?.[r]?.[c];
        if (!piece) continue;
        let pos = this.toBoard([r, c]);
        if (anim && anim.to[0] === r && anim.to[1] === c) {
          const from = this.toBoard(anim.from);
          const to = this.toBoard(anim.to);
          pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        }
        const ctx = this.ctx;
        ctx.font = `${Math.round(CELL * 0.78)}px "Segoe UI Symbol", "Arial Unicode MS", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // 描边增强对比
        ctx.lineWidth = 2;
        ctx.strokeStyle = piece.color === 'white' ? '#333' : '#111';
        const cx = pos.x + CELL / 2;
        const cy = pos.y + CELL / 2 + 2;
        const glyph = GLYPH[piece.color][piece.type];
        ctx.strokeText(glyph, cx, cy);
        ctx.fillStyle = piece.color === 'white' ? '#fff' : '#1a1a1a';
        ctx.fillText(glyph, cx, cy);
      }
    }
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
