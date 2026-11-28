/**
 * 皮肤贴图的几何计算（纯函数，不碰 canvas —— 可以直接单测）。
 *
 * GM-snake-39 / GM-snake-40 / GM-snake-41：**所有类型**的身体图都是一节蛇身的贴图。
 * 不管单图、头身、头身尾还是交替身体，都把**整张图**缩到一节蛇身那么大，
 * 沿路径按弧长一节一节贴（交替皮肤轮换两张图）。
 *
 * 为什么不再用 `CanvasPattern` 描边：图案是屏幕坐标、不跟着蛇身转，
 * 而蛇只有 `2×radius` 宽 —— 一条 96px 的贴图只被截到其中一小块，
 * 蛇一转向，露出来的那块就换了，同一条蛇看着像在变花纹（角度不同效果不同）。
 * 逐节贴整张图，看到的永远是完整贴图，朝向跟着路径走。
 *
 * 为什么按弧长而不是按路径点下标：路径点是服务端每 3px 推一个、本地又每帧插值的不均匀折线，
 * 按下标分段会让节距随蛇的移动忽大忽小。按弧长算，节距只由 `radius × 身长档位` 决定。
 *
 * GM-snake-44 定稿（评审稿 `.review/snake-skin-chain.html` 的 ②「弧长重采样」）：
 * - 贴图就是**一个身宽**的圆，直径 = 碰撞直径 `2R`；四角透明、**不填色也不裁剪**，
 *   蛇身轮廓天然是一串相叠的圆（外面那圈扇贝边是设计，不是破绽）。
 * - 节距 = `2R × (1 − 18%)`，相邻圆只叠一点点；**从尾向头画**，靠头的一张压住靠尾的一张。
 * - 不再有「越长越大」：贴图既然等于身宽，就没有再放大的余地（放大就会比蛇头还粗）。
 *   长蛇的贴图**数量**随长度线性增加，和评审稿一致。
 * - 满幅贴图（熔岩/霓虹/默认）四角不透明，仍裁到身宽带子里，并且贴图要比身宽大
 *   （见 `SKIN_FULL_SIZE`：边长 2R 时裁剪带边缘的沿向覆盖为 0，会露缝）。
 */

/**
 * 相邻贴图的重叠比例（占身宽的比例）：18%。
 *
 * 来由：急转（rc ≈ 4R）时弯道**外侧**的圆心距放大 `1 + R/rc ≈ 1.25` 倍，
 * 节距 `1.64R × 1.25 = 2.05R`，只比直径 2R 多 0.05R —— 最急的弯上外侧也只裂半个像素。
 * 再大就叠成一串厚重的扇贝边，花纹反而糊。
 */
export const SKIN_OVERLAP = 0.18;

/** 圆形贴图的边长（单位：半径）：2R，即**正好一个身宽**，与碰撞直径一致 */
export const SKIN_ROUND_SIZE = 2;

/**
 * 满幅贴图的边长（单位：半径）：4R。
 *
 * 这类图四角不透明，不裁会露出直角，所以仍裁到身宽带（宽 2R）。
 * 而方块是**按各自朝向旋转**后贴的，转到 10° 时，裁剪带边缘（距中心线 R）处
 * 覆盖的沿向范围会从 `±size/2` 缩到 `约 ±(size/2 − R·sinθ)`：
 * 边长 2R 时边缘完全没覆盖、3R 时只剩 7px（实测弯道外侧会露出楔形黑缝），
 * 4R（= 2 个身宽）时还有 ~14px，够盖住节距的一半 13px。圆形图没有这个问题。
 */
export const SKIN_FULL_SIZE = 4;

/**
 * 尾巴占用的弧长（单位：半径）。
 *
 * 尾图按 `2.12R` 画在离尾尖 `R` 的位置 → 尾图最靠头的一边在末端内侧 `2.06R`。
 * 有尾图的皮肤把身体截到这里为止：尾巴那一段**只有尾图**，不再叠身体贴图。
 */
export const TAIL_SPAN = 2.06;

