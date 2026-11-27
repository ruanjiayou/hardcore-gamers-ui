import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

describe('UI-089 演进：渐变常驻覆盖安全区（UI-091）', () => {
  test('CSS 与首帧注入都没有 background-attachment: fixed', () => {
    expect(compact(read('src/styles/index.css'))).not.toContain(')fixed');
    expect(compact(read('vite.config.ts'))).not.toContain('background-attachment:fixed');
  });

  test('渐变层用负安全区 inset，首帧就扩出刘海/Home 区', () => {
    for (const source of [read('src/styles/index.css'), read('vite.config.ts')]) {
      const css = compact(source);
      expect(css).toContain('html::before{content:\'\';position:fixed;');
      for (const side of ['top', 'right', 'bottom', 'left']) {
        expect(css).toContain(`calc(-1*env(safe-area-inset-${side},0px))`);
      }
      expect(css).toContain('background:var(--lobby-page-gradient)');
    }
  });

  test('html 纯色兜底、#root 提层，内容在渐变之上', () => {
    const css = compact(read('src/styles/index.css'));
    expect(css).toContain('html{background-color:var(--lobby-brand-from,#667eea);}');
    expect(css).toContain('#root{position:relative;z-index:1;}');
  });

  test('首帧注入的渐变层不带任何遮罩标记', () => {
    const config = compact(read('vite.config.ts'));
    expect(config).not.toContain('lobby:curtain');
    expect(config).not.toContain('lobby-curtain-on');
  });
});
