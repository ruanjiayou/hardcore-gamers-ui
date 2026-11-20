// 2048 单人 2D 棋盘（纯 Canvas 2D，无 Babylon / 无服务端回合）
// 键盘方向键/WASD + 触摸滑动操作；逐块滑动合并动画；分数/最高分显示。

import Logic2048, { TileMove, MoveEvent, Dir } from "./Logic";

const CELL = 108;
const GAP = 12;
const MARGIN = 28;
const HEADER = 96;               // 顶部标题+分数区高度
const SIZE = 4;
const BOARD_W = MARGIN * 2 + SIZE * CELL + (SIZE - 1) * GAP;
const BOARD_H = HEADER + MARGIN + SIZE * CELL + (SIZE - 1) * GAP + MARGIN;

const COLORS: Record<number, { bg: string; fg: string }> = {
  0: { bg: '#cdc1b4', fg: '#776e65' },
  2: { bg: '#eee4da', fg: '#776e65' },
  4: { bg: '#ede0c8', fg: '#776e65' },
  8: { bg: '#f2b179', fg: '#f9f6f2' },
  16: { bg: '#f59563', fg: '#f9f6f2' },
  32: { bg: '#f67c5f', fg: '#f9f6f2' },
  64: { bg: '#f65e3b', fg: '#f9f6f2' },
  128: { bg: '#edcf72', fg: '#f9f6f2' },
  256: { bg: '#edcc61', fg: '#f9f6f2' },
  512: { bg: '#edc850', fg: '#f9f6f2' },
  1024: { bg: '#edc53f', fg: '#f9f6f2' },
  2048: { bg: '#edc22e', fg: '#f9f6f2' },
};

function colorFor(v: number) {
  return COLORS[v] || { bg: '#3c3a32', fg: '#f9f6f2' };
}

interface View { scale: number; offsetX: number; offsetY: number }

type AnimTile = { value: number; r: number; c: number };

export default class Scene2D2048 {
  logic: Logic2048;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inited = false;
  dpr = 1;
  view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  anim: { tiles: AnimTile[]; start: number; duration: number; spawn: MoveEvent['spawn']; raf: number } | null = null;
  /** 新块的出生动画：滑动结束后再淡入，避免新数字"凭空"出现在棋盘中间 */
  spawnAnim: { r: number; c: number; value: number; start: number; duration: number; raf: number } | null = null;
  gameover = false;
  toast = '';

  private onState = (d: any) => this.handleState(d);
  private onReset = (d: any) => this.handleReset(d);
  private onMove = (d: MoveEvent) => this.handleMove(d);
  private onGameOver = (d: any) => this.handleGameOver(d);
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onResize = () => this.resize();
  private touchStart: { x: number; y: number } | null = null;
  private onTouchStart = (e: TouchEvent) => this.handleTouchStart(e);
  private onTouchMove = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
  private onTouchEnd = (e: TouchEvent) => this.handleTouchEnd(e);

  constructor(canvas: HTMLCanvasElement, logic: Logic2048) {
    this.logic = logic;
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.logic.on('state', this.onState);
    this.logic.on('reset', this.onReset);
    this.logic.on('move', this.onMove);
    this.logic.on('gameover', this.onGameOver);
  }

  async init() {
    if (this.inited) return;
    this.inited = true;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.resize();
    this.render();
  }