/** 身体上的一个贴图锚点 */
export interface SkinSegment {
  x: number;
  y: number;
  /**
   * 贴图朝向（弧度）：**从尾指向头**，即蛇的前进方向。
   * 部件图统一约定「图像上方（-Y）对准前进方向」，所以绘制时 `rotate(angle + π/2)`。
   */
  angle: number;
  /** 交替皮肤用：第几张身体图（0 起） */
  slot: number;
}

/** 折线总弧长 */
export function pathLength(pts: readonly [number, number][]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return acc;
}

/** 一节贴图的尺寸（世界坐标，未乘 zoom） */
export interface SkinCell {
  /** 相邻锚点的弧长间距（= `2R × (1 − 重叠)`，与贴图类型无关） */
  step: number;
  /** 贴图边长（正方形；圆形贴图 = 身宽，满幅贴图放大到 1.5 身宽再裁） */
  size: number;
  /** 是否裁到「身宽带子」里：只有四角不透明的满幅贴图才需要 */
  clip: boolean;
}

/**
 * 一节贴图该画多大、隔多远。
 *
 * 对局（`Scene2D`）与两处预览（主页 / 皮肤列表）都调这一个函数，
 * 免得「预览看着大、进游戏变小」这类两头对不上的问题再出现。
 *
 * `round` = 贴图四角是否透明（由 `skinIsRound()` 从位图探出）：
 * - 圆贴图：边长 = 身宽、不裁剪，四角透明直接落在轮廓外；
 * - 满幅贴图：边长 1.5 身宽、裁到身宽带，方块四角不会戳出轮廓。
 *
 * 贴图恒为正方形，`overlap` 只缩短节距（让相邻贴图叠上），不拉伸贴图 ——
 * 拉伸会把糖果的圆压成椭圆，转向时图案还跟着变形。
 */
export function skinCell(radius: number, round = true, overlap = SKIN_OVERLAP): SkinCell {
  const r = radius > 0 ? radius : 0;
  const ov = overlap > 0 ? Math.min(overlap, 0.45) : 0;
  return {
    // 节距按**身宽**算，与贴图类型无关：换皮肤不该改变身体的节数
    step: r * SKIN_ROUND_SIZE * (1 - ov),
    size: r * (round ? SKIN_ROUND_SIZE : SKIN_FULL_SIZE),
    clip: !round,
  };
}

/**
 * 按等弧长算出锚点个数（含头锚点）。
 *
 * 例：总长 300、节距 30 → 0/30/…/300 共 11 个。
 * **floor** 而不是 ceil：锚点绝不越过尾端，尾巴最后一小截靠贴图自身的放大/半幅盖住，
 * 否则最后一个锚点会被钉在会动的尾尖上，看着像贴图沿身体往回爬。
 */
export function sampleCount(total: number, step: number): number {
  if (!(total > 0) || !(step > 0)) return 0;
  return Math.floor(total / step + 1e-9) + 1;
}

/** 折线取样器：按弧长取点（二分查找，返回折线上的精确位置） */
function makePointAt(pts: readonly [number, number][]) {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1] || 0;
  return (s: number): [number, number] => {
    if (s <= 0) return [pts[0][0], pts[0][1]];
    if (s >= total) return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
    let lo = 0;
    let hi = cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
  };
}

/**
 * 沿路径按弧长切出贴图锚点。
 *
 * 索引 0 的锚点就在蛇头上（`pts[0]`），之后每隔 `step` 一个，**不越过尾端**。
 * `slotCount > 1` 时按 `0,1,0,1…` 轮换，实现两种身体图交替。
 *
 * `tangentWindow > 0` 时，朝向取「s−w 到 s+w 的连线」，而不是所在那一段折线的方向。
 *
 * 为什么需要这个窗口（GM-snake-41）：路径是折线，一段一个方向；锚点滑过折点时
 * 朝向会**整段跳一下**（转弯时每帧 2° 上下），蛇一动，整身花纹就在高频抖。
 * 取前后各 w 的平均方向后，朝向随弧长连续变化 —— 这也是「蛇在运动时皮肤抖动」的根因之一。
 */
