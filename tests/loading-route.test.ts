import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheUrlOf, go, isBackToLobby, loadingUrlOf, softGo } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('游戏加载路由', () => {
  test('加载路由把真实目标 URL 编码进 to 参数', () => {
    expect(loadingUrlOf('/lobby/game/snake/')).toBe('/lobby/loading?to=%2Flobby%2Fgame%2Fsnake%2F');
    expect(loadingUrlOf('/lobby/game/snake/room/abc')).toBe('/lobby/loading?to=%2Flobby%2Fgame%2Fsnake%2Froom%2Fabc');
  });

  test('只有「游戏入口 → 公共入口」才算回大厅', () => {
    expect(isBackToLobby('/lobby/game/snake/', '/lobby/')).toBe(true);
    expect(isBackToLobby('/lobby/game/snake/room/abc', '/lobby/me')).toBe(true);
    expect(isBackToLobby('/lobby/', '/lobby/game/snake/')).toBe(false);
    expect(isBackToLobby('/lobby/', '/lobby/me')).toBe(false);
    expect(isBackToLobby('/lobby/game/snake/', '/lobby/game/gomoku/')).toBe(false);
  });

  test('softGo push 加载路由：进度层 → 预取 → 1s → replace → 失败回滚', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    expect(body).toContain('loadingUrlOf(');
    expect(body).toContain('history.pushState');
    expect(body).toContain('showLoader()');
    expect(body).toContain('location.replace');
    expect(body).toContain('history.back()');
    expect(body).not.toContain('showCurtain');
    expect(code).toContain('fetchEntryHtml');
    expect(typeof softGo).toBe('function');
    expect(typeof go).toBe('function');
  });

  test('入口 HTML 单独预取，其余资源 allSettled，只有入口失败才回滚', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('lobby-loader-overlay');
    expect(code).toContain('Promise.allSettled');
    expect(code).not.toContain('await Promise.all(urls.map');
    const prefetch = code.slice(code.indexOf('export async function prefetchTarget('), code.indexOf('// ---- 热导航标记'));
    expect(prefetch).toContain('await fetchEntryHtml(pathname)');
    expect(code.slice(code.indexOf('async function fetchEntryHtml('), code.indexOf('export async function prefetchTarget('))).toContain('throw new Error');
  });

  test('进度页至少 1 秒，预取不足时补齐', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('MIN_LOADING_MS = 1000');
    expect(code).toContain('loaderStartedAt');
  });

  test('replace 出现在 1s 下限之后，没有提前放行', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const floor = body.indexOf('MIN_LOADING_MS', body.indexOf('prefetchTarget('));
    expect(body.indexOf('location.replace(', floor)).toBeGreaterThan(floor);
    expect(code).not.toContain('withDeadline(');
    expect(code).not.toContain('Promise.race');
  });

  test('回大厅分支不建进度层、不强制 1 秒', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    expect(body).toContain('isBackToLobby(');
    const backBranch = body.slice(body.indexOf('if (back) {'), body.indexOf('history.pushState('));
    expect(backBranch).not.toContain('showLoader(');
    expect(backBranch).not.toContain('MIN_LOADING_MS');
  });

  test('cacheUrlOf 仍是清单 key', () => {
    expect(cacheUrlOf('/lobby/game/2048/')).toBe('/lobby/game/2048/index.html');
    expect(cacheUrlOf('/lobby/')).toBe('/lobby/index.html');
  });
});

describe('首帧与资源清单', () => {
  test('Vite 从 8 个入口 HTML 抽取资源并输出 manifest', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('asset-manifest.json');
    expect(config).toContain('<script');
    expect(config).toContain('<link');
    expect(config).toContain('serviceWorkerPrecache');
  });

  test('内联脚本只处理 /lobby/loading 刷新，不含遮罩或 5s 兜底', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('/lobby/loading');
    expect(config).toContain('location.replace(to)');
    expect(config).not.toContain('lobby:curtain');
    expect(config).not.toContain('lobby-curtain-on');
    expect(config).not.toContain('setTimeout(off, 5000)');
  });

  test('AppBootstrap 不再撤幕', () => {
    expect(read('src/bootstrap/AppBootstrap.tsx')).not.toContain('dismissCurtain');
  });

  test('预取流程追加按游戏清单请求与全部资源缓存', () => {
    const code = read('src/navigation.ts');
    const prefetch = code.slice(code.indexOf('export async function prefetchTarget('), code.indexOf('// ---- 热导航标记'));
    expect(prefetch).toContain('getAssetManifest');
    expect(prefetch).toContain('cacheGameAssets');
    expect(code).toContain('gameSlugOf');
  });

  test('直达游戏冷启动也先走进度页并检查缓存', () => {
    const code = read('src/bootstrap/AppBootstrap.tsx');
    expect(code).toContain('startEntryLoader');
    expect(code).toContain('prefetchTarget');
    expect(code).toContain('stopEntryLoader');
    expect(code).toContain('consumeWarmNav');
  });

  test('SW 缓存范围扩展到静态资源路径，但不缓存 API', () => {
    const config = read('vite.config.ts');
    expect(config).toContain("'/skins/'");
    expect(config).toContain("'/audio/'");
    expect(config).toContain("'/uploads/'");
    expect(config).toContain("url.pathname.startsWith('/api/')");
  });
});
