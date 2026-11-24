import { describe, test, expect } from 'bun:test';
import {
  snakeControlsLayout,
  joystickAngle,
  snakeMinimapLayout,
  minimapPoint,
  snakeMinimapSelfPoint,
  snakeViewport,
  clipSnakeSegments,
  joystickKnobOffset,
  rankTopSnakes,
} from '../src/games/snake/Scene2D';

describe('贪吃蛇控件：固定屏幕布局，与场景/镜头无关', () => {
  test('桌面与手机都是左下摇杆、右下加速，且都在下半屏', () => {
    for (const [w, h] of [[1280, 800], [375, 667], [820, 1180]]) {
      const { boost, joy } = snakeControlsLayout(w, h);
      expect(joy.x).toBeLessThan(w / 2);
      expect(boost.x).toBeGreaterThan(w / 2);
      expect(boost.y).toBeGreaterThan(h / 2);
      expect(joy.y).toBeGreaterThan(h / 2);
      // 加速按钮和摇杆本体不重叠
      expect(Math.hypot(boost.x - joy.x, boost.y - joy.y)).toBeGreaterThan(boost.r + joy.r + 20);
      // 摇杆热区不出屏
      expect(joy.x - joy.r * 1.45).toBeGreaterThan(0);
      expect(boost.x + boost.r).toBeLessThan(w + 1);
    }
  });

  test('布局是纯函数：同一尺寸结果恒定，不随任何世界状态变化', () => {
    const a = snakeControlsLayout(375, 667);
    const b = snakeControlsLayout(375, 667);
    expect(a).toEqual(b);
    // 只吃宽高：换个"蛇头/镜头"概念不影响布局（函数签名里根本没有这些参数）
    expect(Object.keys(a).sort()).toEqual(['boost', 'joy']);
  });

  test('摇杆角度是世界绝对方向：右 0、下 π/2、上 -π/2、圆心附近不响应', () => {
    const joy = snakeControlsLayout(375, 667).joy;
    expect(joystickAngle(joy, joy.x + 40, joy.y)).toBeCloseTo(0, 6);
    expect(joystickAngle(joy, joy.x, joy.y + 40)).toBeCloseTo(Math.PI / 2, 6);
    expect(joystickAngle(joy, joy.x, joy.y - 40)).toBeCloseTo(-Math.PI / 2, 6);
    expect(joystickAngle(joy, joy.x, joy.y)).toBeNull();
    expect(joystickAngle(joy, joy.x + 3, joy.y + 3)).toBeNull();
  });

  test('摇杆手柄只由输入决定：松手回中，不读取也不跟随蛇的朝向', () => {
    const joy = snakeControlsLayout(375, 667).joy;
    // 松手（knob=null）永远回中——函数签名里没有"蛇朝向"这个入参，
    // 摇杆是输入（因），蛇怎么走（果）不会反向写回手柄。
    expect(joystickKnobOffset(joy, null)).toEqual({ dx: 0, dy: 0 });
    // 拖动时手柄 = 手指相对圆心的方向，且被 clamp 在半径内
    const right = joystickKnobOffset(joy, { x: joy.x + 999, y: joy.y });
    expect(right.dx).toBeGreaterThan(0);
    expect(right.dy).toBe(0);
    expect(right.dx).toBeCloseTo(joy.r * 0.82, 6);
    const upLeft = joystickKnobOffset(joy, { x: joy.x - 30, y: joy.y - 30 });
    expect(upLeft.dx).toBeLessThan(0);
    expect(upLeft.dy).toBeLessThan(0);
    // 与手指同心的偏移可还原为绝对角度（手柄和瞄准方向一致）
    const knob = { x: joy.x + 30, y: joy.y - 30 };
    const off = joystickKnobOffset(joy, knob);
    expect(Math.atan2(off.dy, off.dx)).toBeCloseTo(joystickAngle(joy, knob.x, knob.y)!, 6);
  });
});