export function bodySegments(
  pts: readonly [number, number][],
  step: number,
  slotCount = 1,
  tangentWindow = 0,
): SkinSegment[] {
  if (pts.length < 2 || !(step > 0)) return [];
  const total = pathLength(pts);
  const count = sampleCount(total, step);
  if (!count) return [];
  const slots = Math.max(1, Math.floor(slotCount) || 1);
  const at = tangentWindow > 0 ? makePointAt(pts) : null;

  const out: SkinSegment[] = [];
  let acc = 0;
  let idx = 0;
  let target = 0;

  for (let i = 1; i < pts.length && idx < count; i++) {
    const x0 = pts[i - 1][0];
    const y0 = pts[i - 1][1];
    const dx = pts[i][0] - x0;
    const dy = pts[i][1] - y0;
    const seg = Math.hypot(dx, dy);
    if (seg < 1e-9) continue;
    // pts[0] 是蛇头 → 这一段的「前进方向」是从当前点指向前一点
    const chordAngle = Math.atan2(-dy, -dx);
    while (idx < count && acc + seg >= target - 1e-9) {
      const t = Math.min(1, Math.max(0, (target - acc) / seg));
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      let angle = chordAngle;
      if (at) {
        // 前后各取 w：折点处也不会整段跳，朝向连续
        const a = at(target - tangentWindow);
        const b = at(target + tangentWindow);
        const ax = a[0] - b[0];
        const ay = a[1] - b[1];
        if (ax * ax + ay * ay > 1e-9) angle = Math.atan2(ay, ax);
      }
      out.push({ x, y, angle, slot: idx % slots });
      idx++;
      target = idx * step;
    }
    acc += seg;
  }
  return out;
}

/**
 * 蛇身「带子」多边形：把路径左右各偏移 `radius`，两头补半圆。
 *
 * 用途只有一个 —— 给身体贴图当裁剪区（方块贴图的四角不会戳出轮廓、尾端不是平口）。
 *
 * 顶点**按弧长**排（`arcStep`），不是按路径点下标。按下标取会带来两个毛病：
 * 点数变化时 `stride` 跟着变、而且每帧在蛇头插入新点会让整排顶点错位一格，
 * 裁剪边界就跟着抖（「整身皮肤抖动」的另一个来源）。按弧长排，顶点随身体连续平移。
 *
 * 点数按 `maxPoints` 抽稀 —— 一条 600px 的蛇上百个点，clip 路径太长会拖慢手机端光栅化。
 */
export function bodyBand(
  pts: readonly [number, number][],
  radius: number,
  segs = 6,
  maxPoints = 80,
): [number, number][] {
  const n = pts.length;
  if (n < 2 || !(radius > 0)) return [];
  const total = pathLength(pts);
  if (!(total > 0)) return [];

  // 按弧长等距取顶点：步长取「总长 / 上限点数」，且不小于 2px（太密没意义）
  const arcStep = Math.max(2, total / Math.max(2, maxPoints));
  const at = makePointAt(pts);

  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const leftAngle: number[] = [];
  const rightAngle: number[] = [];

  const sampleCountBand = Math.max(2, Math.min(maxPoints, Math.ceil(total / arcStep)) + 1);
  for (let k = 0; k < sampleCountBand; k++) {
    const s = (total * k) / (sampleCountBand - 1);
    const p = at(s);
    // 用弧长前后各 1px 的割线求切向（方向朝尾，与按下标时的 next−prev 一致），折点处不会歪
    const a = at(s - 1);
    const b = at(s + 1);
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    // 左法线（屏幕坐标下顺时针 90°）
    const nx = -dy;
    const ny = dx;
    left.push([p[0] + nx * radius, p[1] + ny * radius]);
    right.push([p[0] - nx * radius, p[1] - ny * radius]);
    leftAngle.push(Math.atan2(ny, nx));
    rightAngle.push(Math.atan2(-ny, -nx));
  }

  const cap = (cx: number, cy: number, from: number, sweep: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 1; i < segs; i++) {
      const a = from + (sweep * i) / segs;
      out.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return out;
  };

  const tail = pts[n - 1];
  const head = pts[0];
  const out: [number, number][] = [];
  out.push(...left);
  // 尾端半圆：从左转到右，鼓向路径末端之外
  out.push(...cap(tail[0], tail[1], leftAngle[leftAngle.length - 1], -Math.PI));
  for (let k = right.length - 1; k >= 0; k--) out.push(right[k]);
  // 头端半圆：同样从左转到右（多边形绕向一致）
  out.push(...cap(head[0], head[1], rightAngle[0], -Math.PI));
  return out;
}

