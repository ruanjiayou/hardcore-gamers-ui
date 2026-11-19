// Scene2D.ts —— 腾讯象棋风格的二维平面棋盘（纯 Canvas 2D，无 Babylon 依赖）
//
// 设计要点：
// - 棋盘逻辑坐标来自 ChessLogic.board[y][x]，x∈[0,8] 列，y∈[0,9] 行。
// - 屏幕坐标由「视角」决定：红方在下（默认），黑方视角将棋盘旋转 180°。
// - 画布按容器等比缩放并居中（letterbox），保证棋盘方正不变形。
// - 点击拾取：屏幕像素反算到逻辑坐标，交 logic.move 做服务端权威校验。
// - 高亮态 highlightedKey 与交互选中态 selected 解耦：
//   选中己方子 → 高亮该子；落子动画落地 → 高亮切到刚落下的棋子（双方一致）。

import ChessLogic, { Piece } from "./Logic";

const CELL = 72;                 // 单格边长（逻辑像素）
const MARGIN = 40;               // 棋盘四周留白（逻辑像素）
const COLS = 9;
const ROWS = 10;

const BOARD_W = (COLS - 1) * CELL + MARGIN * 2;   // 656
const BOARD_H = (ROWS - 1) * CELL + MARGIN * 2;   // 688

interface Point { x: number; y: number }

/** 视图变换（CSS 像素单位）：逻辑坐标 -> 画布坐标 */
interface View { scale: number; offsetX: number; offsetY: number; cssW: number; cssH: number }

type Anim = {
  from: Point;
  to: Point;
  start: number;
  duration: number;
  raf: number;
};

export default class XiangqiScene2D {
  logic: ChessLogic;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  inited = false;
  dpr = 1;
  view: View = { scale: 1, offsetX: 0, offsetY: 0, cssW: BOARD_W, cssH: BOARD_H };

  // 交互选中态：点选己方棋子时设置，用于计算 from/to
  selected = '';
  // 视觉高亮态：始终指向"当前应高亮的棋子"，与 selected 解耦
  highlightedKey = '';
  // 走子插值动画
  anim: Anim | null = null;

  private onState = () => this.handleState();
  private onMove = (data: { from: Point; to: Point }) => this.handleMove(data);
  private onClick = (e: PointerEvent) => this.handleClick(e);
  private onResize = () => this.resize();
  private textFont = '';

  constructor(canvas: HTMLCanvasElement, logic: ChessLogic) {
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
    // 中文字体异步就绪后重绘一次，避免首帧汉字缺字
    (document as any).fonts?.ready?.then(() => {
      if (this.inited) this.render();
    });
  }

  /** 黑方视角：黑方棋子在下，棋盘旋转 180°。等价原 3D 相机 alpha 翻转。 */
  private isFlipped(): boolean {
    return this.logic.player?.role === 'black';
  }

  /** 逻辑格点 -> 棋盘逻辑像素（含视角翻转） */
  private toBoard(p: Point): Point {
    const col = this.isFlipped() ? (COLS - 1 - p.x) : p.x;
    const row = this.isFlipped() ? (ROWS - 1 - p.y) : p.y;
    return { x: MARGIN + col * CELL, y: MARGIN + row * CELL };
  }

  /** 棋盘逻辑像素 -> 逻辑格点（toBoard 的逆），并限制在交叉点附近 */
  private toLogic(px: number, py: number): Point | null {
    let col = Math.round((px - MARGIN) / CELL);
    let row = Math.round((py - MARGIN) / CELL);
    if (col < 0 || col > COLS - 1 || row < 0 || row > ROWS - 1) return null;
    const sx = MARGIN + col * CELL;
    const sy = MARGIN + row * CELL;
    if (Math.hypot(px - sx, py - sy) > CELL * 0.48) return null;
    return this.isFlipped()
      ? { x: COLS - 1 - col, y: ROWS - 1 - row }
      : { x: col, y: row };
  }

  private keyOf(p: Point): string {
    return `${p.y}-${p.x}`;
  }

  /** 根据容器尺寸计算等比缩放 + 居中偏移，写入 canvas 像素尺寸与 view */
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

  // ===== 事件处理 =====

  private handleState() {
    this.selected = '';
    this.highlightedKey = '';
    this.anim = null;
    this.render();
  }

