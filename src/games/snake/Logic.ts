// 贪吃蛇逻辑（连续像素世界，Slither 风格）
// - 服务端 20Hz 权威推进：蛇头浮点坐标 + 朝向角 + 走过的路径，客户端只负责输入与预测
// - 本地预测：从最新快照出发，用与服务端完全相同的模型（目标角 → 最大角速度 → 速度）
//   前推到"现在"。因为每帧都从快照重算，预测不会累积漂移，操作是实时的（摇杆/鼠标移动立即生效）。
// - 输入与上报解耦：aim() 只改本地目标角（UI 每帧可调），上报由独立的 33ms 定时器负责，
//   只在角度真的变了才发包。网络慢/卡时本地控制照常生效，不会被上报节奏拖住。
// - 慢网本地主导：按最近快照间隔自适应放宽预测上限（最多 1.5s）并补偿单程延迟，
//   快照迟到时蛇继续按本地输入前进，校正量慢慢消化而不是硬拽回旧位置。
import EventEmitter from 'eventemitter3';
import type SocketTransport from '../../core/GameTransport';

export type Variant = 'endless' | 'team';

/**
 * 物理参数（像素/秒、弧度/秒）。
 *
 * ⚠️ **速度相关的参数由服务端下发**（见 `SnakeParams`）：
 * 运营在管理端改贪吃蛇的速度/加速/转向配置后，**下一局生效，客户端不用改代码**。
 * 客户端预测必须与服务端权威用同一份数值，否则蛇会「拉丝」——
 * 所以这里只保留**兜底默认值**（拿不到服务端参数时用），真实值走 `this.params`。
 *
 * 速度模型：巡航速度**随身长线性递减**（贪吃蛇大作战的核心手感 —— 刚出生的小蛇快、
 * 越肥越慢）。转弯半径固定 → 角速度 ω = v/R 随速度自动下降，长蛇又慢又难转向。
 */
export const SNAKE_RADIUS = 15;
export const SNAKE_HEAD_RADIUS = 16;

/**
 * 可调参数（服务端下发，建局时冻结）。
 * 字段与语义与服务端 `games/snake/params.ts` 一一对应。
 */
export interface SnakeParams {
  /** 巡航最高速度（px/s）：身长 = 初始身长时的速度 */
  speedMax: number;
  /** 巡航最低速度（px/s）：身长 = 上限时速度 */
  speedMin: number;
  /** 加速倍率：加速速度 = 当前巡航速度 × 本值 */
  boostMult: number;
  /** 巡航最小转弯半径（px） */
  turnRadius: number;
  /** 加速时最小转弯半径（px） */
  boostTurnRadius: number;
  /** 初始身长（px） */
  bodyLength: number;
  /** 身长上限（px） */
  maxLength: number;
  /** 加速时每秒扣除的身长（px） */
  boostDrain: number;
  /** 可加速的最低身长（px） */
  boostMinLen: number;
  /** 磁铁吸附半径（px）：蛇头周围这个范围内的食物被拉过来 */
  magnetRadius: number;
  /** 磁铁吸附速度（px/s） */
  magnetPull: number;
}

/**
 * 兜底默认值：与服务端 `DEFAULT_SNAKE_PARAMS` 一致。
 * 只在「还没收到服务端参数」时使用（例如对局刚开始的那一帧）。
 */
