import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAIL_SPAN, tailPose, trimTail } from '../src/games/snake/skin';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-48（本轮三条需求，逐条钉住）：
 *
 * 1. 有时效性的 buff（磁吸 / 无敌）边框做成**随时间减少**的环：100% → 0%，收完消失；
 * 2. 无敌罩外扩**固定像素**，直径改**对角线**（斜着走 / 拐直角时蛇头老在圈外）；
 * 3. 尾巴改成**绕关节旋转**（原来绕图心 / 用尾尖那两个点算角度 → 转弯时摆动错位）。
 */

/** 一条从右往左的水平身体：头在 x=300，尾在更小的 x（pts[0] = 蛇头） */
function straight(len: number, y = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let d = 0; d <= len; d += 4) pts.push([300 - d, y]);
  if (pts[pts.length - 1][0] !== 300 - len) pts.push([300 - len, y]);
  return pts;
}

/** 四分之一圆弧（用来验证「关节始终在路径上」） */
function arc(radius: number, sweep: number): [number, number][] {
  const pts: [number, number][] = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const a = (sweep * i) / steps;
    pts.push([300 - radius * Math.sin(a), -radius * (1 - Math.cos(a))]);
  }
  return pts;
}

/** 点到折线的最短距离 */
function distToPath(p: [number, number], pts: readonly [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - x0) * dx + (p[1] - y0) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (x0 + dx * t), p[1] - (y0 + dy * t)));
  }
  return best;
}

describe('GM-48 时效性 buff 的倒计时边框', () => {
  test('徽标带 timed 类，时效性 buff 才有外环', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    // 磁吸 / 无敌是时效性的 → 挂 timed；加速是按住就有效，没有环
    expect(ts).toContain("cls:'snake-buffmagnettimed',");
    expect(ts).toContain("cls:'snake-buffstartimed',");
    // 加速是按住就有效、没有时长 → 不挂 timed（不画环）
    expect(ts).toContain("cls:'snake-buffboost',title:'加速中',icon:BUFF_ICONS.boost,art:null,frac:1,timed:false");
    const css = compact(read('src/pages/game/snake/styles/room.css'));
    // 环的画法已在 GM-snake-50 换成 SVG 弧（conic-gradient 做不出圆头），见 snake.gm50.test.ts
    expect(css).toContain('.snake-buff-ring');
  });

  test('占比由剩余时间实时驱动：每帧改属性，不重建 DOM', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    // GM-snake-50：从写 CSS 变量 `--p` 换成写 SVG 的 stroke-dashoffset
    expect(ts).toContain("setAttribute('stroke-dashoffset'");
    // 结构签名只是「哪几个 buff 亮着」，不含时间 → 时间变化不触发 replaceChildren
    expect(ts).toContain('constkey=chips.map(c=>c.cls).join');
    expect(ts).toContain('if(key!==this.buffKey)');
  });

  test('100% 的基准取「见过的最大剩余量」，不硬编码时长；消失后清零重算', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('privatebuffFrac(kind');
    expect(ts).toContain('if(left>this.buffPeak[kind])this.buffPeak[kind]=left');
    expect(ts).toContain('this.buffPeak[kind]=0');
    // 客户端不再自己写死 9s / 4s
    expect(ts).not.toContain('9000');
    expect(ts).not.toContain('4000');
  });
});

describe('GM-48 无敌罩（口径已被 GM-snake-49 覆盖：只罩蛇头）', () => {
  test('外扩仍是固定屏幕像素，但半径不再来自整条蛇的包围盒', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('constSHIELD_PAD_PX=8');
    // 头圈：1.5 个身半径（GM-snake-50 从 1.25 放大）+ 固定 8px
    expect(ts).toContain('this.state.radius*1.5*this.zoom+SHIELD_PAD_PX');
    expect(ts).not.toContain('boundCircle');
  });
});

describe('GM-48 尾巴：绕关节旋转（不是图心 / 最远点）', () => {
  test('关节落在路径上 —— 接缝钉死，转弯时不会错开', () => {
    const pts = arc(100, Math.PI / 2);
    const R = 10;
    const pose = tailPose(pts, R, TAIL_SPAN * R)!;
    expect(distToPath([pose.x, pose.y], pts)).toBeLessThan(1e-6);
  });

  test('朝向用关节→尾尖的弦：2R 基线下角度稳定', () => {
    // 同一段路径，尾端每次只挪 1px，角度不该跳
    const R = 15;
    const base = arc(90, Math.PI / 2);
    let prev: number | null = null;
    for (let cut = 0; cut < 6; cut++) {
      const pts = base.slice(0, base.length - cut);
      const pose = tailPose(pts, R, TAIL_SPAN * R)!;
      if (prev != null) expect(Math.abs(pose.angle - prev)).toBeLessThan(0.12);
      prev = pose.angle;
    }
  });

  test('尾尖仍落在路径末端附近（内缩 inset，不会比碰撞长度长出一截）', () => {
    const R = 15;
    const pts = straight(200);
    const pose = tailPose(pts, R, TAIL_SPAN * R)!;
    const tip = pts[pts.length - 1];
    const d = R * 2.3;
    // 图心在关节后 offset，图再往尾方向铺 d/2 → 尾端 = 关节 + (offset + d/2)
    const end: [number, number] = [
      pose.x - Math.cos(pose.angle) * (pose.offset + d / 2),
      pose.y - Math.sin(pose.angle) * (pose.offset + d / 2),
    ];
    expect(Math.hypot(end[0] - tip[0], end[1] - tip[1])).toBeLessThan(R * 0.3);
  });

  test('渲染：旋转中心在关节，图心沿尾巴方向偏移；预览走同一个函数', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('tailPose(pts,R,TAIL_SPAN*R)');
    expect(ts).toContain('ctx.translate(jx,jy)');
    expect(ts).toContain('ctx.drawImage(img,-d/2,off-d/2,d,d)');
    // 老的两条路（图心当原点 / 最后两点求角）彻底删掉
    expect(ts).not.toContain('partAngle');
    expect(ts).not.toContain('tailCenter(');

    const pv = compact(read('src/components/SkinPreview.tsx'));
    expect(pv).toContain('tailPose(pts,R,TAIL_SPAN*R)');
    expect(pv).not.toContain('tailCenter(');
  });

  test('身体截断与尾巴关节是同一个口径（trimTail(span)）', () => {
    const R = 12;
    const pts = straight(300);
    const body = trimTail(pts, TAIL_SPAN * R);
    const joint = body[body.length - 1];
    const pose = tailPose(pts, R, TAIL_SPAN * R)!;
    expect(pose.x).toBeCloseTo(joint[0], 9);
    expect(pose.y).toBeCloseTo(joint[1], 9);
  });
});
