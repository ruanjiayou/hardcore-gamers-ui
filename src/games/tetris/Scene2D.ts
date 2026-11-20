// 俄罗斯方块 2D 场景（纯 Canvas 2D）
// 键盘：A/D（或 ←→）移动 / S（或 ↓）软降 / 空格（或 ↑/X）旋转 / Z 逆时针 / 回车 硬降 / C 暂存 / P 暂停
// 触屏：左右滑动移动 / 下滑软降 / 上滑硬降 / 轻点旋转
// 面板：分数、最高分、等级、消行、NEXT、HOLD，并提供可点的操作按钮

import LogicTetris, { COLS, PieceType, ROWS, PIECE_COLORS, PIECE_CELLS } from './Logic';

const CELL = 30;
const MARGIN = 22;
const PANEL_W = 168;
const GAP = 22;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const TOTAL_W = MARGIN + BOARD_W + GAP + PANEL_W + MARGIN;
const TOTAL_H = MARGIN + BOARD_H + MARGIN;

const BG = '#14141f';
const BOARD_BG = '#1e1e2e';
const GRID = '#2a2a3d';
const PANEL_BG = '#1a1a28';
const TEXT = '#e8e8f0';
const SUBTEXT = '#8b8ba7';

interface View { scale: number; offsetX: number; offsetY: number }
interface Button { key: 'rotate' | 'drop' | 'hold' | 'pause'; label: string; x: number; y: number; w: number; h: number }

export default class Scene2DTetris {
  logic: LogicTetris;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inited = false;
  dpr = 1;
  view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  toast = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private buttons: Button[] = [];
  private touchStart: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;

