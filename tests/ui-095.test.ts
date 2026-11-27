import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const css = read('src/styles/index.css').replace(/\s+/g, '');

describe('UI-095 只用 standalone 媒体查询区分网页与 PWA 高度', () => {
  test('普通网页 vh 兜底 + dvh 覆盖，不再用 iOS-only @supports', () => {
    const base = css.slice(0, css.indexOf('@media'));
    expect(base).toContain('html,body,#root{height:100vh;height:100dvh;}');
    expect(css).not.toContain('-webkit-touch-callout');
    expect(css).not.toContain('@supports');
  });

  test('PWA 通过 standalone 媒体查询覆盖回 100vh', () => {
    const standalone = css.slice(css.indexOf('@media(display-mode:standalone)'));
    expect(standalone.slice(0, standalone.indexOf('}', standalone.indexOf('html,body,#root')))).toContain('height:100vh;');
  });
});

describe('UI-096 首帧注入同步 html 高度分流', () => {
  test('注入样式含 html/body/#root 高度 + standalone 覆盖，与 CSS bundle 同值', () => {
    const config = read('vite.config.ts').replace(/\s+/g, '');
    expect(config).toContain('html,body,#root{height:100vh;height:100dvh;}');
    expect(config).toContain('@media(display-mode:standalone){html,body,#root{height:100vh;}}');
    expect(config).not.toContain('-webkit-touch-callout');
  });
});
