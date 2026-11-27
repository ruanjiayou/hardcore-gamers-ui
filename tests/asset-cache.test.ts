import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_CACHE, assetUrls, cacheGameAssets, revisionKeyOf } from '../src/services/assetCache';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

class FakeCache {
  map = new Map<string, Response>();
  async match(req: Request | string) { return this.map.get(String(req)); }
  async put(req: Request | string, res: Response) { this.map.set(String(req), res.clone()); }
  async delete(req: Request | string) { return this.map.delete(String(req)); }
}

const manifest = {
  game: 'snake',
  revision: 'snake:1',
  images: { a: '/skins/a.svg', 'a:head': '/skins/ah.svg' },
  groups: {
    snake: { items: [{ id: 'a', url: '/skins/a.svg', head: '/skins/ah.svg' }] },
    food: { items: [{ id: 'b', url: '/skins/b.svg' }] },
  },
  audio: { bgm: [{ url: '/audio/bgm.mp3' }], sfx: { move: '/audio/move.mp3' } },
} as any;

describe('UI-110 游戏资源清单缓存', () => {
  test('清单接口把游戏名放 path，不再带 game/pack query', () => {
    const api = read('src/services/api.ts');
    expect(api).toContain("`/assets/${encodeURIComponent(game)}/manifest.json`");
    expect(api).not.toContain("'/assets/manifest.json'");
  });

  test('assetUrls 收集图片/头图/音频并去重', () => {
    expect(assetUrls(manifest)).toEqual([
      '/skins/a.svg', '/skins/ah.svg', '/skins/b.svg', '/audio/bgm.mp3', '/audio/move.mp3',
    ]);
  });

  test('revision 按游戏分开存', () => {
    expect(revisionKeyOf('snake')).toBe('/lobby/assets/revision/snake');
    expect(ASSET_CACHE).toBe('lobby-assets-v1');
  });

  test('同一 revision 且全部命中缓存时一个网络请求都不发', async () => {
    const cache = new FakeCache();
    const fetched: string[] = [];
    const fetcher = async (url: string) => { fetched.push(url); return new Response('x'); };
    await cacheGameAssets(manifest, { cache: cache as any, fetcher });
    expect(fetched).toHaveLength(5);
    expect(await cache.match('/skins/a.svg')).toBeTruthy();
    fetched.length = 0;
    await cacheGameAssets(manifest, { cache: cache as any, fetcher });
    expect(fetched).toHaveLength(0);
  });

  test('revision 变化后整批资源重新缓存', async () => {
    const cache = new FakeCache();
    const fetched: string[] = [];
    const fetcher = async (url: string) => { fetched.push(url); return new Response('x'); };
    await cacheGameAssets(manifest, { cache: cache as any, fetcher });
    fetched.length = 0;
    await cacheGameAssets({ ...manifest, revision: 'snake:2' }, { cache: cache as any, fetcher });
    expect(fetched).toHaveLength(5);
    expect((await cache.match(revisionKeyOf('snake')))!.text()).resolves.toBe('snake:2');
  });

  test('进度回调按实际处理数推进', async () => {
    const cache = new FakeCache();
    const progress: Array<[number, number]> = [];
    await cacheGameAssets(manifest, {
      cache: cache as any,
      fetcher: async () => new Response('x'),
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  });

  test('单个资源失败不中断整批缓存', async () => {
    const cache = new FakeCache();
    const fetched: string[] = [];
    await cacheGameAssets(manifest, {
      cache: cache as any,
      fetcher: async (url) => {
        fetched.push(url);
        if (url === '/audio/bgm.mp3') throw new Error('offline');
        return new Response('x');
      },
    });
    expect(fetched).toHaveLength(5);
    expect(await cache.match('/skins/a.svg')).toBeTruthy();
  });
});