describe('贪吃蛇微缩地图与局部绘制', () => {
  test('小地图在右上角关闭键下方，自己的世界坐标映射为地图上的相对位置', () => {
    for (const [w, h] of [[1280, 800], [375, 667]]) {
      const m = snakeMinimapLayout(w, h);
      // 右上角、且在 42px 按钮行（top 10 + 42）之下，两者不重叠
      expect(m.x).toBeGreaterThan(w / 2);
      expect(m.x + m.w).toBeLessThanOrEqual(w - 11);
      expect(m.y).toBeGreaterThanOrEqual(52);
      expect(m.y).toBeLessThan(h / 2);
      expect(m.y + m.h).toBeLessThan(h);
      const [topLeft] = minimapPoint(m, 3600, 2600, 0, 0);
      expect(topLeft).toBeCloseTo(m.x, 6);
      const [centerX, centerY] = minimapPoint(m, 3600, 2600, 1800, 1300);
      expect(centerX).toBeCloseTo(m.x + m.w / 2, 6);
      expect(centerY).toBeCloseTo(m.y + m.h / 2, 6);
    }
  });

  test('刘海屏安全区：topInset 把地图整体下移，不压在关闭键上', () => {
    const base = snakeMinimapLayout(390, 844, 0);
    const notch = snakeMinimapLayout(390, 844, 47);
    expect(notch.y - base.y).toBe(47);
    expect(notch.x).toBe(base.x);
    expect(notch.w).toBe(base.w);
    // 自己的白点同样跟着下移
    const [, py0] = snakeMinimapSelfPoint(390, 844, 3600, 2600, 0, 0, 0);
    const [, py1] = snakeMinimapSelfPoint(390, 844, 3600, 2600, 0, 0, 47);
    expect(py1 - py0).toBe(47);
  });

  test('小地图只显示自己：映射只吃自己的坐标，四角都落在地图框内', () => {
    for (const [w, h] of [[1280, 800], [375, 667]]) {
      const m = snakeMinimapLayout(w, h);
      const [cx, cy] = snakeMinimapSelfPoint(w, h, 3600, 2600, 1800, 1300);
      expect(cx).toBeCloseTo(m.x + m.w / 2, 6);
      expect(cy).toBeCloseTo(m.y + m.h / 2, 6);
      for (const [x, y] of [[0, 0], [3600, 0], [0, 2600], [3600, 2600]]) {
        const [px, py] = snakeMinimapSelfPoint(w, h, 3600, 2600, x, y);
        expect(px).toBeGreaterThanOrEqual(m.x);
        expect(px).toBeLessThanOrEqual(m.x + m.w);
        expect(py).toBeGreaterThanOrEqual(m.y);
        expect(py).toBeLessThanOrEqual(m.y + m.h);
      }
    }
  });

  test('局部窗口随镜头移动，且始终钳在世界内', () => {
    const a = snakeViewport({ x: 300, y: 300 }, 800, 600, 1, 3600, 2600);
    const b = snakeViewport({ x: 1200, y: 900 }, 800, 600, 1, 3600, 2600);
    expect(a.x0).toBe(0);
    expect(a.y0).toBe(0);
    expect(b.x0).toBeGreaterThan(a.x0);
    expect(b.y0).toBeGreaterThan(a.y0);
    expect(b.x1).toBeLessThanOrEqual(3600);
    expect(b.y1).toBeLessThanOrEqual(2600);
    // 外扩一圈：比单纯视口大
    expect(b.x1 - b.x0).toBeGreaterThan(800);
  });

  test('长路径只保留镜头附近的段，绕回来的两段不会被连成一条直线', () => {
    const pts: [number, number][] = [
      [0, 0], [100, 100], [200, 200], [900, 900], [1000, 1000], [200, 210], [100, 110],
    ];
    const segs = clipSnakeSegments(pts, { x0: 80, y0: 80, x1: 250, y1: 250 });
    expect(segs.length).toBe(2);
    expect(segs[0]).toEqual([[0, 0], [100, 100], [200, 200], [900, 900]]);
    expect(segs[1]).toEqual([[1000, 1000], [200, 210], [100, 110]]);
  });
});

describe('贪吃蛇排行榜', () => {
  const mk = (id: string, score: number, extra: Record<string, unknown> = {}) => ({ id, score, ...extra });

  test('按分数降序，最多 10 条，名次按完整排序算', () => {
    const snakes = Array.from({ length: 12 }, (_, i) => mk(`p${i}`, i * 10));
    const top = rankTopSnakes(snakes, 10);
    expect(top.length).toBe(10);
    expect(top[0].snake.id).toBe('p11');
    expect(top[0].rank).toBe(1);
    expect(top[9].snake.id).toBe('p2');
    expect(top[9].rank).toBe(10);
  });

  test('自己掉出前 10 时占据最后一行，名次仍是真实排名', () => {
    const snakes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => mk(`p${i}`, i * 10));
    snakes.push(mk('me', 0, { mine: true }));
    const top = rankTopSnakes(snakes, 10);
    expect(top.length).toBe(10);
    expect(top[9].snake.id).toBe('me');
    expect(top[9].rank).toBeGreaterThan(10);
    // 自己没掉出时不会被重复插入
    const inTop = rankTopSnakes([mk('me', 999, { mine: true }), mk('a', 1)], 10);
    expect(inTop.map(x => x.snake.id)).toEqual(['me', 'a']);
  });

  test('死人/离场的人不参与时榜单不会留空壳（纯函数只吃入参，不读全局状态）', () => {
    const top = rankTopSnakes([mk('a', 5), mk('b', 9)], 10);
    expect(top.map(x => x.snake.id)).toEqual(['b', 'a']);
    expect(rankTopSnakes([], 10)).toEqual([]);
  });
});
