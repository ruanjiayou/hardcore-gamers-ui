import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

describe('UI-097 窄屏游戏顶栏保留顶部安全区补偿', () => {
  test('@media 480px 里 .game-header 高度用 calc(52px + env(safe-area-inset-top))', () => {
    const css = compact(read('src/styles/game-header.css'));
    const media = css.slice(css.indexOf('@mediascreenand(max-width:480px)'));
    const block = media.slice(media.indexOf('.game-header{'), media.indexOf('}', media.indexOf('.game-header{')));
    expect(block).toContain('height:calc(52px+env(safe-area-inset-top,0px))');
    expect(block).not.toContain('height:52px;');
  });
});

describe('UI-097 PWA 剩余 dvh 走视口高度变量', () => {
  test('视口高度变量默认 100dvh，standalone 覆盖为 100vh', () => {
    const css = compact(read('src/styles/index.css'));
    expect(css).toContain('--lobby-viewport-h:100dvh');
    const standalone = css.slice(css.indexOf('@media(display-mode:standalone)'));
    expect(standalone.slice(0, standalone.indexOf('html,body,#root'))).toContain('--lobby-viewport-h:100vh');
  });

  test('play/replay/room 的 dvh 声明改用变量', () => {
    for (const rel of ['src/pages/game/2048/styles/play.css', 'src/styles/replay.css', 'src/styles/room.css']) {
      const css = compact(read(rel));
      expect(css, rel).not.toMatch(/[: ]\d+dvh/);
      expect(css, rel).toContain('var(--lobby-viewport-h');
    }
  });
});
