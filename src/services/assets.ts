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

/**
 * 预加载一张图；失败不抛错（渲染层会回退矢量）。
 *
 * 先带 `crossOrigin="anonymous"` 加载：`skinTile()` 要读位图四角判断「圆贴图还是满幅图」，
 * 跨域图片会把 canvas 标记为 tainted，`getImageData` 直接抛错。
 * 万一对方没配 CORS 头（例如前端和资源不在同一个域），退回普通加载 ——
 * 图还是能画，只是这一步判断失败、按满幅贴图处理（裁一下，不会露缝）。
 */
function preloadImage(game: string, key: string, url: string): Promise<void> {
  if (typeof window === 'undefined' || !url) return Promise.resolve();
  const cacheKey = imgKey(game, key);
  if (images.has(cacheKey)) return Promise.resolve();

  const load = (cors: boolean) => new Promise<HTMLImageElement | null>(resolve => {
    const img = new window.Image();
    img.decoding = 'async';
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

  return load(true).then(img => img || load(false)).then(img => {
    if (img) images.set(cacheKey, img);
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

/** 取皮肤对应的尾巴图（`head_body_tail` / `head_alt_body_tail` 才有）；没配返回 null */
export function assetTailImage(game: string, assetId: string): HTMLImageElement | null {
  if (!assetId) return null;
  return images.get(imgKey(game, `${assetId}:tail`)) || null;
}

/**
 * 取交替身体的第二张图（`alt_body` 系才有）；没配返回 null。
 * 有这张就代表身体要沿路径分节交替贴图，而不是整条用一张可平铺纹理。
 */
export function assetAltImage(game: string, assetId: string): HTMLImageElement | null {
  if (!assetId) return null;
  return images.get(imgKey(game, `${assetId}:alt`)) || null;
}

/**
 * 皮肤部件的位图缓存（GM-snake-41 起所有部件都走这里）。
 *
 * 为什么要缓存：每帧拿 SVG 元素按当前尺寸 `drawImage`，浏览器要按那个尺寸重新光栅化 ——
 * 尺寸随蛇身变化连续，缓存命不中，于是**每帧重画一遍**，边缘跟着亚像素抖，
 * 花纹越密越明显（看着就是「蛇一动，整身皮肤在抖」）。
 * 先转一张位图（小图**拉伸铺满** 96px 画布，放大后才不糊），之后每帧只缩放这张图。
 * 「铺满」这一条很关键：早先是把 32px 的糖果 BMP 居中按原尺寸画进 96px 画布，
 * 圆只占画布 1/3，剩下 2/3 全是透明 —— 贴到蛇身上就是「一串分开的小珠子」。
 *
 * **不给透明像素填色**（`GM-snake-43` / `44`）：圆形贴图的四角就是透明的，
 * 蛇身靠相邻贴图重叠连成一条，轮廓外侧那圈扇贝边是设计的一部分。
 * 早先填过「主体平均色」，糖果皮肤于是整条蛇带着一层粉底 —— 那不是皮肤的一部分。
 *
 * 顺带探出「四角是否透明」（`round`），一起缓存：圆贴图不裁剪、边长 = 身宽；
 * 满幅贴图裁到身宽带、边长 1.5 身宽（见 `games/snake/skin.ts` 的 `skinCell`）。
 *
 * 位图按图片对象缓存（WeakMap）：一局只光栅化一次。图还没解码完
 * （`naturalWidth` 为 0）时直接返回原图且**不缓存**，下一帧再试。
 */
interface SkinTile {
  canvas: HTMLCanvasElement;
  /** 四角透明（圆形贴图）→ 不用裁剪；false 表示满幅图，要裁到身宽带 */
  round: boolean;
  /** 贴图主色（`#rrggbb`）：无头图的单图皮肤用它在头部铺底色 */
  accent: string;
}

const tiles = new WeakMap<HTMLImageElement, SkinTile>();

/** 建位图（只跑一次），顺手探四角透明度 */
function tileOf(img: HTMLImageElement | null): SkinTile | null {
  if (!img || typeof document === 'undefined') return null;
  const hit = tiles.get(img);
  if (hit) return hit;
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) return null;

  const n = Math.max(w, h, 96);
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingQuality = 'high';
  // 拉伸铺满，不居中按原尺寸画：贴图在蛇身上是按「一整节」缩放的，
  // 画布里留白就等于蛇身上留白（圆贴图会变成一串分开的珠子）
  g.drawImage(img, 0, 0, n, n);

  const px = readPixels(g, n);
  const tile: SkinTile = { canvas: c, round: isRoundBitmap(px, n), accent: accentOf(px, n) };
  tiles.set(img, tile);
  return tile;
}

/**
 * 一次读完整张位图（RGBA）。
 *
 * 要一次性读出：既判断「四角是否透明」，又要算主色（头部底色用）。
 * 跨域图片会把 canvas 标记为 tainted、`getImageData` 直接抛错 ——
 * 调用方（`preloadImage`）已经带 `crossOrigin` 兜过一层，这里再失败就返回 null，
 * 由上层按「满幅贴图 + 无主色」处理（宁可裁一下，也不会画错）。
 */
function readPixels(g: CanvasRenderingContext2D, n: number): Uint8ClampedArray | null {
  try {
    return g.getImageData(0, 0, n, n).data;
  } catch {
    return null;
  }
}

const DEFAULT_ACCENT = '#e2e8f0';

/**
 * 四角透明 + 中心不透明 → 圆形贴图。
 *
 * 只看 5 个像素：四个角（各 1px）和正中心。圆的四角一定是透的，
 * 满幅长方形图四角是不透明的；中心那一下是为了排除「整张全透明」的空图。
 */
function isRoundBitmap(px: Uint8ClampedArray | null, n: number): boolean {
  if (!px) return false;
  const alphaAt = (x: number, y: number) => px[(y * n + x) * 4 + 3];
  const corners = [alphaAt(0, 0), alphaAt(n - 1, 0), alphaAt(0, n - 1), alphaAt(n - 1, n - 1)];
  return alphaAt(n >> 1, n >> 1) > 40 && corners.every(a => a <= 24);
}

/**
 * 贴图主色：抽样取「饱和度最高」的那一批不透明像素的平均色。
 *
 * 为什么不取平均色：糖果那种贴图一大半是接近白的浅粉（`#fdf2f8`），
 * 平均下来几乎是白的，铺到头上和背景糊成一片。
 * 取饱和度前 18% 的像素，拿到的就是贴图里真正「有色」的那部分（糖果 = 粉色），
 * 这样单图皮肤（没有单独头图）的蛇头才是一个认得出的圆形头部，而不是一块花板子。
 */
function accentOf(px: Uint8ClampedArray | null, n: number): string {
  if (!px) return DEFAULT_ACCENT;
  const step = Math.max(1, Math.round(n / 24));
  const found: { r: number; g: number; b: number; s: number }[] = [];
  for (let y = 0; y < n; y += step) {
    for (let x = 0; x < n; x += step) {
      const i = (y * n + x) * 4;
      const a = px[i + 3];
      // 半透明边角（抗锯齿）不算：它的颜色是被背景稀释过的
      if (a < 200) continue;
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 24) continue; // 近黑（霓虹底的深色）没有色相可言，别把它当主色
      found.push({ r, g, b, s: max === 0 ? 0 : (max - min) / max });
    }
  }
  if (!found.length) return DEFAULT_ACCENT;
  found.sort((a, b) => b.s - a.s);
  const take = Math.max(1, Math.round(found.length * 0.18));
  let r = 0; let g = 0; let b = 0;
  for (let i = 0; i < take; i++) { r += found[i].r; g += found[i].g; b += found[i].b; }
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v / take))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** 贴图位图：一局只光栅化一次（未解码时返回原图，不缓存） */
export function skinTile(img: HTMLImageElement | null): CanvasImageSource | null {
  if (!img) return null;
  return tileOf(img)?.canvas || img;
}

/** 这张贴图是不是「四角透明」的圆形贴图（决定要不要裁到身宽带子） */
export function skinIsRound(img: HTMLImageElement | null): boolean {
  return tileOf(img)?.round === true;
}

/**
 * 贴图主色（`#rrggbb`）：没配蛇头图的单图皮肤用它给蛇头铺底色。
 * 取不到（图没解码/跨域读不出像素）时返回中性灰，调用方照常画。
 */
export function skinAccent(img: HTMLImageElement | null): string {
  return tileOf(img)?.accent || DEFAULT_ACCENT;
}

/** 某个外观资源的清单条目（拿 skinType / 展示名等元信息） */
export function assetItem(game: string, assetId: string): AssetManifestItem | undefined {
  if (!assetId) return undefined;
  const m = manifests.get(game);
  if (!m) return undefined;
  for (const group of Object.values(m.groups || {})) {
    const hit = group.items.find(i => i.id === assetId);
    if (hit) return hit;
  }
  return undefined;
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
