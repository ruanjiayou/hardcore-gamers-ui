import { describe, test, expect } from 'bun:test';
import { snakeControlsLayout, joystickAngle } from '../src/games/snake/Scene2D';

describe('贪吃蛇控件：固定屏幕布局，与场景/镜头无关', () => {
  test('桌面与手机都是左下加速、右下摇杆，且都在下半屏', () => {
    for (const [w, h] of [[1280, 800], [375, 667], [820, 1180]]) {
      const { boost, joy } = snakeControlsLayout(w, h);
      expect(boost.x).toBeLessThan(w / 2);
      expect(joy.x).toBeGreaterThan(w / 2);
      expect(boost.y).toBeGreaterThan(h / 2);
      expect(joy.y).toBeGreaterThan(h / 2);
      // 加速按钮和摇杆本体不重叠
      expect(Math.hypot(boost.x - joy.x, boost.y - joy.y)).toBeGreaterThan(boost.r + joy.r + 20);
      // 摇杆热区不出屏
      expect(joy.x - joy.r * 1.45).toBeGreaterThan(0);
      expect(joy.x + joy.r * 1.45).toBeLessThan(w + 20);
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
});
