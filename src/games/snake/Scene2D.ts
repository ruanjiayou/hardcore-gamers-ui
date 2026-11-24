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
  SNAKE_KIND_CORPSE,
  SNAKE_KIND_FOOD,
  SNAKE_KIND_LIGHTNING,
  SNAKE_KIND_MAGNET,
  SNAKE_MAGNET_RADIUS,
  type SnakeView,
  normalizeAngle,
} from './Logic';

const BG = '#0b0b14';
const OUTSIDE = '#06060b';
const GRID = 'rgba(104,116,170,0.10)';
const GRID_STRONG = 'rgba(120,136,205,0.18)';
/** 边界：墙线本身偏红，配合内侧辉光提示"这是死区" */
const BORDER = 'rgba(248,113,113,0.55)';
/** 边界内辉光：靠墙最亮、向场内渐隐 */
const BORDER_GLOW_RGB = '248,113,113';
/** 普通食物：三档（小的多、大的少），越值钱越大越亮 */
const FOOD_COLORS = ['#ff7a7a', '#ff5d5d', '#ff3b3b'];
/** 尸体残骸：暗灰红 */
const CORPSE_COLOR = '#9b6b6b';
/** 道具配色：磁铁（蓝）、闪电（黄） */
const ITEM_COLORS: Record<number, string> = {
  [SNAKE_KIND_MAGNET]: '#60a5fa',
  [SNAKE_KIND_LIGHTNING]: '#fbbf24',
};
const SNAKE_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399'];
/**
 * 团队模式的队伍配色：同一队伍所有蛇用同一个颜色，方便一眼分清敌我。
 * 队伍名与服务端 games/snake/teams.ts 保持一致（红/蓝/黄/绿/紫/橙）。
 */
const TEAM_COLORS: Record<string, string> = {
  红队: '#ef4444',
  蓝队: '#3b82f6',
  黄队: '#eab308',
  绿队: '#22c55e',
  紫队: '#a855f7',
  橙队: '#f97316',
};
/** 队伍配色回退：服务端出现未知队名时按顺序取色 */
const TEAM_FALLBACK_COLORS = Object.values(TEAM_COLORS);

/** 未知队名的稳定序号（同名永远同色） */
function teamColorIndex(team: string): number {
  let h = 0;
  for (let i = 0; i < team.length; i++) h = (h * 31 + team.charCodeAt(i)) >>> 0;
  return h;
}

/** 食物档位（按半径）：与服务端 rules.ts 的三档一一对应，越大越亮 */
function foodTierIndex(radius: number): number {
  if (radius >= 10) return 2;
  if (radius >= 7) return 1;
  return 0;
}

/** #rrggbb → rgba(r,g,b,a) */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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
/**
 * 自适应分辨率下限：掉帧时允许降到 1.0 / 0.75 再渲染，
 * 保证低端机 / 大屏设备至少能维持稳定帧率。
 */
const DPR_MIN = 0.75;
/** 帧间隔超过这个值算"掉帧"（60fps 预算 16.7ms，留 20% 余量） */
const FRAME_BUDGET_MS = 20;
/** 连续掉帧多少帧才降档（避免偶发抖动就降画质） */
const DOWNGRADE_FRAMES = 45;
/** 连续流畅多少帧才升档（升档比降档保守，防止来回抖） */
const UPGRADE_FRAMES = 180;
/**
 * 目标渲染帧间隔（ms）：约 60fps。
 * 120Hz 屏幕上按这个间隔只画一半的帧 —— 游戏本身是 60fps 节奏，
 * 多画的那一半只会把 GPU/合成开销翻倍（移动端尤其明显），观感没有区别。
 */
const TARGET_FRAME_MS = 15.5;
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

/**
 * 微缩地图放在**右上角关闭键下方**（左上角让给排行榜）。
 * 顶端一行按钮是「玩家与聊天 / 设置 / 关闭」，地图右对齐压在关闭键正下方。
 * topInset 是刘海屏的安全区高度：全屏对局时画布顶边 = 屏幕顶边，必须让开。
 */
export function snakeMinimapLayout(cssW: number, cssH: number, topInset = 0) {
  const w = Math.max(88, Math.min(150, Math.round(cssW * 0.26)));
  const h = Math.round(w * 0.72);
  // 按钮行：top = 安全区 + 10、高 42，地图与它留 8px 间隙
  return { x: Math.max(12, cssW - w - 12), y: topInset + 60, w, h };
}

/** 世界坐标 → 微缩地图坐标（纯函数，便于校验"自己的位置"） */
export function minimapPoint(layout: { x: number; y: number; w: number; h: number }, worldW: number, worldH: number, x: number, y: number) {
  return [layout.x + (x / worldW) * layout.w, layout.y + (y / worldH) * layout.h] as [number, number];
}