/**
 * 从尾端截掉 `len` 弧长，返回剩下的「头 → 新尾端」路径。
 *
 * 有尾图的皮肤用它把身体砍到尾巴前面。不截的话，尾图上会压着一截身体图案，
 * 看着像「尾巴上又长了一节身子」；截断点记得留出尾图本身占的弧长（`TAIL_SPAN`）。
 *
 * 路径不够长 / `len` 非法时返回空数组 —— 调用方按「没有身体」处理，别去画一条尾巴那么短的蛇。
 */
export function trimTail(
  pts: readonly [number, number][],
  len: number,
): [number, number][] {
  if (pts.length < 2) return [];
  if (!(len > 0)) return pts.map(p => [p[0], p[1]] as [number, number]);
  const keep = pathLength(pts) - len;
  if (keep <= 0) return [];

  const out: [number, number][] = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (seg < 1e-9) continue;
    if (acc + seg >= keep) {
      const t = (keep - acc) / seg;
      out.push([pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t]);
      return out;
    }
    out.push([pts[i][0], pts[i][1]]);
    acc += seg;
  }
  return out;
}

/**
 * 尾图的放置姿态（`GM-snake-48`）。头部角度不在这里 —— 头是「蛇头朝向」直接给的。
 *
 * 老实现是「图心 = 尾尖内缩 `inset`、朝向 = **最后两个路径点**的方向」，
 * 两个毛病正好就是用户看到的那种「尾巴在摆、和身体错位」：
 *
 * 1. **旋转中心在图心（贴着尾尖）**：角度一变，靠身体那一端的接缝就横着扫过去，
 *    帝王这类长尾皮肤一转弯就能看到尾巴与身体错开一道缝。
 *    → 改成**绕关节旋转**。关节 = 身体截断点 = 尾巴与身体的接缝，钉死它，
 *    转弯时只有尾尖在甩，接缝严丝合缝。
 * 2. **朝向只用了 3px 的基线**：路径点每 3px 一个、尾端还被逐帧截断，
 *    `atan2` 出来的角自带几度噪声，转到 45° 附近就左右抖。
 *    → 改用**关节 → 尾尖的弦**（基线 ≈ `span` ≈ 2R），这就是尾段整体的朝向，稳。
 *
 * 图像上方仍然对准「前进方向」（朝头），与 `drawSnakeHead` 同一套约定：
 * 绘制时 `rotate(angle + π/2)`，图心画在局部 `+offset`（该局部系的 +y = 朝尾）。
 */
export interface TailPose {
  /** 关节：尾段靠头的一端（= 身体截断点），也是画布旋转中心 */
  x: number;
  y: number;
  /** 朝向：从尾尖指向关节（= 朝头），与头图角度同语义 */
  angle: number;
  /**
   * 图心相对关节的偏移（世界坐标，沿尾巴方向）：`弦长 − inset`。
   * `inset` 是图心离尾尖的距离 —— 内缩才不会让尾巴比碰撞判定长出一截
   * （贴脸时「明明没碰到却被吃」）。取弦长而不是弧长，转弯时尾尖刚好落在路径末端。
   */
  offset: number;
}

export function tailPose(
  pts: readonly [number, number][],
  inset: number,
  span: number,
): TailPose | null {
  const n = pts.length;
  if (n < 2 || !(inset > 0) || !(span > 0)) return null;
  const [tx, ty] = pts[n - 1];
  // 关节走**同一条截断口径**（trimTail），身体截到哪、尾巴就从哪开始接
  const body = trimTail(pts, span);
  const [jx, jy] = body.length ? body[body.length - 1] : pts[0];
  const chord = Math.hypot(jx - tx, jy - ty);
  if (chord < 1e-6) return null;
  return {
    x: jx,
    y: jy,
    angle: Math.atan2(jy - ty, jx - tx),
    offset: Math.max(0, chord - inset),
  };
}
