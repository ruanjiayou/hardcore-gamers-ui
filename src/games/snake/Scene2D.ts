// 贪吃蛇 2D 场景（纯 Canvas 2D）：连续像素世界，Slither 风格
// - 世界 3600×2600 像素，屏幕只显示一部分：镜头平滑跟随自己的蛇头，移动时场景滚动
// - 蛇 = 一条有宽度的折线（round join/cap），按路径绘制，不是格子
// - 输入与场景解耦：方向由屏幕固定位置的虚拟摇杆给"世界绝对角度"，
//   不再按"指针相对蛇头屏幕位置"计算 —— 镜头怎么滚动、蛇贴不贴边，操作含义都一样。
//   左下角加速按钮（带冷却环）、右下角虚拟摇杆；鼠标移动 / WASD 也能给同样的绝对角度。
// - HUD：左上角分数/最高分/玩家；死亡后弹重生/退出框
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
const TEXT = '#eef0f8';
const SUBTEXT = '#8b8ba7';
const FOOD_COLOR = '#ff5d5d';
const SNAKE_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399'];
const BOOST_COLOR = '#38bdf8';

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
const JOY_MARGIN = 26;
const JOY_R_MIN = 54;
const JOY_R_MAX = 78;
/** 摇杆手柄相对圆心的距离比例 */
const JOY_KNOB = 0.56;

/**
 * 控件布局（纯函数）：只吃画布尺寸，不吃镜头/蛇头/世界坐标 —— 控制与场景彻底解耦。
 * 左下角加速按钮、右下角虚拟摇杆，两者不重叠。
 */
