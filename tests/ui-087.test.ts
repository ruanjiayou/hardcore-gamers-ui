import { describe, expect, test, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cacheUrlOf,
  clearTransitionFlags,
  consumeWarmNav,
  markWarmNav,
  prefetchTarget,
} from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

type Resp = { ok: boolean; json?: () => Promise<unknown> };
function fakeFetch(routes: Record<string, Resp>) {
  const calls: string[] = [];
  return {
    calls,
    fetcher: async (url: string): Promise<Resp> => {
      calls.push(url);
      return routes[url] ?? { ok: false };
    },
  };
}

beforeEach(() => {
  (globalThis as any).sessionStorage = new MemoryStorage();
});

describe('UI-087 预取 = 进度条（缓存加载逻辑不变）', () => {
  test('入口 HTML 单独预取且先于清单/资源；失败即抛', async () => {
    const { fetcher, calls } = fakeFetch({ '/lobby/game/snake/index.html': { ok: false } });
    let threw = false;
    try { await prefetchTarget('/lobby/game/snake/room/abc', { fetcher }); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(calls[0]).toBe('/lobby/game/snake/index.html');
    expect(calls).not.toContain('/lobby/asset-manifest.json');
  });

  test('逐项推进度，入口 HTML 也算一项', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const asset = '/lobby/assets/snake-a1b2.js';
    const { fetcher } = fakeFetch({
      [entry]: { ok: true },
      '/lobby/asset-manifest.json': { ok: true, json: async () => ({ [entry]: [entry, asset] }) },
      [asset]: { ok: true },
    });
    const ticks: Array<[number, number]> = [];
    await prefetchTarget('/lobby/game/snake/', { fetcher, onProgress: (d, t) => ticks.push([d, t]) });
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[ticks.length - 1]).toEqual([2, 2]);
  });

  test('单个资源失败不回滚，进度照样走满', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const { fetcher } = fakeFetch({
      [entry]: { ok: true },
      '/lobby/asset-manifest.json': { ok: true, json: async () => ({ [entry]: [entry, '/bad.js'] }) },
      '/bad.js': { ok: false },
    });
    let done = 0, total = 0;
    await prefetchTarget('/lobby/game/snake/', { fetcher, onProgress: (d, t) => { done = d; total = t; } });
    expect([done, total]).toEqual([2, 2]);
  });

  test('没有清单接口时仍完成预取', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const { fetcher } = fakeFetch({ [entry]: { ok: true } });
    let done = 0, total = 0;
    await prefetchTarget('/lobby/game/snake/', { fetcher, onProgress: (d, t) => { done = d; total = t; } });
    expect([done, total]).toEqual([1, 1]);
  });
});

describe('UI-087 热导航标记（无遮罩）', () => {
  test('markWarmNav 打标记，clearTransitionFlags 清掉', () => {
    markWarmNav();
    expect(consumeWarmNav()).toBe(true);
    expect((globalThis as any).sessionStorage.getItem('lobby:warm-nav')).toBeNull();
  });

  test('不再存在 lobby:curtain 标记', () => {
    markWarmNav();
    expect((globalThis as any).sessionStorage.getItem('lobby:curtain')).toBeNull();
  });

  test('consumeWarmNav 过期标记视为非热导航', () => {
    (globalThis as any).sessionStorage.setItem('lobby:warm-nav', String(Date.now() - 11_000));
    expect(consumeWarmNav()).toBe(false);
  });
});

describe('UI-087 编排顺序（静态约束）', () => {
  test('softGo：push → 进度层 → 预取 → 1s → replace → 失败回滚', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const push = body.indexOf('loadingUrlOf(');
    const loader = body.indexOf('showLoader()');
    const prefetch = body.indexOf('prefetchTarget(', loader);
    const floor = body.indexOf('MIN_LOADING_MS', prefetch);
    const replace = body.indexOf('location.replace(', floor);
    const rollback = body.indexOf('history.back()', replace);
    expect(push).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(push);
    expect(prefetch).toBeGreaterThan(loader);
    expect(floor).toBeGreaterThan(prefetch);
    expect(replace).toBeGreaterThan(floor);
    expect(rollback).toBeGreaterThan(replace);
    expect(code).not.toContain('withDeadline(');
    expect(code).not.toContain('Promise.race(');
  });

  test('关游戏分支无进度层、不强制 1s', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const back = body.slice(body.indexOf('if (back) {'), body.indexOf('history.pushState('));
    expect(back).toContain('prefetchTarget(');
    expect(back).not.toContain('showLoader(');
    expect(back).not.toContain('MIN_LOADING_MS');
  });

  test('整条链路不再有遮罩函数', () => {
    const code = read('src/navigation.ts');
    for (const name of ['showCurtain', 'hideCurtain', 'dismissCurtain', 'setTargetBrand']) {
      expect(code).not.toContain(name);
    }
  });
});

describe('UI-087 PWA 首帧与缓存插件', () => {
  test('Vite 注入首帧渐变与 loading 刷新，不注入遮罩', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('transformIndexHtml');
    expect(config).toContain('--lobby-page-gradient');
    expect(config).toContain('/lobby/loading');
    expect(config).not.toContain('lobby-curtain-on');
    expect(config).not.toContain('lobby:curtain');
  });

  test('SW 网络优先：成功写缓存、失败回落 + 离线通知、探测请求放行', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('lobby_probe');
    expect(config).toContain('caches.open');
    expect(config).toContain('cache.put');
    expect(config).toContain('offlineNotice');
    expect(config).toContain('respondWith(network.catch');
  });

  test('资源清单按入口分组，dev 与 build 都产出', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('asset-manifest.json');
    expect(config).toContain('configureServer');
    expect(config).toContain('generateBundle');
  });
});
