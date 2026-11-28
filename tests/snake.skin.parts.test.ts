import { describe, expect, test } from 'bun:test';
import {
  bodySegments,
  partAngle,
  sampleCount,
  tailCenter,
} from '../src/games/snake/skin';

/** 一条从右往左的水平身体：头在 x=300，尾在 x=0（pts[0] = 蛇头） */
function straight(len: number, y = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let d = 0; d <= len; d += 4) pts.push([300 - d, y]);
  if (pts[pts.length - 1][0] !== 300 - len) pts.push([300 - len, y]);
  return pts;
}

/** 四分之一圆弧：从 (300,0) 往 -x 走再弯向 -y */
function arc(radius: number, sweep: number): [number, number][] {
  const pts: [number, number][] = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const a = (sweep * i) / steps;
    pts.push([300 - radius * Math.sin(a), -radius * (1 - Math.cos(a))]);
  }
  return pts;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * GM-snake-39：皮肤部件沿**弧长**锚点分段（不是按路径点下标）。
 *
 * 为什么必须按弧长：路径点是服务端每 3px 推一个的不均匀折线，本地推进后更密更乱；
 * 按下标分段会让蛇变长变粗时节距乱跳。按弧长算，节距 = f(radius)，
 * 蛇越粗图越大、锚点一起放大，重叠比例恒定。
 */
describe('GM-snake-39 身体分段锚点', () => {
  test('直线：锚点从蛇头开始、间距等于 step', () => {
    const segs = bodySegments(straight(300), 30, 1);
    expect(segs.length).toBeGreaterThan(9);
    // 头锚点就在蛇头（允许 1e-6 误差）
    expect(dist([segs[0].x, segs[0].y], [300, 0])).toBeLessThan(1e-6);
    for (let i = 1; i < 10; i++) {
      const d = dist([segs[i].x, segs[i].y], [segs[i - 1].x, segs[i - 1].y]);
      expect(Math.abs(d - 30)).toBeLessThan(0.2);
    }
  });

  test('弯曲路径也按弧长等距（弦长 ≤ 弧长，但不会越走越稀）', () => {
    const segs = bodySegments(arc(200, Math.PI / 2), 24, 1);
    const gaps: number[] = [];
    for (let i = 1; i < segs.length; i++) {
      gaps.push(dist([segs[i].x, segs[i].y], [segs[i - 1].x, segs[i - 1].y]));
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // 弯道弦长必然比弧长短，但不能短到断层（均匀弯 → 弦长稳定）
    expect(avg).toBeGreaterThan(20);
    expect(avg).toBeLessThan(24.2);
    for (const g of gaps) expect(Math.abs(g - avg)).toBeLessThan(1.5);
  });

  test('锚点不越过尾端：最后一个锚点落在路径内', () => {
    const segs = bodySegments(straight(100), 30, 1);
    const total = 100;
    for (const s of segs) {
      const walked = 300 - s.x;
      expect(walked).toBeLessThanOrEqual(total + 1e-6);
    }
  });

  test('交替槽位：body 两张图时按 0/1 轮换', () => {
    const segs = bodySegments(straight(300), 30, 2);
    expect(segs.slice(0, 6).map(s => s.slot)).toEqual([0, 1, 0, 1, 0, 1]);
    const single = bodySegments(straight(300), 30, 1);
    expect(single.every(s => s.slot === 0)).toBe(true);
  });

  test('每个锚点的角度指向**前进方向**（从尾指向头）', () => {
    const segs = bodySegments(straight(300), 30, 1);
    // 头在 x=300，尾在 x=0 → 前进方向 +x，角度 0
    for (const s of segs) expect(Math.abs(s.angle)).toBeLessThan(1e-6);
  });

  test('路径退化（点数不足 / step 非法）返回空数组，不抛错', () => {
    expect(bodySegments([], 30, 1)).toEqual([]);
    expect(bodySegments([[0, 0]], 30, 1)).toEqual([]);
    expect(bodySegments(straight(100), 0, 1)).toEqual([]);
    expect(bodySegments(straight(100), -5, 1)).toEqual([]);
  });
});

describe('GM-snake-39 分段数量估算', () => {
  test('段数 ≈ 总弧长 / 节距', () => {
    expect(sampleCount(300, 30)).toBe(11);   // 0,30,...,300
    expect(sampleCount(305, 30)).toBe(11);
    expect(sampleCount(0, 30)).toBe(0);
    expect(sampleCount(300, 0)).toBe(0);
  });
});

describe('GM-snake-39 头/尾贴图角度与锚点', () => {
  test('头部角 = 蛇头朝向（图像上方对准前进方向）', () => {
    expect(partAngle('head', 0, straight(100))).toBeCloseTo(0, 6);
    expect(partAngle('head', Math.PI / 2, straight(100))).toBeCloseTo(Math.PI / 2, 6);
  });

  test('尾部角 = 从尾尖指向前一节（与蛇头朝向一致）', () => {
    // 水平直线：尾在 x=0，前一节在 x>0 → 方向 +x = 0
    expect(partAngle('tail', 0, straight(100))).toBeCloseTo(0, 6);
    // 忽略传进来的 headAngle：尾巴自己按路径算
    expect(partAngle('tail', Math.PI, straight(100))).toBeCloseTo(0, 6);
  });

  test('尾部中心在末端向内侧缩 inset，尖端仍落在路径末端', () => {
    const c = tailCenter(straight(100), 15)!;
    // 尾在 (200,0)，内缩 15 → 中心 (215,0)
    expect(c[0]).toBeCloseTo(215, 6);
    expect(c[1]).toBeCloseTo(0, 6);
  });

  test('尾部锚点：路径太短 / 非法 inset 返回 null', () => {
    expect(tailCenter([[0, 0]], 15)).toBeNull();
    expect(tailCenter(straight(100), 0)).toBeNull();
    expect(tailCenter(straight(100), -1)).toBeNull();
  });
});
