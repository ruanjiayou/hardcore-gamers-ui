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
  SNAKE_KIND_CORPSE,
  SNAKE_KIND_FOOD,
  SNAKE_KIND_MAGNET,
  SNAKE_KIND_STAR,
  SNAKE_ITEM_KEYS,
  type SnakeView,
  normalizeAngle,
} from './Logic';
import { assetAltImage, assetHeadImage, assetImage, assetTailImage, defaultSkinAsset, equippedAsset, foodAssetId, itemAssetId, skinAccent, skinIsRound, skinTile } from '../../services/assets';
import { drawSnakeHead } from './head';
import {
  TAIL_SPAN,
  bodyBand,
  bodySegments,
  skinCell,
  tailPose,
  trimTail,
  type SkinCell,
} from './skin';

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
/**
 * buff 徽标里的三个回退图标（`GM-snake-46`：只留图标，不写文案）。
 * `GM-snake-50` 统一加 `snake-buff-icon` 类：`.snake-buff svg` 这种后代选择器
 * 会把倒计时环那层 `<svg>` 也命中，一改尺寸环就跟着变形。
 */
const BUFF_ICONS = {
  boost: '<svg class="snake-buff-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 2 5.4 13.4h4.5L8.9 22l8.2-11.4h-4.5L13.6 2Z" fill="currentColor"/></svg>',
  // GM-snake-51：与 items/magnet.svg 对齐 —— 左蓝右红、两腿末端灰白磁极
  magnet: '<svg class="snake-buff-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<defs><linearGradient id="snake-magnet-half" x1="0" y1="0" x2="1" y2="0">'
    + '<stop offset="0.5" stop-color="#3b82f6"/><stop offset="0.5" stop-color="#ef4444"/>'
    + '</linearGradient></defs>'
    + '<path d="M6 21V11a6 6 0 0 1 12 0v10" fill="none" stroke="url(#snake-magnet-half)" stroke-width="5"/>'
    + '<rect x="3.5" y="18" width="5" height="3" fill="#e2e8f0"/>'
    + '<rect x="15.5" y="18" width="5" height="3" fill="#e2e8f0"/></svg>',
  // GM-snake-51：描边（线框）类型，不再实心填充
  star: '<svg class="snake-buff-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.4l2.96 6 6.64.97-4.8 4.68 1.13 6.6L12 17.55 6.07 20.65l1.13-6.6-4.8-4.68 6.64-.97L12 2.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
} as const;

/** 无敌护盾：出生保护与星星道具**同一套**边色（GM-snake-46） */
const SHIELD_RGB = '96,165,250';
/**
 * 头圈在「头本体」之外再外扩的**固定屏幕像素**（`GM-snake-48/49`）。
 *
 * 护盾只罩蛇头（用户口径：`GM-snake-49` 从整身 AABB 改回只加在头部），
 * 半径 = `身半径 × 1.5`（包住 2.3R 宽的头图，还留出一圈呼吸位 —— `GM-snake-50` 从 1.25 放大）
 * + 这个固定像素。
 * 固定像素而不是「按身宽比例」：手机竖屏 zoom 大时按比例会胖出一大圈，拉远了又贴太紧。
 */
const SHIELD_PAD_PX = 8;
/** 尸体残骸：暗灰红 */
const CORPSE_COLOR = '#9b6b6b';
/** 道具配色：磁铁（蓝）、星星（黄） */
const ITEM_COLORS: Record<number, string> = {
  [SNAKE_KIND_MAGNET]: '#60a5fa',
  [SNAKE_KIND_STAR]: '#fbbf24',
};
const SNAKE_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399'];
/**
 * 皮肤资源查找：manifest 里 `food` / `items` 是「档位/道具 key → asset_id」，
 * 拿到 asset_id 再取已预解码的图。**不是**用 `food.small` 这种字符串，
 * 因为同一个 key 在不同资源包里指向不同资源，只有 id 唯一。
 * 取不到图就回退矢量绘制，画面不会缺口。
 */
const GAME_SLUG = 'snake';
const FOOD_TIERS = ['small', 'mid', 'big'] as const;
/**
 * 食物档位：直接读服务端下发的 tier（0 小 / 1 中 / 2 大）。
 * 档位由服务端判定后随快照下发 —— 客户端不再按 radius 反推，
 * 两端各写一套阈值必然漂移（服务端半径 6/12/18，客户端曾按 10/7 反推，中档被贴成大档）。
 */
function foodTierIndex(tier: number | undefined): number {
  if (tier === 1) return 1;
  if (tier === 2) return 2;
  return 0;
}
function foodTierOf(tier: number | undefined): string {
  return FOOD_TIERS[foodTierIndex(tier)] || 'small';
}
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

/** #rrggbb → 与白色混合 `t`（0..1）后的颜色（用于头部高光） */
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
/**
 * 贴边时允许镜头越过世界边界的余量（世界像素）。
 *
 * 需求：「靠近边界时，边界不要紧贴屏幕，允许边界离屏幕有一定距离」——
 * 之前 clampCam 把视野死死钳在世界内，蛇贴墙时墙线正好压在屏幕边缘，
 * 加上小地图/排行榜都盖在屏幕角上，墙的死亡区几乎看不见。
 * 现在允许镜头多探出去一段，墙线就落在屏幕内侧，危险区可见。
 */
const CAM_EDGE_OVERSCAN = 220;
/** 局部绘制窗口相对视口的外扩比例：留出提前量，镜头滚动时不会露出突兀的断头 */
const VIEW_MARGIN = 0.2;
/** 高分屏上限：手机 3x DPI 下 2x 全屏填充很贵，1.5x 对高速运动画面足够清晰 */
const DPR_MAX = 1.5;
/**
 * 自适应分辨率下限：**不能低于 1.0**。
 *
 * 之前是 0.75：canvas 位图只有 CSS 显示尺寸的 0.75 倍，浏览器只能拉伸插值
 * → 画面被拉糊。而自适应是"只降不升"的（掉帧 45 帧降 0.25，升档要 180 帧），
 * 于是一局玩下来画质一路掉到 0.75，手机端就**越玩越糊**。
 * 下限锁到 1.0 = 位图永远不小于显示尺寸，最差也只是"不够锐"，不会"糊"。
 */
const DPR_MIN = 1;
/** 帧间隔超过这个值算"掉帧"（60fps 预算 16.7ms，留 20% 余量） */
const FRAME_BUDGET_MS = 20;
/** 连续掉帧多少帧才降档（避免偶发抖动就降画质） */
const DOWNGRADE_FRAMES = 45;
/**
 * 连续流畅多少帧才升档。
 * 之前是 180（3 秒）—— 降档快、升档慢，越玩越糊。
 * 现在 60 帧（1 秒）就升回去，掉一次档很快能恢复。
 */
