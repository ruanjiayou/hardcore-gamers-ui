import { describe, expect, test } from 'bun:test';
import {
  assetImage,
  defaultSkinAsset,
  equippedSkin,
  foodAssetId,
  getManifest,
  groupAssetId,
  groupItems,
  itemAssetId,
  loadGameAssets,
  markEquipped,
} from '../src/services/assets';

/**
 * 资源预加载：只测「没有资源时怎么兜底」这条最容易出事的路径。
 * 真拉 manifest 要过 HTTP，单测不碰网络（渲染层拿不到图就回退矢量绘制）。
 */
describe('资源预加载（按 asset_id 索引）', () => {
  test('未加载时取图返回 null（渲染层据此回退矢量）', () => {
    expect(assetImage('snake', 'arcade_snake_food_small')).toBeNull();
    expect(assetImage('snake', '')).toBeNull();
  });

  test('没有 manifest 时各索引都返回空串，不抛错', () => {
    expect(getManifest('snake')).toBeUndefined();
    expect(foodAssetId('snake', 'small')).toBe('');
    expect(itemAssetId('snake', 'magnet')).toBe('');
    expect(equippedSkin('snake')).toBe('');
    expect(defaultSkinAsset('snake')).toBe('');
    expect(groupItems('snake', 'snake')).toEqual([]);
    expect(groupAssetId('snake', 'food', 'small')).toBe('');
  });

  test('markEquipped 在没加载过 manifest 时是空操作', () => {
    expect(() => markEquipped('snake', 'x')).not.toThrow();
  });

  test('空游戏 slug 不发起加载', async () => {
    expect(await loadGameAssets('')).toBeNull();
  });
});
