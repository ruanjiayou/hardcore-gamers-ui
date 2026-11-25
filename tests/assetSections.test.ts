import { describe, expect, test } from 'bun:test';
import { assetSections } from '../src/services/assetSections';

/**
 * 游戏设置弹框的外观分区：**按当前游戏的资源清单算**，不写死任何游戏。
 *
 * 核心回归：黑白棋的清单里没有贪吃蛇的 `snake` 分组 →
 * 它的设置弹框里就不该出现「蛇皮肤」分区。
 */
describe('外观分区按游戏隔离', () => {
  test('贪吃蛇：清单里有哪几个分组就显示哪几个分区', () => {
    const sections = assetSections('snake', ['snake', 'food', 'items']);
    expect(sections.map(s => s.group)).toEqual(['snake', 'food', 'items']);
    expect(sections[0].title).toBe('蛇皮肤');
  });

  test('黑白棋：清单里没有 snake 分组 → 不会出现蛇皮肤分区', () => {
    const sections = assetSections('othello', ['board']);
    expect(sections.map(s => s.group)).toEqual(['board']);
    expect(sections.some(s => s.title === '蛇皮肤')).toBe(false);
  });

  test('没配任何外观的游戏：没有分区（不显示空壳分区）', () => {
    expect(assetSections('tetris', [])).toEqual([]);
  });

  test('没登记过的分组用通用词表兜底，再不行就显示分组名', () => {
    expect(assetSections('chess', ['board'])[0].title).toBe('棋盘');
    expect(assetSections('chess', ['whatever'])[0].title).toBe('whatever');
  });

  test('登记过的分区排在前面，后台新配的分组接在后面', () => {
    const sections = assetSections('snake', ['brand_new', 'food', 'snake']);
    expect(sections.map(s => s.group)).toEqual(['snake', 'food', 'brand_new']);
  });
});
