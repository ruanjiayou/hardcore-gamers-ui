import { describe, expect, test } from 'bun:test';
import {
  SKIN_FULL_SIZE,
  SKIN_OVERLAP,
  SKIN_ROUND_SIZE,
  TAIL_SPAN,
  bodyBand,
  bodySegments,
  sampleCount,
  skinCell,
  tailPose,
  trimTail,
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

describe('GM-snake-39/48 尾部姿态', () => {
  test('关节在离尾尖 span 处，角度朝头；图心仍落在尾尖内缩 inset 的位置', () => {
    const pose = tailPose(straight(100), 15, 30)!;
    // 尾在 x=200，沿路径往回 30 → 关节 (230, 0)
    expect(pose.x).toBeCloseTo(230, 6);
    expect(pose.y).toBeCloseTo(0, 6);
    // 朝头 = +x
    expect(pose.angle).toBeCloseTo(0, 6);
    // 图心 = 关节沿尾巴方向退 (弦 − inset)，即尾尖内缩 15 的 (215, 0)
    expect(pose.x - pose.offset).toBeCloseTo(215, 6);
  });

  test('关节就是身体截断点（与分析同一个 trimTail 口径，接缝不会错开）', () => {
    const pts = straight(200);
    const span = TAIL_SPAN * 10;
    const pose = tailPose(pts, 10, span)!;
    const body = trimTail(pts, span);
    const joint = body[body.length - 1];
    expect(pose.x).toBeCloseTo(joint[0], 9);
    expect(pose.y).toBeCloseTo(joint[1], 9);
  });

  test('角度取关节→尾尖的弦，尾端 3px 的噪声不会把尾巴甩歪', () => {
    const pts = straight(200);
    const n = pts.length;
    // 尾尖前 0.4px 插一个偏 2px 的点：老实现（最后两点）算出 ≈78° 的歪角
    pts[n - 2] = [pts[n - 1][0] + 0.4, 2];
    const oldAngle = Math.abs(Math.atan2(2 - 0, 0.4));
    expect(oldAngle).toBeGreaterThan(1);
    const pose = tailPose(pts, 15, 30)!;
    expect(Math.abs(pose.angle)).toBeLessThan(0.15);
  });

  test('非法输入返回 null：路径太短 / inset 或 span 非正', () => {
    expect(tailPose([[0, 0]], 15, 30)).toBeNull();
    expect(tailPose(straight(100), 0, 30)).toBeNull();
    expect(tailPose(straight(100), -1, 30)).toBeNull();
    expect(tailPose(straight(100), 15, 0)).toBeNull();
  });
});

/**
 * GM-snake-40：有尾图的皮肤，身体必须截到尾巴前面 —— 尾巴那一段只画尾图。
 *
 * 之前身体一直描到路径末端，尾图上还压着一节身体贴图，看着像尾巴上又长了一段身子。
 * 截断长度取 `TAIL_SPAN × radius`（尾图按 2.12R 画在离尾尖 R 处 → 最前端在 2.06R）。
 */
describe('GM-snake-40 截掉尾巴段的身体', () => {
  test('从尾端截掉指定弧长，剩下的长度对得上', () => {
    const body = trimTail(straight(100), 20);
    expect(pathLen(body)).toBeCloseTo(80, 6);
    // 头不动，新尾端落在离原尾端 20 的地方
    expect(body[0][0]).toBeCloseTo(300, 6);
    expect(body[body.length - 1][0]).toBeCloseTo(220, 6);
  });

  test('截断点在折线中间时会插一个新点（不会跳过整段）', () => {
    const body = trimTail(straight(100), 22.5);
    expect(pathLen(body)).toBeCloseTo(77.5, 6);
    expect(body[body.length - 1][0]).toBeCloseTo(222.5, 6);
  });

  test('路径比尾巴还短 → 空数组（调用方按「没有身体」处理）', () => {
    expect(trimTail(straight(10), 20)).toEqual([]);
    expect(trimTail([[0, 0]], 20)).toEqual([]);
  });

  test('不截（len ≤ 0）返回副本，不共享原数组引用', () => {
    const pts = straight(50);
    const copy = trimTail(pts, 0);
    expect(pathLen(copy)).toBeCloseTo(50, 6);
    expect(copy).not.toBe(pts);
    expect(copy).toEqual(pts);
  });

  test('弯道也按弧长截（不是按点数）', () => {
    const arcPts = arc(100, Math.PI / 2);
    const total = pathLen(arcPts);
    const body = trimTail(arcPts, 30);
    expect(pathLen(body)).toBeCloseTo(total - 30, 3);
  });

  test('身体锚点全部落在截断后的路径里（尾巴区域不再有身体贴图）', () => {
    const R = 10;
    const pts = straight(200);
    const tailLen = TAIL_SPAN * R;
    const body = trimTail(pts, tailLen);
    const segs = bodySegments(body, R * 4, 1);
    expect(segs.length).toBeGreaterThan(3);
    for (const s of segs) {
      // 300 - x = 离蛇头的距离，必须小于身体长度
      expect(300 - s.x).toBeLessThanOrEqual(200 - tailLen + 1e-6);
    }
  });

  test('贴图与身宽的关系：圆贴图 = 一个身宽，满幅贴图更大（要被裁）', () => {
    // GM-snake-44：圆贴图直径 = 碰撞直径，视觉宽度与判定一致
    expect(SKIN_ROUND_SIZE).toBe(2);
    expect(SKIN_FULL_SIZE).toBeGreaterThan(SKIN_ROUND_SIZE);
    // 尾图边长 2.12R，中心内缩 R → 需要 2.06R，留一点余量
    expect(TAIL_SPAN).toBeGreaterThan(2);
    expect(TAIL_SPAN).toBeLessThan(2.12 + 1);
  });

  test('skinCell：圆贴图边长 = 2R 且不裁剪，节距 = 2R × (1 − 18%)', () => {
    const cell = skinCell(10);
    expect(cell.size).toBeCloseTo(10 * SKIN_ROUND_SIZE, 6);
    expect(cell.clip).toBe(false);
    expect(cell.step).toBeCloseTo(10 * 2 * (1 - SKIN_OVERLAP), 6);

    // 满幅贴图：边长 > 身宽、要裁；节距与圆贴图一致（换皮肤不改变节数）
    const full = skinCell(10, false);
    expect(full.size).toBeCloseTo(10 * SKIN_FULL_SIZE, 6);
    expect(full.clip).toBe(true);
    expect(full.step).toBeCloseTo(cell.step, 6);

    // 重叠 0：正好相切（评审页把滑杆拉到 0 的样子）
    expect(skinCell(10, true, 0).step).toBeCloseTo(20, 6);
  });

  test('满幅贴图：裁剪带边缘（距中心线 R）也被覆盖', () => {
    // 方块按各自朝向旋转后，带边缘处的沿向半宽是 sqrt((size/2)² − R²)；
    // 边长 2R 时它是 0（边缘一点没覆盖，会露缝），所以满幅贴图必须比身宽大。
    const R = 10;
    const full = skinCell(R, false);
    const half = full.size / 2;
    const edgeHalf = Math.sqrt(Math.max(0, half * half - R * R));
    // 急转 rc = 4R 时带外侧的圆心距放大 1 + R/rc = 1.25 倍
    expect(edgeHalf).toBeGreaterThanOrEqual((full.step / 2) * 1.25);
  });

  test('skinCell 对异常入参不跑飞（半径 0 / 负重叠按 0 算）', () => {
    expect(skinCell(0).step).toBe(0);
    expect(skinCell(0).size).toBe(0);
    expect(skinCell(10, true, -1).step).toBeCloseTo(20, 6);
  });
});

function pathLen(pts: readonly [number, number][]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return acc;
}

/**
 * GM-snake-40：身体贴图裁到「身宽带子」里。
 *
 * 贴图是一张方块图，逐节旋转贴上去时四角会戳出蛇身轮廓（满幅的糖果图最明显），
 * 尾端还会被切成平口。用这条宽 2R、两头半圆的多边形当裁剪区，轮廓才是圆润的管子。
 */
describe('GM-snake-40 身宽带子（贴图裁剪区）', () => {
  const R = 10;

  test('直线：带子贴着路径左右各偏移一个半径，两头各鼓出半圆', () => {
    const band = bodyBand(straight(100), R);
    expect(band.length).toBeGreaterThan(10);
    const xs = band.map(p => p[0]);
    const ys = band.map(p => p[1]);
    // 尾在 x=200、头在 x=300 → 尾端半圆到 190，头端半圆到 310
    expect(Math.min(...xs)).toBeCloseTo(190, 6);
    expect(Math.max(...xs)).toBeCloseTo(310, 6);
    // 宽度 = 2R
    expect(Math.max(...ys)).toBeCloseTo(R, 6);
    expect(Math.min(...ys)).toBeCloseTo(-R, 6);
  });

  test('弯道：每个点都在离路径 radius 以内（不会有人跑到带子外面）', () => {
    const pts = arc(100, Math.PI / 2);
    const band = bodyBand(pts, R);
    // 量到**折线段**的距离（不是到最近顶点的距离）：带子顶点按弧长取，可能落在两个路径点之间
    const near = (p: [number, number]) => {
      let best = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2));
        best = Math.min(best, Math.hypot(p[0] - (x0 + dx * t), p[1] - (y0 + dy * t)));
      }
      return best;
    };
    for (const p of band) expect(near(p)).toBeLessThanOrEqual(R + 1e-6);
  });

  test('抽稀生效：长路径不会生成上千个点（clip 路径越长越拖手机）', () => {
    const band = bodyBand(straight(2000), R, 6, 40);
    expect(band.length).toBeLessThanOrEqual(2 * 42 + 2 * 6);
  });

  test('退化输入返回空数组', () => {
    expect(bodyBand([[0, 0]], R)).toEqual([]);
    expect(bodyBand([], R)).toEqual([]);
    expect(bodyBand(straight(100), 0)).toEqual([]);
    expect(bodyBand(straight(100), -3)).toEqual([]);
  });
});

