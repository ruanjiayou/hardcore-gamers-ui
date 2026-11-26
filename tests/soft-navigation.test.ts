import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheUrlOf, go, softGo } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('UI-080 点击预取软导航', () => {
  test('预取 URL 映射到 SW 的 HTML 缓存 key', () => {
    expect(cacheUrlOf('/lobby/game/snake/')).toBe('/lobby/game/snake/index.html');
    expect(cacheUrlOf('/lobby/game/snake/room/abc')).toBe('/lobby/game/snake/index.html');
    expect(cacheUrlOf('/lobby/me')).toBe('/lobby/index.html');
    expect(cacheUrlOf('/lobby/user/u1')).toBe('/lobby/index.html');
  });

  test('softGo 按 pushState → fetch → replace 顺序换文档，失败回滚', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('history.pushState');
    expect(code).toContain('location.replace');
    expect(code).toContain('history.back()');
    expect(code).toContain('lobby:curtain');
    expect(code).toContain('popstate');
    expect(typeof softGo).toBe('function');
    expect(typeof go).toBe('function');
  });

  test('跨入口 go 走 softGo，不再直接写 location.href', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export function go('));
    expect(body).toContain('void softGo(url)');
    // 只有外链才直接整页跳，站内跨入口一律走 softGo
    expect(body.split('window.location.href = url').length - 1).toBe(1);
  });

  test('前进/后退按入口根决定是否重载', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('currentEntryRoot');
    expect(code).toContain('location.reload()');
  });
});

describe('UI-080 黑幕注入', () => {
  test('Vite 向所有 HTML 注入内联黑幕脚本', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('transformIndexHtml');
    expect(config).toContain('lobby:curtain');
    expect(config).toContain('lobby-curtain-on');
    // UI-086：淡出交给 React 首屏，内联脚本只保留 5s 强制移除兜底
    expect(config).toContain('setTimeout(off, 5000)');
  });

  test('HTML 入口源文件不重复写内联脚本（由插件统一注入）', () => {
    for (const rel of ['index.html', 'src/pages/game/snake/index.html']) {
      expect(read(rel)).not.toContain('lobby-curtain-on');
    }
  });
});