  private handleMove(data: { from: Point; to: Point }) {
    this.selected = '';
    const start = performance.now();
    const duration = 220;
    const anim: Anim = { from: data.from, to: data.to, start, duration, raf: 0 };
    this.anim = anim;
    const tick = (now: number) => {
      if (this.anim !== anim) return; // 被新状态/新走子取代
      const t = Math.min(1, (now - anim.start) / anim.duration);
      this.render();
      if (t < 1) {
        anim.raf = requestAnimationFrame(tick);
      } else {
        this.anim = null;
        this.setHighlight(this.keyOf(data.to));
        this.render();
      }
    };
    anim.raf = requestAnimationFrame(tick);
  }

  private handleClick(e: PointerEvent) {
    if (this.logic.isPendding) return;
    if (!this.logic.isMyTurn()) return;
    const rect = this.canvas.getBoundingClientRect();
    // 屏幕(CSS)像素 -> 棋盘逻辑像素：减去居中偏移再除以缩放
    const bx = (e.clientX - rect.left - this.view.offsetX) / this.view.scale;
    const by = (e.clientY - rect.top - this.view.offsetY) / this.view.scale;
    const logicPt = this.toLogic(bx, by);
    if (!logicPt) return;

    if (!this.selected) {
      // 第一次点击：只能选中己方棋子
      const piece = this.logic.getPiece(logicPt.x, logicPt.y);
      if (piece && piece.color === this.logic.player.role) {
        this.selected = this.keyOf(logicPt);
        this.setHighlight(this.selected);
        this.render();
      }
      return;
    }

    if (this.keyOf(logicPt) === this.selected) return; // 重复点同一子

    const piece = this.logic.getPiece(logicPt.x, logicPt.y);
    if (piece && piece.color === this.logic.player.role) {
      // 点到己方另一颗子：切换选中
      this.selected = this.keyOf(logicPt);
      this.setHighlight(this.selected);
      this.render();
      return;
    }

    // 点到对方棋子或空位：作为落子目标，交服务端权威校验
    const [y, x] = this.selected.split('-').map(Number);
    this.logic.move(x, y, logicPt.x, logicPt.y);
  }

  // ===== 高亮 =====

  private clearHighlight() {
    this.highlightedKey = '';
  }

  private setHighlight(key: string) {
    this.clearHighlight();
    const [y, x] = key.split('-').map(Number);
    if (this.logic.getPiece(x, y)) this.highlightedKey = key;
  }

  // ===== 绘制 =====

  private render() {
    const ctx = this.ctx;
    if (!ctx || !this.inited) return;
    const { scale, offsetX, offsetY, cssW, cssH } = this.view;
    // 先按 dpr 清屏（CSS 像素坐标系），再叠加缩放+居中变换绘制棋盘
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * offsetX, this.dpr * offsetY);

