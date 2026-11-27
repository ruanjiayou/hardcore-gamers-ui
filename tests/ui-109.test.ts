import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

describe('UI-109 用户菜单 / 玩家菜单分文件', () => {
  test('UserMenu 只含 user 表入口，不夹带游戏/玩家逻辑', () => {
    const tsx = compact(read('src/components/UserMenu.tsx'));
    expect(tsx).toContain('profileUrl()');
    expect(tsx).toContain('userUrl(');
    expect(tsx).not.toContain('gameUrl(');
    expect(tsx).not.toContain('playerUrl(');
    expect(tsx).not.toContain('GameSettingsDialog');
    expect(tsx).not.toContain('store.game');
    expect(tsx).not.toContain('profileGame');
    expect(tsx).not.toContain('scope');
  });

  test('PlayerMenu 独立成文件，头像昵称等级取 player 表', () => {
    const tsx = compact(read('src/components/PlayerMenu.tsx'));
    expect(tsx).toContain('store.game.player?.nickname');
    expect(tsx).toContain('store.game.player?.avatar');
    expect(tsx).toContain('store.game.player?.level');
    expect(tsx).not.toContain('store.auth.user?._id');
    expect(tsx).not.toContain('userUrl(');
  });

  test('PlayerMenu 三个玩家入口：玩家中心 / 本游戏战绩 / 游戏设置', () => {
    const tsx = compact(read('src/components/PlayerMenu.tsx'));
    expect(tsx).toContain("gameUrl(slug,'me')");
    expect(tsx).toContain('playerUrl(slug,pid)');
    expect(tsx).toContain('玩家中心');
    expect(tsx).toContain('本游戏战绩');
    expect(tsx).toContain('游戏设置');
  });

  test('GameHeader 游戏主页左侧渲染 PlayerMenu，不再用 UserMenu', () => {
    const tsx = compact(read('src/components/GameHeader.tsx'));
    expect(tsx).toContain("<PlayerMenuslug={profileGame||''}/>");
    expect(tsx).not.toContain('<UserMenu');
  });

  test('PlayerCenter 公开主页用 go() 传全路径，绕开 basename 二次拼接', () => {
    const tsx = compact(read('src/components/PlayerCenter.tsx'));
    expect(tsx).toContain('go(playerUrl(slug,profile.player_id))');
    expect(tsx).not.toContain('navigate(playerUrl(');
  });
});