const UPGRADE_FRAMES = 60;

/**
 * 目标渲染帧间隔（ms）：约 60fps。
 * 120Hz 屏幕上按这个间隔只画一半的帧 —— 游戏本身是 60fps 节奏，
 * 多画的那一半只会把 GPU/合成开销翻倍（移动端尤其明显），观感没有区别。
 */
const TARGET_FRAME_MS = 15.5;
const TAU = Math.PI * 2;

/**
 * 画质档位（纯函数）：掉帧降一档、流畅升一档。
 *
 * 关键约束：**永远不低于 1.0**。低于 1.0 时 canvas 位图比 CSS 显示尺寸小，
 * 浏览器只能拉伸插值 → 画面变糊（手机上尤其明显）。
 */
export function snakeRenderScale(scale: number, slowFrames: number, fastFrames: number): number {
  if (slowFrames >= DOWNGRADE_FRAMES && scale > DPR_MIN) return Math.max(DPR_MIN, scale - 0.25);
  if (fastFrames >= UPGRADE_FRAMES && scale < DPR_MAX) return Math.min(DPR_MAX, scale + 0.25);
  return scale;
}

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
  // GM-snake-46：关闭键删掉后右上角整排按钮不再占位，小地图直接顶到顶部，
  // 只和安全区留 10px（原来为了躲关闭键要往下让 60px，一半屏幕高度被地图吃掉）
  return { x: Math.max(12, cssW - w - 12), y: topInset + 10, w, h };
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
  /** 排行榜下方的 buff 条（加速 / 磁吸 / 无敌） */
  buffs: HTMLDivElement;
  minimap: HTMLDivElement;
  minimapDot: HTMLDivElement;
  boost: HTMLDivElement;
  boostRing: HTMLDivElement;
  /** 闪电图标（SVG）：按钮上不显示文字 */
  boostIcon: SVGSVGElement;
  joystick: HTMLDivElement;
  joyBase: HTMLDivElement;
  joyKnob: HTMLDivElement;
  hint: HTMLDivElement;
  overlay: HTMLDivElement;
  death: HTMLDivElement;
  deathScore: HTMLDivElement;
  /** 弹框底部提示（"\u5206\u6570\u5df2\u8bb0\u5165\u6392\u884c\u699c"） */
  deathNote: HTMLDivElement;
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
  /** buff 徽标里的道具图标（`GM-snake-49`）：与地图道具同一套画法，按 kind+皮肤缓存 */
  private buffIcons = new Map<string, HTMLCanvasElement>();
  /**
   * 头圈护盾的**出现系数**（0~1，`GM-snake-49`）：只有半径需要过渡，圆心就是蛇头。
   *
   * 圆心不再平滑：圈跟着头走，一旦滞后就会拖在头后面（快速移动 / 加速时最明显）。
   * 半径从 0.2 撑到 1（τ=60ms），生效瞬间是「圈从头上扩散出来」而不是凭空出现。
   */
  private shieldScales = new Map<string, number>();
  /** 上一次看到的重生计数：变了说明整条蛇瞬移，镜头要直接对齐（-1 = 还没见过） */
  private lastRespawns = -1;
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
  /** 按住加速的 pointerId（松手/取消时收到同一个 id 才停） */
  private boostPointerId: number | null = null;
  private hudPlayersSig = '';
  /** buff 条的**结构**签名（哪几个 buff 亮着）：只有它变了才重建 DOM */
  private buffKey = '';
  /** buff 徽标缓存：倒计时每帧只改属性，不重建元素 */
  private buffChips = new Map<string, HTMLSpanElement>();
  /** 倒计时环里那根进度弧（`GM-snake-50` SVG 方案）：每帧只改 stroke-dashoffset */
  private buffBars = new Map<string, SVGCircleElement>();
  /**
   * buff 满值（剩余时间见过的最大值）—— 倒计时环 100% 的基准。
   *
   * 时长由服务端道具规则决定（磁吸 9s / 无敌 4s），客户端不硬编码一份：
   * 看到 buff 的第一帧剩余量就是满值；中途又吃一个续上更长的，基准自动抬高、环回满。
   * buff 消失时清零，下一轮重新起算（`GM-snake-48`）。
   */
  private buffPeak: Record<'magnet' | 'star', number> = { magnet: 0, star: 0 };
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

  private onKey = (e: KeyboardEvent) => {
    this.handleKey(e);
  };
  /**
   * 键盘松手：加速是「按住」语义，keydown 加速、keyup 必须减速。
   * 之前只监听 keydown，松手没有任何处理 → 按下加速后就一直加速，
   * 直到身长耗尽或死亡。
   */
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.key === 'Shift') this.logic.setBoost(false);
  };
  /** 切窗口 / 失焦：强制释放加速，避免回来时蛇还在全速跑 */
  private onBlur = () => this.logic.setBoost(false);
  private onResize = () => this.resize();
  private onCanvasDown = (e: PointerEvent) => this.handleCanvasDown(e);
  private onCanvasMove = (e: PointerEvent) => this.handleCanvasMove(e);
  private onContextMenu = (e: Event) => e.preventDefault();

  private onJoyDown = (e: PointerEvent) => this.handleJoyDown(e);
  private onJoyMove = (e: PointerEvent) => this.handleJoyMove(e);
  private onJoyUp = (e: PointerEvent) => this.handleJoyUp(e);
  private onBoostDown = (e: PointerEvent) => this.handleBoostDown(e);
  private onBoostUp = (e: PointerEvent) => this.handleBoostUp(e);

  constructor(canvas: HTMLCanvasElement, logic: LogicSnake) {
    this.canvas = canvas;
    this.logic = logic;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.state = logic.view();
    logic.on('state', (s: SnakeView) => { this.state = s; });
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
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
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
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
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
    this.shieldScales.clear();
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
    // 顶部显示**全游戏今日最高分**（GM-snake-46）：玩家自己的分数在下面的榜单里，
    // 顶部留一个「今天最高到过多少」的目标值。
    const hudBestLabel = el('span', 'snake-hud-best-label');
    hudBestLabel.textContent = '今日最高';
    const hudScore = el('span', 'snake-hud-score');
    hudScores.append(hudBestLabel, hudScore);
    const hudPlayers = el('div', 'snake-hud-players');
    // buff 状态条（GM-snake-45）：加速 / 磁吸 / 无敌 改成排行榜下方的文字牌，
    // 不再在蛇身上叠半透明光环（那东西在深色地图上反而看不清，还挡蛇头）
    const buffs = el('div', 'snake-buffs');
    hud.append(hudMode, hudScores, hudPlayers, buffs);

    const minimap = el('div', 'snake-minimap');
    const minimapDot = el('div', 'snake-minimap-dot');
    minimap.appendChild(minimapDot);

    const boost = el('div', 'snake-boost');
    const boostRing = el('div', 'snake-boost-ring');
    const boostIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    boostIcon.setAttribute('viewBox', '0 0 24 24');
    boostIcon.setAttribute('class', 'snake-boost-icon');
    boostIcon.setAttribute('aria-hidden', 'true');
    // 闪电：上尖下宽的折线形，填充用 currentColor 跟随按钮状态色
    const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bolt.setAttribute('d', 'M13.4 2 5.6 13.1h4.3L9.4 22l8.2-11.4h-4.6L13.4 2Z');
    bolt.setAttribute('fill', 'currentColor');
    boostIcon.appendChild(bolt);
    boost.append(boostRing, boostIcon);

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
      root, hud, hudMode, hudScore, hudPlayers, buffs,
      minimap, minimapDot, boost, boostRing, boostIcon,
      joystick, joyBase, joyKnob, hint, overlay,
      death, deathScore, deathNote, deathRespawn, deathExit, fps,
    };

    joystick.addEventListener('pointerdown', this.onJoyDown);
    joystick.addEventListener('pointermove', this.onJoyMove);
    joystick.addEventListener('pointerup', this.onJoyUp);
    joystick.addEventListener('pointercancel', this.onJoyUp);
    joystick.addEventListener('pointerleave', this.onJoyUp);
    boost.addEventListener('pointerdown', this.onBoostDown);
    boost.addEventListener('pointerup', this.onBoostUp);
    boost.addEventListener('pointercancel', this.onBoostUp);
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
   * 掉帧时把渲染缩放降一档（DPR_MAX 1.5 → 1.25 → 1.0），
   * 帧率恢复后再逐步升回去。迟滞计数避免来回抖动。
   *
   * 下限是 1.0：位图永远不小于 CSS 显示尺寸（不然就是拉伸插值的"糊"）。
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
    const next = snakeRenderScale(this.renderScale, this.slowFrames, this.fastFrames);
    if (next !== this.renderScale) {
      this.renderScale = next;
      this.slowFrames = 0;
      this.fastFrames = 0;
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
      // 按住生效：keydown 加速、keyup（onKeyUp）减速。
      // 键盘自动重复会多次触发 keydown，Logic.setBoost 内部按值去重，不会重复发包。
      this.logic.setBoost(true);
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

  /** 加速键：按下即加速，松开（或指针离开/取消）立即停 —— 无 CD */
  private handleBoostDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.boostPointerId = e.pointerId;
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    this.logic.setBoost(true);
  }

  private handleBoostUp(e: PointerEvent) {
    if (this.boostPointerId !== null && e.pointerId !== this.boostPointerId) return;
    this.boostPointerId = null;
    this.logic.setBoost(false);
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

    // 每帧重新取视图：本地预测按"距快照经过的时间"前推，必须逐帧算才顺滑。
    // 快照在 view() 里消化（GM-snake-49：socket 回调只登记、不处理），
    // 所以「重生」的检测也放到这里 —— `on('state')` 不再逐帧触发。
    this.state = this.logic.view();
    const meNow = this.state.snakes.find(x => x.mine);
    const respawnsNow = meNow?.respawns ?? 0;
    if (meNow && this.lastRespawns >= 0 && respawnsNow !== this.lastRespawns) this.camInited = false;
    this.lastRespawns = respawnsNow;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.updateCamera(dt);
    this.smoothRemote(dt);

    const view = snakeViewport(
      this.cam, this.cssW, this.cssH, this.zoom,
      this.state.w, this.state.h, VIEW_MARGIN,
    );
    this.drawWorld(view);
    this.drawFood(now, view);
    this.drawSnakes(now, view, dt);

    // UI 在同一个 rAF 里更新：连续量每帧写 transform/opacity，静态内容按脏检查写
    this.syncUi(now);
  }

  /**
   * 把镜头中心钳在"视野不越出世界太多"的范围内。
   *
   * 与旧版的区别：允许越过边界 CAM_EDGE_OVERSCAN 个世界像素。
   * 蛇贴墙时墙线会落在屏幕内侧而不是压在屏幕边缘上，
   * 小地图和排行榜盖住的部分就少了，红色死亡区也看得见。
   */
  private clampCam(p: Camera): Camera {
    const halfW = this.cssW / (2 * this.zoom);
    const halfH = this.cssH / (2 * this.zoom);
    const { w, h } = this.state;
    // 余量按视野比例封顶：小屏上不能探太多出去，否则蛇离墙太远反而不直观
    const over = Math.min(CAM_EDGE_OVERSCAN, halfW * 0.4, halfH * 0.4);
    const minX = halfW - over;
    const maxX = w - halfW + over;
    const minY = halfH - over;
    const maxY = h - halfH + over;
    // 世界比视野（含余量）还小的时候居中，不做钳制
    const x = minX >= maxX ? w / 2 : Math.min(Math.max(p.x, minX), maxX);
    const y = minY >= maxY ? h / 2 : Math.min(Math.max(p.y, minY), maxY);
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

  /**
   * 远端蛇：蛇头位置与朝向做缓动（20Hz → 60fps 更顺滑）。
   *
   * **身体折线不再在这里插值** —— Logic 层已经为远端蛇维护了连续的本地路径
   * （每帧自己往前推，尾巴贴着身体连续滑动）。若这里再按点索引向快照目标
   * 插值，会把这层连续性抹掉，尾巴又变成"每 50ms 跳一格"。
   */
  private smoothRemote(dt: number) {
    const k = Math.min(1, dt / SMOOTH_LAG);
    for (const s of this.state.snakes) {
      if (s.mine) continue;
      const cur = this.disp.get(s.id);
      if (!cur) {
        this.disp.set(s.id, { x: s.x, y: s.y, angle: s.angle, pts: s.pts.map(p => [p[0], p[1]] as [number, number]) });
        continue;
      }
      if (!s.alive) continue;
      cur.x += (s.x - cur.x) * k;
      cur.y += (s.y - cur.y) * k;
      cur.angle = cur.angle + shortestArc(cur.angle, s.angle) * k;
      // 身体：直接采用 Logic 给的连续路径。
      // 点数会随本地路径推进而变，所以按长度重建会让整条蛇每帧闪一下 ——
      // 这里改成"就地复用数组、长度变了就补齐/截断"。
      const pts = cur.pts;
      const n = Math.min(pts.length, s.pts.length);
      for (let i = 0; i < n; i++) {
        pts[i][0] = s.pts[i][0];
        pts[i][1] = s.pts[i][1];
      }
      if (pts.length < s.pts.length) {
        for (let i = pts.length; i < s.pts.length; i++) pts.push([s.pts[i][0], s.pts[i][1]]);
      } else if (pts.length > s.pts.length) {
        pts.length = s.pts.length;
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
  private getFoodSprite(kind: number, radius: number, tier: number): { canvas: HTMLCanvasElement; size: number } | null {
    if (typeof document === 'undefined') return null;
    const assetId = this.foodAssetOf(kind, tier);
    // 换主题（asset_id 变）后缓存键跟着变，不用手动清缓存
    const key = `${kind}:${radius}:${tier}:${assetId || '-'}`;
    let s = this.foodSprites.get(key);
    if (!s) {
      const built = this.buildFoodSprite(kind, radius, tier, assetId);
      if (!built) return null;
      s = built;
      this.foodSprites.set(key, s);
    }
    return s;
  }

  /** 该拾取物对应的皮肤资源 id；没有配图返回 ''（走矢量绘制） */
  private foodAssetOf(kind: number, tier: number): string {
    if (kind === SNAKE_KIND_CORPSE) return equippedAsset(GAME_SLUG, 'corpse');
    if (kind === SNAKE_KIND_FOOD) return foodAssetId(GAME_SLUG, foodTierOf(tier));
    const key = SNAKE_ITEM_KEYS[kind];
    return key ? itemAssetId(GAME_SLUG, key) : '';
  }

  /** 皮肤图（已预加载）；未加载/不存在时返回 null */
  private skinImage(assetId: string | null | undefined): HTMLImageElement | null {
    return assetId ? assetImage(GAME_SLUG, assetId) : null;
  }

  /**
   * 按类型与档位生成精灵：普通食物分三档（越小越暗）、残骸暗红、磁铁/星星画图标。
   * 资源包给了皮肤图就直接贴图（光晕仍按配色画，保证大小/脉动/占位一致）。
   */
  private buildFoodSprite(
    kind: number,
    radius: number,
    tier: number,
    assetId: string | null = null,
    /** 半径的倍率：地图上跟 zoom 走；buff 徽标里固定 1（与缩放无关） */
    scale = this.zoom,
    /**
     * 紧凑画布（`GM-snake-50`）：只留图形本身那一点边，不带脉动余量。
     *
     * 地图上要 3.1r，是因为道具会按 `itemPulse` 放大到 1.12 倍，画布不留余量会切边。
     * 徽标里的图标是静态的，留那圈空白等于把图形缩小到 2/3 —— 用户要的「里面的内容放大」
     * 就是把这圈空白裁掉（2.35r），同一个 21px 的框，图形从 14px 变成 ≈19px。
     */
    tight = false,
  ): { canvas: HTMLCanvasElement; size: number } | null {
    if (typeof document === 'undefined') return null;
    const r = radius * scale;
    // 不留光晕的余量（GM-snake-45）：以前画布开到 5.2r 全是为了那圈半透明光晕，
    // 现在只剩实体（2.05r）+ 脉动余量（1.12 倍），3.1r 就够。
    const size = Math.ceil(r * (tight ? 2.35 : 3.1));
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * this.dpr);
    const g = c.getContext('2d');
    if (!g) return null;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const mid = size / 2;
    const color = kind === SNAKE_KIND_CORPSE
      ? CORPSE_COLOR
      : (kind === SNAKE_KIND_FOOD ? FOOD_COLORS[foodTierIndex(tier)] : (ITEM_COLORS[kind] || FOOD_COLORS[0]));

    // GM-snake-46：道具**不画彩色底圆**（磁铁的蓝底被当成"蓝色边框"，星星的黄底同问题），
    // 只留放大的白色图标；食物/残骸仍是实体圆（它们是"能吃的东西"，需要圆的身形）。
    const isItem = kind === SNAKE_KIND_MAGNET || kind === SNAKE_KIND_STAR;
    if (!isItem) {
      g.beginPath();
      g.arc(mid, mid, r, 0, TAU);
      g.fillStyle = color;
      g.fill();
    }

    const img = this.skinImage(assetId);
    if (img) {
      // 皮肤图画满主体圆（留一圈光晕），比矢量图标更有主题感
      const d = r * 2.05;
      g.drawImage(img, mid - d / 2, mid - d / 2, d, d);
      return { canvas: c, size };
    }

    if (kind === SNAKE_KIND_MAGNET) {
      // 马蹄形磁铁（`GM-snake-51`）：**一半蓝一半红** + 两腿末端一小段灰白磁极，
      // 与 `public/skins/arcade/snake/items/magnet.svg` 同一套配色和比例。
      // 不再画外围那圈深色描边 —— 它让 U 形看起来像个圆环（用户：「不要外围的圈」）。
      const R = r * 0.95;
      const lw = R * 0.48;
      const cx = mid;
      const cy = mid + R * 0.1;
      const arcR = R * 0.58;
      const legH = R * 0.62;
      // 左右两半各画一遍**完整的** U（弧 + 两条腿），靠 clip 在中线硬切：
      // 只画各自的半弧会露出断口，画两遍再切就正好在顶点接上。
      const half = (left: boolean, color: string) => {
        g.save();
        g.beginPath();
        g.rect(left ? 0 : cx, 0, cx, size);
        g.clip();
        g.beginPath();
        g.arc(cx, cy, arcR, Math.PI, 0);
        g.strokeStyle = color;
        g.lineWidth = lw;
        g.lineCap = 'butt';
        g.stroke();
        g.fillStyle = color;
        g.fillRect(cx - arcR - lw / 2, cy, lw, legH);
        g.fillRect(cx + arcR - lw / 2, cy, lw, legH);
        g.restore();
      };
      half(true, '#3b82f6');   // 左：蓝（S 极）
      half(false, '#ef4444');  // 右：红（N 极）
      // 磁极：两腿末端的一小段灰白（约两成腿长）
      const capH = legH * 0.26;
      g.fillStyle = '#e2e8f0';
      g.fillRect(cx - arcR - lw / 2, cy + legH - capH, lw, capH);
      g.fillRect(cx + arcR - lw / 2, cy + legH - capH, lw, capH);
    } else if (kind === SNAKE_KIND_STAR) {
      // 五角星（无敌）：**描边（线框）**类型（`GM-snake-51`）——
      // 不填实心、不垫底色，只留一圈同色轮廓 + 10% 的淡填充（纯空心在小尺寸下会糊成一条线）。
      const drawStar = (rr: number, inner: number) => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const ang = -Math.PI / 2 + (i * Math.PI) / 5;
          const rad = i % 2 === 0 ? rr : inner;
          const px = mid + Math.cos(ang) * rad;
          const py = mid + Math.sin(ang) * rad;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
      };
      g.lineJoin = 'round';
      g.lineCap = 'round';
      drawStar(r * 0.9, r * 0.38);
      g.fillStyle = 'rgba(252,211,77,0.10)';
      g.fill();
      g.strokeStyle = '#fcd34d';
      g.lineWidth = Math.max(2, r * 0.2);
      g.stroke();
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
      const sprite = this.getFoodSprite(f.k, f.r, f.t ?? 0);
      if (!sprite) continue;
      const rr = f.r * this.zoom;
      if (f.x < view.x0 - rr || f.x > view.x1 + rr || f.y < view.y0 - rr || f.y > view.y1 + rr) continue;
      const isItem = f.k === SNAKE_KIND_MAGNET || f.k === SNAKE_KIND_STAR;
      const size = sprite.size * (isItem ? itemPulse : foodPulse);
      const half = size / 2;
      ctx.drawImage(sprite.canvas, this.sx(f.x) - half, this.sy(f.y) - half, size, size);
    }
  }

  /**
   * 身体贴图：按弧长逐节贴整张图，**圆贴图直接叠圆**（`GM-snake-44` 定稿方案）。
   *
   * 这是评审稿 `.review/snake-skin-chain.html` ②「弧长重采样」的对局实现：
   * - 锚点沿头部走过的路径按弧长取，节距 `2R × (1 − 18%)`；
   * - 每节只做两件事：平移到锚点、按切向旋转（切向取前后各 1.2R，折点不跳）；
   * - **从尾向头画**：靠头的一张压住靠尾的一张（前方覆盖后方）；
   * - 圆贴图直径 = 身宽，**不裁剪也不填色**，四角透明直接落在轮廓外。
   *
   * 为什么不用 `CanvasPattern` 描边：图案是屏幕坐标、不跟蛇身转，
   * 蛇只有 2R 宽 —— 96px 的贴图只被截到一小块，蛇一转向露出的那块就变了。
   *
   * 满幅贴图（熔岩/霓虹/默认）四角不透明，仍然裁到身宽带子里（`cell.clip`），
   * 否则方块按各自朝向旋转后会露出直角；圆形贴图不走裁剪 ——
   * 那圈扇贝边就是「一个个圆叠起来」本来的样子。
   *
   * 视口外的锚点直接跳过 —— 一局几十节 × 10 条蛇全画会掉帧。
   */
  private drawBodySkin(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    body: CanvasImageSource,
    alt: CanvasImageSource | null,
    view: WorldRect,
    cell: SkinCell,
  ) {
    const worldR = this.state.radius;
    // 切向取前后各 1.2 个身宽：折点处不会整段跳（画面抖动的根因之一）
    const segs = bodySegments(pts, cell.step, alt ? 2 : 1, worldR * 1.2);
    if (!segs.length) return;

    // 正方形贴图：宽高都是 cell.size
    const w = cell.size * this.zoom;
    const h = w;
    const halfW = w / 2;
    const halfH = h / 2;
    const reach = cell.size;

    if (cell.clip) {
      // 只有满幅贴图才裁：方块的四角不会戳出轮廓，尾端也是圆的。
      // 半径传**世界坐标**的 r（下面的坐标会再乘一次 zoom）。
      const band = bodyBand(pts, worldR);
      if (band.length < 3) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.sx(band[0][0]), this.sy(band[0][1]));
      for (let i = 1; i < band.length; i++) ctx.lineTo(this.sx(band[i][0]), this.sy(band[i][1]));
      ctx.closePath();
      ctx.clip();
    }

    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (s.x < view.x0 - reach || s.x > view.x1 + reach) continue;
      if (s.y < view.y0 - reach || s.y > view.y1 + reach) continue;
      const img = s.slot === 0 ? body : alt;
      if (!img) continue;
      ctx.save();
      ctx.translate(this.sx(s.x), this.sy(s.y));
      // 部件图约定「图像上方（-Y）对准前进方向」→ 高度那一边沿着蛇长
      ctx.rotate(s.angle + Math.PI / 2);
      ctx.drawImage(img, -halfW, -halfH, w, h);
      ctx.restore();
    }
    if (cell.clip) ctx.restore();
  }

  /**
   * 头圈护盾的出现系数（`GM-snake-49`）。
   *
   * 用户口径：「无敌罩还是改为只加在头部吧」—— 圈只包住蛇头，不再罩整条身体：
   * - 圆心 = 蛇头（不平滑，圈必须跟着头，不能拖在后面）；
   * - 半径 = 头的半径 + 固定像素（见 `SHIELD_PAD_PX`），与蛇长、朝向、45° 走位都无关，
   *   所以也就不存在「头跑到圈外」这件事；
   * - 只剩这个系数做过渡：生效时 0.2 → 1（τ=60ms），消失时直接删掉，下次重新扩散。
   */
  private shieldGrow(id: string, dt: number): number {
    const cur = this.shieldScales.get(id) ?? 0;
    const next = cur + (1 - cur) * (1 - Math.exp(-dt / 60));
    this.shieldScales.set(id, next);
    // 不从 0 起：第一帧是个点会闪一下，0.2 起步看着就是「从头上扩出来」
    return 0.2 + 0.8 * next;
  }

  /**
   * 尾巴贴图（`GM-snake-48` 重写旋转中心）。
   *
   * 老代码把画布原点放在**图心**（贴着尾尖）再旋转 —— 角度一变，靠身体那一端的接缝
   * 就横着扫过去，帝王这种长尾皮肤一转弯就看得到尾巴和身体错开一道缝，像在甩尾。
   * 现在原点放在**关节**（身体截断点 = 尾巴与身体的接缝），旋转钉在关节上：
   * 接缝严丝合缝，转弯时只有尾尖在甩，和身体一样流畅。见 `tailPose`。
   */
  private drawTailSkin(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    img: CanvasImageSource,
  ) {
    const R = this.state.radius;
    const pose = tailPose(pts, R, TAIL_SPAN * R);
    if (!pose) return;
    // 2.3 而不是 2.12：尾图是 64 画布里画 r=30 的圆（留 2px 透明边），
    // 放大一点才能盖满尾巴那一段，不露出后面的身体/背景
    const d = R * 2.3 * this.zoom;
    const off = pose.offset * this.zoom;
    const jx = this.sx(pose.x);
    const jy = this.sy(pose.y);
    // 图心 = 关节沿尾巴方向（朝尾尖）退 off；视口裁剪按图心算，别用关节
    const cx = jx - Math.cos(pose.angle) * off;
    const cy = jy - Math.sin(pose.angle) * off;
    if (cx < -d || cx > this.cssW + d || cy < -d || cy > this.cssH + d) return;
    ctx.save();
    ctx.translate(jx, jy);
    // 图像上方对准前进方向（朝头）；该局部系的 +y 因此指向尾尖
    ctx.rotate(pose.angle + Math.PI / 2);
    ctx.drawImage(img, -d / 2, off - d / 2, d, d);
    ctx.restore();
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

  private drawSnakes(now: number, view: WorldRect, dt: number) {
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
      // 没装备（人机/游客）就用默认皮肤：四个部件都按这个 id 取图，
      // 否则默认皮肤被换成多段式时（头/尾/交替），空 skin 的蛇只有身体没有头尾。
      const skinId = snake.skin || defaultSkinAsset(GAME_SLUG);
      const disp = snake.mine ? null : this.disp.get(snake.id);
      const pts = disp ? disp.pts : snake.pts;
      if (!pts.length) return;

      // 有尾图的皮肤：身体截到尾巴前面，尾巴那一段**只有尾图**（GM-snake-40）
      const tailImg = assetTailImage(GAME_SLUG, skinId);
      const bodyPts = tailImg ? trimTail(pts, TAIL_SPAN * this.state.radius) : pts;
      const bodyImg = this.skinImage(skinId);
      const altImg = assetAltImage(GAME_SLUG, skinId);
      const headImg = assetHeadImage(GAME_SLUG, skinId);
      // 位图缓存 + 透明角填色（GM-snake-42）：每帧只是缩放一张已光栅化的图，
      // 身体贴图额外把四角的透明像素填成自身边缘色 —— 去掉描边后蛇身才不露缝
      const bodyBmp = skinTile(bodyImg);
      const altBmp = skinTile(altImg);
      const headBmp = skinTile(headImg);
      const tailBmp = skinTile(tailImg);
      // 一节贴图的尺寸（GM-snake-44）：圆贴图 = 身宽、不裁；满幅贴图放大 1.5 倍再裁。
      // 节距恒为 `2R × (1 − 18%)`，换皮肤不会改变身体的节数。
      const roundBody = skinIsRound(bodyImg);
      const cell = skinCell(this.state.radius, roundBody);

      const segCount = bodyPts.length >= 2 ? clipSnakeSegmentRanges(bodyPts, {
        x0: view.x0 - margin, y0: view.y0 - margin,
        x1: view.x1 + margin, y1: view.y1 + margin,
      }, this.segRanges) : 0;

      const head = pts[0];
      const hx = this.sx(head[0]);
      const hy = this.sy(head[1]);
      const headVisible = head[0] >= view.x0 - margin && head[0] <= view.x1 + margin
        && head[1] >= view.y0 - margin && head[1] <= view.y1 + margin
        && hx > -radius * 3 && hx < this.cssW + radius * 3
        && hy > -radius * 3 && hy < this.cssH + radius * 3;

      // GM-snake-42：不再先描一圈黑边、再描一层平均色底、最后加一道白色高光。
      // 身体就是「配置的那套皮肤」，贴图自己已经有描边/渐变/花纹，
      // 再套一层深色外圈只会让蛇变细一圈、颜色也被压暗。
      // 没有贴图（资源没配/还在解码）时才用玩家配色画一条纯色身体兜底。
      if (!bodyBmp && segCount) {
        ctx.beginPath();
        for (let s = 0; s < segCount; s++) {
          const from = Math.max(0, this.segRanges[s * 2] - 1);
          const to = Math.min(bodyPts.length - 1, this.segRanges[s * 2 + 1] + 1);
          if (to <= from) continue;
          ctx.moveTo(this.sx(bodyPts[from][0]), this.sy(bodyPts[from][1]));
          for (let i = from + 1; i <= to; i++) ctx.lineTo(this.sx(bodyPts[i][0]), this.sy(bodyPts[i][1]));
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = radius * 2;
        ctx.stroke();
      }
      // 身体贴图：一张图 = 一节蛇身，沿路径逐节贴（所有皮肤类型同一条路，GM-snake-40）
      if (bodyBmp && segCount) {
        this.drawBodySkin(ctx, bodyPts, bodyBmp, altBmp, view, cell);
      }
      // 尾巴：画在身体之上、蛇头之前（身体已截短，这一段只有尾图）
      if (tailBmp) this.drawTailSkin(ctx, pts, tailBmp);

      // 加速 / 磁吸不再在蛇头上画半透明光环与吸附范围圈（GM-snake-45）：
      // 深色地图上那层半透明边太虚，还会把蛇头本身的颜色压暗；
      // 改成排行榜下方的 buff 文字牌（见 syncUi / renderBuffs）。

      if (headVisible) {
        const angle = disp ? disp.angle : snake.angle;
        // GM-snake-42：头也不再铺队伍色圆底、不再描一圈白边 —— 头就是配置的那张头图。
        // GM-snake-46：整套画法抽到 `head.ts`，皮肤预览用的是同一个函数，
        // 否则预览里糖果头还是旧样子（花纹贴图 + 眼睛靠下），跟对局对不上。
        drawSnakeHead(ctx, hx, hy, angle, {
          head: headBmp,
          body: bodyBmp,
          roundBody,
          spriteSize: cell.size * this.zoom,
          radius,
          accent: bodyImg ? skinAccent(bodyImg) : '#e2e8f0',
          fallbackColor: color,
        });

        // 无敌：只罩**蛇头**（`GM-snake-49` 按用户口径从整身改回头部）。
        // 圆心 = 蛇头、半径 = 头的一圈多 + 固定像素；圈的大小与蛇长/朝向无关，
        // 也就不会再出现「蛇头在圈外」。出生护盾与星星道具同一套视觉（同色同形）。
        if (snake.alive && (snake.star > 0 || snake.invincible > 0)) {
          const grow = this.shieldGrow(snake.id, dt);
          const cx = hx;
          const cy = hy;
          const pulse = 0.5 + 0.5 * Math.sin(now / 320);
          // GM-snake-50：1.25 → 1.5，圈再大一圈（头图外留出明显空隙，不贴着脖子）
          const rr = (this.state.radius * 1.5 * this.zoom + SHIELD_PAD_PX) * grow * (1 + 0.01 * pulse);
          // 内圈完全透明、越靠边越亮：整圆铺色会把蛇身糊成一片
          const g = ctx.createRadialGradient(cx, cy, rr * 0.55, cx, cy, rr);
          g.addColorStop(0, `rgba(${SHIELD_RGB},0)`);
          g.addColorStop(0.7, `rgba(${SHIELD_RGB},${(0.04 + 0.03 * pulse).toFixed(3)})`);
          g.addColorStop(0.94, `rgba(${SHIELD_RGB},${(0.16 + 0.08 * pulse).toFixed(3)})`);
          g.addColorStop(1, `rgba(${SHIELD_RGB},${(0.30 + 0.12 * pulse).toFixed(3)})`);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, TAU);
          ctx.fillStyle = g;
          ctx.fill();
          // 外面再压一条亮边：深色地图上单靠渐变边界发虚，得有一根清晰的线
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, TAU);
          ctx.strokeStyle = `rgba(${SHIELD_RGB},${(0.38 + 0.18 * pulse).toFixed(3)})`;
          ctx.lineWidth = Math.max(1.5, 2.2 * this.zoom);
          ctx.stroke();
        } else {
          // 护盾消失：清掉系数，下次生效重新从 0.2 扩散
          this.shieldScales.delete(snake.id);
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
    // 标题只留「排行榜」，团队模式追加剩余时间（按秒量化，只在秒变化时写 DOM）
    const left = s.endsIn > 0 ? Math.ceil(s.endsIn / 1000) : 0;
    const clock = left > 0
      ? ` · ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
      : '';
    const hudSig = `${s.todayBest}|${clock}`;
    if (hudSig !== this.hudSig) {
      ui.hudMode.textContent = `🏆 排行榜${clock}`;
      // 顶部是今日全游戏最高分；自己的分数看下面榜单里高亮的那一行
      ui.hudScore.textContent = String(s.todayBest || 0);
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

    // --- buff 状态条（GM-snake-45 / 46 / 48）：排行榜下方的图标徽标 ---
    const meSnake = s.snakes.find(x => x.mine);
    const magnetLeft = meSnake && meSnake.alive ? Math.max(0, meSnake.magnet) : 0;
    const starLeft = meSnake && meSnake.alive ? Math.max(0, meSnake.star) : 0;
    const boostOn = !!s.boosting && !!s.alive;
    // 每帧都刷：倒计时环是连续量（100% → 0%），量化到 100ms 会一格一格掉；
    // renderBuffs 内部只在「哪几个 buff 亮着」变化时重建 DOM，其余帧只改一个 CSS 变量。
    this.renderBuffs(
      ui.buffs,
      boostOn,
      magnetLeft,
      starLeft,
      this.buffFrac('magnet', magnetLeft),
      this.buffFrac('star', starLeft),
    );

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

    // --- 加速按钮：按住即加速（无 CD），手指还按着就一直亮着，不会被身长扣到下限搞灰 ---
    this.dom.style(ui.boost, 'display', showControls ? '' : 'none');
    if (showControls) {
      // 「按住」= 本地手指意图（boostHeld）；「生效」= 服务端物理判定（boosting）。
      // 两个都要有：按住中但身长不足时加速不生效，按钮却仍然是亮的（不能变灰）。
      const held = !!s.boostHeld;
      // 加速门槛（可加速的最低身长）由服务端下发，客户端不硬编码
      const enough = (s.length || 0) > (s.params?.boostMinLen ?? 120);
      const effective = !!s.boosting;
      this.dom.cls(ui.boost, 'ready', held || enough);
      this.dom.cls(ui.boost, 'held', held);
      this.dom.cls(ui.boost, 'boosting', effective);
      this.dom.style(ui.boostRing, 'background', effective
        ? 'rgba(56,189,248,0.55)'
        : (held ? 'rgba(56,189,248,0.38)' : (enough ? 'rgba(56,189,248,0.22)' : 'rgba(148,163,184,0.15)')));
      // 按钮上不显示文字，只有闪电图标；状态文案放到 title 里（悬停可见 + 读屏可读）
      const label = held
        ? (effective ? '松开停止加速' : '按住中 · 身长不足，暂不加速')
        : (enough ? '按住加速' : '按住加速 · 身长不足时不加速');
      if (label !== this.boostLabelSig) {
        ui.boost.title = label;
        ui.boost.setAttribute('aria-label', label);
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

  /**
   * buff 状态条：加速（按住即生效，不算剩余时间）/ 磁吸 / 无敌（带剩余秒数）。
   *
   * 为什么放在这里：原来加速是头部一圈半透明光环、磁吸是头部一圈很大的
   * 半透明圆（半径 220px）—— 深色地图上两个都看不清，还会把蛇头压暗。
   * 改成排行榜下方的文字牌，当前有哪些 buff、剩多久一目了然。
   * 没有 buff 时整条隐藏 —— 它挂在榜单下面，空着会白占一块。
   */
  /** 剩余时间 → 倒计时环占比（0~1）。buff 消失时基准清零，下一轮从 100% 起 */
  private buffFrac(kind: 'magnet' | 'star', left: number): number {
    if (!(left > 0)) {
      this.buffPeak[kind] = 0;
      return 0;
    }
    if (left > this.buffPeak[kind]) this.buffPeak[kind] = left;
    const peak = this.buffPeak[kind];
    return peak > 0 ? Math.min(1, left / peak) : 1;
  }

  /**
   * buff 徽标里的道具图标（`GM-snake-49`）。
   *
   * 用户口径：「磁吸和无敌的 buff 使用道具的皮肤」—— 不另画一套图标，
   * 直接复用地图道具的精灵生成（`buildFoodSprite`）：manifest 配了道具皮肤图就贴图，
   * 没配就是磁铁 / 五角星的矢量画法，和场上那颗长得**一模一样**。
   * 半径固定 8px、倍率 1（与地图 zoom 解耦），按 `kind + 皮肤 id` 缓存一张画布。
   * `GM-snake-50`：走 tight 画布 —— 徽标只要图形本身，不要那圈为脉动预留的空白。
   */
  private buffIcon(kind: number): HTMLCanvasElement | null {
    const assetId = this.foodAssetOf(kind, 0);
    const key = `${kind}:${assetId || '-'}`;
    const hit = this.buffIcons.get(key);
    if (hit) return hit;
    const built = this.buildFoodSprite(kind, 8, 0, assetId, 1, true);
    if (!built) return null;
    this.buffIcons.set(key, built.canvas);
    return built.canvas;
  }

  /**
   * buff 徽标（`GM-snake-46` 只留图标；`GM-snake-48` 加倒计时外环）。
   *
   * 时效性 buff（磁吸 / 无敌）的外环从 100% 顺时针收到 0%，到 0 时整块消失 ——
   * 环就是剩余时间，比数字直观，也不用再往徽标里塞秒数。
   * 加速是「按住就加速、没有时长」，所以没有环。
   */
  private renderBuffs(
    container: HTMLDivElement,
    boost: boolean,
    magnetMs: number,
    starMs: number,
    magnetFrac: number,
    starFrac: number,
  ) {
    // GM-snake-49：磁吸 / 无敌不再用内联 SVG，改成**道具自己的皮肤**
    // （地图上那颗道具怎么画，徽标里就怎么画；没配图时就是磁铁 / 五角星的矢量画法）
    const chips: {
      cls: string;
      title: string;
      icon: string;
      art: HTMLCanvasElement | null;
      frac: number;
      /** 有时长 → 带倒计时环（加速是按住即生效，没有时长） */
      timed: boolean;
    }[] = [];
    if (boost) {
      chips.push({
        cls: 'snake-buff boost',
        title: '加速中',
        icon: BUFF_ICONS.boost,
        art: null,
        frac: 1,
        timed: false,
      });
    }
    if (magnetMs > 0) {
      chips.push({
        cls: 'snake-buff magnet timed',
        title: '磁吸中',
        icon: BUFF_ICONS.magnet,
        art: this.buffIcon(SNAKE_KIND_MAGNET),
        frac: magnetFrac,
        timed: true,
      });
    }
    if (starMs > 0) {
      chips.push({
        cls: 'snake-buff star timed',
        title: '无敌中',
        icon: BUFF_ICONS.star,
        art: this.buffIcon(SNAKE_KIND_STAR),
        frac: starFrac,
        timed: true,
      });
    }

    // 结构只在「哪几个 buff 亮着」变了才重建：倒计时是每帧改一个属性，不碰 DOM 结构
    const key = chips.map(c => c.cls).join(',');
    if (key !== this.buffKey) {
      this.buffKey = key;
      this.buffChips.clear();
      this.buffBars.clear();
      container.replaceChildren();
      for (const c of chips) {
        const chip = document.createElement('span');
        chip.className = c.cls;
        chip.title = c.title;
        chip.setAttribute('aria-label', c.title);
        // 内容先画，环最后盖上去 —— `innerHTML` 会清空已有子节点
        if (c.art) {
          // 画布是缓存复用的：换 chip 时只是把它挪到新节点里
          c.art.className = 'snake-buff-art';
          chip.appendChild(c.art);
        } else {
          chip.innerHTML = c.icon;
        }
        if (c.timed) {
          const bar = this.buildBuffRing(chip);
          this.buffBars.set(c.cls, bar);
        }
        container.appendChild(chip);
        this.buffChips.set(c.cls, chip);
      }
    }
    // 倒计时环：每帧只写 `stroke-dashoffset`（100 = 空，0 = 满）
    for (const c of chips) {
      const bar = this.buffBars.get(c.cls);
      if (!bar) continue;
      const left = Math.max(0, Math.min(1, c.frac));
      bar.setAttribute('stroke-dashoffset', String(((1 - left) * 100).toFixed(2)));
    }
    // 每帧都会走到这里，display 只在真的变了才写（避免每帧一次无意义的样式失效）
    const want = chips.length ? '' : 'none';
    if (container.style.display !== want) container.style.display = want;
  }

  /**
   * 倒计时环（`GM-snake-50`）：一层 SVG，两条同心圆 —— 暗色轨道 + 进度弧。
   *
   * 为什么不再用 `conic-gradient`：它按角度切断，端点必然是**直角**（做不出圆头），
   * 而且要靠 `mask` 抠细边，最细也就 3px，26px 的框上看着又粗又闷。
   * SVG 弧用 `stroke-linecap: round` 两头直接是圆的，线宽 2px 想多细都行；
   * `pathLength="100"` 之后 `stroke-dasharray: 100` 的单位就是「整圈的 1%」，
   * 每帧只需要写 `stroke-dashoffset = (1 - 占比) × 100`。
   *
   * @returns 进度弧节点，交给 `buffBars` 缓存，每帧更新
   */
  private buildBuffRing(chip: HTMLElement): SVGCircleElement {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'snake-buff-ring');
    svg.setAttribute('viewBox', '0 0 26 26');
    svg.setAttribute('aria-hidden', 'true');
    let bar: SVGCircleElement | null = null;
    for (const cls of ['track', 'bar'] as const) {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('class', cls);
      circle.setAttribute('cx', '13');
      circle.setAttribute('cy', '13');
      // r=11.5 + 半根线宽 1 = 12.5，留 0.5 余量，圆头不会顶到视口边界被切
      circle.setAttribute('r', '11.5');
      if (cls === 'bar') {
        circle.setAttribute('pathLength', '100');
        circle.setAttribute('stroke-dasharray', '100');
        circle.setAttribute('stroke-dashoffset', '100');
        bar = circle;
      }
      svg.appendChild(circle);
    }
    chip.appendChild(svg);
    return bar!;
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
    } else if (!s.alive && (s.snakes.some(x => x.mine) || s.variant === 'team')) {
      // 团队模式下即使服务端把死蛇摘掉了也要给弹框：关闭键已删除，
      // 没有弹框就没有任何退出口（`GM-snake-45` 的收尾）。
      // 自己死了 → 出局弹框（GM-snake-45）。
      // 无尽模式有「重生 / 退出」；团队模式本局对玩家已经结束（不会复活），
      // 弹框里只有「退出」。对战屏幕已经去掉关闭键，
      // 这个弹框是对局中唯一的出口。
      kind = 'death';
    } else if (!s.alive) {
      // 没有自己的蛇（观战者）：只提示，不给操作
      kind = 'notice'; title = '已出局'; sub = '对局已结束';
    }
    // 无敌不再用顶部文字提示：蛇头的半透明遮罩圆已经表达了（GM-snake-36）

    // 出局卡片里的名次/分数会随结算变化，签名要带上，否则弹框停在第一帧的数字上
    const myScore = s.snakes.find(x => x.mine)?.score ?? s.score;
    const myRank = myScore > 0
      ? 1 + s.snakes.filter(x => (x.score || 0) > myScore).length
      : 0;
    const sig = `${kind}|${title}|${sub}|${myScore}|${myRank}|${s.snakes.length}|${s.todayBest}`;
    if (sig === this.overlaySig) return;
    this.overlaySig = sig;

    ui.overlay.replaceChildren();
    ui.overlay.className = 'snake-overlay';
    ui.overlay.style.display = kind ? '' : 'none';
    ui.death.style.display = kind === 'death' ? '' : 'none';
    if (kind === 'death') {
      // GM-snake-46：弹框里补上**名次**（用户反馈「弹框里没数据」就是要看排名），
      // 名次按场上所有蛇的分数算，跟左侧榜单口径一致。
      const total = s.snakes.length;
      ui.deathScore.textContent = myRank > 0 && total > 1
        ? `第 ${myRank} 名 / 共 ${total} 条蛇 · 本局 ${myScore} 分`
        : `本局得分 ${myScore} · 最高 ${s.best}`;
      ui.deathNote.textContent = s.variant === 'team'
        ? `本局已结束，分数已记入排行榜${s.todayBest > 0 ? ` · 今日最高 ${s.todayBest}` : ''}`
        : `分数已记入排行榜${s.todayBest > 0 ? ` · 今日最高 ${s.todayBest}` : ''}`;
      // 只有无尽模式能重生；团队模式出局就是真出局，留一个「重生」只会被点到不生效
      const canRespawn = s.variant === 'endless' && s.awaiting;
      ui.deathRespawn.style.display = canRespawn ? '' : 'none';
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
