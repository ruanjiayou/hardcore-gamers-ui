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

/** 进度页 → 游戏入口文档过桥用的 sessionStorage key 前缀（清单含玩家装备，不进 SW 缓存） */
export const SESSION_MANIFEST_PREFIX = 'lobby:assets:';
/** 换装/清单刷新时广播，所有展示当前外观的页面据此重渲染 */
export const ASSETS_CHANGED_EVENT = 'lobby:assets-changed';

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

/** 写入内存 + 会话存储：进度页拉到的清单由此过桥给下一份文档 */
export function saveGameManifest(game: string, data: AssetManifest): AssetManifest {
  manifests.set(game, data);
  if (typeof sessionStorage !== 'undefined') {
    try { sessionStorage.setItem(SESSION_MANIFEST_PREFIX + game, JSON.stringify(data)); } catch { /* 隐私模式忽略 */ }
  }
  return data;
}

/** 游戏入口渲染前同步恢复清单：首帧就有正确的已装备皮肤，不闪默认图 */
export function hydrateGameAssets(game: string): AssetManifest | undefined {
  if (!game) return undefined;
  const existing = manifests.get(game);
  if (existing) return existing;
  if (typeof sessionStorage === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_MANIFEST_PREFIX + game);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as AssetManifest;
    if (data?.game) { manifests.set(game, data); return data; }
  } catch { /* 坏数据忽略，下面走网络拉取 */ }
  return undefined;
}

/** 冷启动预热：优先用进度页过桥的清单，缺图再拉一次，随后全部解码 */
export async function prewarmGameAssets(game: string): Promise<AssetManifest | null> {
  if (!game) return null;
  let data = hydrateGameAssets(game) || null;
  if (!data) data = await loadGameAssets(game);
  if (!data) return null;
  await Promise.all(Object.entries(data.images || {}).map(([key, url]) => preloadImage(game, key, url)));
  return data;
}

/** 订阅某个游戏的清单变更（换装后所有展示当前外观的页面同步刷新） */
export function subscribeAssets(game: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    if ((event as CustomEvent<{ game?: string }>).detail?.game === game) onChange();
  };
  window.addEventListener(ASSETS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ASSETS_CHANGED_EVENT, listener);
}

/**
 * 加载并预加载某个游戏的全部图片。
 * @param options.force 忽略缓存强制重拉（后台资源改过 revision 时用）
 */
export function loadGameAssets(game: string, options: { force?: boolean } = {}): Promise<AssetManifest | null> {
  if (!game) return Promise.resolve(null);
  const cached = manifests.get(game);
  if (cached && !options.force) return Promise.resolve(cached);
  const flightKey = game;
  const running = pending.get(flightKey);
  if (running && !options.force) return running;

  const task = getAssetManifest(game)
    .then(async res => {
      const data = res.data?.data;
      if (res.data?.code !== 0 || !data) return null;
      saveGameManifest(game, data);
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

/** 取一张已解码的身体图（按 asset_id）；没有就返回 null，调用方回退矢量绘制 */
export function assetImage(game: string, assetId: string): HTMLImageElement | null {
  if (!assetId) return null;
  return images.get(imgKey(game, assetId)) || null;
}

/** 取皮肤对应的蛇头图；没配就返回 null，调用方回退用身体图案 */
export function assetHeadImage(game: string, assetId: string): HTMLImageElement | null {
  if (!assetId) return null;
  return images.get(imgKey(game, `${assetId}:head`)) || null;
}

/** 某类外观当前装备的 asset_id（snake / corpse） */
export function equippedAsset(game: string, group: 'snake' | 'corpse'): string {
  return manifests.get(game)?.equippedByGroup?.[group] || '';
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

/**
 * 本地更新「已装备」：不可变替换整份清单（React 才能看到引用变化），
 * 同步会话存储（下一份文档也拿到新皮肤），并广播给所有展示当前外观的页面。
 */
export function markEquipped(
  game: string,
  assetId: string,
  group: 'snake' | 'corpse' = 'snake',
): AssetManifest | undefined {
  const m = manifests.get(game);
  if (!m) return undefined;
  const next: AssetManifest = {
    ...m,
    equippedByGroup: { ...(m.equippedByGroup || {}), [group]: assetId },
    ...(group === 'snake' ? { equipped: assetId } : {}),
    groups: {
      ...(m.groups || {}),
      [group]: {
        ...(m.groups?.[group] || { items: [] }),
        items: (m.groups?.[group]?.items || []).map(item => ({ ...item, equipped: item.id === assetId })),
      },
    },
    skins: m.skins.map(s => ({ ...s, equipped: s.id === assetId && s.group === group })),
  };
  saveGameManifest(game, next);
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ASSETS_CHANGED_EVENT, { detail: { game } }));
  }
  return next;
}
