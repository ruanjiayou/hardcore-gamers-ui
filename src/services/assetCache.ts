/**
 * UI-110：把「某个游戏的全部资源」写进 Cache Storage。
 *
 * 资源 URL 只来自服务端清单（SB-066），不再由客户端拼主题路径；
 * revision 变了就整批重抓，没变且缓存命中则跳过，进度按实际处理数推进。
 */
import { getAssetManifest, type AssetManifest } from './api';

export const ASSET_CACHE = 'lobby-assets-v1';
const REVISION_PREFIX = '/lobby/assets/revision';

export function revisionKeyOf(game: string): string {
  return `${REVISION_PREFIX}/${game}`;
}

/** 清单里所有需要缓存的 URL（图片身体 + 蛇头 + 音频），去重保序 */
export function assetUrls(manifest: AssetManifest): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (url?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  for (const url of Object.values(manifest.images || {})) add(url);
  for (const group of Object.values(manifest.groups || {})) {
    for (const item of group.items || []) {
      add(item.body || item.url);
      add(item.head);
    }
  }
  for (const track of manifest.audio?.bgm || []) add(track.url);
  for (const url of Object.values(manifest.audio?.sfx || {})) add(url);
  return out;
}

interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
  delete(request: Request | string): Promise<boolean>;
}

/**
 * 拉取并重放清单里的全部资源。
 * 单个资源失败只跳过它（对局渲染会回退矢量），不影响其余资源与进度推进。
 */
export async function cacheGameAssets(
  manifest: AssetManifest,
  options: {
    cache?: CacheLike;
    fetcher?: (url: string) => Promise<Response>;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ done: number; total: number; downloaded: number }> {
  const cache = options.cache
    ?? (typeof caches !== 'undefined' ? await caches.open(ASSET_CACHE) : undefined);
  if (!cache) return { done: 0, total: 0, downloaded: 0 };

  const revisionKey = revisionKeyOf(manifest.game);
  const cachedRev = await cache.match(revisionKey).then(r => r?.text().catch(() => '') || '').catch(() => '');
  const refresh = cachedRev !== manifest.revision;
  await cache.put(revisionKey, new Response(manifest.revision)).catch(() => undefined);

  const urls = assetUrls(manifest);
  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  let done = 0;
  let downloaded = refresh ? 1 : 0; // revision 记录本身也算一项
  for (const url of urls) {
    let ok = !refresh && !!(await cache.match(url).catch(() => undefined));
    if (!ok) {
      try {
        const res = await fetcher(url);
        if (res.ok) {
          await cache.put(url, res.clone());
          ok = true;
        }
      } catch {
        // 单个资源失败不阻断整批
      }
    }
    if (ok) downloaded += 1;
    done += 1;
    options.onProgress?.(done, urls.length);
  }
  return { done, total: urls.length, downloaded };
}

/** 进度页用的便捷入口：先拉游戏清单，再缓存全部资源 */
export async function getGameAssetUrls(game: string): Promise<string[]> {
  const res = await getAssetManifest(game);
  if (res.data?.code !== 0 || !res.data?.data) throw new Error('资源清单请求失败');
  const manifest = res.data.data;
  await cacheGameAssets(manifest);
  return assetUrls(manifest);
}