/** 小地图只标自己：入参里没有食物/镜头/其他玩家，位置完全由自己的世界坐标决定 */
export function snakeMinimapSelfPoint(cssW: number, cssH: number, worldW: number, worldH: number, x: number, y: number, topInset = 0) {
  const m = snakeMinimapLayout(cssW, cssH, topInset);
  return minimapPoint({ x: m.x + 6, y: m.y + 6, w: m.w - 12, h: m.h - 12 }, worldW, worldH, x, y);
}

/**
 * 排行榜取前 N 名（纯函数）。自己一定在列表里 —— 否则掉出前 10 就看不到自己的名次。
 * 名次按完整排序算，所以替换进末尾的那条也能显示真实排名。
 */
export function rankTopSnakes<T extends { score: number; mine?: boolean }>(
  snakes: readonly T[],
  limit = 10,
): { snake: T; rank: number }[] {
  if (limit <= 0) return [];
  const ranked = [...snakes].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = ranked.slice(0, limit);
  if (ranked.length > limit) {
    const meIdx = ranked.findIndex(x => x.mine);
    if (meIdx >= limit) top[limit - 1] = ranked[meIdx];
  }
  return top.map(snake => ({ snake, rank: ranked.indexOf(snake) + 1 }));
}

/**
 * 稳定的蛇身配色槽位：按玩家 id **首次出现顺序**分配，已有 id 保留原槽位。
 *
 * 原来按 `state.snakes` 数组下标取色：别人离场时服务端 splice 一下，下标位移，
 * 剩下的人集体变色；榜单圆点更是按名次下标取色，别人一死排名一变，
 * 自己名字旁边的圆点颜色就变了（和蛇身色还对不上）。
 */
