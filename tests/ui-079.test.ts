import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { go, isSameEntry, consumeWarmNav, markWarmNav } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const SLUGS = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

describe('UI-079 入口归档到 src/pages/game', () => {
  test('7 个游戏入口都在 src/pages/game/<slug>/，根目录 game/ 已移除', () => {
    const missing = SLUGS.filter(slug => !existsSync(join(ROOT, 'src', 'pages', 'game', slug, 'main.tsx')));
    expect(missing).toEqual([]);
    expect(existsSync(join(ROOT, 'game'))).toBe(false);
  });

  test('Vite 输入指向 src/pages/game/<slug>/index.html，并生成 sw.js', () => {
    const config = read('vite.config.ts');
    expect(config).toContain('src/pages/game/snake/index.html');
    expect(config).toContain('sw.js');
    expect(config).toContain('gameHtmlOutputPath');
    expect(config).toContain("file.type === 'chunk'");
  });

  test('tsconfig 已包含 src/pages', () => {
    expect(read('tsconfig.json')).toContain('"include": ["src"]');
  });
});

describe('UI-079 同入口 push / 跨入口热导航', () => {
  test('同一入口内的 URL 判定为同入口', () => {
    expect(isSameEntry('/lobby/game/snake/', '/lobby/game/snake/player/p1')).toBe(true);
    expect(isSameEntry('/lobby/game/snake/room/abc', '/lobby/game/snake')).toBe(true);
    expect(isSameEntry('/lobby/', '/lobby/user/u1')).toBe(true);
  });

  test('跨入口的 URL 判定为不同入口', () => {
    expect(isSameEntry('/lobby/game/snake/', '/lobby/me?game=snake')).toBe(false);
    expect(isSameEntry('/lobby/', '/lobby/game/snake/')).toBe(false);
    expect(isSameEntry('/lobby/game/snake/', '/lobby/gomoku/')).toBe(false);
  });

  test('go 在同入口时 push、跨入口时打热导航标记', () => {
    const code = read('src/navigation.ts');
    expect(code).toContain('entryNavigate(');
    expect(code).toContain('WARM_NAV_KEY');
    expect(typeof go).toBe('function');
    expect(typeof markWarmNav).toBe('function');
    expect(typeof consumeWarmNav).toBe('function');
  });

  test('AppFrame 注册入口 navigate 桥接', () => {
    const code = read('src/bootstrap/AppFrame.tsx');
    expect(code).toContain('registerEntryNav');
    expect(code).toContain('useNavigate');
  });

  test('socket 在挂载前同步创建，热导航跳过全屏 Loading', () => {
    const entry = read('src/bootstrap/entry.tsx');
    const bootstrap = read('src/bootstrap/AppBootstrap.tsx');
    expect(entry).toContain('ensureSocket()');
    expect(bootstrap).toContain('consumeWarmNav()');
    expect(bootstrap).toContain('isLoading');
    // UI-093：热导航仍跳过全屏 Loading，但去掉了顶部白色进度条
    expect(bootstrap).not.toContain('app-warm-progress');
  });

  test('PWA 注册只在生产生效', () => {
    expect(read('src/services/pwa.ts')).toContain('import.meta.env.PROD');
    expect(read('src/bootstrap/entry.tsx')).toContain('registerPwa');
  });
});