    this.drawBoard();
    this.drawStars();
    this.drawRiverText();
    this.drawPieces();
  }

  /** 画一条棋盘逻辑像素线段 */
  private line(a: Point, b: Point) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  private drawBoard() {
    const ctx = this.ctx;
    // 木纹底色
    ctx.fillStyle = '#ebc88f';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    // 外框
    ctx.strokeStyle = '#7a4f28';
    ctx.lineWidth = 3;
    ctx.strokeRect(MARGIN - 12, MARGIN - 12, (COLS - 1) * CELL + 24, (ROWS - 1) * CELL + 24);

    ctx.strokeStyle = '#5a3a1c';
    ctx.lineWidth = 1.4;

    // 10 条横线贯通
    for (let y = 0; y < ROWS; y++) {
      this.line(this.toBoard({ x: 0, y }), this.toBoard({ x: COLS - 1, y }));
    }
    // 9 条竖线：最外两条贯通，其余在楚河汉界处断开
    for (let x = 0; x < COLS; x++) {
      const top = this.toBoard({ x, y: 0 });
      const bottom = this.toBoard({ x, y: ROWS - 1 });
      if (x === 0 || x === COLS - 1) {
        this.line(top, bottom);
      } else {
        this.line(top, this.toBoard({ x, y: 4 }));
        this.line(this.toBoard({ x, y: 5 }), bottom);
      }
    }
    // 九宫斜线
    this.drawPalace(0);
    this.drawPalace(ROWS - 3);
  }

  private drawPalace(topRow: number) {
    const tl = this.toBoard({ x: 3, y: topRow });
    const tr = this.toBoard({ x: 5, y: topRow });
    const bl = this.toBoard({ x: 3, y: topRow + 2 });
    const br = this.toBoard({ x: 5, y: topRow + 2 });
    this.line(tl, br);
    this.line(tr, bl);
  }

  private drawRiverText() {
    const ctx = this.ctx;
    const midY = this.toBoard({ x: 4, y: 4.5 }).y;
    const left = this.toBoard({ x: 1.5, y: 4.5 });
    const right = this.toBoard({ x: 6.5, y: 4.5 });
    ctx.save();
    ctx.fillStyle = '#6b4423';
    ctx.font = `bold ${Math.round(CELL * 0.6)}px "KaiTi", "STKaiti", "SimSun", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚 河', left.x, midY + 2);
    ctx.fillText('汉 界', right.x, midY + 2);
    ctx.restore();
  }

  /** 炮位、兵位的"星位"折角标记 */
  private drawStars() {
    const stars: Point[] = [
      { x: 1, y: 2 }, { x: 7, y: 2 }, { x: 1, y: 7 }, { x: 7, y: 7 },
      { x: 0, y: 3 }, { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 6, y: 3 }, { x: 8, y: 3 },
      { x: 0, y: 6 }, { x: 2, y: 6 }, { x: 4, y: 6 }, { x: 6, y: 6 }, { x: 8, y: 6 },
    ];
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#5a3a1c';
    ctx.lineWidth = 1.4;
    const arm = CELL * 0.13;
    const gap = CELL * 0.09;
    for (const s of stars) {
      const p = this.toBoard(s);
      const neighbors: Point[] = [
        { x: s.x - 1, y: s.y }, { x: s.x + 1, y: s.y },
        { x: s.x, y: s.y - 1 }, { x: s.x, y: s.y + 1 },
      ];
      for (const n of neighbors) {
        if (n.x < 0 || n.x > COLS - 1 || n.y < 0 || n.y > ROWS - 1) continue;
        const np = this.toBoard(n);
        const dx = Math.sign(np.x - p.x);
        const dy = Math.sign(np.y - p.y);
        const bx = p.x + dx * gap;
        const by = p.y + dy * gap;
        if (dx !== 0) this.line({ x: bx, y: by - arm }, { x: bx, y: by + arm });
        else this.line({ x: bx - arm, y: by }, { x: bx + arm, y: by });
      }
    }
    ctx.restore();
  }

  private drawPieces() {
    const anim = this.anim;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const piece = this.logic.getPiece(x, y);
        if (!piece) continue;
        const key = this.keyOf({ x, y });
        let pos = this.toBoard({ x, y });
        let scale = 1;
        if (anim && key === this.keyOf(anim.to)) {
          const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
          const from = this.toBoard(anim.from);
          const to = this.toBoard(anim.to);
          const e = t * t * (3 - 2 * t); // smoothstep
          pos = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
          scale = 1 + 0.12 * Math.sin(Math.PI * t); // 落子时轻微抬起
        }
        this.drawPiece(pos, piece, key === this.highlightedKey, scale);
      }
    }
  }

  private drawPiece(pos: Point, piece: Piece, highlighted: boolean, scale: number) {
    const ctx = this.ctx;
    const r = CELL * 0.42 * scale;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;

    const grad = ctx.createRadialGradient(pos.x - r * 0.3, pos.y - r * 0.35, r * 0.1, pos.x, pos.y, r);
    grad.addColorStop(0, '#fff8e6');
    grad.addColorStop(0.7, '#f2dcae');
    grad.addColorStop(1, '#d9b87e');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // 双圈
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#8a6234';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r * 0.84, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,84,44,0.55)';
    ctx.stroke();

    // 高亮外环
    if (highlighted) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
    }

    // 汉字（黑方视角也保持文字正向可读）
    const char = this.getChineseChar(piece.type, piece.color);
    ctx.fillStyle = piece.color === 'red' ? '#c62828' : '#1b1b1b';
    if (!this.textFont) this.textFont = '"KaiTi", "STKaiti", "SimHei", "Microsoft YaHei", serif';
    ctx.font = `bold ${Math.round(r * 1.05)}px ${this.textFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, pos.x, pos.y + r * 0.04);
    ctx.restore();
  }

  private getChineseChar(type: string, color: string): string {
    const map: Record<string, { red: string; black: string }> = {
      r: { red: '车', black: '車' },
      n: { red: '马', black: '馬' },
      b: { red: '相', black: '象' },
      a: { red: '仕', black: '士' },
      k: { red: '帅', black: '将' },
      c: { red: '炮', black: '砲' },
      p: { red: '兵', black: '卒' },
    };
    return (map[type]?.[color as 'red' | 'black']) ?? type;
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
