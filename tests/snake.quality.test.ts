import { describe, test, expect } from 'bun:test';
import { snakeRenderScale } from '../src/games/snake/Scene2D';

/**
 * 画质自适应（GM-snake-35）：
 * 之前下限是 0.75 —— canvas 位图只有 CSS 显示尺寸的 0.75 倍，浏览器只能拉伸插值，
 * 于是手机端「越玩越糊」。现在下限锁 1.0，且升档比降档快（不会只降不升）。
 */
describe('贪吃蛇画质自适应', () => {
  test('分辨率下限不低于 1.0：位图永远不小于显示尺寸', () => {
    let scale = 1.5;
    for (let i = 0; i < 50; i++) scale = snakeRenderScale(scale, 999, 0);
    expect(scale).toBeGreaterThanOrEqual(1);
  });

  test('掉帧会降档，但流畅一段后能升回去（不再只降不升）', () => {
    let scale = 1.5;
    scale = snakeRenderScale(scale, 60, 0);
    expect(scale).toBeLessThan(1.5);
    const down = scale;
    // 连续流畅 60 帧 → 升回一档
    scale = snakeRenderScale(scale, 0, 60);
    expect(scale).toBeGreaterThan(down);
    // 一直流畅 → 回到上限
    scale = snakeRenderScale(scale, 0, 600);
    expect(scale).toBeCloseTo(1.5, 6);
  });

  test('掉帧/流畅都没到阈值时不动（避免来回抖）', () => {
    expect(snakeRenderScale(1.5, 10, 0)).toBe(1.5);
    expect(snakeRenderScale(1.5, 0, 10)).toBe(1.5);
  });
});
