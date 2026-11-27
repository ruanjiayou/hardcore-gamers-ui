import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheUrlOf, go, softGo } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('点击预取软导航（缓存逻辑不变）', () => {
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
    expect(code).toContain('lobby:warm-nav');
    expect(code).toContain('popstate');
    expect(typeof softGo).toBe('function');
    expect(typeof go).toBe('function');
  });

  test('跨入口 go 走 softGo，只有外链直接整页跳', () => {
    const code = read('src/navigation.ts');
    const body = code.slice(code.indexOf('export function go('));
    expect(body).toContain('void softGo(url)');
    expect(body.split('window.location.href = url').length - 1).toBe(1);
  });

  test('前进/后退按入口根决定是否重载', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('currentEntryRoot');
    expect(code).toContain('location.reload()');
  });
});

describe('首帧渐变注入（无遮罩）', () => {
  test('Vite 向所有 HTML 注入主题变量、渐变与 loading 刷新', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('transformIndexHtml');
    expect(config).toContain('--lobby-page-gradient');
    expect(config).toContain('html::before');
    expect(config).toContain('/lobby/loading');
    expect(config).not.toContain('lobby-curtain-on');
    expect(config).not.toContain('lobby:curtain');
  });

  test('HTML 入口源文件不写内联首帧样式（由插件统一注入）', () => {
    for (const rel of ['index.html', 'src/pages/game/snake/index.html']) {
      expect(read(rel)).not.toContain('lobby-curtain-on');
      expect(read(rel)).not.toContain('html::before');
    }
  });
});
