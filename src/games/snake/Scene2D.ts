// 贪吃蛇 2D 场景：世界层用 Canvas 2D，UI 层用 DOM/CSS
// - 世界 3600×2600 像素，屏幕只显示一部分：镜头平滑跟随自己的蛇头，移动时场景滚动
// - 蛇 = 一条有宽度的折线（round join/cap），按路径绘制，不是格子
// - 只画镜头附近：世界很大，但每帧只把视口外扩一圈的局部路径/食物送进 Canvas
// - 输入与场景解耦：方向由屏幕固定位置的虚拟摇杆给"世界绝对角度"，
//   镜头怎么滚动、蛇贴不贴边，操作含义都一样。摇杆是"因"（控制蛇的目标朝向），
//   蛇怎么走是"果"；摇杆手柄只反映手指输入，松手就回中，绝不镜像蛇的朝向。
// - 动画统一走 requestAnimationFrame：世界层逐帧画蛇/食物；HUD/小地图/摇杆/按钮
//   等 UI 是 DOM，在同一个 rAF 里按变化更新（transform/text），不再有 UI 节流。
import LogicSnake, {
  SNAKE_BOOST_CD_MS,
  SNAKE_FOOD_RADIUS,
  type SnakeView,
  normalizeAngle,
} from './Logic';

const BG = '#0b0b14';
const OUTSIDE = '#06060b';
const GRID = 'rgba(104,116,170,0.10)';
const GRID_STRONG = 'rgba(120,136,205,0.18)';
const BORDER = 'rgba(120,140,220,0.55)';
const FOOD_COLOR = '#ff5d5d';
const SNAKE_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399'];

/** 相机缩放：按屏幕尺寸自适应，保证不同设备看到的"世界范围"接近 */
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.35;
/** 镜头跟随的平滑系数（毫秒） */
const CAM_LAG = 90;
/** 远端蛇的插值收敛时间（毫秒）：快照 20Hz，靠它补成 60fps */
const SMOOTH_LAG = 60;
/** 触屏死区（像素）：按下后至少移动这么远才开始算方向 */
const TOUCH_DEAD_ZONE = 4;
/** 摇杆圆心离屏幕边缘的距离 / 半径范围（CSS 像素） */
const JOY_MARGIN = 38;
const JOY_R_MIN = 54;
const JOY_R_MAX = 78;
/** 局部绘制窗口相对视口的外扩比例：留出提前量，镜头滚动时不会露出突兀的断头 */
const VIEW_MARGIN = 0.2;
/** 高分屏上限：手机 3x DPI 下 2x 全屏填充很贵，1.5x 对高速运动画面足够清晰 */
const DPR_MAX = 1.5;
const TAU = Math.PI * 2;

/**
 * 控件布局（纯函数）：只吃画布尺寸，不吃镜头/蛇头/世界坐标 —— 控制与场景彻底解耦。
 * 左下角虚拟摇杆、右下角加速按钮，两者不重叠。
 */
export function snakeControlsLayout(cssW: number, cssH: number) {
  const br = Math.max(34, Math.min(44, Math.round(Math.min(cssW, cssH) * 0.07)));
  const jr = Math.max(JOY_R_MIN, Math.min(JOY_R_MAX, Math.round(Math.min(cssW, cssH) * 0.11)));
  return {
    boost: { x: cssW - br - 22, y: cssH - br - 22, r: br },
    joy: { x: jr + JOY_MARGIN, y: cssH - jr - JOY_MARGIN, r: jr },
  };
}

export interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 微缩地图在画布右上角（避让右上角设置按钮，放在它下方） */
export function snakeMinimapLayout(cssW: number, cssH: number) {
  const w = Math.max(88, Math.min(160, Math.round(cssW * 0.28)));
  const h = Math.round(w * 0.72);
  return { x: Math.max(8, cssW - w - 12), y: 64, w, h };
}

/** 世界坐标 → 微缩地图坐标（纯函数，便于校验"自己的位置"） */
export function minimapPoint(layout: { x: number; y: number; w: number; h: number }, worldW: number, worldH: number, x: number, y: number) {
  return [layout.x + (x / worldW) * layout.w, layout.y + (y / worldH) * layout.h] as [number, number];
}

/** 小地图只标自己：入参里没有食物/镜头/其他玩家，位置完全由自己的世界坐标决定 */
export function snakeMinimapSelfPoint(cssW: number, cssH: number, worldW: number, worldH: number, x: number, y: number) {
  const m = snakeMinimapLayout(cssW, cssH);
  return minimapPoint({ x: m.x + 6, y: m.y + 6, w: m.w - 12, h: m.h - 12 }, worldW, worldH, x, y);
}

/**
 * 当前镜头对应的"局部绘制窗口"：视口向四周各外扩 margin 比例，再钳到世界内。
 * 蛇头移动 → 镜头移动 → 这个窗口跟着更新，窗口外的路径/食物不进 Canvas。
 */
