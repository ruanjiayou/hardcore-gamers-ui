import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
const ruleOf = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start));
};

const ENTRIES = [
  'index.html',
  ...['2048', 'chess', 'gomoku', 'othello', 'snake', 'tetris', 'xiangqi']
    .map(slug => `src/pages/game/${slug}/index.html`),
];

describe('UI-090 保留项与 UI-091 修订', () => {
  test('页面级重复渐变仍全部移除', () => {
    const cases: Array<[string, string]> = [
      ['src/styles/lobby.css', '.lobby'],
      ['src/styles/game.css', '.game-page'],
      ['src/styles/login.css', '.login-container'],
      ['src/styles/room.css', '.room-page'],
    ];
    for (const [file, selector] of cases) {
      expect(ruleOf(read(file), selector), `${file} ${selector}`).not.toContain('background');
    }
  });

  test('8 个入口 meta 齐全且 theme-color 一致', () => {
    for (const entry of ENTRIES) {
      const html = read(entry);
      expect(html, entry).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/);
      expect(html, entry).toMatch(/<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/);
      expect(html, entry).toMatch(/<meta\s+name="theme-color"\s+content="#667eea"/);
    }
  });

  test('standalone PWA 顶栏仍用实色画进安全区', () => {
    for (const file of ['src/styles/navbar.css', 'src/styles/game-header.css']) {
      const css = compact(read(file));
      expect(css, file).toContain('@media(display-mode:standalone)');
      expect(css, file).toContain('background:var(--lobby-brand-from,#667eea)');
    }
  });

  test('加载进度层用不透明品牌渐变，不再透视大厅', () => {
    const nav = compact(read('src/navigation.ts'));
    expect(nav).toContain('background:var(--lobby-page-gradient)');
    expect(nav).not.toContain('background:transparent');
    expect(nav).not.toContain('background:#0f1020');
  });
});

describe('UI-091 转场遮罩已移除', () => {
  test('源码与 8 个 HTML 不含遮罩 DOM/脚本/标记', () => {
    for (const file of ['src/navigation.ts', 'vite.config.ts', 'src/bootstrap/AppBootstrap.tsx']) {
      expect(read(file), file).not.toContain('lobby-curtain');
      expect(read(file), file).not.toContain('showCurtain');
      expect(read(file), file).not.toContain('dismissCurtain');
    }
    for (const entry of ENTRIES) {
      expect(read(entry), entry).not.toContain('lobby-curtain');
    }
  });

  test('品牌映射文件已删除，导航不再依赖它', () => {
    expect(read('src/navigation.ts')).not.toContain("from './brand'");
  });
});
