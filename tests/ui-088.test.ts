import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('UI-088 保留项：主题变量与安全区（UI-091 去掉遮罩）', () => {
  test('8 个入口都注入品牌变量与页面渐变', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('--lobby-brand-from');
    expect(config).toContain('--lobby-brand-to');
    expect(config).toContain('--lobby-page-gradient');
    expect(config).toContain('transformIndexHtml');
  });

  test('navbar 与游戏头栏仍用品牌变量', () => {
    expect(read('src/styles/navbar.css')).toContain('var(--lobby-brand-from');
    expect(read('src/styles/game-header.css')).toContain('var(--lobby-brand-from');
  });

  test('顶部/左右/底部安全区 padding 仍在', () => {
    const navbar = read('src/styles/navbar.css');
    expect(navbar).toContain('env(safe-area-inset-top');
    expect(navbar).toContain('env(safe-area-inset-left');
    expect(navbar).toContain('env(safe-area-inset-right');
    expect(read('src/styles/game-header.css')).toContain('calc(58px + env(safe-area-inset-top');
    expect(read('src/styles/index.css')).toContain('padding-bottom: env(safe-area-inset-bottom');
  });

  test('100vh / 100dvh 兜底仍在', () => {
    const css = read('src/styles/index.css');
    expect(css).toContain('height: 100vh');
    expect(css).toContain('height: 100dvh');
  });

  test('遮罩相关代码已全部移除', () => {
    expect(read('vite.config.ts')).not.toContain('lobby-curtain-on');
    expect(read('src/navigation.ts')).not.toContain('__lobbyCurtainBrand');
    expect(read('src/bootstrap/AppBootstrap.tsx')).not.toContain('dismissCurtain');
  });
});
