import { describe, test, expect } from 'bun:test';
import { layout2048 } from '../src/games/2048/Scene2D';

describe('2048 画布响应式布局', () => {
  test('PC 横屏：棋盘在左、分数与最高分在右，互不重叠', () => {
    const L = layout2048(1280, 720);
    expect(L.wide).toBe(true);
    expect(L.scores[0].x).toBeGreaterThanOrEqual(L.gridX + L.gridW);
    expect(L.scores[1].x).toBeCloseTo(L.scores[0].x, 6);
    expect(L.scores[1].y).toBeGreaterThan(L.scores[0].y);
    expect(L.baseH).toBeGreaterThanOrEqual(L.gridY + L.gridH);
  });

  test('手机竖屏：分数在上、棋盘在下，两个分数框并排不重叠', () => {
    const L = layout2048(390, 700);
    expect(L.wide).toBe(false);
    expect(L.scores[0].y).toBeLessThan(L.gridY);
    expect(L.scores[1].y).toBeCloseTo(L.scores[0].y, 6);
    expect(L.scores[1].x).toBeGreaterThan(L.scores[0].x);
    expect(L.scores[1].x).toBeGreaterThanOrEqual(L.scores[0].x + 104);
  });

  test('横竖屏切换只改变布局，棋盘仍是正方形且纯函数可复算', () => {
    const pc = layout2048(1200, 700);
    const phone = layout2048(400, 800);
    for (const L of [pc, phone]) {
      expect(L.gridW).toBe(L.gridH);
      expect(L.gridX).toBeGreaterThanOrEqual(0);
      expect(L.gridY).toBeGreaterThanOrEqual(0);
      expect(L.gridX + L.gridW).toBeLessThanOrEqual(L.baseW);
      expect(L.gridY + L.gridH).toBeLessThanOrEqual(L.baseH);
      expect(layout2048(L.baseW, L.baseH)).toEqual(L);
    }
  });
});