/**
 * GM-snake-44 定稿：弧长重采样 + 圆贴图重叠 18%（评审稿 ② 的做法）。
 *
 * 贴图就是一个身宽的圆，节距 = `2R × 82%`，从尾向头画、靠头的压住靠尾的。
 * 贴图既然等于身宽，就不能再「越长越大」（放大就比蛇头还粗），
 * 所以这一版把身长档位整块撤掉：长蛇的贴图数量随长度线性增加，与评审稿一致。
 */
describe('GM-snake-44 定稿：圆贴图 = 身宽、重叠 18%', () => {
  const R = 10;

  test('节距 = 身宽 × (1 − 18%)，圆贴图与满幅贴图一致', () => {
    expect(SKIN_OVERLAP).toBeCloseTo(0.18, 6);
    for (const round of [true, false]) {
      const cell = skinCell(R, round);
      expect(cell.step).toBeCloseTo(R * 2 * (1 - SKIN_OVERLAP), 6);
    }
  });

  test('相邻圆叠 18%：急弯外侧也只裂半个像素以内', () => {
    const cell = skinCell(R);
    // 急转 rc = 4R 时，弯道外侧的圆心距放大 1 + R/rc = 1.25 倍
    const outer = cell.step * 1.25;
    expect(outer - cell.size).toBeLessThan(R * 0.12);
  });

  test('节数随长度线性增加，且与皮肤类型无关', () => {
    const short = sampleCount(600, skinCell(R).step);
    const long = sampleCount(1200, skinCell(R).step);
    // 长度翻倍 → 节数约翻倍（差一个收尾）
    expect(Math.abs(long - (short * 2 - 1))).toBeLessThanOrEqual(1);
    expect(sampleCount(1200, skinCell(R, false).step)).toBe(long);
  });
});

