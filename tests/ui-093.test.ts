import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

// UI-093 的高度分流口径已由 UI-094 收紧（仅 iOS Safari 用 100dvh），断言见 tests/ui-094.test.ts。

describe('UI-093 白色进度线已删除', () => {
  test('AppBootstrap 不再渲染 app-warm-progress，但保留 consumeWarmNav', () => {
    const code = read('src/bootstrap/AppBootstrap.tsx');
    expect(code).not.toContain('app-warm-progress');
    expect(code).toContain('consumeWarmNav()');
  });

  test('全局样式与应用壳都不再定义进度线样式', () => {
    expect(read('src/styles/index.css')).not.toContain('app-warm-progress');
    expect(read('src/styles/index.css')).not.toContain('app-warm-slide');
    expect(read('src/navigation.ts')).not.toContain('app-warm-progress');
  });
});

describe('UI-093 五类独立页顶栏统一安全区', () => {
  const cases: Array<[string, string, string]> = [
    ['src/styles/game-header.css', '.game-header', 'game-header'],
    ['src/styles/friends.css', '.friends-header', 'friends-header'],
    ['src/styles/skins.css', '.skins-header', 'skins-header'],
    ['src/styles/profile.css', '.profile-head', 'profile-head'],
  ];

  for (const [file, selector, name] of cases) {
    test(`${name} 顶部用 env(safe-area-inset-top) 留白`, () => {
      const css = compact(read(file));
      const start = css.indexOf(`${selector}{`);
      expect(start, `${file} ${selector}`).toBeGreaterThanOrEqual(0);
      const rule = css.slice(start, css.indexOf('}', start));
      expect(rule, `${file} ${selector}`).toContain('env(safe-area-inset-top,0px)');
    });
  }

  test('四类页面顶栏在 standalone 下用实色画进安全区', () => {
    for (const file of ['src/styles/friends.css', 'src/styles/skins.css', 'src/styles/profile.css']) {
      const css = compact(read(file));
      expect(css, file).toContain('@media(display-mode:standalone)');
      expect(css, file).toContain('background:var(--lobby-brand-from,#667eea)');
    }
  });
});

describe('UI-093 个人中心/公开主页去白色空隙', () => {
  test('.profile-page 顶部不再有 16px 白底 padding', () => {
    const css = compact(read('src/styles/profile.css'));
    const start = css.indexOf('.profile-page{');
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).not.toMatch(/padding:16px/);
    expect(rule).toContain('padding-bottom:calc(64px+env(safe-area-inset-bottom,0px))');
  });
});