export function snakeViewport(
  cam: { x: number; y: number },
  cssW: number,
  cssH: number,
  zoom: number,
  worldW: number,
  worldH: number,
  margin = 0.2,
): WorldRect {
  const halfW = cssW / (2 * zoom);
  const halfH = cssH / (2 * zoom);
  return {
    x0: Math.max(0, cam.x - halfW * (1 + margin)),
    y0: Math.max(0, cam.y - halfH * (1 + margin)),
    x1: Math.min(worldW, cam.x + halfW * (1 + margin)),
    y1: Math.min(worldH, cam.y + halfH * (1 + margin)),
  };
}

/**
 * 把一条长路径裁成若干段，只保留与局部窗口相交的部分。
 * 段之间用独立 moveTo 断开，避免蛇绕回来时把屏幕外的一段连成一条直线。
 */
export function clipSnakeSegments(pts: [number, number][], r: WorldRect): [number, number][][] {
  const segments: [number, number][][] = [];
  let cur: [number, number][] | null = null;
  let prevIn = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
    if (inside) {
      if (!prevIn) {
        cur = i > 0 ? [pts[i - 1]] : [];
        cur.push(p);
      } else {
        cur!.push(p);
      }
    } else if (prevIn && cur) {
      cur.push(p);
      segments.push(cur);
      cur = null;
    }
    prevIn = inside;
  }
  if (cur && cur.length > 1) segments.push(cur);
  return segments;
}

/**
 * 摇杆 → 世界绝对朝向的换算（纯函数）：只依赖固定圆心和手指屏幕坐标，
 * 与镜头位置、蛇头坐标、世界大小毫无关系。圆心附近返回 null（不给方向）。
 */
export function joystickAngle(joy: { x: number; y: number; r: number }, px: number, py: number): number | null {
  const dx = px - joy.x;
  const dy = py - joy.y;
  if (Math.hypot(dx, dy) < 8) return null;
  return Math.atan2(dy, dx);
}

/**
 * 摇杆手柄相对圆心的偏移（纯函数）。
 * - knob 为 null（松手/未操作）→ 回中 {0,0}，与蛇的朝向无关：
 *   摇杆是输入设备，只显示"手指把它推到哪"，不是蛇当前姿态的仪表盘。
 * - 拖动中 → 用手指位置，并 clamp 在半径内。
 */
export function joystickKnobOffset(
  joy: { x: number; y: number; r: number },
  knob: { x: number; y: number } | null,
  maxRatio = 0.82,
) {
  if (!knob) return { dx: 0, dy: 0 };
  const dx = knob.x - joy.x;
  const dy = knob.y - joy.y;
  const d = Math.hypot(dx, dy) || 1;
  const clamped = Math.min(d, joy.r * maxRatio);
  return { dx: (dx / d) * clamped, dy: (dy / d) * clamped };
}

interface Camera {
  x: number;
  y: number;
}

interface DispSnake {
  x: number;
  y: number;
  angle: number;
  pts: [number, number][];
}

/** UI 层 DOM 节点集合 */
interface SnakeUi {
  root: HTMLDivElement;
  hud: HTMLDivElement;
  hudMode: HTMLDivElement;
  hudScore: HTMLSpanElement;
  hudBest: HTMLSpanElement;
  hudPlayers: HTMLDivElement;
  minimap: HTMLDivElement;
  minimapDot: HTMLDivElement;
  boost: HTMLDivElement;
  boostRing: HTMLDivElement;
  boostLabel: HTMLSpanElement;
  joystick: HTMLDivElement;
  joyBase: HTMLDivElement;
  joyKnob: HTMLDivElement;
  hint: HTMLDivElement;
  overlay: HTMLDivElement;
  death: HTMLDivElement;
  deathScore: HTMLDivElement;
  deathRespawn: HTMLButtonElement;
  deathExit: HTMLButtonElement;
}

export default class Scene2DSnake {
  logic: LogicSnake;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inited = false;
  dpr = 1;
  cssW = 800;
  cssH = 600;
  zoom = 1;

  private state: SnakeView;
  private cam: Camera = { x: 1800, y: 1300 };
  private camInited = false;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private lastFrame = 0;
  private startedAt = 0;
  /** 远端蛇的平滑显示状态 */
  private disp = new Map<string, DispSnake>();
  /** 食物预渲染精灵：避免每帧为每颗食物画三层圆 */
  private foodSprite: HTMLCanvasElement | null = null;
  private foodSpriteSize = 0;
  /** 指针坐标缓存：pointermove 不再每次读 getBoundingClientRect 触发强制布局 */
  private rectCache: { left: number; top: number } | null = null;
  /** DOM UI 层 */
  private ui: SnakeUi | null = null;
  /** UI 脏检查签名：只有内容变化才写 DOM，连续量（位置/透明度）每帧直接写 transform/opacity */
  private hudSig = '';
  private overlaySig = '';
  private boostLabelSig = '';
  private hudPlayersSig = '';