/**
 * GM-snake-41：锚点朝向按「前后各 w 的连线」算，而不是所在折线的方向。
 *
 * 折线一段一个方向，锚点滑过折点时朝向会整段跳一下（转弯时每帧 2° 上下），
 * 一身花纹就在高频抖 —— 这是「蛇动起来皮肤抖」的根因之一。
 */
describe('GM-snake-41 锚点朝向走切向窗口', () => {
  test('直线上：有没有窗口结果都一样', () => {
    const pts = straight(200);
    const plain = bodySegments(pts, 30, 1);
    const smooth = bodySegments(pts, 30, 1, 15);
    expect(smooth.length).toBe(plain.length);
    plain.forEach((p, i) => expect(smooth[i].angle).toBeCloseTo(p.angle, 6));
  });

  test('直角折点：无窗口时朝向只能是两段之一，有窗口时取中间方向', () => {
    // 蛇头在原点朝 -x 走 60px，再折向 -y 走 60px
    const pts: [number, number][] = [];
    for (let t = 0; t <= 60; t += 3) pts.push([-t, 0]);
    for (let t = 3; t <= 60; t += 3) pts.push([-60, -t]);

    const plain = bodySegments(pts, 30, 1);
    const corner = plain[2]; // s = 60，正落在折点上
    const legs = [0, Math.PI / 2];
    expect(Math.min(...legs.map(a => Math.abs(corner.angle - a)))).toBeLessThan(1e-6);

    const smooth = bodySegments(pts, 30, 1, 20);
    // 前后各 20px 连线的方向 = 两段的角平分线
    expect(smooth[2].angle).toBeCloseTo(Math.PI / 4, 6);
  });

  test('窗口不会把锚点带偏：位置与无窗口一致', () => {
    const pts = arc(100, Math.PI / 2);
    const plain = bodySegments(pts, 30, 1);
    const smooth = bodySegments(pts, 30, 1, 15);
    plain.forEach((p, i) => {
      expect(smooth[i].x).toBeCloseTo(p.x, 6);
      expect(smooth[i].y).toBeCloseTo(p.y, 6);
    });
  });
});
