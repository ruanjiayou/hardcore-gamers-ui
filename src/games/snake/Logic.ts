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

export type Variant = 'endless' | 'multi';

/** 与服务端保持一致的物理参数（像素/秒、弧度/秒） */
export const SNAKE_SPEED = 170;
export const SNAKE_BOOST_MULT = 1.85;
/** 最小转弯半径（像素）：角速度 ω = v / R，与服务端同一套推导 */
export const SNAKE_MIN_TURN_RADIUS = 26;
export const SNAKE_BOOST_MIN_TURN_RADIUS = 42;
export const SNAKE_TURN_RATE = SNAKE_SPEED / SNAKE_MIN_TURN_RADIUS;
export const SNAKE_BOOST_TURN_RATE = (SNAKE_SPEED * SNAKE_BOOST_MULT) / SNAKE_BOOST_MIN_TURN_RADIUS;
export const SNAKE_RADIUS = 12;
export const SNAKE_HEAD_RADIUS = 13;
export const SNAKE_FOOD_RADIUS = 7;
/** 3s 冲刺，1 分钟一次（与服务端一致） */
export const SNAKE_BOOST_MS = 3000;
export const SNAKE_BOOST_CD_MS = 60_000;

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
  /** 加速中 */
  boosting: boolean;
  /** 加速冷却剩余（ms） */
  boostCd: number;
  /** 距离重生（ms） */
  respawnIn: number;
  /** 已重生次数（无尽），用于检测"整条蛇瞬移" */
  respawns: number;
}

export interface SnakeView {
  variant: Variant;
  /** 世界宽高（像素） */
  w: number;
  h: number;
  radius: number;
  food: [number, number][];
  snakes: SnakeEntry[];
  players: { id: string; nickname: string }[];
  myId: string;
  score: number;
  best: number;
  /** 我是否活着（死亡时镜头停在原地，等待重生） */
  alive: boolean;
  boosting: boolean;
  boostCd: number;
  invincible: number;
  respawnIn: number;
  /** 已出局、等玩家选「重生 / 退出」（无尽模式） */
  awaiting: boolean;
  respawns: number;
  status: 'waiting' | 'playing' | 'over';
  winner: string;
}

interface SnapshotSnake {
  id: string;
  x: number;
  y: number;
  angle: number;
  pts: [number, number][];
  length: number;
  alive: boolean;
  score: number;
  best?: number;
  invincible?: number;
  boosting?: number;
  boostCd?: number;
  respawnIn?: number;
  awaiting?: boolean;
  respawns?: number;
}

interface Snapshot {
  w: number;
  h: number;
  radius?: number;
  tick: number;
  variant?: string;
  food: [number, number][];
  /** 座位表：局中有人加入时也会随快照刷新 */
  players?: { id: string; nickname: string }[];
  snakes: SnapshotSnake[];
  status: 'playing' | 'over';
  winner?: string;
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
  food: [number, number][] = [];
  snakes: SnakeEntry[] = [];
  players: { id: string; nickname: string }[] = [];
  status: 'waiting' | 'playing' | 'over' = 'waiting';
  winner = '';
  tick = 0;

  // ===== 本地预测（只针对自己） =====
  /** 最新快照里自己的蛇（预测基准，不随预测改动） */
  private snap: { x: number; y: number; angle: number; pts: [number, number][]; length: number; at: number } | null = null;
  /** 玩家期望朝向：摇杆/鼠标/键盘给的世界绝对角度，本地立即生效 */
  private targetAngle = 0;
  private predAlive = true;
  /** 上报完全独立：固定 33ms 定时器只在角度变化时发包，aim() 不碰网络 */
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private lastSentAngle = Number.NaN;
  /** 玩家还没给过方向时不要上报：否则会拿默认 0 覆盖服务端"朝地图中心"的出生角度 */
  private hasAim = false;
  /** 渲染校正量（像素 / 弧度）：新快照把蛇头往回拉时，用它把跳变摊平 */
  private corr = { x: 0, y: 0, a: 0 };
  /** 上一次校正量衰减的时间戳：保证一帧只衰减一次 */
  private lastDecayAt = 0;
  /** 最近几次快照间隔（ms），用于识别慢网并自适应放宽预测 */
  private gaps: number[] = [];
  private avgGap = 0;
  private roomId = '';

  // ===== 本地展示的加速状态（乐观 + 快照纠正） =====
  private localBoostUntil = 0;
  private localBoostReadyAt = 0;
  private invincibleUntil = 0;
  private awaiting = false;
  private respawnAt = 0;
  private respawns = 0;

