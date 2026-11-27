import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arenaRoomUrl, isArenaEntryUrl } from '../src/navigation';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

describe('UI-112 换装刷新不还原 / 竞技场刷新保持一致', () => {
  test('竞技场房间 URL 带 arena=1，刷新后仍可识别', () => {
    expect(arenaRoomUrl('snake', 'room-1')).toBe('/lobby/game/snake/room/room-1?arena=1');
    expect(isArenaEntryUrl('?arena=1')).toBe(true);
    expect(isArenaEntryUrl('')).toBe(false);
    expect(isArenaEntryUrl('?arena=0')).toBe(false);
  });

  test('房间页从 URL 读沉浸标记，刷新后仍保持全屏', () => {
    const code = read('src/pages/game/snake/Room.tsx');
    expect(code).toContain('useLocation()');
    expect(code).toContain('isArenaEntryUrl(location.search)');
  });

  test('无尽匹配跳房用竞技场 URL，普通建房不变', () => {
    const code = compact(read('src/pages/game/snake/index.tsx'));
    expect(code).toContain('arenaRoomUrl(slug,roomId)');
    expect(code).toContain('gameUrl(slug,\'/room/\'+roomId)');
  });

  test('游戏页在 socket 就绪前不挂载，避免房间页拿不到 socket', () => {
    const code = compact(read('src/bootstrap/AppBootstrap.tsx'));
    expect(code).toContain('<LoadingisLoading={isLoading||(!!gameSlug&&!isReady)}>');
  });
});
