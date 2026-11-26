import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheUrlOf, go, isBackToLobby, loadingUrlOf, softGo } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('UI-081 游戏加载路由', () => {
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

  test('UI-085：softGo push 加载路由，黑幕在进度完成后才亮', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    // 进游戏先 push /lobby/loading?to=...
    expect(body).toContain('loadingUrlOf(');
    expect(body).toContain('history.pushState');
    expect(body).toContain('showLoader()');
    expect(body).toContain('location.replace');
    expect(body).toContain('history.back()');
    // 黑幕在 showLoader 之后（进度先，黑幕后）
    const loaderAt = body.indexOf('showLoader()');
    const curtainAt = body.indexOf('showCurtain()', loaderAt);
    expect(curtainAt).toBeGreaterThan(loaderAt);
    expect(code).toContain('fetchEntryHtml');
    expect(typeof softGo).toBe('function');
    expect(typeof go).toBe('function');
  });

  test('UI-084：进度层保留，但逐项预取改 allSettled，只有入口 HTML 失败才回滚', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('lobby-loader-overlay');
    expect(code).toContain('Promise.allSettled');
    expect(code).not.toContain('await Promise.all(urls.map');
    const prefetch = code.slice(code.indexOf('async function prefetchTarget('), code.indexOf('/** UI-082：整段过渡'));
    // 入口 HTML 单独预取（UI-080 稳定关键），其余资源 allSettled 不回滚
    expect(prefetch).toContain('await fetchEntryHtml(pathname)');
    expect(code.slice(code.indexOf('async function fetchEntryHtml('), code.indexOf('/** UI-084'))).toContain('throw new Error');
  });

  test('进度页至少 1 秒，预取不足时补齐', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('MIN_LOADING_MS = 1000');
    expect(code).toContain('loaderStartedAt');
  });

  test('UI-085：黑幕在预取/进度完成之后才亮，不在 softGo 入口', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    const prelude = body.slice(body.indexOf('navigating = true'), body.indexOf('if (back) {'));
    expect(prelude).not.toContain('showCurtain()');
    expect(body).toContain("markWarmNav();\n      showCurtain();");
    // 进度层浮在黑幕之上（黑幕亮时进度层仍在，视觉连续）
    expect(code).toContain('z-index:2147483648');
  });

  test('回大厅分支不建覆盖层、不强制 1 秒', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export async function softGo('));
    expect(body).toContain('isBackToLobby(');
    const backBranch = body.slice(body.indexOf('if (back) {'), body.indexOf('history.pushState('));
    expect(backBranch).not.toContain('showLoader(');
    expect(backBranch).not.toContain('MIN_LOADING_MS');
  });

  test('UI-086：不再用 withDeadline 提前放行，必须预取完才亮幕', () => {
    const code = read('src/navigation.ts');
    expect(code).not.toContain('withDeadline(');
    expect(code).not.toContain('Promise.race');
    expect(read('vite.config.ts')).toContain('setTimeout(off, 5000)');
  });

  test('cacheUrlOf 仍是清单 key', () => {
    expect(cacheUrlOf('/lobby/game/2048/')).toBe('/lobby/game/2048/index.html');
    expect(cacheUrlOf('/lobby/')).toBe('/lobby/index.html');
  });
});

describe('UI-081 资源清单生成', () => {
  test('Vite 从 8 个入口 HTML 抽取资源并输出 manifest', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('asset-manifest.json');
    expect(config).toContain('<script');
    expect(config).toContain('<link');
    expect(config).toContain('serviceWorkerPrecache');
  });

  test('UI-086：内联脚本只亮幕 + 5s 兜底，淡出交给 React 首屏', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('lobby:curtain');
    expect(config).toContain('lobby-curtain-on');
    expect(config).not.toContain("addEventListener('DOMContentLoaded', off");
    expect(config).not.toContain("addEventListener('load', off");
    expect(config).toContain('setTimeout(off, 5000)');
  });
});

describe('UI-086 黑幕在新页面渲染后消失', () => {
  test('dismissCurtain 由 React 首屏调用，内联脚本不再自己淡出', () => {
    const nav = read('src/navigation.ts');
    expect(nav).toContain('export function dismissCurtain(');
    const boot = read('src/bootstrap/AppBootstrap.tsx');
    expect(boot).toContain('dismissCurtain');
    const config = read('vite.config.ts');
    expect(config).not.toContain("addEventListener('DOMContentLoaded', off");
    expect(config).not.toContain("addEventListener('load', off");
    expect(config).toContain('setTimeout(off, 5000)');
  });

  test('黑幕只在预取全部完成后亮，withDeadline 不再提前放行', () => {
    const nav = read('src/navigation.ts');
    const body = nav.slice(nav.indexOf('export async function softGo('));
    // 黑幕出现在 withDeadline 之后
    expect(body.indexOf('showCurtain()')).toBeGreaterThan(body.indexOf('withDeadline('));
    expect(nav).not.toContain('Promise.race');
  });
});
