/**
 * 皮肤贴图的几何计算（纯函数，不碰 canvas —— 可以直接单测）。
 *
 * GM-snake-39：皮肤分「可平铺纹理」和「一节蛇身贴图」两类。
 *
 * - `single` / `head_body` / `head_body_tail` 的 body 是**可平铺纹理**（96×96 那种），
 *   用 `CanvasPattern` 描边就好，蛇弯不弯都自然。
 * - `alt_body` 系的 body 是**一节蛇身的贴图**（两张交替），必须沿路径**按弧长**分段贴。
 *
 * 为什么按弧长而不是按路径点下标：路径点是服务端每 3px 推一个、本地又每帧插值的不均匀折线，
 * 按下标分段会让节距随蛇的移动忽大忽小。按弧长算，节距只由 `radius` 决定 ——
 * 蛇越粗图越大、锚点一起放大，**重叠比例恒定**，蛇再长也不会糊成一团。
 */

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

/**
 * 按等弧长算出锚点个数（含头锚点）。
 *
 * 例：总长 300、节距 30 → 0/30/…/300 共 11 个。
 */
export function sampleCount(total: number, step: number): number {
  if (!(total > 0) || !(step > 0)) return 0;
  return Math.floor(total / step + 1e-9) + 1;
}

/**
 * 沿路径按弧长切出贴图锚点。
 *
 * 索引 0 的锚点就在蛇头上（`pts[0]`），之后每隔 `step` 一个，**不越过尾端**。
 * `slotCount > 1` 时按 `0,1,0,1…` 轮换，实现两种身体图交替。
 */
export function bodySegments(
  pts: readonly [number, number][],
  step: number,
  slotCount = 1,
): SkinSegment[] {
  if (pts.length < 2 || !(step > 0)) return [];
  const count = sampleCount(pathLength(pts), step);
  if (!count) return [];
  const slots = Math.max(1, Math.floor(slotCount) || 1);

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
    const angle = Math.atan2(-dy, -dx);
    while (idx < count && acc + seg >= target - 1e-9) {
      const t = Math.min(1, Math.max(0, (target - acc) / seg));
      out.push({ x: x0 + dx * t, y: y0 + dy * t, angle, slot: idx % slots });
      idx++;
      target = idx * step;
    }
    acc += seg;
  }
  return out;
}

/**
 * 头/尾贴图的旋转角。
 *
 * - `head`：直接用蛇头朝向（`angle` 由逻辑层给，含转向动画）。
 * - `tail`：按路径自己算 —— 从尾尖指向前一节，也就是「尾巴的正面朝前」。
 *   （尾巴尖朝后，但图像上方要朝前进方向，跟头保持同一套约定。）
 */
export function partAngle(
  kind: 'head' | 'tail',
  headAngle: number,
  pts: readonly [number, number][],
): number {
  if (kind === 'head') return headAngle;
  const n = pts.length;
  if (n < 2) return headAngle;
  const [tx, ty] = pts[n - 1];
  const [px, py] = pts[n - 2];
  return Math.atan2(py - ty, px - tx);
}

/**
 * 尾巴贴图的中心点：末端**向内侧缩 `inset`**。
 *
 * 不内缩的话，尾图会超出路径末端 `inset` 那么长 —— 画出来的蛇比碰撞判定更长，
 * 贴脸时看起来「明明没碰到却被吃」。内缩后尖端正好落在路径末端。
 */
export function tailCenter(
  pts: readonly [number, number][],
  inset: number,
): [number, number] | null {
  const n = pts.length;
  if (n < 2 || !(inset > 0)) return null;
  const [tx, ty] = pts[n - 1];
  const [px, py] = pts[n - 2];
  const a = Math.atan2(py - ty, px - tx);
  return [tx + Math.cos(a) * inset, ty + Math.sin(a) * inset];
}