  // 输入状态（全部是屏幕坐标，与镜头/世界无关）
  /** 正在拖摇杆的那根手指 */
  private joyPointerId: number | null = null;
  /** 手指当前位置（决定手柄偏移；松手置 null → 手柄回中） */
  private joyKnob: { x: number; y: number } | null = null;
  /** 触屏按下点：移动超过死区才真正开始瞄准 */
  private touchStart: { x: number; y: number } | null = null;
  private touchLocked = false;

  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onResize = () => this.resize();
  private onCanvasDown = (e: PointerEvent) => this.handleCanvasDown(e);
  private onCanvasMove = (e: PointerEvent) => this.handleCanvasMove(e);
  private onContextMenu = (e: Event) => e.preventDefault();

  private onJoyDown = (e: PointerEvent) => this.handleJoyDown(e);
  private onJoyMove = (e: PointerEvent) => this.handleJoyMove(e);
  private onJoyUp = (e: PointerEvent) => this.handleJoyUp(e);
  private onBoostDown = (e: PointerEvent) => this.handleBoostDown(e);

  constructor(canvas: HTMLCanvasElement, logic: LogicSnake) {
    this.canvas = canvas;
    this.logic = logic;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.state = logic.view();
    let lastRespawns = -1;
    logic.on('state', (s: SnakeView) => {
      this.state = s;
      // 重生是整条蛇瞬移到地图另一处：镜头直接对齐，别从旧位置平滑飞过去
      const mine = s.snakes.find(x => x.mine);
      const respawns = mine?.respawns ?? 0;
      if (mine && lastRespawns >= 0 && respawns !== lastRespawns) this.camInited = false;
      lastRespawns = respawns;
    });
  }

