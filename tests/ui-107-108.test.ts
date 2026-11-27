import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
const GAMES = ['snake', 'gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris'];

describe('UI-107 玩家中心页 /lobby/game/:slug/me', () => {
  test('7 个游戏入口都挂了 /me 路由', () => {
    for (const g of GAMES) {
      const app = compact(read(`src/pages/game/${g}/App.tsx`));
      expect(app, g).toContain('path="/me"');
      expect(app, g).toContain('element={<Me/>}');
    }
  });

  test('每个游戏有 Me.tsx 薄壳，传 slug 给共用 PlayerCenter', () => {
    for (const g of GAMES) {
      const p = `src/pages/game/${g}/Me.tsx`;
      expect(existsSync(join(ROOT, p)), p).toBe(true);
      const tsx = compact(read(p));
      expect(tsx).toContain('PlayerCenter');
      expect(tsx).toContain(`slug="${g}"`);
    }
  });

  test('共用 PlayerCenter 从 player 表接口读取并允许改昵称头像', () => {
    const tsx = compact(read('src/components/PlayerCenter.tsx'));
    expect(tsx).toContain('getMyPlayerProfile');
    expect(tsx).toContain('updateMyPlayerProfile');
    expect(tsx).toContain('player_id');
    expect(tsx).not.toContain('getProfile(');
  });

  test('游戏内 PlayerMenu「玩家中心」指到 gameUrl(slug, me)，大厅 UserMenu 仍指 profileUrl()', () => {
    const player = compact(read('src/components/PlayerMenu.tsx'));
    const user = compact(read('src/components/UserMenu.tsx'));
    expect(player).toContain('gameUrl(slug,\'me\')');
    expect(user).toContain('profileUrl()');
  });
});

describe('UI-108 玩家公开主页走 player 表接口', () => {
  test('api.ts 提供三个 player 接口，路径与 SB-065 一致', () => {
    const api = compact(read('src/services/api.ts'));
    expect(api).toContain('/players/${slug}/profile/${player_id}');
    expect(api).toContain('/players/${slug}/me');
    expect(api).toContain('updateMyPlayerProfile');
    expect(api).toContain('getPlayerProfile');
    expect(api).toContain('getMyPlayerProfile');
  });

  test('PlayerProfile 用 getPlayerProfile(slug, player_id)，不再调用户接口 getProfile', () => {
    const tsx = compact(read('src/components/PlayerProfile.tsx'));
    expect(tsx).toContain('getPlayerProfile(slug,playerId)');
    expect(tsx).not.toContain('getProfile(');
  });

  test('PlayerMenu「本游戏战绩」拿 player_id 而不是 user_id', () => {
    const tsx = compact(read('src/components/PlayerMenu.tsx'));
    expect(tsx).toContain('playerUrl(slug,pid)');
    expect(tsx).not.toContain('store.auth.user?._id');
  });
});