export function snakeControlsLayout(cssW: number, cssH: number) {
  const br = Math.max(34, Math.min(44, Math.round(Math.min(cssW, cssH) * 0.07)));
  const jr = Math.max(JOY_R_MIN, Math.min(JOY_R_MAX, Math.round(Math.min(cssW, cssH) * 0.11)));
  return {
    boost: { x: br + 22, y: cssH - br - 22, r: br },
    joy: { x: cssW - jr - JOY_MARGIN, y: cssH - jr - JOY_MARGIN, r: jr },
  };
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Camera {
  /** 视口中心，世界坐标（像素） */
  x: number;
  y: number;
}

interface DispSnake {
  x: number;
  y: number;
  angle: number;
  pts: [number, number][];
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

  // 输入状态（全部是屏幕坐标，与镜头/世界无关）
  private pointerId: number | null = null;
  private boostPressed = false;
  /** 正在拖摇杆的那根手指 */
  private joyPointerId: number | null = null;
  /** 手指当前位置（画手柄用） */
  private joyKnob: { x: number; y: number } | null = null;
  /** 触屏按下点：移动超过死区才真正开始瞄准（避免一按就甩头） */
  private touchStart: { x: number; y: number } | null = null;
  private touchLocked = false;
  /** 死亡弹框按钮区域（屏幕坐标），tap 命中用 */
  private deadUi: { respawn: Rect; exit: Rect } | null = null;

  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onResize = () => this.resize();
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private onContextMenu = (e: Event) => e.preventDefault();

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
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerUp);
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.ro?.disconnect();
    this.ro = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.inited = false;
    this.pointerId = null;
    this.joyPointerId = null;
    this.joyKnob = null;
    this.touchStart = null;
    this.boostPressed = false;
  }

  // ===== 布局 =====
  private resize() {
    if (!this.inited) return;
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, Math.round(rect.width || 800));
    this.cssH = Math.max(1, Math.round(rect.height || 600));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(this.cssW / 900, this.cssH / 720)));
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
    // 方向键默认会滚动页面，必须拦掉
    e.preventDefault();
    this.logic.aimDir(dir);
  }

  /** 左下角加速按钮（屏幕固定坐标） */
  private boostButton() {
    return snakeControlsLayout(this.cssW, this.cssH).boost;
  }

  private inBoost(x: number, y: number) {
    const b = this.boostButton();
    return (x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 12) ** 2;
  }

  /** 右下角虚拟摇杆（屏幕固定坐标，绝不跟随镜头或蛇头） */
  private joystick() {
    return snakeControlsLayout(this.cssW, this.cssH).joy;
  }

  /** 摇杆热区：圈本身再放宽一点，手机上手指容易按中 */
  private inJoystick(x: number, y: number) {
    const j = this.joystick();
    return Math.hypot(x - j.x, y - j.y) <= j.r * 1.45;
  }

  /** 摇杆：手柄相对圆心的角度就是世界绝对朝向（0 = 向右） */
  private aimFromJoystick(px: number, py: number) {
    const angle = joystickAngle(this.joystick(), px, py);
    if (angle === null) return; // 圆心附近不给方向，避免乱跳
    this.logic.aim(angle);
  }

  /**
   * 鼠标：以"屏幕中心"为原点算绝对角度（固定参考点，与镜头/蛇头位置无关）；
   * 落在摇杆圈里时直接用摇杆角度，保持鼠标与摇杆显示一致。
   */
  private aimFromPointer(px: number, py: number) {
    if (this.inJoystick(px, py)) {
      this.aimFromJoystick(px, py);
      return;
    }
    const dx = px - this.cssW / 2;
    const dy = py - this.cssH / 2;
    if (Math.hypot(dx, dy) < 24) return;
    this.logic.aim(Math.atan2(dy, dx));
  }

  private hitRect(r: Rect, x: number, y: number) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private handlePointerDown(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 死亡弹框优先：按钮命中就执行，其余点击一律不穿透（弹框期间不转向）
    if (this.deadUi) {
      if (this.hitRect(this.deadUi.respawn, x, y)) {
        this.deadUi = null;
        this.logic.respawn();
        return;
      }
      if (this.hitRect(this.deadUi.exit, x, y)) {
        this.deadUi = null;
        this.logic.exit();
        return;
      }
      return;
    }

    if (this.inBoost(x, y)) {
      this.boostPressed = true;
      (this.canvas as any).setPointerCapture?.(e.pointerId);
      if (this.state.boostCd <= 0) this.logic.boost();
      return;
    }

    if (e.pointerType === 'touch') {
      // 触屏必须按在摇杆热区里；按下先不给方向，移动超过 4px 死区才开始算，
      // 避免手指刚落下就把蛇掰向一个莫名其妙的角度。
      if (!this.inJoystick(x, y)) return;
      this.pointerId = e.pointerId;
      this.joyPointerId = e.pointerId;
      this.touchStart = { x: e.clientX, y: e.clientY };
      this.touchLocked = false;
      (this.canvas as any).setPointerCapture?.(e.pointerId);
      return;
    }
    // 鼠标：不用按下也能给方向，参考点是固定的屏幕中心/摇杆圆心
    this.aimFromPointer(x, y);
  }

  private handlePointerMove(e: PointerEvent) {
    if (this.boostPressed) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.pointerType === 'touch') {
      // 触屏：只有拖摇杆的那根手指有效
      if (this.joyPointerId !== e.pointerId || !this.touchStart) return;
      if (!this.touchLocked) {
        const d = Math.hypot(e.clientX - this.touchStart.x, e.clientY - this.touchStart.y);
        if (d < TOUCH_DEAD_ZONE) return;
        this.touchLocked = true;
      }
      this.joyKnob = { x, y };
      this.aimFromJoystick(x, y);
      return;
    }
    this.aimFromPointer(x, y);
  }

  private handlePointerUp(e?: PointerEvent) {
    if (e && this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.joyPointerId = null;
    this.joyKnob = null;
    this.touchStart = null;
    this.touchLocked = false;
    this.boostPressed = false;
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

    // 每帧重新取一次视图：本地预测按"距快照经过的时间"前推，必须逐帧算才顺滑
    this.state = this.logic.view();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    this.updateCamera(dt);
    this.smoothRemote(dt);

    this.drawWorld();
    this.drawFood(now);
    this.drawSnakes(now);
    this.drawHud();
    this.drawBoostButton();
    this.drawJoystick();
    this.drawOverlay();
    this.drawHint();
  }

  /**
   * 把镜头中心钳在"视野不越出世界"的范围内，避免贴边时露出大片世界外空底色。
   * 世界比视口还小（极端情况）时退化为居中。
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

  private drawWorld() {
    const ctx = this.ctx;
    const { w, h } = this.state;
    const x0 = this.sx(0);
    const y0 = this.sy(0);
    const x1 = this.sx(w);
    const y1 = this.sy(h);

    // 世界之外：更暗，让边界一眼可见
    ctx.fillStyle = OUTSIDE;
    if (x0 > 0) ctx.fillRect(0, 0, x0, this.cssH);
    if (y0 > 0) ctx.fillRect(0, 0, this.cssW, y0);
    if (x1 < this.cssW) ctx.fillRect(x1, 0, this.cssW - x1, this.cssH);
    if (y1 < this.cssH) ctx.fillRect(0, y1, this.cssW, this.cssH - y1);

    // 稀疏网格（每 100 世界像素一格），纯参考线，移动时提供视差感
    const step = 100;
    const left = this.cam.x - this.cssW / (2 * this.zoom);
    const right = this.cam.x + this.cssW / (2 * this.zoom);
    const top = this.cam.y - this.cssH / (2 * this.zoom);
    const bottom = this.cam.y + this.cssH / (2 * this.zoom);

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

    // 每 500 像素一条稍亮的线，方便判断远近
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

    // 地图边界
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
  }

  private drawFood(now: number) {
    const ctx = this.ctx;
    const r = SNAKE_FOOD_RADIUS * this.zoom;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    for (const [fx, fy] of this.state.food) {
      const cx = this.sx(fx);
      const cy = this.sy(fy);
      if (cx < -r * 4 || cy < -r * 4 || cx > this.cssW + r * 4 || cy > this.cssH + r * 4) continue;
      // 外发光
      ctx.beginPath();
      ctx.arc(cx, cy, r * (2.1 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,93,93,0.10)';
      ctx.fill();
      // 果肉
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.92 + 0.08 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = FOOD_COLOR;
      ctx.fill();
      // 高光
      ctx.beginPath();
      ctx.arc(cx - r * 0.28, cy - r * 0.28, r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }
  }

  private drawSnakes(now: number) {
    const ctx = this.ctx;
    const radius = this.state.radius * this.zoom;

    this.state.snakes.forEach((snake, idx) => {
      const color = SNAKE_COLORS[idx % SNAKE_COLORS.length];
      const disp = snake.mine ? null : this.disp.get(snake.id);
      const pts = disp ? disp.pts : snake.pts;
      if (!pts.length) return;

      const alpha = snake.alive ? 1 : 0.22;
      ctx.globalAlpha = alpha;

      // 身体：一条有宽度的折线（圆角连接 = 平滑的蛇），先描深色外轮廓再描本色
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(this.sx(pts[0][0]), this.sy(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.38)';
        ctx.lineWidth = radius * 2 + Math.max(2, radius * 0.32);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.lineWidth = radius * 2;
        ctx.stroke();

        // 身体高光：一条更窄更亮的线，制造圆柱感
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.lineWidth = radius * 0.8;
        ctx.stroke();
      }

      // 加速时的尾焰光晕
      if (snake.boosting && snake.alive) {
        ctx.beginPath();
        ctx.moveTo(this.sx(pts[0][0]), this.sy(pts[0][1]));
        for (let i = 1; i < Math.min(pts.length, 6); i++) ctx.lineTo(this.sx(pts[i][0]), this.sy(pts[i][1]));
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(125,211,252,0.35)';
        ctx.lineWidth = radius * 2.6;
        ctx.stroke();
      }

      const head = pts[0];
      const hx = this.sx(head[0]);
      const hy = this.sy(head[1]);
      const angle = disp ? disp.angle : snake.angle;

      // 蛇头：比身体略大的圆 + 朝向对齐的眼睛
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

      // 无敌护盾（重生后 3s）
      if (snake.invincible > 0 && snake.alive) {
        const a = 0.3 + 0.35 * Math.sin(now / 150);
        ctx.beginPath();
        ctx.arc(hx, hy, radius * (1.8 + 0.12 * Math.sin(now / 220)), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(96,165,250,${a.toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // 别人的名字（小字浮在头顶）
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
    });
  }

  /** 左上角信息条：分数 / 最高分 / 模式 / 玩家列表（屏幕坐标，不随镜头缩放） */
  private drawHud() {
    const ctx = this.ctx;
    const s = this.state;
    const compact = this.cssW < 560;
    const w = compact ? Math.min(200, this.cssW - 120) : 210;
    const rows = Math.min(s.snakes.length, 4);
    const showPlayers = s.snakes.length > 1;
    const h = 52 + (showPlayers ? 16 + rows * 17 : 0);

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(18,18,30,0.78)';
    this.roundRect(ctx, 12, 12, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = SUBTEXT;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(s.variant === 'endless' ? '无尽挑战' : '多人对战', 24, 22);

    ctx.fillStyle = TEXT;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(String(s.score), 24, 36);
    const scoreW = ctx.measureText(String(s.score)).width;

    ctx.fillStyle = SUBTEXT;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`最高 ${s.best}`, 24 + scoreW + 10, 46);

    if (showPlayers) {
      let y = 68;
      s.snakes.slice(0, 4).forEach((snake, i) => {
        const name = s.players.find(p => p.id === snake.id)?.nickname || `玩家${i + 1}`;
        const color = SNAKE_COLORS[i % SNAKE_COLORS.length];
        ctx.globalAlpha = snake.alive ? 1 : 0.45;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(24, y + 5, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = snake.mine ? TEXT : SUBTEXT;
        ctx.font = `${snake.mine ? 'bold ' : ''}11px system-ui, sans-serif`;
        ctx.fillText(this.truncate(name, 9), 34, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = snake.alive ? TEXT : SUBTEXT;
        ctx.fillText(snake.alive ? String(snake.score) : '等待重生', 12 + w - 12, y);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
        y += 17;
      });
    }
    ctx.restore();
  }

  /** 左下角加速按钮：冷却时按剩余比例画环并显示秒数 */
  private drawBoostButton() {
    const ctx = this.ctx;
    const b = this.boostButton();
    const cd = this.state.boostCd;
    const boosting = this.state.boosting;
    const ready = cd <= 0;
    const pulse = boosting ? 1 + 0.04 * Math.sin(performance.now() / 90) : 1;

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2);
    ctx.fillStyle = ready ? 'rgba(56,189,248,0.22)' : 'rgba(24,24,36,0.82)';
    ctx.fill();
    ctx.strokeStyle = ready ? BOOST_COLOR : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (!ready) {
      const ratio = Math.max(0, Math.min(1, cd / SNAKE_BOOST_CD_MS));
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - ratio));
      ctx.strokeStyle = 'rgba(56,189,248,0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (ready) {
      ctx.fillStyle = TEXT;
      ctx.font = `bold ${Math.round(b.r * 0.42)}px system-ui, sans-serif`;
      ctx.fillText('加速', b.x, b.y);
    } else {
      ctx.fillStyle = SUBTEXT;
      // 冷却 60s：两位数秒数（"60"），最后 10s 才显示一位小数，避免小圆里挤 4 个字符
      const label = cd >= 10_000 ? String(Math.ceil(cd / 1000)) : (cd / 1000).toFixed(1);
      ctx.font = `bold ${Math.round(b.r * 0.46)}px system-ui, sans-serif`;
      ctx.fillText(label, b.x, b.y);
    }
    ctx.restore();
  }

  /**
   * 右下角虚拟摇杆：屏幕固定位置，与镜头/世界完全无关。
   * 圈里的小圆点就是"当前期望朝向"，拖动它（或移动鼠标 / 按 WASD）都会同步指向同一个绝对角度。
   */
  private drawJoystick() {
    const s = this.state;
    // 死亡弹框/未开局时不画控件，避免和弹框抢点击
    if (s.status !== 'playing' || s.awaiting || !s.alive) return;
    const ctx = this.ctx;
    const j = this.joystick();
    const active = this.joyPointerId !== null && this.touchLocked;
    const angle = this.logic.aimAngle;
    let kx = j.x + Math.cos(angle) * j.r * JOY_KNOB;
    let ky = j.y + Math.sin(angle) * j.r * JOY_KNOB;
    if (active && this.joyKnob) {
      const dx = this.joyKnob.x - j.x;
      const dy = this.joyKnob.y - j.y;
      const d = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(d, j.r * 0.82);
      kx = j.x + (dx / d) * clamped;
      ky = j.y + (dy / d) * clamped;
    }

    ctx.save();
    ctx.globalAlpha = active ? 0.98 : 0.76;
    // 外圈
    ctx.beginPath();
    ctx.arc(j.x, j.y, j.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,14,26,0.44)';
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(96,165,250,0.85)' : 'rgba(150,170,230,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 8 个刻度点：让"绝对方向"的参照更直观
    ctx.fillStyle = 'rgba(226,232,248,0.35)';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.arc(j.x + Math.cos(a) * j.r * 0.88, j.y + Math.sin(a) * j.r * 0.88, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 圆心 → 手柄
    ctx.beginPath();
    ctx.moveTo(j.x, j.y);
    ctx.lineTo(kx, ky);
    ctx.strokeStyle = 'rgba(226,232,248,0.42)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 圆心
    ctx.beginPath();
    ctx.arc(j.x, j.y, j.r * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(226,232,248,0.35)';
    ctx.fill();
    // 手柄
    ctx.beginPath();
    ctx.arc(kx, ky, j.r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = active ? 'rgba(96,165,250,0.95)' : 'rgba(96,165,250,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,248,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /** 开局几秒的操作提示（右下摇杆 / 鼠标 / WASD） */
  private drawHint() {
    if (this.state.status !== 'playing' || !this.state.alive) return;
    const age = performance.now() - this.startedAt;
    if (age > 7000) return;
    const alpha = age < 5500 ? 1 : Math.max(0, 1 - (age - 5500) / 1500);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(226,232,248,0.72)';
    const text = '右下摇杆控方向 · 鼠标/WASD 亦可 · 左下加速';
    const w = Math.min(this.cssW - 20, ctx.measureText(text).width + 28);
    ctx.fillStyle = 'rgba(12,12,22,0.6)';
    this.roundRect(ctx, (this.cssW - w) / 2, this.cssH - 46, w, 28, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(226,232,248,0.78)';
    ctx.fillText(text, this.cssW / 2, this.cssH - 32);
    ctx.restore();
  }

  /** 等待 / 死亡重生 / 结束 的中央提示 */
  private drawOverlay() {
    const s = this.state;
    const ctx = this.ctx;
    let title = '';
    let sub = '';
    // 弹框按钮区域每帧重算：不显示弹框时必须清空，否则点击会被拦掉
    this.deadUi = null;

    if (s.status === 'waiting') {
      // 无尽房是"进房即开局"的常开对局，根本没有"等待开始"这一态：
      // 首帧快照正常在 1s 内到达，这段时间不弹提示（否则会让人误以为在等人）。
      // 只有真连不上（>3s 没快照）才给个兜底文案，避免画面一片空白。
      if (s.variant === 'endless') {
        if (performance.now() - this.startedAt < 3000) return;
        title = '连接中…';
        sub = '正在进入对局';
      } else {
        title = '等待对局开始';
        sub = '进入房间后会自动开局';
      }
    } else if (s.status === 'over') {
      if (s.variant === 'multi') {
        const winner = s.snakes.find(x => x.id === s.winner);
        const name = winner ? (s.players.find(p => p.id === winner.id)?.nickname || '玩家') : '';
        title = name ? `${name} 获胜` : '平局';
      } else {
        title = '本局结束';
      }
      sub = `本局最高 ${s.best} 分`;
    } else if (!s.alive) {
      // 无尽模式：死亡后不再自动重生，弹框让玩家选「重生 / 退出」
      if (s.awaiting) {
        this.drawDeathCard();
        return;
      }
      title = '已出局';
      sub = '对局已结束';
    } else if (s.invincible > 0 && s.variant === 'endless') {
      // 无敌保护提示：小字提示，不遮挡画面
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px system-ui, sans-serif';
      const text = `无敌 ${(s.invincible / 1000).toFixed(1)}s`;
      const w = ctx.measureText(text).width + 26;
      ctx.fillStyle = 'rgba(56,189,248,0.22)';
      this.roundRect(ctx, (this.cssW - w) / 2, 16, w, 28, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(96,165,250,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#bfe3ff';
      ctx.fillText(text, this.cssW / 2, 30);
      ctx.restore();
      return;
    }

    if (!title) return;

    const w = Math.min(320, this.cssW - 40);
    const h = sub ? 96 : 68;
    const x = (this.cssW - w) / 2;
    const y = (this.cssH - h) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(10,10,18,0.82)';
    this.roundRect(ctx, x, y, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText(title, this.cssW / 2, y + (sub ? 22 : 24));
    if (sub) {
      ctx.fillStyle = SUBTEXT;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(sub, this.cssW / 2, y + 54);
    }
    ctx.restore();
  }

  /**
   * 无尽模式死亡弹框：重生 / 退出。
   * 分数在服务端"死亡那一 tick"就写进排行榜了，这里只负责展示与让玩家选择。
   */
  private drawDeathCard() {
    const s = this.state;
    const ctx = this.ctx;
    const w = Math.min(330, this.cssW - 40);
    const h = 186;
    const x = (this.cssW - w) / 2;
    const y = (this.cssH - h) / 2;

    ctx.save();
    // 压暗背景，把注意力收到卡片上
    ctx.fillStyle = 'rgba(6,8,14,0.55)';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.fillStyle = 'rgba(22,22,34,0.97)';
    this.roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f5f7ff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('已出局', this.cssW / 2, y + 22);

    ctx.fillStyle = 'rgba(160,168,190,0.95)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`本局得分 ${s.score} · 最高 ${s.best}`, this.cssW / 2, y + 56);
    ctx.fillText('分数已记入排行榜', this.cssW / 2, y + 78);

    const bw = (w - 52) / 2;
    const bh = 42;
    const by = y + h - bh - 22;
    const respawn: Rect = { x: x + 20, y: by, w: bw, h: bh };
    const exit: Rect = { x: x + 32 + bw, y: by, w: bw, h: bh };
    this.drawCardButton(respawn, '重生', true);
    this.drawCardButton(exit, '退出', false);
    this.deadUi = { respawn, exit };
    ctx.restore();
  }

  private drawCardButton(r: Rect, label: string, primary: boolean) {
    const ctx = this.ctx;
    ctx.fillStyle = primary ? '#3b82f6' : 'rgba(255,255,255,0.09)';
    this.roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.strokeStyle = primary ? 'rgba(147,197,253,0.85)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = primary ? '#ffffff' : 'rgba(226,232,248,0.92)';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
  }
  private truncate(s: string, n: number) {
    return s.length > n ? `${s.slice(0, n)}…` : s;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

/** 两个角度之间的最短弧（-π, π]），用于角度插值 */
function shortestArc(from: number, to: number): number {
  let diff = normalizeAngle(to - from);
  if (diff > Math.PI) diff -= Math.PI * 2;
  return diff;
}