  private onState = () => this.render();
  private onClear = (d: { cleared: number; level: number }) => {
    const gain = [0, 100, 300, 500, 800][Math.min(d.cleared, 4)] * d.level;
    this.showToast(d.cleared >= 4 ? `TETRIS! +${gain}` : `消 ${d.cleared} 行 +${gain}`);
  };
  private onGameOver = () => {
    this.showToast('游戏结束');
    this.render();
  };
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onResize = () => this.resize();
  private onClick = (e: MouseEvent) => this.handleClick(e);
  private onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
  private onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
  private onTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);

  constructor(canvas: HTMLCanvasElement, logic: LogicTetris) {
    this.logic = logic;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.buildButtons();
    this.logic.on('state', this.onState);
    this.logic.on('clear', this.onClear);
    this.logic.on('gameover', this.onGameOver);
  }

  async init() {
    if (this.inited) return;
    this.inited = true;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.resize();
    this.render();
  }

  // ===== 坐标换算 =====
  private resize() {
    if (!this.inited) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || TOTAL_W;
    const cssH = rect.height || TOTAL_H;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    const scale = Math.min(cssW / TOTAL_W, cssH / TOTAL_H);
    this.view = {
      scale,
      offsetX: (cssW - TOTAL_W * scale) / 2,
      offsetY: (cssH - TOTAL_H * scale) / 2,
    };
    this.render();
  }

  private toBoard(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      sx: (clientX - rect.left - this.view.offsetX) / this.view.scale,
      sy: (clientY - rect.top - this.view.offsetY) / this.view.scale,
    };
  }

  // ===== 输入 =====
  private handleKey(e: KeyboardEvent) {
    // 在聊天输入框/可编辑区域里打字时不响应游戏按键
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
    const k = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'Enter'].includes(k)) e.preventDefault();
    if (this.logic.finished) return;
    switch (k) {
      case 'ArrowLeft': case 'a': case 'A': this.logic.move(-1); break;
      case 'ArrowRight': case 'd': case 'D': this.logic.move(1); break;
      case 'ArrowDown': case 's': case 'S': this.logic.softDrop(); break;
      case 'ArrowUp': case 'w': case 'W': case 'x': case 'X': case ' ': this.logic.rotate(1); break;
      case 'z': case 'Z': this.logic.rotate(-1); break;
      case 'Enter': this.logic.hardDrop(); break;
      case 'c': case 'C': this.logic.hold(); break;
      case 'p': case 'P': this.logic.togglePause(); break;
    }
  }

  private hitButton(x: number, y: number): Button | null {
    return this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }

  private handleClick(e: MouseEvent) {
    const { sx, sy } = this.toBoard(e.clientX, e.clientY);
    const btn = this.hitButton(sx, sy);
    if (btn) this.triggerButton(btn.key);
  }

  private triggerButton(key: Button['key']) {
    if (this.logic.finished) return;
    if (key === 'rotate') this.logic.rotate(1);
    else if (key === 'drop') this.logic.hardDrop();
    else if (key === 'hold') this.logic.hold();
    else if (key === 'pause') this.logic.togglePause();
  }

  private handleTouchStart(e: TouchEvent) {
    const t = e.changedTouches[0];
    if (t) this.touchStart = { x: t.clientX, y: t.clientY, lastX: t.clientX, lastY: t.clientY, moved: false };
  }

  private handleTouchMove(e: TouchEvent) {
    if (!this.touchStart) return;
    if (e.cancelable) e.preventDefault();
    const t = e.changedTouches[0];
    if (!t) return;
    const TH = 22;
    // 左右滑动：逐格移动
    let dx = t.clientX - this.touchStart.lastX;
    while (Math.abs(dx) >= TH) {
      const dir = dx > 0 ? 1 : -1;
      this.logic.move(dir);
      this.touchStart.lastX += dir * TH;
      this.touchStart.moved = true;
      dx = t.clientX - this.touchStart.lastX;
    }
    // 下滑：软降
    let dy = t.clientY - this.touchStart.lastY;
    while (dy >= TH) {
      this.logic.softDrop();
      this.touchStart.lastY += TH;
      this.touchStart.moved = true;
      dy = t.clientY - this.touchStart.lastY;
    }
  }

  private handleTouchEnd(e: TouchEvent) {
    if (!this.touchStart) return;
    const start = this.touchStart;
    this.touchStart = null;
    const t = e.changedTouches[0];
    if (!t) return;
    // 点在面板按钮上：交给 click 处理，避免误触旋转
    const { sx, sy } = this.toBoard(start.x, start.y);
    if (this.hitButton(sx, sy)) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dy < -60 && Math.abs(dy) > Math.abs(dx)) {
      this.logic.hardDrop();
      return;
    }
    if (!start.moved && Math.max(Math.abs(dx), Math.abs(dy)) < 14) {
      this.logic.rotate(1); // 轻点旋转
    }
  }

  // ===== 布局：面板按钮 =====
  private buildButtons() {
    const x0 = MARGIN + BOARD_W + GAP;
    const bw = (PANEL_W - 8) / 2;
    const bh = 36;
    const y0 = TOTAL_H - MARGIN - bh * 2 - 8;
    this.buttons = [
      { key: 'rotate', label: '↻ 旋转', x: x0, y: y0, w: bw, h: bh },
      { key: 'drop', label: '⤓ 硬降', x: x0 + bw + 8, y: y0, w: bw, h: bh },
      { key: 'hold', label: '⇄ 暂存', x: x0, y: y0 + bh + 8, w: bw, h: bh },
      { key: 'pause', label: '⏸ 暂停', x: x0 + bw + 8, y: y0 + bh + 8, w: bw, h: bh },
    ];
  }

  // ===== 渲染 =====
  private render() {
    if (!this.inited) return;
    const ctx = this.ctx;
    const { scale, offsetX, offsetY } = this.view;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 外框
    ctx.fillStyle = BG;
    this.roundRect(ctx, 0, 0, TOTAL_W, TOTAL_H, 14);
    ctx.fill();

    this.drawBoard();
    this.drawPanel();

    if (this.logic.paused && !this.logic.finished) this.drawOverlay('已暂停', '按 P 或点「暂停」继续');
    if (this.logic.finished) this.drawOverlay('游戏结束', `本局 ${this.logic.score} 分 · ${this.logic.lines} 行`);
    if (this.toast) this.drawToast();

    ctx.restore();
  }

  private drawBoard() {
    const ctx = this.ctx;
    const bx = MARGIN;
    const by = MARGIN;

    // 棋盘底
    ctx.fillStyle = BOARD_BG;
    this.roundRect(ctx, bx, by, BOARD_W, BOARD_H, 8);
    ctx.fill();

    // 网格
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(bx + c * CELL, by);
      ctx.lineTo(bx + c * CELL, by + BOARD_H);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(bx, by + r * CELL);
      ctx.lineTo(bx + BOARD_W, by + r * CELL);
      ctx.stroke();
    }

    // 已固定的方块
    const board = this.logic.board;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (v) this.drawBlock(bx + c * CELL, by + r * CELL, CELL, PIECE_COLORS[v]);
      }
    }

    // 幽灵投影 + 当前方块
    const cur = this.logic.current;
    if (cur) {
      const ghostY = this.logic.ghostY();
      const color = PIECE_COLORS[cur.type];
      for (const [r, c] of this.cellsOf(cur.type, cur.rot)) {
        const rr = ghostY + r;
        if (rr < 0) continue;
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        this.roundRect(ctx, bx + (cur.x + c) * CELL + 2, by + rr * CELL + 2, CELL - 4, CELL - 4, 4);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        this.roundRect(ctx, bx + (cur.x + c) * CELL + 2, by + rr * CELL + 2, CELL - 4, CELL - 4, 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (const [r, c] of this.cellsOf(cur.type, cur.rot)) {
        const rr = cur.y + r;
        if (rr < 0) continue;
        this.drawBlock(bx + (cur.x + c) * CELL, by + rr * CELL, CELL, color);
      }
    }
  }

  private drawPanel() {
    const ctx = this.ctx;
    const x = MARGIN + BOARD_W + GAP;
    const w = PANEL_W;

    ctx.fillStyle = PANEL_BG;
    this.roundRect(ctx, x, MARGIN, w, BOARD_H, 10);
    ctx.fill();

    let y = MARGIN + 14;

    // 标题
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('俄罗斯方块', x + 12, y);
    y += 28;

    // 分数 / 最高
    const stat = (label: string, value: string, big = false) => {
      ctx.fillStyle = SUBTEXT;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x + 12, y);
      ctx.fillStyle = TEXT;
      ctx.font = `bold ${big ? 26 : 18}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(value, x + w - 12, y - (big ? 6 : 2));
      ctx.textAlign = 'left';
      y += big ? 36 : 26;
    };
    stat('分数', String(this.logic.score), true);
    stat('最高', String(this.logic.best));
    stat('等级', String(this.logic.level));
    stat('消行', String(this.logic.lines));

    y += 8;
    // NEXT（3 个预览）
    ctx.fillStyle = SUBTEXT;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('NEXT', x + 12, y);
    y += 16;
    const previewBoxW = (w - 24 - 8) / 3;
    this.logic.next.slice(0, 3).forEach((t, i) => {
      const px = x + 12 + i * (previewBoxW + 4);
      ctx.fillStyle = '#22222f';
      this.roundRect(ctx, px, y, previewBoxW, previewBoxW, 6);
      ctx.fill();
      this.drawPreview(t, px + previewBoxW / 2, y + previewBoxW / 2, 11);
    });
    y += previewBoxW + 12;

    // HOLD
    ctx.fillStyle = SUBTEXT;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('HOLD', x + 12, y);
    y += 16;
    const holdW = previewBoxW * 1.6;
    ctx.fillStyle = '#22222f';
    this.roundRect(ctx, x + 12, y, holdW, previewBoxW, 6);
    ctx.fill();
    if (this.logic.holdType) {
      ctx.globalAlpha = this.logic.holdUsed ? 0.4 : 1;
      this.drawPreview(this.logic.holdType, x + 12 + holdW / 2, y + previewBoxW / 2, 11);
      ctx.globalAlpha = 1;
    }

    // 操作按钮
    for (const b of this.buttons) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      this.roundRect(ctx, b.x, b.y, b.w, b.h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, b.x, b.y, b.w, b.h, 8);
      ctx.stroke();
      ctx.fillStyle = b.key === 'pause' && this.logic.paused ? '#f7d308' : TEXT;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  }

  /** 预览小图形（居中绘制） */
  private drawPreview(type: PieceType, cx: number, cy: number, cell: number) {
    const cells = this.cellsOf(type, 0);
    const minR = Math.min(...cells.map(c => c[0]));
    const maxR = Math.max(...cells.map(c => c[0]));
    const minC = Math.min(...cells.map(c => c[1]));
    const maxC = Math.max(...cells.map(c => c[1]));
    const w = (maxC - minC + 1) * cell;
    const h = (maxR - minR + 1) * cell;
    const ox = cx - w / 2 - minC * cell;
    const oy = cy - h / 2 - minR * cell;
    for (const [r, c] of cells) {
      this.drawBlock(ox + c * cell, oy + r * cell, cell, PIECE_COLORS[type]);
    }
  }

  private cellsOf(type: PieceType, rot: number): [number, number][] {
    return PIECE_CELLS[type][rot % 4];
  }

  private drawBlock(x: number, y: number, size: number, color: string) {
    const ctx = this.ctx;
    const pad = size >= 20 ? 1.5 : 1;
    ctx.fillStyle = color;
    this.roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, size >= 20 ? 4 : 2);
    ctx.fill();
    // 顶部高光
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    this.roundRect(ctx, x + pad + 1, y + pad + 1, size - pad * 2 - 2, (size - pad * 2) * 0.28, 2);
    ctx.fill();
    // 右下阴影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    this.roundRect(ctx, x + pad + 1, y + size - pad - (size * 0.22), size - pad * 2 - 2, size * 0.2, 2);
    ctx.fill();
  }

  private drawOverlay(title: string, sub: string) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,10,18,0.82)';
    this.roundRect(ctx, MARGIN, MARGIN, BOARD_W, BOARD_H, 8);
    ctx.fill();
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, MARGIN + BOARD_W / 2, MARGIN + BOARD_H / 2 - 18);
    ctx.fillStyle = SUBTEXT;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(sub, MARGIN + BOARD_W / 2, MARGIN + BOARD_H / 2 + 22);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  private drawToast() {
    const ctx = this.ctx;
    const w = Math.max(120, this.toast.length * 13 + 28);
    const x = MARGIN + BOARD_W / 2 - w / 2;
    const y = MARGIN + 18;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    this.roundRect(ctx, x, y, w, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.toast, MARGIN + BOARD_W / 2, y + 18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  private showToast(text: string) {
    this.toast = text;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = '';
      this.render();
    }, 900);
    this.render();
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.logic.off('state', this.onState);
    this.logic.off('clear', this.onClear);
    this.logic.off('gameover', this.onGameOver);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.inited = false;
  }
}