export function snakeColorSlots(slots: Map<string, number>, ids: readonly string[]): Map<string, number> {
  for (const id of ids) {
    if (!slots.has(id)) slots.set(id, slots.size);
  }
  return slots;
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
 * 裁剪的零分配版本：把可见段的"起止下标"写进 out（[start, end, start, end…]），
 * 返回段数。绘制时从 start-1 画到 end+1（两端各多带一个窗口外的点，路径才不断）。
 * 每帧不再新建段数组与点数组。
 */
export function clipSnakeSegmentRanges(pts: [number, number][], r: WorldRect, out: number[]): number {
  out.length = 0;
  let prevIn = false;
  let start = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
    if (inside) {
      if (!prevIn) start = i;
    } else if (prevIn) {
      out.push(start, i - 1);
      start = -1;
    }
    prevIn = inside;
  }
  if (prevIn && start >= 0) out.push(start, pts.length - 1);
  return out.length / 2;
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

/**
 * DOM 写入去重：只有值真的变了才写样式。
 * 之前每帧无条件写 transform / opacity / display / background / class，
 * 即使值没变也会让浏览器做一次样式失效 + 重绘（conic-gradient 那条尤其贵）。
 */
class DomWriter {
  private styles = new WeakMap<HTMLElement, Map<string, string>>();
  private classes = new WeakMap<HTMLElement, Map<string, boolean>>();

  style(el: HTMLElement, prop: string, value: string) {
    let m = this.styles.get(el);
    if (!m) { m = new Map(); this.styles.set(el, m); }
    if (m.get(prop) === value) return;
    m.set(prop, value);
    (el.style as unknown as Record<string, string>)[prop] = value;
  }

  cls(el: HTMLElement, name: string, on: boolean) {
    let m = this.classes.get(el);
    if (!m) { m = new Map(); this.classes.set(el, m); }
    if (m.get(name) === on) return;
    m.set(name, on);
    el.classList.toggle(name, on);
  }
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
  /** 可选的帧率诊断浮层（?fps=1 开启） */
  fps: HTMLDivElement | null;
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
  /** 帧率节流用：上一次 rAF 的时间戳与累加器 */
  private lastLoopAt = 0;
  private frameAccum = 0;
  private startedAt = 0;
  /** 远端蛇的平滑显示状态 */
  private disp = new Map<string, DispSnake>();
  /** 蛇身/榜单圆点的稳定配色槽位（按玩家 id 首次出现顺序，GM-snake-23） */
  private colorSlots = new Map<string, number>();
  /** 食物/道具预渲染精灵：按 (类型, 半径) 缓存，避免每帧为每颗画多层圆 */
  private foodSprites = new Map<string, { canvas: HTMLCanvasElement; size: number }>();
  /** 边界内辉光的四条渐变条：null=还没建，undefined=当前环境建不了（无 document） */
  private glowSprites: Record<'left' | 'right' | 'top' | 'bottom', HTMLCanvasElement> | null | undefined = null;
  /** 指针坐标缓存：pointermove 不再每次读 getBoundingClientRect 触发强制布局 */
  private rectCache: { left: number; top: number } | null = null;
  /** DOM UI 层 */
  private ui: SnakeUi | null = null;
  /** UI 脏检查签名：只有内容变化才写 DOM，连续量（位置/透明度）每帧直接写 transform/opacity */
  private hudSig = '';
  private overlaySig = '';
  private boostLabelSig = '';
  private hudPlayersSig = '';
  /** DOM 写入去重器 */
  private dom = new DomWriter();
  /** 当前渲染缩放（DPR 上限）：掉帧时自动下调，恢复后回升 */
  private renderScale = DPR_MAX;
  /** 刘海屏顶部安全区（px）：全屏对局里画布顶边 = 屏幕顶边，DOM 控件要给状态栏/刘海让位 */
  private safeTop = 0;
  /** 上一帧到本帧的间隔（ms）：用来判断是否掉帧 */
  private lastFrameGap = 0;
  /** 连续掉帧 / 连续流畅的帧数（自适应分辨率的迟滞计数） */
  private slowFrames = 0;
  private fastFrames = 0;
  /** 路径裁剪用的复用缓冲：避免每帧新建段数组 */
  private segRanges: number[] = [];
  /** 昵称索引：避免每条蛇每帧都线性查 players */
  private nameMap = new Map<string, string>();
  /** 存活蛇 id 集合（复用，避免每帧新建） */
  private aliveIds = new Set<string>();
  /** 帧率诊断：统计窗口内的帧数 */
  private fpsFrames = 0;
  private fpsSince = 0;
  private fpsText = '';

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
    this.foodSprites.clear();
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
    hudScores.append(hudScore);
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

    // 帧率诊断浮层：URL 带 ?fps=1 才显示，方便在真机上核对帧率/画质档位
    let fps: HTMLDivElement | null = null;
    try {
      if (new URLSearchParams(window.location.search).get('fps') === '1') {
        fps = el('div', 'snake-fps');
        fps.textContent = 'fps --';
        root.appendChild(fps);
      }
    } catch { /* ignore */ }

    parent.appendChild(root);
    this.ui = {
      root, hud, hudMode, hudScore, hudPlayers,
      minimap, minimapDot, boost, boostRing, boostLabel,
      joystick, joyBase, joyKnob, hint, overlay,
      death, deathScore, deathRespawn, deathExit, fps,
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
    this.dpr = Math.min(this.renderScale, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.foodSprites.clear();
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(this.cssW / 900, this.cssH / 720)));
    this.layoutUi();
  }

  /**
   * 自适应分辨率：低端机 / 大屏设备上全屏 canvas 的光栅化是主要开销，
   * 掉帧时把渲染缩放降一档（DPR_MAX → 1.25 → 1.0 → 0.75），
   * 帧率恢复后再逐步升回去。迟滞计数避免来回抖动。
   */
  private checkQuality() {
    const gap = this.lastFrameGap;
    if (gap > FRAME_BUDGET_MS) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (gap > 0 && gap < FRAME_BUDGET_MS - 2) {
      this.fastFrames++;
      this.slowFrames = 0;
    }
    if (this.slowFrames >= DOWNGRADE_FRAMES && this.renderScale > DPR_MIN) {
      this.renderScale = Math.max(DPR_MIN, this.renderScale - 0.25);
      this.slowFrames = 0;
      this.fastFrames = 0;
      this.resize();
    } else if (this.fastFrames >= UPGRADE_FRAMES && this.renderScale < DPR_MAX) {
      this.renderScale = Math.min(DPR_MAX, this.renderScale + 0.25);
      this.fastFrames = 0;
      this.slowFrames = 0;
      this.resize();
    }
  }

  /** DOM 控件的尺寸/位置依赖画布尺寸，resize 时放一次；位置连续变化的部分每帧写 transform */
  private layoutUi() {
    const ui = this.ui;
    if (!ui) return;
    this.measureSafeTop();
    const { boost, joy } = snakeControlsLayout(this.cssW, this.cssH);
    const m = snakeMinimapLayout(this.cssW, this.cssH, this.safeTop);
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
    // 玩家/聊天抽屉要落在小地图下方：把地图底边暴露成 CSS 变量（只在 resize 时写一次）
    document.documentElement.style.setProperty('--snake-minimap-bottom', `${m.y + m.h}px`);
  }

  /**
   * 读一次刘海屏顶部安全区高度。
   * CSS env() 只能在样式里用，这里用一个 height:env(...) 的探针把它量成像素，
   * 免得为了一个数值在 JS 里硬编码机型。resize 时读一次即可，不算热点。
   */
  private measureSafeTop() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;'
      + 'height:env(safe-area-inset-top, 0px);pointer-events:none;visibility:hidden';
    document.body.appendChild(probe);
    this.safeTop = Math.round(probe.getBoundingClientRect().height) || 0;
    probe.remove();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (!this.lastLoopAt) {
      this.lastLoopAt = now;
      this.render();
      return;
    }
    let delta = now - this.lastLoopAt;
    this.lastLoopAt = now;
    // 切后台再回来时不要"补帧"，直接丢掉这一段
    if (delta > 250) delta = TARGET_FRAME_MS;
    this.frameAccum += delta;
    if (this.frameAccum < TARGET_FRAME_MS) return;
    this.frameAccum = Math.max(0, this.frameAccum - TARGET_FRAME_MS);
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
    const m = snakeMinimapLayout(this.cssW, this.cssH, this.safeTop);
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
    this.lastFrameGap = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    this.checkQuality();

    // 每帧重新取视图：本地预测按"距快照经过的时间"前推，必须逐帧算才顺滑
    this.state = this.logic.view();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

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
    for (const s of this.state.snakes) {
      if (s.mine) continue;
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
    // 回收已经离场的蛇：复用同一个 Set（clear + 重新填），避免每帧新建数组/集合
    this.aliveIds.clear();
    for (const s of this.state.snakes) this.aliveIds.add(s.id);
    if (this.disp.size !== this.aliveIds.size) {
      for (const id of [...this.disp.keys()]) if (!this.aliveIds.has(id)) this.disp.delete(id);
    }
  }

  private drawWorld(view: WorldRect) {
    const ctx = this.ctx;
    const { w, h } = this.state;
    const x0 = this.sx(0);
    const y0 = this.sy(0);
    const x1 = this.sx(w);
    const y1 = this.sy(h);

    // 先整屏铺"世界外"底色，再在世界矩形上铺"世界内"底色：
    // 两次填充覆盖全屏，没有重叠区域，比"全屏 + 4 块世界外矩形"少 3 次大面积填充。
    ctx.fillStyle = OUTSIDE;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (x1 > 0 && y1 > 0 && x0 < this.cssW && y0 < this.cssH) {
      ctx.fillStyle = BG;
      ctx.fillRect(
        Math.max(0, x0), Math.max(0, y0),
        Math.min(this.cssW, x1) - Math.max(0, x0),
        Math.min(this.cssH, y1) - Math.max(0, y0),
      );
    }

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

    // 边界内辉光：四面各贴一条"靠墙最亮、向场内渐隐"的渐变条，
    // 让玩家在远处就能看出墙在哪（撞墙即死，得有个明显的危险区提示）。
    // 渐变做成 64px 的小 sprite 一次性缓存，每帧只是 4 次 drawImage，不建 gradient 对象。
    const glow = this.edgeGlowSprites();
    if (glow) {
      const t = Math.max(12, Math.min(30, Math.round(Math.min(this.cssW, this.cssH) * 0.045)));
      const gx0 = Math.max(0, x0);
      const gy0 = Math.max(0, y0);
      const gx1 = Math.min(this.cssW, x1);
      const gy1 = Math.min(this.cssH, y1);
      if (gx1 > gx0 && gy1 > gy0) {
        if (x0 > -t && x0 < this.cssW) ctx.drawImage(glow.left, x0, gy0, t, gy1 - gy0);
        if (x1 > 0 && x1 < this.cssW + t) ctx.drawImage(glow.right, x1 - t, gy0, t, gy1 - gy0);
        if (y0 > -t && y0 < this.cssH) ctx.drawImage(glow.top, gx0, y0, gx1 - gx0, t);
        if (y1 > 0 && y1 < this.cssH + t) ctx.drawImage(glow.bottom, gx0, y1 - t, gx1 - gx0, t);
      }
    }

    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
  }

  /**
   * 边界内辉光用的四条渐变条（左/右/上/下），只在首次绘制时建一次。
   * 每条都是 64px 的单向渐变再按需拉伸：alpha 沿墙的法线方向线性衰减，
   * 拉伸后依然是同一条渐变，与边界长度/厚度无关。
   */
  private edgeGlowSprites() {
    if (this.glowSprites !== null) return this.glowSprites || undefined;
    if (typeof document === 'undefined') {
      this.glowSprites = undefined;
      return undefined;
    }
    const build = (horizontal: boolean, fromOuter: boolean) => {
      const n = 64;
      const c = document.createElement('canvas');
      c.width = horizontal ? n : 1;
      c.height = horizontal ? 1 : n;
      const g = c.getContext('2d');
      if (!g) return c;
      const grad = horizontal ? g.createLinearGradient(0, 0, n, 0) : g.createLinearGradient(0, 0, 0, n);
      const stops: [number, string][] = [
        [0, `rgba(${BORDER_GLOW_RGB},${fromOuter ? 0.52 : 0})`],
        [0.35, `rgba(${BORDER_GLOW_RGB},${fromOuter ? 0.18 : 0.18})`],
        [1, `rgba(${BORDER_GLOW_RGB},${fromOuter ? 0 : 0.52})`],
      ];
      for (const [at, color] of stops) grad.addColorStop(at, color);
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
      return c;
    };
    this.glowSprites = {
      left: build(true, true),
      right: build(true, false),
      top: build(false, true),
      bottom: build(false, false),
    };
    return this.glowSprites;
  }

  /** 食物三层圆只画一次到精灵，之后每帧一次 drawImage */
  private getFoodSprite(kind: number, radius: number): { canvas: HTMLCanvasElement; size: number } | null {
    if (typeof document === 'undefined') return null;
    const key = `${kind}:${radius}`;
    let s = this.foodSprites.get(key);
    if (!s) {
      const built = this.buildFoodSprite(kind, radius);
      if (!built) return null;
      s = built;
      this.foodSprites.set(key, s);
    }
    return s;
  }

  /** 按类型与半径生成精灵：普通食物分三档（越小越暗）、残骸暗红、磁铁/闪电画图标 */
  private buildFoodSprite(kind: number, radius: number): { canvas: HTMLCanvasElement; size: number } | null {
    if (typeof document === 'undefined') return null;
    const r = radius * this.zoom;
    const size = Math.ceil(r * 5.2);
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * this.dpr);
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const mid = size / 2;
    const color = kind === SNAKE_KIND_CORPSE
      ? CORPSE_COLOR
      : (kind === SNAKE_KIND_FOOD ? FOOD_COLORS[foodTierIndex(radius)] : (ITEM_COLORS[kind] || FOOD_COLORS[0]));

    // 光晕
    g.beginPath();
    g.arc(mid, mid, r * 2.1, 0, TAU);
    g.fillStyle = withAlpha(color, 0.12);
    g.fill();
    // 主体
    g.beginPath();
    g.arc(mid, mid, r, 0, TAU);
    g.fillStyle = color;
    g.fill();

    if (kind === SNAKE_KIND_MAGNET) {
      // 马蹄形磁铁：白色 U 形 + 两个极
      g.strokeStyle = '#e2e8f0';
      g.lineWidth = Math.max(1.5, r * 0.26);
      g.beginPath();
      g.arc(mid, mid + r * 0.12, r * 0.6, Math.PI, 0);
      g.stroke();
      g.fillStyle = '#e2e8f0';
      g.fillRect(mid - r * 0.6, mid + r * 0.12, r * 0.24, r * 0.4);
      g.fillRect(mid + r * 0.36, mid + r * 0.12, r * 0.24, r * 0.4);
    } else if (kind === SNAKE_KIND_LIGHTNING) {
      // 闪电符号
      g.fillStyle = '#1f2937';
      g.beginPath();
      g.moveTo(mid + r * 0.16, mid - r * 0.72);
      g.lineTo(mid - r * 0.34, mid + r * 0.06);
      g.lineTo(mid - r * 0.02, mid + r * 0.06);
      g.lineTo(mid - r * 0.2, mid + r * 0.76);
      g.lineTo(mid + r * 0.34, mid - r * 0.1);
      g.lineTo(mid + r * 0.02, mid - r * 0.1);
      g.closePath();
      g.fill();
    } else {
      // 食物 / 残骸：高光
      g.beginPath();
      g.arc(mid - r * 0.28, mid - r * 0.28, r * 0.32, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
    }
    return { canvas: c, size };
  }

  private drawFood(now: number, view: WorldRect) {
    const ctx = this.ctx;
    // 普通食物轻微脉动，道具脉动更明显（要一眼看见）
    const foodPulse = 1 + 0.05 * (0.5 + 0.5 * Math.sin(now / 300));
    const itemPulse = 1 + 0.12 * (0.5 + 0.5 * Math.sin(now / 220));
    for (const f of this.state.food) {
      const sprite = this.getFoodSprite(f.k, f.r);
      if (!sprite) continue;
      const rr = f.r * this.zoom;
      if (f.x < view.x0 - rr || f.x > view.x1 + rr || f.y < view.y0 - rr || f.y > view.y1 + rr) continue;
      const isItem = f.k === SNAKE_KIND_MAGNET || f.k === SNAKE_KIND_LIGHTNING;
      const size = sprite.size * (isItem ? itemPulse : foodPulse);
      const half = size / 2;
      ctx.drawImage(sprite.canvas, this.sx(f.x) - half, this.sy(f.y) - half, size, size);
    }
  }

  /** 刷新配色槽位：按玩家 id 首次出现顺序分配，已有 id 保留原槽位（GM-snake-23） */
  private syncColorSlots() {
    snakeColorSlots(this.colorSlots, this.state.snakes.map(s => s.id));
  }

  /** 取色：团队按队伍，无尽按玩家固定槽位（蛇身与榜单圆点共用，GM-snake-23） */
  private colorOf(snake: SnakeView['snakes'][number]): string {
    if (snake.team) {
      return TEAM_COLORS[snake.team]
        || TEAM_FALLBACK_COLORS[teamColorIndex(snake.team) % TEAM_FALLBACK_COLORS.length];
    }
    const slot = this.colorSlots.get(snake.id) ?? 0;
    return SNAKE_COLORS[slot % SNAKE_COLORS.length];
  }

  private drawSnakes(now: number, view: WorldRect) {
    const ctx = this.ctx;
    const radius = this.state.radius * this.zoom;
    const margin = radius / this.zoom * 2;

    // 昵称索引：避免每条蛇每帧线性查 players
    this.nameMap.clear();
    for (const p of this.state.players) this.nameMap.set(p.id, p.nickname);

    // 配色槽位每帧刷新一次：按玩家 id 首次出现顺序，别人离场不会让自己的颜色变
    this.syncColorSlots();

    this.state.snakes.forEach((snake) => {
      // 死掉的蛇直接不画：死亡瞬间身体已经沿路径变成了残骸食物，
      // 再叠一层半透明的旧蛇身就是"残影"（残骸和尸体两条形状重叠，看着像没死透）。
      if (!snake.alive) return;
      // 团队模式按队伍取色（队友同色），无尽模式按玩家固定槽位取色
      const color = this.colorOf(snake);
      const disp = snake.mine ? null : this.disp.get(snake.id);
      const pts = disp ? disp.pts : snake.pts;
      if (!pts.length) return;

      const segCount = clipSnakeSegmentRanges(pts, {
        x0: view.x0 - margin, y0: view.y0 - margin,
        x1: view.x1 + margin, y1: view.y1 + margin,
      }, this.segRanges);
      if (!segCount) return;

      const head = pts[0];
      const hx = this.sx(head[0]);
      const hy = this.sy(head[1]);
      const headVisible = head[0] >= view.x0 - margin && head[0] <= view.x1 + margin
        && head[1] >= view.y0 - margin && head[1] <= view.y1 + margin
        && hx > -radius * 3 && hx < this.cssW + radius * 3
        && hy > -radius * 3 && hy < this.cssH + radius * 3;

      ctx.beginPath();
      for (let s = 0; s < segCount; s++) {
        const from = Math.max(0, this.segRanges[s * 2] - 1);
        const to = Math.min(pts.length - 1, this.segRanges[s * 2 + 1] + 1);
        if (to <= from) continue;
        ctx.moveTo(this.sx(pts[from][0]), this.sy(pts[from][1]));
        for (let i = from + 1; i <= to; i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.38)';
      ctx.lineWidth = radius * 2 + Math.max(2, radius * 0.32);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = radius * 2;
      ctx.stroke();
      // 高光只给玩家自己那条：远端蛇省掉一整遍宽描边（多人局里这是笔不小的光栅开销）
      if (snake.mine) {
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = radius * 0.8;
        ctx.stroke();
      }

      if (headVisible && snake.boosting && snake.alive) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        for (let i = 1; i < Math.min(pts.length, 6); i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(125,211,252,0.35)';
        ctx.lineWidth = radius * 2.6;
        ctx.stroke();
      }

      // 磁铁：蛇头外圈画吸附范围提示
      if (headVisible && snake.magnet > 0 && snake.alive) {
        ctx.beginPath();
        ctx.arc(hx, hy, SNAKE_MAGNET_RADIUS * this.zoom, 0, TAU);
        ctx.strokeStyle = 'rgba(96,165,250,0.30)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 闪电：黄色加速拖尾
      if (headVisible && snake.lightning > 0 && snake.alive) {
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        for (let i = 1; i < Math.min(pts.length, 6); i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(251,191,36,0.32)';
        ctx.lineWidth = radius * 2.4;
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
          const name = this.nameMap.get(snake.id);
          if (name) {
            // 团队模式：名字前面挂队伍标签，方便一眼分清敌我
            const label = snake.team ? `[${snake.team}] ${name}` : name;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = 'rgba(10,10,18,0.55)';
            ctx.fillText(label, hx, hy - radius * 1.5 + 1);
            ctx.fillStyle = snake.team ? color : 'rgba(226,232,248,0.75)';
            ctx.fillText(label, hx, hy - radius * 1.5);
            ctx.textAlign = 'left';
          }
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // ===== DOM UI 同步（同一个 rAF 内；所有写入都做去重，值没变就不碰 DOM） =====
  private syncUi(now: number) {
    const ui = this.ui;
    if (!ui) return;
    const s = this.state;
    const showControls = s.status === 'playing' && !s.awaiting && s.alive;

    // --- HUD 文本：脏检查 ---
    // 标题只留「排行榜」（不再拼玩法名），也不显示本玩家最高分（GM-snake-21）
    const hudSig = String(s.score);
    if (hudSig !== this.hudSig) {
      ui.hudMode.textContent = '🏆 排行榜';
      ui.hudScore.textContent = String(s.score);
      this.hudSig = hudSig;
    }
    // 排行榜签名：按分数排序后取前 10（分数/生死/名字任一变化才重建 DOM）
    const top = s.snakes.length > 1 ? rankTopSnakes(s.snakes, 10) : [];
    const playersSig = top
      .map(({ snake }) => {
        const name = s.players.find(p => p.id === snake.id)?.nickname || '';
        return `${snake.id}:${name}:${snake.score}:${snake.alive ? 1 : 0}`;
      }).join('|');
    if (playersSig !== this.hudPlayersSig) {
      this.renderPlayers(ui.hudPlayers, s);
      this.hudPlayersSig = playersSig;
    }

    // --- 小地图：只标自己，白点位置变了才写 transform ---
    const showMap = !!s.w && !!s.h && s.status !== 'waiting';
    this.dom.style(ui.minimap, 'display', showMap ? '' : 'none');
    if (showMap) {
      const me = s.snakes.find(snake => snake.mine);
      const m = snakeMinimapLayout(this.cssW, this.cssH, this.safeTop);
      if (me && m.w > 12 && m.h > 12) {
        const [px, py] = snakeMinimapSelfPoint(this.cssW, this.cssH, s.w, s.h, me.x, me.y, this.safeTop);
        // 白点绝对定位在 minimap 容器内：换算成容器内的相对偏移（snakeMinimapSelfPoint 已含 6px 内边距）
        // 量化到 0.5px：肉眼无差别，但能少写很多次 transform
        const dx = Math.round((px - m.x) * 2) / 2;
        const dy = Math.round((py - m.y) * 2) / 2;
        this.dom.style(ui.minimapDot, 'transform', `translate(${dx}px, ${dy}px) translate(-50%, -50%)`);
        this.dom.style(ui.minimapDot, 'display', '');
      } else {
        this.dom.style(ui.minimapDot, 'display', 'none');
      }
    }

    // --- 加速按钮：冷却环用 conic-gradient，量化到 2° 且只在变化时写 ---
    this.dom.style(ui.boost, 'display', showControls ? '' : 'none');
    if (showControls) {
      const cd = s.boostCd;
      const ready = cd <= 0;
      const ratio = ready ? 0 : Math.max(0, Math.min(1, cd / SNAKE_BOOST_CD_MS));
      this.dom.cls(ui.boost, 'ready', ready);
      this.dom.cls(ui.boost, 'boosting', !!s.boosting);
      // conic-gradient 字符串每帧重写会触发一次样式重算 + 重绘，量化到 2° 再去重
      const deg = ready ? 0 : Math.round((1 - ratio) * 360 / 2) * 2;
      this.dom.style(ui.boostRing, 'background', ready
        ? 'rgba(56,189,248,0.22)'
        : `conic-gradient(rgba(56,189,248,0.55) ${deg}deg, rgba(24,24,36,0.82) 0deg)`);
      const label = ready ? '加速' : (cd >= 10_000 ? String(Math.ceil(cd / 1000)) : (cd / 1000).toFixed(1));
      if (label !== this.boostLabelSig) {
        ui.boostLabel.textContent = label;
        this.boostLabelSig = label;
      }
    }

    // --- 摇杆：手柄只由 joyKnob（手指输入）决定；松手回中，绝不镜像蛇朝向 ---
    this.dom.style(ui.joystick, 'display', showControls ? '' : 'none');
    if (showControls) {
      // 没在拖动时手柄停在圆心（写一次即可，靠 CSS transition 平滑回中）；
      // 拖动时才每帧跟随手指。
      const j = this.joystick();
      if (this.joyKnob) {
        const off = joystickKnobOffset(j, this.joyKnob);
        this.dom.style(ui.joyKnob, 'transform', `translate(${(j.r + off.dx).toFixed(1)}px, ${(j.r + off.dy).toFixed(1)}px) translate(-50%, -50%)`);
      } else {
        this.dom.style(ui.joyKnob, 'transform', `translate(${j.r}px, ${j.r}px) translate(-50%, -50%)`);
      }
      this.dom.cls(ui.joystick, 'active', this.joyPointerId !== null && this.touchLocked);
    } else if (this.joyPointerId !== null) {
      // 死亡瞬间松开输入，避免复活后手柄卡在旧位置
      this.deathReset();
    }

    // --- 开场提示：7s 淡出（透明度量化到 0.05，变化时才写） ---
    if (s.status === 'playing' && s.alive) {
      const age = now - this.startedAt;
      const alpha = age > 7000 ? 0 : (age < 5500 ? 1 : Math.max(0, 1 - (age - 5500) / 1500));
      const q = Math.round(alpha * 20) / 20;
      this.dom.style(ui.hint, 'opacity', q.toFixed(2));
      this.dom.style(ui.hint, 'display', q > 0 ? '' : 'none');
    } else {
      this.dom.style(ui.hint, 'display', 'none');
    }

    // --- 中央提示 / 死亡卡片：按状态签名切换 ---
    this.syncOverlay(ui, s, now);

    // --- 帧率诊断（?fps=1 才显示）：fps / 帧耗时 / 当前画质档位 ---
    if (ui.fps) {
      this.fpsFrames++;
      if (!this.fpsSince) this.fpsSince = now;
      const span = now - this.fpsSince;
      if (span >= 500) {
        const fps = Math.round(this.fpsFrames * 1000 / span);
        const text = `fps ${fps} · ${this.lastFrameGap.toFixed(1)}ms · 画质 ${this.renderScale.toFixed(2)}x`;
        if (text !== this.fpsText) {
          this.fpsText = text;
          ui.fps.textContent = text;
        }
        this.fpsFrames = 0;
        this.fpsSince = now;
      }
    }
  }

  private renderPlayers(container: HTMLDivElement, s: SnakeView) {
    container.replaceChildren();
    if (s.snakes.length <= 1) return;
    // 排行榜：按分数从高到低取前 10 名（自己一定在里面 —— 否则看不到自己的名次）
    this.syncColorSlots();
    const top = rankTopSnakes(s.snakes, 10);
    top.forEach(({ snake, rank }, i) => {
      const row = document.createElement('div');
      row.className = 'snake-player-row'
        + (snake.mine ? ' me' : '')
        + (snake.alive ? '' : ' dead');
      const rankEl = document.createElement('span');
      rankEl.className = 'snake-player-rank';
      rankEl.textContent = String(rank);
      const dot = document.createElement('span');
      dot.className = 'snake-player-dot';
      // 圆点用玩家固定色槽（与蛇身同色）：按名次取色会让人一死就变色
      dot.style.background = this.colorOf(snake);
      const name = document.createElement('span');
      name.className = 'snake-player-name' + (snake.mine ? ' me' : '');
      const raw = s.players.find(p => p.id === snake.id)?.nickname || `玩家${i + 1}`;
      // 团队模式：名字前挂队伍标签
      name.textContent = snake.team
        ? `${snake.team}·${raw.length > 7 ? `${raw.slice(0, 7)}…` : raw}`
        : (raw.length > 8 ? `${raw.slice(0, 8)}…` : raw);
      const score = document.createElement('span');
      score.className = 'snake-player-score';
      // 死掉的蛇照样显示分数（死亡瞬间已结算上榜），不再写"等待重生"：
      // 那样一旦有人/人机离场后没被清掉，榜单上会永远挂一行等待重生的僵尸条目。
      score.textContent = String(snake.score);
      row.append(rankEl, dot, name, score);
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
      if (s.variant === 'team') {
        const winner = s.snakes.find(x => x.id === s.winner);
        const name = winner ? (s.players.find(p => p.id === winner.id)?.nickname || '玩家') : '';
        const team = winner?.team || '';
        title = name ? `${team ? team + ' ' : ''}${name} 获胜` : '平局';
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
      // 文字必须写在胶囊元素里：原来是裸文本节点（flex item 落在 y=0），
      // 胶囊却是 top:16px 的伪元素 → 文字在框外（GM-snake-22）
      const tip = document.createElement('div');
      tip.className = 'snake-invincible-tip';
      tip.textContent = sub;
      ui.overlay.appendChild(tip);
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