  async init() {
    if (this.inited) return;
    this.inited = true;
    this.startedAt = performance.now();
    this.canvas.style.touchAction = 'none';
    (this.canvas.style as any).webkitUserSelect = 'none';
    this.buildUi();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('pointerdown', this.onCanvasDown);
    this.canvas.addEventListener('pointermove', this.onCanvasMove);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
    }
    this.resize();
    this.loop();
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onCanvasDown);
    this.canvas.removeEventListener('pointermove', this.onCanvasMove);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.ro?.disconnect();
    this.ro = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ui?.root.remove();
    this.ui = null;
    this.foodSprite = null;
    this.rectCache = null;
    this.inited = false;
    this.joyPointerId = null;
    this.joyKnob = null;
    this.touchStart = null;
    this.touchLocked = false;
  }

  // ===== DOM UI 构建 =====
  private buildUi() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
      const node = document.createElement(tag);
      node.className = cls;
      return node;
    };
    const root = el('div', 'snake-dom-ui');
    const hud = el('div', 'snake-hud');
    const hudMode = el('div', 'snake-hud-mode');
    const hudScores = el('div', 'snake-hud-scores');
    const hudScore = el('span', 'snake-hud-score');
    const hudBest = el('span', 'snake-hud-best');
    hudScores.append(hudScore, hudBest);
    const hudPlayers = el('div', 'snake-hud-players');
    hud.append(hudMode, hudScores, hudPlayers);

    const minimap = el('div', 'snake-minimap');
    const minimapDot = el('div', 'snake-minimap-dot');
    minimap.appendChild(minimapDot);

    const boost = el('div', 'snake-boost');
    const boostRing = el('div', 'snake-boost-ring');
    const boostLabel = el('span', 'snake-boost-label');
    boost.append(boostRing, boostLabel);

    const joystick = el('div', 'snake-joystick');
    const joyBase = el('div', 'snake-joy-base');
    const joyKnob = el('div', 'snake-joy-knob');
    joystick.append(joyBase, joyKnob);

    const hint = el('div', 'snake-hint');
    hint.textContent = '左下摇杆控方向 · 鼠标/WASD 亦可 · 右下加速';

    const overlay = el('div', 'snake-overlay');
    const death = el('div', 'snake-death');
    const deathScore = el('div', 'snake-death-score');
    const deathActions = el('div', 'snake-death-actions');
    const deathRespawn = el('button', 'snake-death-btn primary');
    deathRespawn.textContent = '重生';
    const deathExit = el('button', 'snake-death-btn');
    deathExit.textContent = '退出';
    deathActions.append(deathRespawn, deathExit);
    const deathTitle = el('div', 'snake-death-title');
    deathTitle.textContent = '已出局';
    const deathNote = el('div', 'snake-death-note');
    deathNote.textContent = '分数已记入排行榜';
    death.append(deathTitle, deathScore, deathNote, deathActions);

    root.append(hud, minimap, boost, joystick, hint, overlay, death);
    parent.appendChild(root);
    this.ui = {
      root, hud, hudMode, hudScore, hudBest, hudPlayers,
      minimap, minimapDot, boost, boostRing, boostLabel,
      joystick, joyBase, joyKnob, hint, overlay,
      death, deathScore, deathRespawn, deathExit,
    };

    joystick.addEventListener('pointerdown', this.onJoyDown);
    joystick.addEventListener('pointermove', this.onJoyMove);
    joystick.addEventListener('pointerup', this.onJoyUp);
    joystick.addEventListener('pointercancel', this.onJoyUp);
    joystick.addEventListener('pointerleave', this.onJoyUp);
    boost.addEventListener('pointerdown', this.onBoostDown);
    deathRespawn.addEventListener('click', () => {
      this.deathReset();
      this.logic.respawn();
    });
    deathExit.addEventListener('click', () => {
      this.deathReset();
      this.logic.exit();
    });
  }

  private deathReset() {
    this.joyPointerId = null;
    this.joyKnob = null;
    this.touchStart = null;
    this.touchLocked = false;
  }

  // ===== 布局 =====
  private resize() {
    if (!this.inited) return;
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, Math.round(rect.width || 800));
    this.cssH = Math.max(1, Math.round(rect.height || 600));
    this.rectCache = { left: rect.left, top: rect.top };
    this.dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.foodSprite = null;
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(this.cssW / 900, this.cssH / 720)));
    this.layoutUi();
  }

  /** DOM 控件的尺寸/位置依赖画布尺寸，resize 时放一次；位置连续变化的部分每帧写 transform */
  private layoutUi() {
    const ui = this.ui;
    if (!ui) return;
    const { boost, joy } = snakeControlsLayout(this.cssW, this.cssH);
    const m = snakeMinimapLayout(this.cssW, this.cssH);
    Object.assign(ui.joystick.style, {
      left: `${joy.x - joy.r}px`, top: `${joy.y - joy.r}px`,
      width: `${joy.r * 2}px`, height: `${joy.r * 2}px`,
    });
    Object.assign(ui.boost.style, {
      left: `${boost.x - boost.r}px`, top: `${boost.y - boost.r}px`,
      width: `${boost.r * 2}px`, height: `${boost.r * 2}px`,
    });
    Object.assign(ui.minimap.style, {
      left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px`,
    });
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.render();
  };

  // ===== 输入 =====
  private handleKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;

    if (e.code === 'Space' || e.key === 'Shift') {
      e.preventDefault();
      if (this.state.boostCd <= 0) this.logic.boost();
      return;
    }
    const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    this.logic.aimDir(dir);
  }

  private joystick() {
    return snakeControlsLayout(this.cssW, this.cssH).joy;
  }

  private pointerXY(e: PointerEvent) {
    const r = this.rectCache;
    return r
      ? { x: e.clientX - r.left, y: e.clientY - r.top }
      : { x: e.clientX - this.canvas.getBoundingClientRect().left, y: e.clientY - this.canvas.getBoundingClientRect().top };
  }

  /** 摇杆角度 → 目标朝向（因），蛇怎么走是果；摇杆手柄不读这个角度 */
  private aimFromJoystick(px: number, py: number) {
    const angle = joystickAngle(this.joystick(), px, py);
    if (angle !== null) this.logic.aim(angle);
  }

  /** 鼠标：以屏幕中心为固定参考点给绝对朝向；小地图区域跳过，避免误改方向 */
  private aimFromPointer(px: number, py: number) {
    const m = snakeMinimapLayout(this.cssW, this.cssH);
    if (px >= m.x - 8 && px <= m.x + m.w + 8 && py >= m.y - 8 && py <= m.y + m.h + 8) return;
    const dx = px - this.cssW / 2;
    const dy = py - this.cssH / 2;
    if (Math.hypot(dx, dy) < 24) return;
    this.logic.aim(Math.atan2(dy, dx));
  }

  private handleCanvasDown(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.rectCache = { left: rect.left, top: rect.top };
    if (e.pointerType === 'mouse') {
      const { x, y } = this.pointerXY(e);
      this.aimFromPointer(x, y);
    }
    // 触屏的控制全部交给 DOM 摇杆/加速按钮，画布空白触摸不改方向
  }

  private handleCanvasMove(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    const { x, y } = this.pointerXY(e);
    this.aimFromPointer(x, y);
  }

  private handleJoyDown(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.rectCache = { left: rect.left, top: rect.top };
    e.preventDefault();
    e.stopPropagation();
    this.joyPointerId = e.pointerId;
    this.touchStart = { x: e.clientX, y: e.clientY };
    this.touchLocked = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // 按下即让手柄跟手（鼠标点击摇杆也能立即指向）
    const { x, y } = this.pointerXY(e);
    const j = this.joystick();
    if (Math.hypot(x - j.x, y - j.y) >= TOUCH_DEAD_ZONE) {
      this.touchLocked = true;
      this.joyKnob = { x, y };
      this.aimFromJoystick(x, y);
    }
  }

  private handleJoyMove(e: PointerEvent) {
    if (this.joyPointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.touchLocked && this.touchStart) {
      const d = Math.hypot(e.clientX - this.touchStart.x, e.clientY - this.touchStart.y);
      if (d < TOUCH_DEAD_ZONE) return;
      this.touchLocked = true;
    }
    const { x, y } = this.pointerXY(e);
    this.joyKnob = { x, y };
    this.aimFromJoystick(x, y);
  }

  private handleJoyUp(e: PointerEvent) {
    if (this.joyPointerId !== null && e.pointerId !== this.joyPointerId) return;
    // 松手：手柄回中（knob=null），但蛇保持最后的目标朝向继续前进
    this.joyPointerId = null;
    this.joyKnob = null;
    this.touchStart = null;
    this.touchLocked = false;
  }

  private handleBoostDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (this.state.boostCd <= 0) this.logic.boost();
  }

  // ===== 坐标换算（世界 → 屏幕） =====
  private sx(wx: number) {
    return (wx - this.cam.x) * this.zoom + this.cssW / 2;
  }

  private sy(wy: number) {
    return (wy - this.cam.y) * this.zoom + this.cssH / 2;
  }

  // ===== 渲染 =====
  private render() {
    if (!this.inited) return;
    const ctx = this.ctx;
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    this.lastFrame = now;

    // 每帧重新取视图：本地预测按"距快照经过的时间"前推，必须逐帧算才顺滑
    this.state = this.logic.view();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    this.updateCamera(dt);
    this.smoothRemote(dt);

    const view = snakeViewport(
      this.cam, this.cssW, this.cssH, this.zoom,
      this.state.w, this.state.h, VIEW_MARGIN,
    );
    this.drawWorld(view);
    this.drawFood(now, view);
    this.drawSnakes(now, view);

    // UI 在同一个 rAF 里更新：连续量每帧写 transform/opacity，静态内容按脏检查写
    this.syncUi(now);
  }

  /**
   * 把镜头中心钳在"视野不越出世界"的范围内，避免贴边时露出大片世界外空底色。
   */
  private clampCam(p: Camera): Camera {
    const halfW = this.cssW / (2 * this.zoom);
    const halfH = this.cssH / (2 * this.zoom);
    const { w, h } = this.state;
    const x = w <= halfW * 2 ? w / 2 : Math.min(Math.max(p.x, halfW), w - halfW);
    const y = h <= halfH * 2 ? h / 2 : Math.min(Math.max(p.y, halfH), h - halfH);
    return { x, y };
  }

  private updateCamera(dt: number) {
    const me = this.state.snakes.find(s => s.mine);
    if (!me) {
      if (!this.camInited) {
        this.cam = this.clampCam({ x: this.state.w / 2, y: this.state.h / 2 });
        this.camInited = true;
      }
      return;
    }
    const target = this.clampCam({ x: me.x, y: me.y });
    if (!this.camInited) {
      this.cam = target;
      this.camInited = true;
      return;
    }
    const k = Math.min(1, dt / CAM_LAG);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.cam = this.clampCam(this.cam);
  }

  /** 远端蛇：向最新快照缓动，把 20Hz 补成 60fps（自己的蛇走本地预测，不参与） */
  private smoothRemote(dt: number) {
    const k = Math.min(1, dt / SMOOTH_LAG);
    const alive = new Set<string>();
    for (const s of this.state.snakes) {
      if (s.mine) continue;
      alive.add(s.id);
      const cur = this.disp.get(s.id);
      if (!cur || cur.pts.length !== s.pts.length) {
        this.disp.set(s.id, { x: s.x, y: s.y, angle: s.angle, pts: s.pts.map(p => [p[0], p[1]] as [number, number]) });
        continue;
      }
      if (!s.alive) continue;
      cur.x += (s.x - cur.x) * k;
      cur.y += (s.y - cur.y) * k;
      cur.angle = cur.angle + shortestArc(cur.angle, s.angle) * k;
      for (let i = 0; i < s.pts.length; i++) {
        cur.pts[i][0] += (s.pts[i][0] - cur.pts[i][0]) * k;
        cur.pts[i][1] += (s.pts[i][1] - cur.pts[i][1]) * k;
      }
    }
    for (const id of [...this.disp.keys()]) if (!alive.has(id)) this.disp.delete(id);
  }

  private drawWorld(view: WorldRect) {
    const ctx = this.ctx;
    const { w, h } = this.state;
    const x0 = this.sx(0);
    const y0 = this.sy(0);
    const x1 = this.sx(w);
    const y1 = this.sy(h);

    ctx.fillStyle = OUTSIDE;
    if (x0 > 0) ctx.fillRect(0, 0, x0, this.cssH);
    if (y0 > 0) ctx.fillRect(0, 0, this.cssW, y0);
    if (x1 < this.cssW) ctx.fillRect(x1, 0, this.cssW - x1, this.cssH);
    if (y1 < this.cssH) ctx.fillRect(0, y1, this.cssW, this.cssH - y1);

    const step = 100;
    const left = view.x0;
    const right = view.x1;
    const top = view.y0;
    const bottom = view.y1;

    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    for (let gx = Math.max(0, Math.floor(left / step) * step); gx <= Math.min(w, right); gx += step) {
      const x = Math.round(this.sx(gx)) + 0.5;
      ctx.moveTo(x, Math.max(0, y0));
      ctx.lineTo(x, Math.min(this.cssH, y1));
    }
    for (let gy = Math.max(0, Math.floor(top / step) * step); gy <= Math.min(h, bottom); gy += step) {
      const y = Math.round(this.sy(gy)) + 0.5;
      ctx.moveTo(Math.max(0, x0), y);
      ctx.lineTo(Math.min(this.cssW, x1), y);
    }
    ctx.stroke();

    ctx.strokeStyle = GRID_STRONG;
    ctx.beginPath();
    for (let gx = Math.max(0, Math.floor(left / 500) * 500); gx <= Math.min(w, right); gx += 500) {
      const x = Math.round(this.sx(gx)) + 0.5;
      ctx.moveTo(x, Math.max(0, y0));
      ctx.lineTo(x, Math.min(this.cssH, y1));
    }
    for (let gy = Math.max(0, Math.floor(top / 500) * 500); gy <= Math.min(h, bottom); gy += 500) {
      const y = Math.round(this.sy(gy)) + 0.5;
      ctx.moveTo(Math.max(0, x0), y);
      ctx.lineTo(Math.min(this.cssW, x1), y);
    }
    ctx.stroke();

    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
  }

  /** 食物三层圆只画一次到精灵，之后每帧一次 drawImage */
  private buildFoodSprite() {
    if (typeof document === 'undefined') return;
    const r = SNAKE_FOOD_RADIUS * this.zoom;
    const size = Math.ceil(r * 5.2);
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * this.dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const mid = size / 2;
    g.beginPath();
    g.arc(mid, mid, r * 2.1, 0, TAU);
    g.fillStyle = 'rgba(255,93,93,0.10)';
    g.fill();
    g.beginPath();
    g.arc(mid, mid, r, 0, TAU);
    g.fillStyle = FOOD_COLOR;
    g.fill();
    g.beginPath();
    g.arc(mid - r * 0.28, mid - r * 0.28, r * 0.32, 0, TAU);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fill();
    this.foodSprite = c;
    this.foodSpriteSize = size;
  }

  private drawFood(now: number, view: WorldRect) {
    if (!this.foodSprite) this.buildFoodSprite();
    const sprite = this.foodSprite;
    if (!sprite) return;
    const ctx = this.ctx;
    const r = SNAKE_FOOD_RADIUS * this.zoom;
    const pulse = 1 + 0.05 * (0.5 + 0.5 * Math.sin(now / 300));
    const size = this.foodSpriteSize * pulse;
    const half = size / 2;
    for (const [fx, fy] of this.state.food) {
      if (fx < view.x0 - r || fx > view.x1 + r || fy < view.y0 - r || fy > view.y1 + r) continue;
      ctx.drawImage(sprite, this.sx(fx) - half, this.sy(fy) - half, size, size);
    }
  }

  private drawSnakes(now: number, view: WorldRect) {
    const ctx = this.ctx;
    const radius = this.state.radius * this.zoom;
    const margin = radius / this.zoom * 2;

    this.state.snakes.forEach((snake, idx) => {
      const color = SNAKE_COLORS[idx % SNAKE_COLORS.length];
      const disp = snake.mine ? null : this.disp.get(snake.id);
      const pts = disp ? disp.pts : snake.pts;
      if (!pts.length) return;

      const segments = clipSnakeSegments(pts, {
        x0: view.x0 - margin, y0: view.y0 - margin,
        x1: view.x1 + margin, y1: view.y1 + margin,
      });
      if (!segments.length) return;

      const head = pts[0];
      const hx = this.sx(head[0]);
      const hy = this.sy(head[1]);
      const headVisible = head[0] >= view.x0 - margin && head[0] <= view.x1 + margin
        && head[1] >= view.y0 - margin && head[1] <= view.y1 + margin
        && hx > -radius * 3 && hx < this.cssW + radius * 3
        && hy > -radius * 3 && hy < this.cssH + radius * 3;

      const alpha = snake.alive ? 1 : 0.22;
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      for (const seg of segments) {
        ctx.moveTo(this.sx(seg[0][0]), this.sy(seg[0][1]));
        for (let i = 1; i < seg.length; i++) ctx.lineTo(this.sx(seg[i][0]), this.sy(seg[i][1]));
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.lineWidth = radius * 2 + Math.max(2, radius * 0.32);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = radius * 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = radius * 0.8;
      ctx.stroke();

      if (headVisible && snake.boosting && snake.alive) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        for (let i = 1; i < Math.min(pts.length, 6); i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(125,211,252,0.35)';
        ctx.lineWidth = radius * 2.6;
        ctx.stroke();
      }

      if (headVisible) {
        const angle = disp ? disp.angle : snake.angle;
        ctx.beginPath();
        ctx.arc(hx, hy, radius * 1.06, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (snake.mine) {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        const ex = Math.cos(angle);
        const ey = Math.sin(angle);
        const px = -ey;
        const py = ex;
        const eyeR = Math.max(1.6, radius * 0.26);
        for (const side of [-1, 1]) {
          const cxp = hx + ex * radius * 0.42 + px * radius * 0.42 * side;
          const cyp = hy + ey * radius * 0.42 + py * radius * 0.42 * side;
          ctx.beginPath();
          ctx.arc(cxp, cyp, eyeR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(10,10,18,0.82)';
          ctx.fill();
        }

        if (snake.invincible > 0 && snake.alive) {
          const a = 0.3 + 0.35 * Math.sin(now / 150);
          ctx.beginPath();
          ctx.arc(hx, hy, radius * (1.8 + 0.12 * Math.sin(now / 220)), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(96,165,250,${a.toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.globalAlpha = 1;
        if (!snake.mine) {
          const name = this.state.players.find(p => p.id === snake.id)?.nickname;
          if (name) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(10,10,18,0.55)';
            ctx.fillText(name, hx, hy - radius * 1.5 + 1);
            ctx.fillStyle = 'rgba(226,232,248,0.75)';
            ctx.fillText(name, hx, hy - radius * 1.5);
            ctx.textAlign = 'left';
          }
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // ===== DOM UI 同步（同一个 rAF 内；连续量每帧写，静态量按签名脏检查） =====
  private syncUi(now: number) {
    const ui = this.ui;
    if (!ui) return;
    const s = this.state;
    const showControls = s.status === 'playing' && !s.awaiting && s.alive;

    // --- HUD 文本：脏检查 ---
    const mode = s.variant === 'endless' ? '无尽挑战' : '多人对战';
    const hudSig = `${mode}|${s.score}|${s.best}`;
    if (hudSig !== this.hudSig) {
      ui.hudMode.textContent = mode;
      ui.hudScore.textContent = String(s.score);
      ui.hudBest.textContent = `最高 ${s.best}`;
      this.hudSig = hudSig;
    }
    const playersSig = s.snakes.length > 1
      ? s.snakes.slice(0, 4).map(snake => {
        const name = s.players.find(p => p.id === snake.id)?.nickname || '';
        return `${snake.id}:${name}:${snake.score}:${snake.alive ? 1 : 0}`;
      }).join('|')
      : '';
    if (playersSig !== this.hudPlayersSig) {
      this.renderPlayers(ui.hudPlayers, s);
      this.hudPlayersSig = playersSig;
    }

    // --- 小地图：只画自己，白点位置每帧更新（transform 很便宜） ---
    const showMap = !!s.w && !!s.h && s.status !== 'waiting';
    ui.minimap.style.display = showMap ? '' : 'none';
    if (showMap) {
      const me = s.snakes.find(snake => snake.mine);
      const m = snakeMinimapLayout(this.cssW, this.cssH);
      if (me && m.w > 12 && m.h > 12) {
        const [px, py] = snakeMinimapSelfPoint(this.cssW, this.cssH, s.w, s.h, me.x, me.y);
        // 白点绝对定位在 minimap 容器内：换算成容器内的相对偏移（snakeMinimapSelfPoint 已含 6px 内边距）
        ui.minimapDot.style.transform = `translate(${(px - m.x).toFixed(1)}px, ${(py - m.y).toFixed(1)}px) translate(-50%, -50%)`;
        ui.minimapDot.style.display = '';
      } else {
        ui.minimapDot.style.display = 'none';
      }
    }

    // --- 加速按钮：冷却环用 conic-gradient，标签按 0.1s 粒度脏检查 ---
    ui.boost.style.display = showControls ? '' : 'none';
    if (showControls) {
      const cd = s.boostCd;
      const ready = cd <= 0;
      const ratio = ready ? 0 : Math.max(0, Math.min(1, cd / SNAKE_BOOST_CD_MS));
      ui.boost.classList.toggle('ready', ready);
      ui.boost.classList.toggle('boosting', !!s.boosting);
      ui.boostRing.style.background = ready
        ? 'rgba(56,189,248,0.22)'
        : `conic-gradient(rgba(56,189,248,0.55) ${((1 - ratio) * 360).toFixed(1)}deg, rgba(24,24,36,0.82) 0deg)`;
      const label = ready ? '加速' : (cd >= 10_000 ? String(Math.ceil(cd / 1000)) : (cd / 1000).toFixed(1));
      if (label !== this.boostLabelSig) {
        ui.boostLabel.textContent = label;
        this.boostLabelSig = label;
      }
    }

    // --- 摇杆：手柄只由 joyKnob（手指输入）决定；松手回中，绝不镜像蛇朝向 ---
    ui.joystick.style.display = showControls ? '' : 'none';
    if (showControls) {
      const j = this.joystick();
      const off = joystickKnobOffset(j, this.joyKnob);
      ui.joyKnob.style.transform = `translate(${(j.r + off.dx).toFixed(1)}px, ${(j.r + off.dy).toFixed(1)}px) translate(-50%, -50%)`;
      ui.joystick.classList.toggle('active', this.joyPointerId !== null && this.touchLocked);
    } else if (this.joyPointerId !== null) {
      // 死亡瞬间松开输入，避免复活后手柄卡在旧位置
      this.deathReset();
    }

    // --- 开场提示：7s 淡出（连续量，每帧写 opacity） ---
    if (s.status === 'playing' && s.alive) {
      const age = now - this.startedAt;
      const alpha = age > 7000 ? 0 : (age < 5500 ? 1 : Math.max(0, 1 - (age - 5500) / 1500));
      ui.hint.style.opacity = alpha.toFixed(3);
      ui.hint.style.display = alpha > 0 ? '' : 'none';
    } else {
      ui.hint.style.display = 'none';
    }

    // --- 中央提示 / 死亡卡片：按状态签名切换 ---
    this.syncOverlay(ui, s, now);
  }

  private renderPlayers(container: HTMLDivElement, s: SnakeView) {
    container.replaceChildren();
    if (s.snakes.length <= 1) return;
    s.snakes.slice(0, 4).forEach((snake, i) => {
      const row = document.createElement('div');
      row.className = 'snake-player-row' + (snake.alive ? '' : ' dead');
      const dot = document.createElement('span');
      dot.className = 'snake-player-dot';
      dot.style.background = SNAKE_COLORS[i % SNAKE_COLORS.length];
      const name = document.createElement('span');
      name.className = 'snake-player-name' + (snake.mine ? ' me' : '');
      const raw = s.players.find(p => p.id === snake.id)?.nickname || `玩家${i + 1}`;
      name.textContent = raw.length > 9 ? `${raw.slice(0, 9)}…` : raw;
      const score = document.createElement('span');
      score.className = 'snake-player-score';
      score.textContent = snake.alive ? String(snake.score) : '等待重生';
      row.append(dot, name, score);
      container.appendChild(row);
    });
  }

  private syncOverlay(ui: SnakeUi, s: SnakeView, now: number) {
    let kind = '';
    let title = '';
    let sub = '';
    if (s.status === 'waiting') {
      if (s.variant === 'endless') {
        if (now - this.startedAt >= 3000) {
          kind = 'notice'; title = '连接中…'; sub = '正在进入对局';
        }
      } else {
        kind = 'notice'; title = '等待对局开始'; sub = '进入房间后会自动开局';
      }
    } else if (s.status === 'over') {
      kind = 'notice';
      if (s.variant === 'multi') {
        const winner = s.snakes.find(x => x.id === s.winner);
        const name = winner ? (s.players.find(p => p.id === winner.id)?.nickname || '玩家') : '';
        title = name ? `${name} 获胜` : '平局';
      } else {
        title = '本局结束';
      }
      sub = `本局最高 ${s.best} 分`;
    } else if (!s.alive) {
      if (s.awaiting) {
        kind = 'death';
      } else {
        kind = 'notice'; title = '已出局'; sub = '对局已结束';
      }
    } else if (s.invincible > 0 && s.variant === 'endless') {
      kind = 'invincible';
      sub = `无敌 ${(s.invincible / 1000).toFixed(1)}s`;
    }

    const sig = `${kind}|${title}|${sub}`;
    if (sig === this.overlaySig) return;
    this.overlaySig = sig;

    ui.overlay.replaceChildren();
    ui.overlay.className = 'snake-overlay';
    ui.overlay.style.display = kind ? '' : 'none';
    ui.death.style.display = kind === 'death' ? '' : 'none';
    if (kind === 'death') {
      ui.deathScore.textContent = `本局得分 ${s.score} · 最高 ${s.best}`;
    } else if (kind === 'invincible') {
      ui.overlay.classList.add('snake-invincible');
      ui.overlay.textContent = sub;
    } else if (kind === 'notice') {
      const card = document.createElement('div');
      card.className = 'snake-notice-card';
      const t = document.createElement('div');
      t.className = 'snake-notice-title';
      t.textContent = title;
      card.appendChild(t);
      if (sub) {
        const d = document.createElement('div');
        d.className = 'snake-notice-sub';
        d.textContent = sub;
        card.appendChild(d);
      }
      ui.overlay.appendChild(card);
    }
  }
}

/** 两个角度之间的最短弧（-π, π]），用于角度插值 */
function shortestArc(from: number, to: number): number {
  let diff = normalizeAngle(to - from);
  if (diff > Math.PI) diff -= Math.PI * 2;
  return diff;
}
