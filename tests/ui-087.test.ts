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

/** bun test 没有 DOM 的 sessionStorage，按 Storage 接口给一个内存实现。 */
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
      const resp = routes[url];
      if (!resp) return { ok: false };
      return resp;
    },
  };
}

beforeEach(() => {
  (globalThis as any).sessionStorage = new MemoryStorage();
});

describe('UI-087 预取 = 进度条（同一组事件）', () => {
  test('入口 HTML 单独预取且先于清单/资源；失败即抛', async () => {
    const { fetcher, calls } = fakeFetch({
      '/lobby/game/snake/index.html': { ok: false },
    });
    let threw = false;
    try {
      await prefetchTarget('/lobby/game/snake/room/abc', { fetcher });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(calls[0]).toBe('/lobby/game/snake/index.html');
    // 入口 HTML 失败就不去拿清单
    expect(calls).not.toContain('/lobby/asset-manifest.json');
  });

  test('逐项推进度：入口 HTML 也算一项，清单资源全部抓完后 done === total', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const asset = '/lobby/assets/snake-a1b2.js';
    const { fetcher } = fakeFetch({
      [entry]: { ok: true },
      '/lobby/asset-manifest.json': { ok: true, json: async () => ({ [entry]: [entry, asset] }) },
      [asset]: { ok: true },
    });
    const ticks: Array<[number, number]> = [];
    await prefetchTarget('/lobby/game/snake/', {
      fetcher,
      onProgress: (done, total) => ticks.push([done, total]),
    });
    expect(ticks.length).toBeGreaterThan(0);
    const [done, total] = ticks[ticks.length - 1];
    expect(total).toBe(2);
    expect(done).toBe(total);
  });

  test('单个资源抓取失败不回滚：Promise.allSettled 让进度照样走满', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const okAsset = '/lobby/assets/snake-ok.js';
    const badAsset = '/lobby/assets/snake-bad.js';
    const { fetcher } = fakeFetch({
      [entry]: { ok: true },
      '/lobby/asset-manifest.json': { ok: true, json: async () => ({ [entry]: [entry, okAsset, badAsset] }) },
      [okAsset]: { ok: true },
      [badAsset]: { ok: false },
    });
    let done = 0;
    let total = 0;
    await prefetchTarget('/lobby/game/snake/', {
      fetcher,
      onProgress: (d, t) => { done = d; total = t; },
    });
    expect(total).toBe(3);
    expect(done).toBe(3);
  });

  test('没有清单接口时仍完成预取，进度到 100%', async () => {
    const entry = cacheUrlOf('/lobby/game/snake/');
    const { fetcher } = fakeFetch({ [entry]: { ok: true } });
    let done = 0;
    let total = 0;
    await prefetchTarget('/lobby/game/snake/', {
      fetcher,
      onProgress: (d, t) => { done = d; total = t; },
    });
    expect(total).toBe(1);
    expect(done).toBe(1);
  });
});

describe('UI-087 转场标记与回滚', () => {
  test('markWarmNav(false) 只打热导航标记，不亮黑幕', () => {
    markWarmNav(false);
    expect(consumeWarmNav()).toBe(true);
    expect((globalThis as any).sessionStorage.getItem('lobby:curtain')).toBeNull();
  });

  test('clearTransitionFlags 清掉热导航与黑幕两个标记', () => {
    markWarmNav(true);
    expect((globalThis as any).sessionStorage.getItem('lobby:curtain')).not.toBeNull();
    clearTransitionFlags();
    expect((globalThis as any).sessionStorage.getItem('lobby:warm-nav')).toBeNull();
    expect((globalThis as any).sessionStorage.getItem('lobby:curtain')).toBeNull();
  });

  test('consumeWarmNav 过期标记视为非热导航', () => {
    (globalThis as any).sessionStorage.setItem('lobby:warm-nav', String(Date.now() - 11_000));
    expect(consumeWarmNav()).toBe(false);
  });
});

describe('UI-087 编排顺序（静态约束）', () => {
  test('softGo：push 加载路由 → 进度层 → 预取 → 1s 下限 → 黑幕 → 换文档 → 失败回滚', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const push = body.indexOf('loadingUrlOf(');
    const loader = body.indexOf('showLoader()');
    const prefetch = body.indexOf('prefetchTarget(', loader);
    const floor = body.indexOf('MIN_LOADING_MS', prefetch);
    const curtain = body.indexOf('showCurtain()', floor);
    const replace = body.indexOf('location.replace(', curtain);
    const rollback = body.indexOf('history.back()', replace);

    expect(push).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(push);
    expect(prefetch).toBeGreaterThan(loader);
    expect(floor).toBeGreaterThan(prefetch);
    expect(curtain).toBeGreaterThan(floor);
    expect(replace).toBeGreaterThan(curtain);
    expect(rollback).toBeGreaterThan(replace);
    // 不允许超时放行
    expect(code).not.toContain('withDeadline(');
    expect(code).not.toContain('Promise.race(');
  });

  test('关游戏分支无进度层、不强制 1s，但同样在预取后亮幕换文档', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const back = body.slice(body.indexOf('if (back) {'), body.indexOf('history.pushState('));
    expect(back).toContain('prefetchTarget(');
    expect(back).toContain('showCurtain()');
    expect(back).not.toContain('showLoader(');
    expect(back).not.toContain('MIN_LOADING_MS');
  });

  test('dismissCurtain 由 React 首屏调用，内联脚本只有 5s 兜底', () => {
    const boot = read('src/bootstrap/AppBootstrap.tsx');
    expect(boot).toContain('dismissCurtain()');
    const config = read('vite.config.ts');
    expect(config).toContain('setTimeout(off, 5000)');
    expect(config).not.toContain("addEventListener('load', off");
    expect(config).not.toContain("addEventListener('DOMContentLoaded', off");
  });
});

describe('UI-087 PWA 黑幕与缓存插件', () => {
  test('Vite 向 8 个 HTML 注入黑幕，且处理加载路由刷新回真实目标', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('transformIndexHtml');
    expect(config).toContain('lobby-curtain-on');
    expect(config).toContain('lobby:curtain');
    expect(config).toContain('/lobby/loading');
    for (const rel of [
      'index.html',
      'src/pages/game/snake/index.html',
      'src/pages/game/chess/index.html',
    ]) {
      expect(read(rel)).not.toContain('lobby-curtain-on');
    }
  });

  test('SW 网络优先：成功写缓存、失败回落 + 离线通知、探测请求放行', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("lobby_probe");
    expect(config).toContain('caches.open');
    expect(config).toContain('cache.put');
    expect(config).toContain('offlineNotice');
    expect(config).toContain('respondWith(network.catch');
  });

  test('资源清单按入口分组，dev 与 build 都产出 asset-manifest.json', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('asset-manifest.json');
    expect(config).toContain('configureServer');
    expect(config).toContain('generateBundle');
  });
});