  private onRemoteAction = (data: any) => {
    if (data?.snake) this.applySnapshot(data.snake as Snapshot);
  };

  constructor(socket: SocketTransport, player: any, variant?: string, room?: any) {
    super();
    this.socket = socket;
    this.player = player;
    this.roomMembers = room?.members || [];
    this.roomId = room?._id || player?.room_id || '';
    this.variant = variant === 'multi' ? 'multi' : 'endless';
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
    if (state.match_id) this.match_id = state.match_id;
    if (Array.isArray(state.players)) {
      this.players = state.players
        .filter((p: any) => p.member_type === 'player' || p.role === 'player' || p.role === 'snake')
        .map((p: any) => ({
          id: p._id,
          nickname: p.nickname
            || this.roomMembers.find((m: any) => m._id === p._id)?.nickname
            || '玩家',
        }));
    }
    const variant = state.variant as string | undefined;
    if (variant === 'multi' || variant === 'endless') this.variant = variant;
    this.status = state.snake ? 'playing' : 'waiting';
    if (state.snake) this.applySnapshot(state.snake as Snapshot);
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

  /** 加速：有冷却，服务端权威；本地先乐观置灰给出即时反馈 */
  boost() {
    if (this.status !== 'playing' || !this.predAlive) return;
    const now = Date.now();
    if (now < this.localBoostReadyAt) return;
    this.localBoostUntil = now + SNAKE_BOOST_MS;
    this.localBoostReadyAt = now + SNAKE_BOOST_CD_MS;
    this.send({ boost: true });
    this.emitView();
  }

  /**
   * 无尽模式：死亡弹框里点「重生」。
   * 本地先收起弹框（乐观），真正的复活位置/无敌时间以服务端下一帧快照为准。
   */
  respawn() {
    if (this.variant !== 'endless' || !this.awaiting) return;
    this.awaiting = false;
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

  private send(payload: Record<string, unknown>) {
    if (!this.match_id || !this.myId) return;
    this.socket?.socket?.emit('room:player-action', this.match_id, {
      player_id: this.myId,
      ...payload,
    });
  }

  // ===== 快照 =====
  private applySnapshot(snap: Snapshot) {
    this.w = snap.w || this.w;
    this.h = snap.h || this.h;
    this.radius = snap.radius || this.radius;
    this.tick = snap.tick || 0;
    this.food = snap.food.map(([x, y]) => [x, y] as [number, number]);
    if (snap.variant === 'multi' || snap.variant === 'endless') this.variant = snap.variant;
    if (Array.isArray(snap.players) && snap.players.length) {
      // 以快照里的座位表为准：局中进来的人也能立刻显示昵称
      this.players = snap.players.map(p => ({ id: p.id, nickname: p.nickname || '玩家' }));
    }

    const myId = this.myId;
    const now = Date.now();
    // 慢网识别：记录最近几次快照的真实间隔（排除首次与 >5s 的异常值）
    const prevGap = this.lastSnapshotAt ? now - this.lastSnapshotAt : 0;
    if (prevGap > 0 && prevGap < 5000) {
      this.gaps.push(prevGap);
      if (this.gaps.length > 5) this.gaps.shift();
      this.avgGap = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length;
    }
    // 视觉误差平滑：先记下"旧快照在现在这一刻的预测位置"，
    // 新快照进来后两者的差值就是这次校正量，作为渲染偏移逐步吃掉（否则每 50ms 顿一下）
    const beforePred = this.predict(now);
    this.snakes = snap.snakes.map(s => ({
      id: s.id,
      x: s.x,
      y: s.y,
      angle: s.angle,
      pts: s.pts.map(([x, y]) => [x, y] as [number, number]),
      length: s.length,
      alive: s.alive,
      score: s.score,
      best: Math.max(s.score || 0, s.best || 0),
      mine: s.id === myId,
      invincible: s.invincible || 0,
      boosting: (s.boosting || 0) > 0,
      boostCd: s.boostCd || 0,
      respawnIn: s.respawnIn || 0,
      respawns: s.respawns || 0,
    }));
    this.awaiting = snap.snakes.find(x => x.id === myId)?.awaiting === true;
    this.winner = snap.winner || '';
    this.status = snap.status === 'over' ? 'over' : 'playing';

    const mine = this.snakes.find(s => s.mine);
    if (mine) {
      this.predAlive = mine.alive;
      this.invincibleUntil = now + mine.invincible;
      this.respawnAt = mine.alive ? 0 : now + mine.respawnIn;
      this.respawns = mine.respawns || this.respawns;
      // 服务端冷却为准，只往"更晚"的方向纠正，避免本地乐观值被旧快照覆盖
      this.localBoostReadyAt = Math.max(this.localBoostReadyAt, now + mine.boostCd);
      if (mine.boosting) this.localBoostUntil = Math.max(this.localBoostUntil, now + 60);
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
    } else {
      this.predAlive = false;
      this.snap = null;
    }
    this.predAliveWasAlive = !!mine?.alive;
    this.lastSnapshotAt = now;

    const wasStale = prevGap > STALE_GAP_MS || this.avgGap > STALE_GAP_MS;
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
    this.emitView();
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
  private predict(now: number): { x: number; y: number; angle: number; pts: [number, number][] } | null {
    const snap = this.snap;
    if (!snap || !this.predAlive) return null;
    const elapsed = Math.min(this.predictMaxMs(), Math.max(0, now - snap.at));
    if (elapsed < 8) return { x: snap.x, y: snap.y, angle: snap.angle, pts: snap.pts };

    const boosting = now < this.localBoostUntil;
    const speed = SNAKE_SPEED * (boosting ? SNAKE_BOOST_MULT : 1);
    // 与服务端同一条公式：角速度 = 速度 / 最小转弯半径
    const rate = speed / (boosting ? SNAKE_BOOST_MIN_TURN_RADIUS : SNAKE_MIN_TURN_RADIUS);

    const dt = elapsed / 1000;
    // 慢网时 elapsed 可达 1.5s，子步仍保持 ≤33ms 才不会把转弯算成折线
    const steps = Math.max(1, Math.min(48, Math.ceil(dt / 0.033)));
    const sub = dt / steps;

    let x = snap.x;
    let y = snap.y;
    let angle = snap.angle;
    const head: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      angle = turnToward(angle, this.targetAngle, rate * sub);
      x += Math.cos(angle) * speed * sub;
      y += Math.sin(angle) * speed * sub;
      head.push([x, y]);
    }

    // 新轨迹倒序接在快照路径前（索引 0 = 蛇头），再按身长截断
    const pts: [number, number][] = head.reverse().concat(snap.pts);
    return { x, y, angle, pts: truncatePath(pts, snap.length) };
  }

  // ===== 渲染数据 =====
  view(): SnakeView {
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
    const snakes = this.snakes.map(s => {
      if (!s.mine || !pred) return s;
      return {
        ...s,
        x: headX,
        y: headY,
        angle: normalizeAngle(pred.angle + this.corr.a),
        // 身体整条跟着平移，头与身子不会错位
        pts: (shiftX || shiftY)
          ? pred.pts.map(([x, y]) => [x + shiftX, y + shiftY] as [number, number])
          : pred.pts,
        invincible: Math.max(0, this.invincibleUntil - now),
        boosting: now < this.localBoostUntil,
        boostCd: Math.max(0, this.localBoostReadyAt - now),
      };
    });

    // 预测已经吃到的食物先本地隐藏，避免"蛇头压过食物却还在"的穿模观感。
    // 先做一次 O(n) 扫描判断附近有没有食物：绝大多数帧没有，就直接把原数组交出去，
    // 省掉每帧一次 70 元素的数组复制（渲染循环每秒要跑 60 次）。
    let food = this.food;
    if (pred && mySnake?.alive) {
      const limit = SNAKE_HEAD_RADIUS + SNAKE_FOOD_RADIUS;
      const limit2 = limit * limit;
      let near = false;
      for (let i = 0; i < this.food.length; i++) {
        const dx = this.food[i][0] - headX;
        const dy = this.food[i][1] - headY;
        if (dx * dx + dy * dy <= limit2) { near = true; break; }
      }
      if (near) {
        food = this.food.filter(([fx, fy]) => Math.hypot(fx - headX, fy - headY) > limit);
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
      boosting: now < this.localBoostUntil,
      boostCd: Math.max(0, this.localBoostReadyAt - now),
      invincible: Math.max(0, this.invincibleUntil - now),
      respawnIn: mySnake && !mySnake.alive ? Math.max(0, this.respawnAt - now) : 0,
      awaiting: this.awaiting,
      respawns: this.respawns,
      status: this.status,
      winner: this.winner,
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

/** 按身长截断折线（最后一个点插值到精确长度） */
function truncatePath(pts: [number, number][], length: number): [number, number][] {
  if (pts.length < 2) return pts;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (acc + seg >= length) {
      const t = seg > 1e-6 ? (length - acc) / seg : 0;
      const tail: [number, number] = [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t];
      return pts.slice(0, i).concat([tail]);
    }
    acc += seg;
  }
  return pts;
}