export const DEFAULT_SNAKE_PARAMS: SnakeParams = {
  speedMax: 110,
  speedMin: 62,
  boostMult: 1.85,
  turnRadius: 25,
  boostTurnRadius: 52,
  bodyLength: 160,
  maxLength: 2400,
  boostDrain: 18,
  boostMinLen: 120,
  magnetRadius: 220,
  magnetPull: 300,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 磁铁吸附半径的兜底值：真实值读快照 params（服务端建局时冻结），后台可改。
 * 画范围提示圈时用 params.magnetRadius，本常量只作拿不到参数时的退路。
 */
export const SNAKE_MAGNET_RADIUS = DEFAULT_SNAKE_PARAMS.magnetRadius;

/**
 * 把服务端下发的参数解析成合法值（缺字段用默认值、越界裁剪）。
 * 与服务端 `resolveSnakeParams` 同规则 —— 两端解析逻辑一致才不会出现数值漂移。
 */
export function resolveSnakeParams(raw: unknown): SnakeParams {
  const out: SnakeParams = { ...DEFAULT_SNAKE_PARAMS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const ranges: Record<keyof SnakeParams, { min: number; max: number }> = {
    speedMax: { min: 20, max: 400 },
    speedMin: { min: 10, max: 400 },
    boostMult: { min: 1, max: 5 },
    turnRadius: { min: 5, max: 200 },
    boostTurnRadius: { min: 5, max: 300 },
    bodyLength: { min: 20, max: 2000 },
    maxLength: { min: 200, max: 20000 },
    boostDrain: { min: 0, max: 200 },
    boostMinLen: { min: 0, max: 5000 },
    magnetRadius: { min: 0, max: 800 },
    magnetPull: { min: 0, max: 1200 },
  };
  for (const key of Object.keys(DEFAULT_SNAKE_PARAMS) as (keyof SnakeParams)[]) {
    const v = src[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const range = ranges[key];
    out[key] = Math.min(range.max, Math.max(range.min, v));
  }
  if (out.speedMin > out.speedMax) out.speedMin = out.speedMax;
  if (out.boostMinLen > out.bodyLength) out.boostMinLen = out.bodyLength;
  if (out.maxLength < out.bodyLength) out.maxLength = out.bodyLength;
  return out;
}

/**
 * 巡航速度（像素/秒）：按身长线性插值，与服务端 snakeCruiseSpeed 完全一致。
 * @param params 本局参数（服务端下发）；缺省用兜底默认值。
 */
export function snakeCruiseSpeed(length: number, params?: SnakeParams): number {
  const p = params || DEFAULT_SNAKE_PARAMS;
  const t = clamp01((length - p.bodyLength) / Math.max(1, p.maxLength - p.bodyLength));
  return p.speedMax + (p.speedMin - p.speedMax) * t;
}

/** 当前身长下的实际移动速度（加速时 = 巡航 × 倍率） */
export function snakeMoveSpeed(length: number, boosting: boolean, params?: SnakeParams): number {
  const p = params || DEFAULT_SNAKE_PARAMS;
  return snakeCruiseSpeed(length, p) * (boosting ? p.boostMult : 1);
}

/** 当前身长下的转向角速度（rad/s）：ω = v / R */
export function snakeTurnRate(length: number, boosting: boolean, params?: SnakeParams): number {
  const p = params || DEFAULT_SNAKE_PARAMS;
  const r = boosting ? p.boostTurnRadius : p.turnRadius;
  return snakeMoveSpeed(length, boosting, p) / Math.max(1, r);
}

/**
 * 场上可拾取物类型（与服务端 rules.ts 一一对应）：
 * 普通食物（分三档）/ 尸体残骸 / 道具（磁铁、星星）。
 * 道具的 kind 由服务端注册表分配，客户端只用 kind 查皮肤、用 key 取名。
 */
export const SNAKE_KIND_FOOD = 0;
export const SNAKE_KIND_CORPSE = 1;
export const SNAKE_KIND_MAGNET = 2;
export const SNAKE_KIND_STAR = 3;
/** kind -> 资源包里的皮肤 key（`games[game].skins.items[key]`，GM-snake-25/26） */
export const SNAKE_ITEM_KEYS: Record<number, string> = {
  [SNAKE_KIND_MAGNET]: 'magnet',
  [SNAKE_KIND_STAR]: 'star',
};

/** 一个可拾取物（服务端权威下发：id + 坐标 + 半径 + 分值 + 类型） */
export interface SnakeFoodItem {
  /** 服务端稳定自增 id（老快照可能没有，按坐标兜底） */
  id?: number;
  x: number;
  y: number;
  /** 半径（像素）：决定碰撞判定与绘制大小 */
  r: number;
  /** 分值（道具为 0） */
  v: number;
  /** 类型：SNAKE_KIND_* */
  k: number;
  /**
   * 外观档位（0 小 / 1 中 / 2 大）：由服务端判定后随快照下发。
   * 客户端直接用它贴素材，不按 radius 反推 —— 两端各自反推必然漂移。
   */
  t?: number;
}

const TAU = Math.PI * 2;
/** 上报定时器周期（ms）：30Hz，与渲染/服务端 tick 对得上，且完全独立于 UI 输入 */
const AIM_INTERVAL = 33;
/** 正常网络下预测最多前推多久（ms） */
const PREDICT_MAX_MS = 200;
/** 快照间隔超过这个值视为"慢网"，放宽预测上限、让本地输入主导 */
const STALE_GAP_MS = 220;
/** 慢网时预测前推的硬上限（ms）：再长就等快照，避免彻底跑飞 */
const PREDICT_STALE_MAX_MS = 1500;

export const normalizeAngle = (a: number): number => {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
};

export const turnToward = (cur: number, target: number, maxDelta: number): number => {
  if (!Number.isFinite(target)) return normalizeAngle(cur);
  let diff = normalizeAngle(target - cur);
  if (diff > Math.PI) diff -= TAU;
  if (Math.abs(diff) <= maxDelta) return normalizeAngle(target);
  return normalizeAngle(cur + Math.sign(diff) * maxDelta);
};

export interface SnakeEntry {
  id: string;
  /** 蛇头坐标（像素） */
  x: number;
  y: number;
  /** 朝向（弧度） */
  angle: number;
  /** 身体中心线，从蛇头起等距采样 */
  pts: [number, number][];
  /** 身长（像素） */
  length: number;
  alive: boolean;
  score: number;
  best: number;
  mine: boolean;
  /** 剩余无敌（ms） */
  invincible: number;
  /** 这一 tick 是否真的在加速（按住 + 身长够） */
  boosting: boolean;
  /** 加速键是否按住 */
  boostHeld: boolean;
  /** 磁铁效果剩余（ms），0 表示没有 */
  magnet: number;
  /** 星星无敌剩余（ms），0 表示没有 */
  star: number;
  /** 距离重生（ms） */
  respawnIn: number;
  /** 已重生次数（无尽），用于检测"整条蛇瞬移" */
  respawns: number;
  /** 所属队伍（团队模式）；空串表示无队伍 */
  team: string;
  /** 玩家装备的蛇皮肤 **asset_id**（manifest 里按 id 取图；空 = 用默认皮肤） */
  skin: string;
}

export interface SnakeView {
  variant: Variant;
  /** 世界宽高（像素） */
  w: number;
  h: number;
  radius: number;
  food: SnakeFoodItem[];
  snakes: SnakeEntry[];
  players: { id: string; nickname: string; team: string }[];
  myId: string;
  score: number;
  best: number;
  /** 我是否活着（死亡时镜头停在原地，等待重生） */
  alive: boolean;
  /** 自己的身长（加速代价按它判定，HUD 也用它） */
  length: number;
  boosting: boolean;
  boostHeld: boolean;
  invincible: number;
  respawnIn: number;
  /** 已出局、等玩家选「重生 / 退出」（无尽模式） */
  awaiting: boolean;
  respawns: number;
  status: 'waiting' | 'playing' | 'over';
  winner: string;
  /** 团队模式下各队总积分：team -> 分数 */
  teamScores: Record<string, number>;
  /** 团队模式剩余毫秒（0 = 不限时） */
  endsIn: number;
  /** 全游戏今日最高分（HUD 顶部显示，跨房间跨玩家；0 = 还没有记录） */
  todayBest: number;
  /**
   * 本局生效的可调参数（服务端下发）。
   * 渲染层要用它判断「身长够不够加速」等阈值 —— 阈值同样由服务端决定，
   * 客户端不该再硬编码一份。
   */
  params: SnakeParams;
}

/**
 * 远端蛇的本地路径状态。
 * - path：身体折线，索引 0 = 蛇头，往后依次是身体，最后一个是尾巴
 * - length：身长（像素），路径总弧长应等于它
 */
export interface RemotePath {
  path: [number, number][];
  length: number;
  /** 上一次推进的时刻（ms） */
  at: number;
}

interface SnapshotSnake {
  id: string;
  team?: string;
  x: number;
  y: number;
  angle: number;
  pts: [number, number][];
  length: number;
  alive: boolean;
  score: number;
  best?: number;
  invincible?: number;
  boosting?: boolean;
  boostHeld?: boolean;
  magnet?: number;
  star?: number;
  respawnIn?: number;
  awaiting?: boolean;
  respawns?: number;
  /** 玩家级蛇皮肤 key（资源包决定画风，缺省 default） */
  skin?: string;
}

interface Snapshot {
  w: number;
  h: number;
  radius?: number;
  tick: number;
  variant?: string;
  /**
   * 本局生效的可调参数（服务端下发）。
   * 客户端用它做本地预测 —— 与服务端权威是同一份数值，否则蛇会「拉丝」。
   */
  params?: Partial<SnakeParams>;
  /**
   * 拾取物：只有 `foodFull=true` 时才有全量，平时走 `foodAdd` / `foodDel` 增量。
   * 100 个食物每 50ms 全量推一遍太浪费，增量帧通常只有 0~2 个元素。
   */
  food?: SnakeFoodItem[];
  foodAdd?: SnakeFoodItem[];
  foodDel?: number[];
  /** 坐标变化的拾取物（磁铁吸附会把食物往蛇头拉，不发这个客户端就看不到吸附） */
  foodMove?: { id: number; x: number; y: number }[];
  foodFull?: boolean;
  /** 座位表：局中有人加入时也会随快照刷新 */
  players?: { id: string; nickname: string; team?: string }[];
  snakes: SnapshotSnake[];
  status: 'playing' | 'over';
  winner?: string;
  /** 团队模式各队总积分 */
  teamScores?: Record<string, number>;
  /** 团队模式剩余毫秒；0 = 不限时 */
  endsIn?: number;
  /** 全游戏今日最高分（服务端日榜，跨房间汇总） */
  todayBest?: number;
}

export default class LogicSnake extends EventEmitter {
  socket: SocketTransport;
  player: any;
  variant: Variant;
  match_id = '';
  roomMembers: any[] = [];

  w = 3600;
  h = 2600;
  radius = SNAKE_RADIUS;
  food: SnakeFoodItem[] = [];
  snakes: SnakeEntry[] = [];
  players: { id: string; nickname: string; team: string }[] = [];
  /** 团队模式各队总积分 */
  teamScores: Record<string, number> = {};
  status: 'waiting' | 'playing' | 'over' = 'waiting';
  winner = '';
  tick = 0;

  /**
   * 本局生效的可调参数（服务端下发，建局时冻结）。
   *
   * 客户端**不再硬编码**速度/加速/转向数值 —— 运营在管理端改配置后，
   * 下一局开始客户端自动用新参数，无需改前端代码、无需重新构建。
   * 收到快照时更新；还没收到时用兜底默认值。
   */
  params: SnakeParams = { ...DEFAULT_SNAKE_PARAMS };

  /**
   * 远端蛇的连续身体（渲染用）。
   *
   * 为什么不能直接用快照里的 pts：服务端 20Hz 推一帧，pts 的每个点都是
   * 「那一瞬间的位置」。若渲染层只是向这组离散目标插值，尾巴就会
   * **每 50ms 跳一次**（目标不动时插值收敛到目标就停住）—— 看着像
   * 「尾部间隔前进」而不是贴着身体滑动。
   *
   * 正确做法是像服务端那样维护一条路径：每帧按速度把路径往前推，
   * 尾巴按身长收缩。路径是连续的，尾巴就跟着连续地往前爬。
   */
  private remotePaths = new Map<string, RemotePath>();

  /**
   * 自己那条蛇的本地连续身体（渲染用）。
   *
   * 为什么不能直接用快照里的 pts：服务端 20Hz 推一帧，pts 是沿密集路径
   * 每 22px 采一个点的**稀疏**折线（服务端 snakeSpine）。这些采样点之间的
   * 弦长比真实弧长短（弯道越弯短得越多），客户端再按身长截断时根本
   * 截不到底 —— 尾巴只能停在最后一个采样点上。而服务端的尾巴本身是
   * 每 tick 往前走的，所以客户端看到的尾巴就是"每 50ms 跳一格"。
   *
   * 正确做法（与远端蛇同一套机制）：本地维护一条**密集**路径，
   * 每帧把蛇头推进、尾巴按身长连续收缩。路径连续 → 尾巴贴着身体滑动。
   */
  private myPath: RemotePath | null = null;
  /** 上一次同步本地路径时的重生次数（变了说明蛇瞬移过，路径要重建） */
  private myRespawns = -1;

  // ===== 本地预测（只针对自己） =====
  /** 最新快照里自己的蛇（预测基准，不随预测改动） */
  private snap: { x: number; y: number; angle: number; pts: [number, number][]; length: number; at: number } | null = null;
  /** 玩家期望朝向：摇杆/鼠标/键盘给的世界绝对角度，本地立即生效 */
  private targetAngle = 0;
  private predAlive = true;
  /** 上报完全独立：固定 33ms 定时器只在角度变化时发包，aim() 不碰网络 */
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private lastSentAngle = Number.NaN;
  /** 连续被服务端拒绝的次数（用于节流重发，防止 30Hz 上报被放大成倍流量） */
  private retryCount = 0;
  /** 玩家还没给过方向时不要上报：否则会拿默认 0 覆盖服务端"朝地图中心"的出生角度 */
  private hasAim = false;
  /** 渲染校正量（像素 / 弧度）：新快照把蛇头往回拉时，用它把跳变摊平 */
  private corr = { x: 0, y: 0, a: 0 };
  /** 上一次校正量衰减的时间戳：保证一帧只衰减一次 */
  private lastDecayAt = 0;
  /** 最近几次快照**到达**间隔（ms），用于识别慢网并自适应放宽预测 */
  private gaps: number[] = [];
  private avgGap = 0;
  /**
   * 待消化的**最新**快照（`GM-snake-49`）。
   *
   * 网络抖动（弱网重传、切后台回来）时积压的快照会**成串**一次性到达。
   * 老实现收到就同步处理：每条都要深拷贝全部蛇身、重建远端路径、再广播一次视图；
   * 十条堆在同一帧里就是几十毫秒的主线程卡顿 —— 表现是「网络一卡，连自己的蛇都冻住」。
   * 现在只留最后一条，由渲染帧统一消化（每帧最多一条，最新者胜）：
   * 自己的位置本来就是本地预测前推的，别人的位置用最新一帧就够。
   */
  private pendingSnap: Snapshot | null = null;
  /** 最近一次快照**到达**的时刻（间隔统计按到达算，不能按消化算 —— 消化是每帧一条） */
  private lastArriveAt = 0;
  /** 正在帧内消化快照：不再额外广播视图（调用方紧接着就会拿到新视图） */
  private draining = false;
  private roomId = '';

  // ===== 本地展示的道具状态（快照驱动） =====
  /** 加速键是否按住（按住即生效，代价是扣身长，无 CD） */
  private boostHeld = false;
  /** 磁铁道具的本地截止时间（渲染用） */
  private localMagnetUntil = 0;
  /** 星星道具的本地截止时间（渲染用）；与服务端 starUntil 对齐 */
  private localStarUntil = 0;
  /** 团队模式结束时间戳（ms），0 = 不限时 */
  private endsAt = 0;
  /** 全游戏今日最高分（快照里的 todayBest，HUD 顶部显示） */
  private todayBest = 0;
  private invincibleUntil = 0;
  private awaiting = false;
  private respawnAt = 0;
  private respawns = 0;
  /**
   * 本局是否已经见过自己的蛇（SB-053）。
   * 用来识别"外来帧"：同一房间同时存在两个运行时时，僵尸那局的快照里没有我，
   * 照单全收就会在两个对局的画面之间来回跳（已出局提示狂闪）。
   */
  private mySnakeSeen = false;

  /**
   * 我是这个房间的对战玩家吗？
   * 观战者（member_type=viewer）本来就没有蛇，不能按"快照里没有我"判成出局。
   * 拿不到成员信息时按玩家处理（对战才是主场景）。
   */
  private get isPlayerMember(): boolean {
    if (!this.roomMembers.length) return true;
    const me = this.roomMembers.find((m: any) => String(m._id) === String(this.myId));
    if (!me) return true;
    return me.member_type !== 'viewer';
  }

  private onRemoteAction = (data: any) => {
    if (data?.snake) this.queueSnapshot(data.snake as Snapshot);
  };

  constructor(socket: SocketTransport, player: any, variant?: string, room?: any) {
    super();
    this.socket = socket;
    this.player = player;
    this.roomMembers = room?.members || [];
    this.roomId = room?._id || player?.room_id || '';
    this.variant = variant === 'team' ? 'team' : 'endless';
    this.socket?.socket?.on('room:player-action', this.onRemoteAction);
    // 上报与 UI 分开：UI 只调用 aim()，这里按固定节奏把最新角度送出去
    this.reportTimer = setInterval(() => this.reportAim(), AIM_INTERVAL);
    // 浏览器里 setInterval 返回 number（无 unref）；测试环境里 unref 掉，避免定时器吊住进程
    (this.reportTimer as any)?.unref?.();
  }

  get myId() { return this.player?._id || ''; }

  /** 当前期望朝向（供虚拟摇杆把手柄画在与输入一致的方向） */
  get aimAngle() { return this.targetAngle; }

  /** 是否处于慢网（快照间隔偏大）：本地控制优先 */
  get stale() {
    const since = this.lastSnapshotAt ? Date.now() - this.lastSnapshotAt : 0;
    return this.avgGap > STALE_GAP_MS || since > STALE_GAP_MS + 200;
  }

  setPlayer(player: any) {
    if (!player) return;
    this.player = player;
    if (player.room_id) this.roomId = player.room_id;
  }

  setMatchId(id: string) { if (id) this.match_id = id; }

  /** 对局状态（开局/重连都会调用） */
  setState(state: any) {
    if (!state) return;
    if (state.match_id && state.match_id !== this.match_id) {
      this.match_id = state.match_id;
      // 换局了：清掉「见过自己的蛇」标记，新局里我可能还没进快照
      this.mySnakeSeen = false;
      // 本地身体路径也是上一局的：清掉，新局第一帧重建（否则身体从旧位置滑过来）
      this.myPath = null;
      this.myRespawns = -1;
    }
    // 本局参数：服务端在建局时冻结进对局状态（match.curr_state.params）。
    // 重连时从这里拿，不必等第一帧快照；之后每帧快照也会带同一份。
    if (state.params) this.params = resolveSnakeParams(state.params);
    if (Array.isArray(state.players)) {
      this.players = state.players
        .filter((p: any) => p.member_type === 'player' || p.role === 'player' || p.role === 'snake')
        .map((p: any) => ({
          id: p._id,
          nickname: p.nickname
            || this.roomMembers.find((m: any) => m._id === p._id)?.nickname
            || '玩家',
          team: p.team || '',
        }));
    }
    const variant = state.variant as string | undefined;
    if (variant === 'team' || variant === 'endless') this.variant = variant;
    this.status = state.snake ? 'playing' : 'waiting';
    // 重连/开局这条一次性路径不走队列（要立刻出画面），但到达间隔照样要记
    if (state.snake) {
      this.noteArrival();
      this.applySnapshot(state.snake as Snapshot);
    }
    else this.emitView();
  }

  // ===== 输入 =====
  /**
   * 瞄准：传入世界坐标系下的绝对朝向（弧度）。
   * 只改本地目标角，下一帧预测就朝这个方向转 —— 与网络上报完全解耦，
   * 所以请求慢、包丢了也不会让操作变卡。
   */
  aim(angle: number) {
    if (this.status !== 'playing' || !this.predAlive) return;
    if (!Number.isFinite(angle)) return;
    this.targetAngle = normalizeAngle(angle);
    this.hasAim = true;
  }

  /** 键盘：朝四个基准方向瞄准（同样走 aim，手感与鼠标一致） */
  aimDir(dir: 'up' | 'down' | 'left' | 'right') {
    const angle = dir === 'up' ? -Math.PI / 2
      : dir === 'down' ? Math.PI / 2
        : dir === 'left' ? Math.PI
          : 0;
    this.aim(angle);
  }

  /**
   * 加速键按住状态（按下 / 松开各调一次）。
   * 无冷却、无时长上限：按住就一直加速，代价是每隔一段时间从尾部扣身长。
   * 本地先乐观生效，服务端下一帧快照会带 `boosting` 纠正（被拒也只是不加速而已）。
   */
  setBoost(held: boolean) {
    if (this.boostHeld === held) return;
    this.boostHeld = held;
    if (this.status !== 'playing' || !this.predAlive) return;
    this.send({ boostHeld: held });
    this.emitView();
  }

  /**
   * 无尽模式：死亡弹框里点「重生」。
   * 本地先收起弹框（乐观），真正的复活位置/无敌时间以服务端下一帧快照为准。
   */
  respawn() {
    if (this.variant !== 'endless' || !this.awaiting) return;
    this.awaiting = false;
    this.boostHeld = false;
    this.send({ respawn: true });
    this.emitView();
  }

  /** 死亡弹框里点「退出」：先同步分数，再交给页面处理（离开房间回大厅） */
  exit() {
    this.syncScore();
    this.emit('exit');
  }

  /**
   * 点击离开/关闭时把分数同步到排行榜。分数由服务端按运行时局面结算，
   * 客户端不带分数（防篡改），只发"请记一次"；与瞄准上报走的是不同通道。
   */
  syncScore() {
    const room_id = this.roomId || this.player?.room_id;
    if (!room_id || !this.myId) return;
    this.socket?.socket?.emit('room:sync-score', { room_id, player_id: this.myId });
  }

  /** 独立的上报定时器：角度没变就不发包，静止时零流量 */
  private reportAim() {
    if (!this.hasAim) return;
    if (this.status !== 'playing' || !this.predAlive) return;
    let delta = Math.abs(normalizeAngle(this.targetAngle - this.lastSentAngle));
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    if (Number.isFinite(delta) && delta < 0.002) return;
    this.lastSentAngle = this.targetAngle;
    this.send({ angle: this.targetAngle });
  }

  /**
   * 发指令并等服务端确认。
   *
   * 服务端会回 { success, message }：success=false 表示这条指令被拒
   * （最典型的是"不在局中"——刚进房时运行时还没把这个玩家加进去）。
   * 带 ack 是为了能感知失败并重发，而不是像以前那样静默丢弃 ——
   * 静默丢弃的表现就是"进了房间却完全控制不了方向"。
   *
   * 重试是节流的：转向指令 30Hz 上报，若每条都重试会成倍放大流量。
   * 只有"准入失败"才补发（最多补 2 次、每次间隔 220ms），
   * 补发的是当前目标角 —— 玩家按住不放时，补一条就够了。
   */
  private send(payload: Record<string, unknown>) {
    if (!this.match_id || !this.myId) return;
    this.socket?.socket?.emit(
      'room:player-action',
      this.match_id,
      { player_id: this.myId, ...payload },
      (res: any) => {
        if (res?.success) {
          this.retryCount = 0;
          return;
        }
        // 其它失败原因（超时、参数非法等）重试也没意义
        if (this.retryCount >= 2) return;
        this.retryCount++;
        setTimeout(() => {
          if (this.status === 'playing' && this.predAlive && this.hasAim) {
            this.send({ angle: this.targetAngle });
          }
        }, 220);
      },
    );
  }

  // ===== 快照 =====
  /**
   * 收快照：只登记最新的那条 + 记到达间隔，处理留给渲染帧（见 `pendingSnap`）。
   *
   * socket 回调必须**极轻**：它和渲染共用主线程，弱网一次 flush 十几条时，
   * 每条都在这里做重活就会把 rAF 顶掉 —— 玩家看到的是「自己也在卡」。
   */
  private queueSnapshot(snap: Snapshot) {
    this.pendingSnap = snap;
    this.noteArrival();
  }

  /** 记一次「快照到达」：慢网判定（`avgGap` / `stale`）只认这个时刻 */
  private noteArrival() {
    const now = Date.now();
    const gap = this.lastArriveAt ? now - this.lastArriveAt : 0;
    if (gap > 0 && gap < 5000) {
      this.gaps.push(gap);
      if (this.gaps.length > 5) this.gaps.shift();
      this.avgGap = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
    }
    this.lastArriveAt = now;
  }

  /** 帧内消化待处理快照：一帧最多一条，且只消化最新的那条 */
  drainPendingSnapshot() {
    const snap = this.pendingSnap;
    if (!snap) return;
    this.pendingSnap = null;
    this.draining = true;
    try {
      this.applySnapshot(snap);
    } finally {
      this.draining = false;
    }
  }

  private applySnapshot(snap: Snapshot) {
    // 外来的帧要挡掉（SB-053）：
    // 同一个房间如果同时存在两个运行时（僵尸对局没停干净），它们会往同一个频道
    // 交替广播快照 —— 僵尸那局里没有我的蛇，客户端就会在两个对局的画面之间来回跳，
    // 「已出局」提示每 50ms 闪一次。这里按「快照里有没有我」判定帧的归属：
    // · 见过自己的蛇、这帧却没有 → 外来帧，整帧丢弃；
    // · 从没见过自己的蛇、我是对战玩家 → 我还没进这一局，保持等待态（别报出局）；
    // · 观战者本来就没有蛇 → 正常渲染。
    const myId = this.myId;
    const mineInSnap = snap.snakes.find(x => x.id === myId);
    if (!mineInSnap) {
      if (this.mySnakeSeen) return;
      if (this.isPlayerMember) {
        this.status = 'waiting';
        this.emitView();
        return;
      }
    } else {
      this.mySnakeSeen = true;
    }

    this.w = snap.w || this.w;
    this.h = snap.h || this.h;
    this.radius = snap.radius || this.radius;
    this.tick = snap.tick || 0;
    // 本局参数（服务端下发）：预测公式必须与服务端权威用同一份数值
    if (snap.params) this.params = resolveSnakeParams(snap.params);
    this.applyFoodDelta(snap);
    if (snap.variant === 'team' || snap.variant === 'endless') this.variant = snap.variant;
    if (Array.isArray(snap.players) && snap.players.length) {
      // 以快照里的座位表为准：局中进来的人也能立刻显示昵称
      this.players = snap.players.map(p => ({ id: p.id, nickname: p.nickname || '玩家', team: p.team || '' }));
    }
    if (snap.teamScores) this.teamScores = snap.teamScores;
    this.endsAt = typeof snap.endsIn === 'number' ? Date.now() + snap.endsIn : 0;
    if (typeof snap.todayBest === 'number') this.todayBest = snap.todayBest;

    const now = Date.now();
    // 慢网识别只看 `avgGap`（在 `queueSnapshot` 里按**到达**间隔统计）：
    // 换成按消化间隔统计的话，突发快照被摊成每帧一条，会误判成「网络很好」
    // 视觉误差平滑：先记下"旧快照在现在这一刻的预测位置"，
    // 新快照进来后两者的差值就是这次校正量，作为渲染偏移逐步吃掉（否则每 50ms 顿一下）
    const beforePred = this.predict(now);
    this.snakes = snap.snakes.map(s => ({
      id: s.id,
      x: s.x,
      y: s.y,
      angle: s.angle,
      // 直接引用这条消息刚解析出来的数组：没有别处共享、也没有任何地方原地改它，
      // 逐点拷贝只会给弱网突发添一份「30 条蛇 × 200 点」的 GC 压力（GM-snake-49）
      pts: s.pts as [number, number][],
      length: s.length,
      alive: s.alive,
      score: s.score,
      best: Math.max(s.score || 0, s.best || 0),
      mine: s.id === myId,
      invincible: s.invincible || 0,
      boosting: s.boosting === true,
      boostHeld: s.boostHeld === true,
      magnet: s.magnet || 0,
      star: s.star || 0,
      respawnIn: s.respawnIn || 0,
      respawns: s.respawns || 0,
      team: s.team || '',
      skin: s.skin || '',
    }));
    this.awaiting = snap.snakes.find(x => x.id === myId)?.awaiting === true;
    this.winner = snap.winner || '';
    this.status = snap.status === 'over' ? 'over' : 'playing';

    // 远端蛇的本地路径同步：
    // 快照里的 pts 是「那一瞬间的身体」，直接拿去渲染，尾巴每 50ms 跳一次。
    // 这里把快照的蛇身折线存成连续路径，之后每帧自己往前推 → 尾巴连续滑动。
    this.syncRemotePaths(snap.snakes, now);

    const mine = this.snakes.find(s => s.mine);
    if (mine) {
      this.predAlive = mine.alive;
      this.invincibleUntil = now + mine.invincible;
      this.respawnAt = mine.alive ? 0 : now + mine.respawnIn;
      this.respawns = mine.respawns || this.respawns;
      // 加速的「按住」以本地手指为准：**不用服务端快照回写本地按住态**。
      // 服务端的 boostHeld 是上一帧的值 —— 玩家刚按下还没到服务端时会被它清掉，
      // 按钮当场变灰，看起来像按键失灵。反过来服务端发 boostHeld=true 也不回写本地
      // （玩家已经松手了），所以本地只认 pointer 事件。
      if (!mine.alive) this.boostHeld = false;
      // 道具效果：服务端给的是剩余毫秒数，本地记下截止点（磁铁用于渲染提示圈）
      if (mine.magnet) this.localMagnetUntil = Math.max(this.localMagnetUntil, now + mine.magnet);
      // 星星金圈同理：本地按截止点连续衰减，不受 20Hz 快照节奏影响
      if (mine.star) this.localStarUntil = Math.max(this.localStarUntil, now + mine.star);
      this.snap = {
        x: mine.x,
        y: mine.y,
        angle: mine.angle,
        pts: mine.pts.map(([x, y]) => [x, y] as [number, number]),
        length: mine.length,
        // 快照是"服务端那一刻"的状态，到达客户端已经过了一个单程延迟。
        // 慢网时把基准时间往前挪一点，让本地预测多走这段路 —— 本地控制为主，不被旧状态拽住。
        at: now - Math.min(160, Math.max(0, this.avgGap / 2 - 25)),
      };
      // 首次拿到快照 / 重生后：本地目标角对齐当前朝向，避免"刚出生就往回拐"
      if (this.lastSnapshotAt === 0 || !this.predAliveWasAlive) this.targetAngle = mine.angle;
      // 自己这条蛇的本地连续路径：
      // 快照里的 pts 是**稀疏采样**（服务端沿密集路径每 22px 采一点 + 补精确尾点），
      // 直接拿它当身体 → 客户端按身长截断时根本截不到底，尾巴只能停在
      // 最后一个采样点上 → 每 50ms 跳一格（尾部一顿一顿的根源）。
      // 这里用快照 pts 建一条本地路径，之后每帧自己往前推 → 尾巴贴着身体连续滑动。
      // 后续快照**不整体替换路径**（那会把本地推进出来的连续性抹掉），只更新身长。
      const respawned = this.myRespawns !== -1 && this.myRespawns !== mine.respawns;
      if (!mine.alive) {
        this.myPath = null;
      } else if (!this.myPath || respawned) {
        this.myPath = {
          path: mine.pts.map(([x, y]) => [x, y] as [number, number]),
          length: mine.length || 0,
          at: now,
        };
      } else {
        this.myPath.length = mine.length || this.myPath.length;
      }
      this.myRespawns = mine.respawns || 0;
    } else {
      this.predAlive = false;
      this.snap = null;
      this.boostHeld = false;
    }
    this.predAliveWasAlive = !!mine?.alive;
    this.lastSnapshotAt = now;

    const wasStale = this.avgGap > STALE_GAP_MS;
    const afterPred = this.predict(now);
    if (beforePred && afterPred) {
      let da = normalizeAngle(beforePred.angle - afterPred.angle);
      if (da > Math.PI) da -= TAU;
      this.corr.x += beforePred.x - afterPred.x;
      this.corr.y += beforePred.y - afterPred.y;
      this.corr.a += da;
      // 正常网络下，重生/切房间这类整条蛇瞬移不做平滑，直接吸附；
      // 慢网时不吸附 —— 差值也可能是"迟到快照"造成的，本地位置更可信，交给衰减慢慢消化。
      if (!wasStale && Math.hypot(this.corr.x, this.corr.y) > 140) {
        this.corr.x = 0; this.corr.y = 0; this.corr.a = 0;
      }
    }
    // 帧内消化时不广播：调用方（`view()`）紧接着就会用新数据算一版视图，
    // 再 emit 一次等于把整套远端路径推进/纠偏白算一遍
    if (!this.draining) this.emitView();
  }

  /**
   * 拾取物增量合并：
   * - `foodFull` 或带了 `food` 数组 → 整表替换（开局首帧 / 中途加入 / 每 10s 对齐）；
   * - 否则按 id 删 `foodDel`、加 `foodAdd`、按 id 改坐标 `foodMove`。
   *
   * `foodMove` 是磁铁吸附的通道：服务端把范围内食物往蛇头拉（改了 x/y），
   * 增删协议只带 id → 客户端食物纹丝不动，看起来就是「吸的效果没了」。
   *
   * 本地预测只影响渲染时临时过滤出来的数组，不动 `this.food`，
   * 所以「猜错了」不会把食物永久吃掉——下一帧快照里它还在。
   */
  private applyFoodDelta(snap: Snapshot) {
    const full = snap.foodFull === true || Array.isArray(snap.food);
    if (full) {
      this.food = (snap.food || []).map(f => ({ id: f.id, x: f.x, y: f.y, r: f.r, v: f.v, k: f.k, t: f.t }));
      return;
    }
    if (snap.foodDel?.length) {
      const gone = new Set(snap.foodDel);
      this.food = this.food.filter(f => f.id === undefined || !gone.has(f.id));
    }
    if (snap.foodAdd?.length) {
      const known = new Set(this.food.map(f => f.id));
      for (const f of snap.foodAdd) {
        // 同 id 已存在就跳过：乱序/重复的增量不能让场上出现两个一样的东西
        if (f.id !== undefined) {
          if (known.has(f.id)) continue;
          known.add(f.id);
        }
        this.food.push({ id: f.id, x: f.x, y: f.y, r: f.r, v: f.v, k: f.k, t: f.t });
      }
    }
    if (snap.foodMove?.length) {
      for (const m of snap.foodMove) {
        const f = this.food.find(x => x.id === m.id);
        // 找不到就跳过：这个 id 可能刚被吃掉（或本帧才新增），位置由 foodAdd 带
        if (!f) continue;
        f.x = m.x;
        f.y = m.y;
      }
    }
  }

  private lastSnapshotAt = 0;
  private predAliveWasAlive = true;

  /** 慢网时放宽预测上限，让蛇继续按本地输入前进而不是被 200ms 钉住 */
  private predictMaxMs() {
    if (this.avgGap <= STALE_GAP_MS) return PREDICT_MAX_MS;
    return Math.min(PREDICT_STALE_MAX_MS, Math.max(PREDICT_MAX_MS, Math.round(this.avgGap * 2.5)));
  }

  /**
   * 从最新快照前推到"现在"：用与服务端相同的角速度/速度模型跑若干子步。
   * 因为每帧都从快照重算，时间越长预测越超前但绝不累积漂移。
   */
  private predict(now: number): { x: number; y: number; angle: number } | null {
    const snap = this.snap;
    if (!snap || !this.predAlive) return null;
    const elapsed = Math.min(this.predictMaxMs(), Math.max(0, now - snap.at));
    if (elapsed < 8) return { x: snap.x, y: snap.y, angle: snap.angle };

    // 按住加速且身长够才生效（与服务端同一条判定，用同一份参数）
    const boosting = this.boostHeld && snap.length > this.params.boostMinLen;
    // 速度随身长递减（与服务端同一个公式）：长蛇更慢，角速度也随之下降
    const speed = snakeMoveSpeed(snap.length, boosting, this.params);
    // 与服务端同一条公式：角速度 = 速度 / 最小转弯半径
    const rate = snakeTurnRate(snap.length, boosting, this.params);

    const dt = elapsed / 1000;
    // 慢网时 elapsed 可达 1.5s，子步仍保持 ≤33ms 才不会把转弯算成折线
    const steps = Math.max(1, Math.min(48, Math.ceil(dt / 0.033)));
    const sub = dt / steps;

    let x = snap.x;
    let y = snap.y;
    let angle = snap.angle;
    for (let i = 0; i < steps; i++) {
      angle = turnToward(angle, this.targetAngle, rate * sub);
      x += Math.cos(angle) * speed * sub;
      y += Math.sin(angle) * speed * sub;
    }
    // 只预测**蛇头**：身体交给本地连续路径（myPath），
    // 不再把服务端 20Hz 的稀疏 spine 拼进来 —— 那正是尾巴一顿一顿的根源。
    return { x, y, angle };
  }

  /**
   * 把快照里的远端蛇同步进本地路径表。
   *
   * - 第一次见到这条蛇 → 直接用快照的 pts 建路径；
   * - 之后每次快照 → **只校正路径的头部朝向与身长**，不整体替换：
   *   整体替换会把本地推进出来的连续路径抹掉，尾巴又变成"每 50ms 跳一下"。
   *   服务端与本地只会有很小的偏差（网络延迟 + 转向时机差），
   *   让路径的头部缓慢朝权威位置靠拢即可。
   */
  private syncRemotePaths(snakes: SnapshotSnake[], now: number) {
    const seen = new Set<string>();
    for (const s of snakes) {
      if (s.id === this.myId) continue;
      seen.add(s.id);
      const rp = this.remotePaths.get(s.id);
      if (!rp) {
        // 首次：用快照建路径（路径本身就是折线，索引 0 = 蛇头）
        this.remotePaths.set(s.id, {
          path: s.pts.map(([x, y]) => [x, y] as [number, number]),
          length: s.length || 0,
          at: now,
        });
        continue;
      }
      // 死亡/重生：路径整体失效，下一帧重建（否则蛇会从旧位置"滑"过来）
      if (!s.alive) {
        this.remotePaths.delete(s.id);
        continue;
      }
      rp.length = s.length || rp.length;
      rp.at = now;
    }
    // 清理已经离场的蛇
    for (const id of [...this.remotePaths.keys()]) {
      if (!seen.has(id)) this.remotePaths.delete(id);
    }
  }

  /**
   * 每帧推进所有远端蛇的本地路径（与自己的蛇一样，渲染层每帧调一次 view()）。
   * 让远端蛇的尾巴也贴着身体连续滑动，而不是每 50ms 跳一格。
   */
  private advanceRemotePaths(now: number) {
    if (!this.remotePaths.size) return;
    for (const [id, rp] of this.remotePaths) {
      const s = this.snakes.find(x => x.id === id);
      if (!s || !s.alive) continue;
      const dt = Math.min(0.2, Math.max(0, (now - rp.at) / 1000));
      if (dt <= 0) continue;
      // 头沿权威朝向推进；速度用与服务端相同的公式（按身长递减）
      const speed = snakeMoveSpeed(rp.length, s.boosting, this.params);
      advanceLocalPath(rp, s.angle, speed, dt, s.boosting);
      rp.at = now;
    }
  }

  /**
   * 把远端蛇的本地路径头**缓慢纠偏**到权威位置。
   *
   * 本地路径靠自己往前推，会与服务端产生小偏差（网络延迟、转向时机差）。
   * 偏差不纠正会随时间累积，长局里远端蛇会明显"跑偏"。
   * 这里只移动**头部那一个点**，并按偏差比例渐进修正 ——
   * 身体其余部分不动，所以尾巴的连续性不受影响。
   */
  private correctRemotePaths() {
    for (const [id, rp] of this.remotePaths) {
      const s = this.snakes.find(x => x.id === id);
      if (!s || !s.alive || !rp.path.length) continue;
      const dx = s.x - rp.path[0][0];
      const dy = s.y - rp.path[0][1];
      const err = Math.hypot(dx, dy);
      // 偏差很小就不用动（避免抖动）；很大说明本地路径已经失效，直接重建
      if (err < 0.5) continue;
      if (err > 60) {
        // 差太远（重生/瞬移/长时间挂起）：整体重建路径
        rp.path = s.pts.map(([x, y]) => [x, y] as [number, number]);
        rp.length = s.length || rp.length;
        continue;
      }
      // 渐进修正：一次吃掉 25% 的偏差。
      // 走 pushPathHead：偏差向后（本地超前）时它只替换头点、不插点，
      // 不会在头部留下一段折返（那正是"某一节超前"的根源）。
      const k = 0.25;
      pushPathHead(rp.path, rp.path[0][0] + dx * k, rp.path[0][1] + dy * k, 0.3);
    }
  }

  /**
   * 推进自己那条蛇的本地路径，返回渲染用的身体折线。
   *
   * **身体 = 蛇头自己走过的轨迹**：每帧把本地预测的头位置接到
   * 路径头部，再按身长从尾部截断 → 尾巴贴着身体连续滑动
   * （而不是每 50ms 跳一格）。
   *
   * 预测头每帧都从最新快照重算，渲染时整体叠加 corr 平移，
   * 所以头与身体严丝合缝。
   */
  private advanceMyPath(
    now: number,
    pred: { x: number; y: number; angle: number } | null,
  ): [number, number][] | null {
    const mp = this.myPath;
    if (!mp || !pred || mp.path.length < 2) return null;
    const dx = pred.x - mp.path[0][0];
    const dy = pred.y - mp.path[0][1];
    if (Math.hypot(dx, dy) > 60) {
      // 差太远（重生 / 长时间挂起）：整体重建，别让身体从旧位置"滑"过来
      const src = this.snakes.find(x => x.mine);
      if (src && src.pts.length >= 2) {
        mp.path = src.pts.map(([x, y]) => [x, y] as [number, number]);
        mp.length = src.length || mp.length;
        mp.at = now;
        return mp.path;
      }
    }
    // 身体 = 蛇头自己走过的轨迹（GM-snake-45）：每帧只把**预测头位置**接到
    // 路径头部，再按身长从尾部截断。旧实现先按速度推进路径、再把头"吸附到"
    // 预测位置 —— 两个来源互相打架：预测偶尔落在上一点后面时，路径头部就多了一
    // 段折返，按弧长取锚点时那一节就永远是错位的（见 pushPathHead）。
    pushPathHead(mp.path, pred.x, pred.y, 0.4);
    truncatePathInPlace(mp.path, mp.length);
    mp.at = now;
    return mp.path;
  }

  // ===== 渲染数据 =====
  view(): SnakeView {
    // 网络抖动积压的快照在这里统一消化：每帧最多一条，突发再多也只算一次
    this.drainPendingSnapshot();
    const now = Date.now();
    const mySnake = this.snakes.find(s => s.mine);
    const pred = this.predict(now);

    // 校正量逐帧衰减：新快照带来的几像素回拉被摊到 ~5 帧里，视觉上是连续的。
    // 按时间戳节流：渲染循环每帧会调一次 view()，快照到达时又会调一次，
    // 不节流的话校正量会被衰减两次（回拉变得突兀，蛇会"弹一下"）。
    if (now - this.lastDecayAt >= 4) {
      this.lastDecayAt = now;
      if (this.corr.x || this.corr.y || this.corr.a) {
        // 慢网时衰减更慢：本地位置保持得更久，不被迟到的快照硬拽回去
        const k = this.stale ? 0.86 : 0.7;
        this.corr.x *= k;
        this.corr.y *= k;
        this.corr.a *= k;
        if (Math.abs(this.corr.x) < 0.05 && Math.abs(this.corr.y) < 0.05 && Math.abs(this.corr.a) < 0.0005) {
          this.corr.x = 0;
          this.corr.y = 0;
          this.corr.a = 0;
        }
      }
    }

    const shiftX = this.corr.x;
    const shiftY = this.corr.y;
    const headX = pred ? pred.x + shiftX : 0;
    const headY = pred ? pred.y + shiftY : 0;
    // 远端蛇：先把本地路径往前推（尾巴连续滑动），再把头纠偏到权威位置，最后用它渲染
    this.advanceRemotePaths(now);
    this.correctRemotePaths();
    // 自己那条蛇：同样用本地连续路径渲染身体（尾巴不再随快照跳格）
    const myBody = this.advanceMyPath(now, pred);
    const snakes = this.snakes.map(s => {
      if (s.mine) {
        if (!pred) return s;
        // 本地路径还没有（刚进场/刚重生）时退回快照里的身体
        const body = myBody && myBody.length >= 2 ? myBody : s.pts;
        return {
          ...s,
          x: headX,
          y: headY,
          angle: normalizeAngle(pred.angle + this.corr.a),
          // 身体整条跟着平移，头与身子不会错位（实测：给身体单独加低通反而让头身相对运动更抖）
          pts: (shiftX || shiftY)
            ? body.map(([x, y]) => [x + shiftX, y + shiftY] as [number, number])
            : body,
          invincible: Math.max(0, this.invincibleUntil - now),
          // 星星金圈按本地截止点连续衰减；服务端快照每 50ms 才刷新一次，
          // 直接用快照值会让金圈随快照节奏一格一格地消失
          star: Math.max(0, this.localStarUntil - now),
          boosting: this.boostHeld && s.length > this.params.boostMinLen,
          boostHeld: this.boostHeld,
        };
      }
      // 远端蛇：优先用本地连续路径；没有（刚进场/刚重生）就退回快照的 pts
      const rp = this.remotePaths.get(s.id);
      if (!rp || rp.path.length < 2) return s;
      return { ...s, pts: rp.path };
    });

    // 预测已经吃到的食物先本地隐藏，避免"蛇头压过食物却还在"的穿模观感。
    // 每颗食物半径不同（分三档），判定要按各自的 r 算。
    // 先做一次 O(n) 扫描判断附近有没有食物：绝大多数帧没有，就直接把原数组交出去，
    // 省掉每帧一次数组复制（渲染循环每秒要跑 60 次）。
    let food = this.food;
    if (pred && mySnake?.alive) {
      let near = false;
      for (let i = 0; i < this.food.length; i++) {
        const f = this.food[i];
        const dx = f.x - headX;
        const dy = f.y - headY;
        const limit = SNAKE_HEAD_RADIUS + f.r;
        if (dx * dx + dy * dy <= limit * limit) { near = true; break; }
      }
      if (near) {
        food = this.food.filter(f => {
          const limit = SNAKE_HEAD_RADIUS + f.r;
          return Math.hypot(f.x - headX, f.y - headY) > limit;
        });
      }
    }

    return {
      variant: this.variant,
      w: this.w,
      h: this.h,
      radius: this.radius,
      food,
      snakes,
      players: this.players,
      myId: this.myId,
      score: mySnake?.score ?? 0,
      best: mySnake?.best ?? 0,
      alive: mySnake ? mySnake.alive : false,
      length: mySnake?.length ?? 0,
      boosting: this.boostHeld && (mySnake?.length ?? 0) > this.params.boostMinLen,
      boostHeld: this.boostHeld,
      invincible: Math.max(0, this.invincibleUntil - now),
      respawnIn: mySnake && !mySnake.alive ? Math.max(0, this.respawnAt - now) : 0,
      awaiting: this.awaiting,
      respawns: this.respawns,
      status: this.status,
      winner: this.winner,
      teamScores: this.teamScores,
      endsIn: this.endsAt ? Math.max(0, this.endsAt - now) : 0,
      todayBest: this.todayBest,
      params: this.params,
    };
  }

  private emitView() {
    this.emit('state', this.view());
  }

  destroy() {
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
    this.socket?.socket?.off('room:player-action', this.onRemoteAction);
  }
}

/**
 * 把新的蛇头位置接到路径头部，**保证弧长单调前进**（绝不产生折返段）。
 *
 * 为什么需要它（GM-snake-45）：旧实现把一帧内分出的若干个提前点
 * 一次 `path.unshift(...insert)` 插进去，而 `insert` 是按「由近到远」生成的 ——
 * unshift 之后 `path[0]` 是**最靠后**的那个点，紧跟其后的点反而更靠前，
 * 于是路径头部留下一段来回折返的「死弧」。按弧长取锚点时，这段死弧被
 * 当成身体长度吃掉：一次掉帧（dt>36ms → 分两小步）就在路径里**永久**
 * 刻下一个 4px 的压缩量 —— 一个个圆沿身体排下去，到那一段就「超前半个身位」，
 * 随着身体前进慢慢移到尾巴，看起来就是「某一节始终错位」。
 *
 * 语义归一为「只往前接」：
 * - 离头不足 `minStep`（亚像素抖动）→ 只挪头点，不新增点；
 * - 新头落在头的**后方**（预测被服务端回拉）→ 替换头点，不插点；
 * - 其余 → 插到最前面。多次调用天然有序（每次插入的点都成为新的头）。
 */
export function pushPathHead(
  path: [number, number][],
  x: number,
  y: number,
  minStep = 0.5,
): void {
  if (!path.length) { path.push([x, y]); return; }
  const hx = path[0][0];
  const hy = path[0][1];
  const dx = x - hx;
  const dy = y - hy;
  if (Math.hypot(dx, dy) < minStep) { path[0] = [x, y]; return; }
  if (path.length > 1) {
    // 头 → 第二节 的方向就是「前方」；新头在反方向就是回拉
    const bx = hx - path[1][0];
    const by = hy - path[1][1];
    if (dx * bx + dy * by < 0) { path[0] = [x, y]; return; }
  }
  path.unshift([x, y]);
}

export function advanceLocalPath(
  rp: RemotePath,
  angle: number,
  speed: number,
  dt: number,
  boosting: boolean,
): void {
  const path = rp.path;
  if (path.length < 2) return;
  const step = speed * dt;
  if (step <= 0) return;

  // 沿当前朝向推进头（分小步，走直线不会把弯角切掉）。
  // 注意每次 pushPathHead 都把新点插在最前面，所以「由近到远」依次接就天然有序；
  // 不能先攒一个数组再整体 unshift —— 顺序一反就是折返。
  const steps = Math.max(1, Math.min(16, Math.ceil(step / 4)));
  const sub = step / steps;
  let hx = path[0][0];
  let hy = path[0][1];
  for (let i = 0; i < steps; i++) {
    hx += Math.cos(angle) * sub;
    hy += Math.sin(angle) * sub;
    pushPathHead(path, hx, hy, 0.25);
  }

  // 尾部收缩：身长不变 → 砍掉前进量那么多；加速时身长在扣 → 砍更多
  const target = boosting ? rp.length - DEFAULT_SNAKE_PARAMS.boostDrain * dt : rp.length;
  rp.length = Math.max(60, target);
  truncatePathInPlace(path, rp.length);
}

/** 就地截断折线到指定弧长（末尾插值到精确点） */
export function truncatePathInPlace(pts: [number, number][], length: number): void {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= length) {
      const t = seg > 1e-6 ? (length - acc) / seg : 0;
      pts[i] = [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t];
      pts.length = i + 1;
      return;
    }
    acc += seg;
  }
}
