/**
 * 资源预加载（图片皮肤）。
 *
 * 设计约束：**图片 URL 不进对局快照**。快照每帧广播，塞 URL 既浪费带宽也画不出来；
 * 所以流程是「进游戏前拉一次 manifest → 预加载全部图片 → 对局内只按 key 取已解码的 Image」。
 * 对局中如果某个 key 没有图（当前主题没配 / 加载失败），渲染层回退到矢量绘制，不会白屏。
 *
 * 索引方式：`images` 的 key 是 **asset_id**（资源表主键）。快照里 `food` 的 `k/r`
 * 和 `players[].skin` 最终都换算成 asset_id 再取图，所以「换主题换同 key 资源」
 * 不会串图，也不需要客户端认识 `food.small` 这种字符串。
 *
 * 资源按**分组**下发（`manifest.groups`）：分组名由游戏自己定，服务端不解释含义，
 * 所以黑白棋拿不到贪吃蛇的分组，设置弹框里也不会冒出别的游戏的外观。
 */
import { getAssetManifest, type AssetManifest, type AssetManifestItem } from './api';

/** 每个游戏一份 manifest（按 slug 索引） */
const manifests = new Map<string, AssetManifest>();
/** 已解码的图片：`gameslug:assetId` → HTMLImageElement */
const images = new Map<string, HTMLImageElement>();
/** 已经发起过的加载（同一游戏并发调用共享一次请求） */
const pending = new Map<string, Promise<AssetManifest | null>>();

const imgKey = (game: string, key: string) => `${game}:${key}`;

/** 预加载一张图；失败不抛错（渲染层会回退矢量） */
function preloadImage(game: string, key: string, url: string): Promise<void> {
  if (typeof window === 'undefined' || !url) return Promise.resolve();
  const cacheKey = imgKey(game, key);
  if (images.has(cacheKey)) return Promise.resolve();
  return new Promise<void>(resolve => {
    const img = new window.Image();
    img.decoding = 'async';
    img.onload = () => { images.set(cacheKey, img); resolve(); };
    img.onerror = () => { resolve(); };
    img.src = url;
  });
}

/**
 * 加载并预加载某个游戏的全部皮肤图。
 * @param options.pack 指定资源包（缺省用玩家当前选择，服务端解析）
 * @param options.force 忽略缓存强制重拉（切换语音包后用）
 */
export function loadGameAssets(game: string, options: { pack?: string; force?: boolean } = {}): Promise<AssetManifest | null> {
  if (!game) return Promise.resolve(null);
  const cached = manifests.get(game);
  if (cached && !options.force && !options.pack) return Promise.resolve(cached);
  const flightKey = `${game}:${options.pack || ''}`;
  const running = pending.get(flightKey);
  if (running && !options.force) return running;

  const task = getAssetManifest(game, options.pack)
    .then(async res => {
      const data = res.data?.data;
      if (res.data?.code !== 0 || !data) return null;
      manifests.set(game, data);
      await Promise.all(Object.entries(data.images).map(([key, url]) => preloadImage(game, key, url)));
      return data;
    })
    .catch(() => null)
    .finally(() => { pending.delete(flightKey); });

  pending.set(flightKey, task);
  return task;
}

/** 已加载的 manifest（渲染层读外观清单/当前装备用） */
export function getManifest(game: string): AssetManifest | undefined {
  return manifests.get(game);
}

/** 取一张已解码的皮肤图（按 asset_id）；没有就返回 null，调用方回退矢量绘制 */
export function assetImage(game: string, assetId: string): HTMLImageElement | null {
  if (!assetId) return null;
  return images.get(imgKey(game, assetId)) || null;
}

/** 某个分组下的全部外观资源（按清单里的顺序） */
export function groupItems(game: string, group: string): AssetManifestItem[] {
  return manifests.get(game)?.groups?.[group]?.items || [];
}

/** 分组下某个 key 对应的 asset_id，没配图返回 '' */
export function groupAssetId(game: string, group: string, key: string): string {
  return groupItems(game, group).find(i => i.key === key)?.id || '';
}

/** 食物档位对应的 asset_id（small/mid/big），没配图返回 '' */
export function foodAssetId(game: string, tier: string): string {
  return groupAssetId(game, 'food', tier);
}

/** 道具 key 对应的 asset_id（magnet/star…），没配图返回 '' */
export function itemAssetId(game: string, key: string): string {
  return groupAssetId(game, 'items', key);
}

/** 当前玩家装备的外观 asset_id（游客/未选为 ''，调用方回退默认外观） */
export function equippedSkin(game: string): string {
  return manifests.get(game)?.equipped || '';
}

/** 默认外观的资源 id（该主题里 key=default 的可装备项），没配图返回 '' */
export function defaultSkinAsset(game: string): string {
  const skins = manifests.get(game)?.skins || [];
  return skins.find(s => s.key === 'default')?.id || '';
}

/** 本地更新「已装备」：不等重新拉 manifest，界面立刻切到新外观 */
export function markEquipped(game: string, assetId: string) {
  const m = manifests.get(game);
  if (!m) return;
  m.equipped = assetId;
  m.skins = m.skins.map(s => ({ ...s, equipped: s.id === assetId }));
  for (const g of Object.values(m.groups || {})) {
    g.items = g.items.map(i => ({ ...i, equipped: i.id === assetId }));
  }
}