  /** 逻辑格 -> 棋盘逻辑像素（格子左上角） */
  private cellXY(r: number, c: number): { x: number; y: number } {
    return {
      x: MARGIN + c * (CELL + GAP),
      y: HEADER + MARGIN + r * (CELL + GAP),
    };
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
    };
    this.render();
  }

  /** 屏幕坐标 -> 棋盘逻辑像素 */
  private toBoard(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left - this.view.offsetX) / this.view.scale;
    const sy = (clientY - rect.top - this.view.offsetY) / this.view.scale;
    return { sx, sy };
  }

  private handleKey(e: KeyboardEvent) {
    const map: Record<string, Dir> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    this.tryMove(dir);
  }

  private handleTouchStart(e: TouchEvent) {
    const t = e.changedTouches[0];
    if (t) this.touchStart = { x: t.clientX, y: t.clientY };
  }

  private handleTouchEnd(e: TouchEvent) {
    if (!this.touchStart) return;
    const t = e.changedTouches[0];
    if (!t) { this.touchStart = null; return; }
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    this.touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; // 太小忽略
    const dir: Dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    this.tryMove(dir);
  }

  private tryMove(dir: Dir) {
    if (this.gameover) return;
    if (this.anim) return; // 动画中忽略，避免连击导致状态错乱
    this.logic.move(dir);
  }

  private clearSpawnAnim() {
    if (this.spawnAnim) cancelAnimationFrame(this.spawnAnim.raf);
    this.spawnAnim = null;
  }

  private handleState(_d: any) {
    this.gameover = false;
    this.anim = null;
    this.clearSpawnAnim();
    this.render();
  }

  private handleReset(d: any) {
    this.gameover = false;
    this.anim = null;
    this.clearSpawnAnim();
    this.render();
  }

  private handleMove(d: MoveEvent) {
    // 把 TileMove 转成动画期间的临时块：每个 from 块滑向 to。
    // 合并块在终点叠放两个（动画结束后由 render 用 logic.board 显示合并值）。
    this.clearSpawnAnim();
    const tiles: AnimTile[] = d.moves.map((m: TileMove) => ({
      value: m.value,
      r: m.from[0],
      c: m.from[1],
    }));
    // 目标块信息存在 anim 里，用一个隐藏字段记录 end 坐标
    (tiles as any)._ends = d.moves.map((m: TileMove) => m.to);
    const spawn = d.spawn;
    this.anim = {
      tiles,
      start: performance.now(),
      duration: 150,
      spawn,
      raf: 0,
    };
    const tick = () => {
      if (!this.anim) return;
      const t = (performance.now() - this.anim.start) / this.anim.duration;
      if (t >= 1) {
        this.anim = null;
        this.startSpawnAnim(spawn);
        this.render();
        return;
      }
      this.render();
      this.anim.raf = requestAnimationFrame(tick);
    };
    this.anim.raf = requestAnimationFrame(tick);
  }

  /** 滑动落地后，让新块从格子里缩放淡入，而不是在动画结束那一帧突然冒出来 */
  private startSpawnAnim(spawn: MoveEvent['spawn']) {
    if (!spawn) return;
    this.clearSpawnAnim();
    this.spawnAnim = {
      r: spawn.r, c: spawn.c, value: spawn.value,
      start: performance.now(), duration: 140, raf: 0,
    };
    const tick = () => {
      if (!this.spawnAnim) return;
      if (performance.now() - this.spawnAnim.start >= this.spawnAnim.duration) {
        this.spawnAnim = null;
        this.render();
        return;
      }
      this.render();
      this.spawnAnim.raf = requestAnimationFrame(tick);
    };
    this.spawnAnim.raf = requestAnimationFrame(tick);
  }

  private handleGameOver(_d: any) {
    this.gameover = true;
    this.toast = '游戏结束';
    this.render();
    setTimeout(() => { this.toast = ''; this.render(); }, 1800);
  }

  private render() {
    if (!this.inited) return;
    const ctx = this.ctx;
    const { scale, offsetX, offsetY } = this.view;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 背景
    ctx.fillStyle = '#bbada0';
    this.roundRect(ctx, 0, 0, BOARD_W, BOARD_H, 12);
    ctx.fill();

    // 标题 + 分数
    ctx.fillStyle = '#776e65';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('2048', MARGIN, 18);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = '#eee4da';
    this.scoreBox(ctx, MARGIN + 150, 14, '分数', String(this.logic.score));
    this.scoreBox(ctx, MARGIN + 268, 14, '最高', String(this.logic.best));

    // 空格底
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const { x, y } = this.cellXY(r, c);
        ctx.fillStyle = '#cdc1b4';
        this.roundRect(ctx, x, y, CELL, CELL, 8);
        ctx.fill();
      }
    }

    // 动画中：绘制滑动的块
    if (this.anim) {
      const t = Math.min(1, (performance.now() - this.anim.start) / this.anim.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const ends = (this.anim.tiles as any)._ends as number[][];
      this.anim.tiles.forEach((tile, i) => {
        const endRC = ends[i];
        const from = this.cellXY(tile.r, tile.c);
        const to = this.cellXY(endRC[0], endRC[1]);
        const x = from.x + (to.x - from.x) * ease;
        const y = from.y + (to.y - from.y) * ease;
        this.drawTile(ctx, x, y, tile.value);
      });
    } else {
      // 静态：直接画逻辑棋盘；刚生成的新块单独做缩放淡入
      const spawnProgress = this.spawnAnim
        ? Math.min(1, (performance.now() - this.spawnAnim.start) / this.spawnAnim.duration)
        : 1;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const v = this.logic.board[r]?.[c] || 0;
          if (v === 0) continue;
          const { x, y } = this.cellXY(r, c);
          if (this.spawnAnim && this.spawnAnim.r === r && this.spawnAnim.c === c) {
            const ease = 1 - Math.pow(1 - spawnProgress, 3);
            const k = 0.55 + 0.45 * ease;
            ctx.save();
            ctx.globalAlpha = Math.max(0.05, ease);
            ctx.translate(x + CELL / 2, y + CELL / 2);
            ctx.scale(k, k);
            ctx.translate(-(x + CELL / 2), -(y + CELL / 2));
            this.drawTile(ctx, x, y, v);
            ctx.restore();
          } else {
            this.drawTile(ctx, x, y, v);
          }
        }
      }
    }

    // 结束蒙层
    if (this.gameover) {
      ctx.fillStyle = 'rgba(238,228,218,0.85)';
      this.roundRect(ctx, MARGIN, HEADER + MARGIN, BOARD_W - MARGIN * 2, SIZE * CELL + (SIZE - 1) * GAP, 8);
      ctx.fill();
      ctx.fillStyle = '#776e65';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('游戏结束', BOARD_W / 2, HEADER + MARGIN + (SIZE * CELL + (SIZE - 1) * GAP) / 2 - 20);
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(`本局 ${this.logic.score} 分`, BOARD_W / 2, HEADER + MARGIN + (SIZE * CELL + (SIZE - 1) * GAP) / 2 + 26);
    }

    if (this.toast) {
      ctx.fillStyle = 'rgba(119,110,101,0.9)';
      this.roundRect(ctx, BOARD_W / 2 - 90, HEADER - 6, 180, 34, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.toast, BOARD_W / 2, HEADER + 11);
    }

    ctx.restore();
  }

  private scoreBox(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string) {
    ctx.fillStyle = '#bbada0';
    this.roundRect(ctx, x, y, 104, 52, 6);
    ctx.fill();
    ctx.fillStyle = '#eee4da';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + 52, y + 4);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillText(value, x + 52, y + 48);
  }

  private drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, value: number) {
    const { bg, fg } = colorFor(value);
    ctx.fillStyle = bg;
    this.roundRect(ctx, x, y, CELL, CELL, 8);
    ctx.fill();
    const fontSize = value >= 1024 ? 44 : value >= 128 ? 52 : value >= 16 ? 60 : 66;
    ctx.fillStyle = fg;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + CELL / 2, y + CELL / 2 + 2);
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
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.logic.off('state', this.onState);
    this.logic.off('reset', this.onReset);
    this.logic.off('move', this.onMove);
    this.logic.off('gameover', this.onGameOver);
    if (this.anim) cancelAnimationFrame(this.anim.raf);
    this.clearSpawnAnim();
    this.inited = false;
  }
}
