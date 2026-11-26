import { describe, expect, test } from 'bun:test';
import {
  gameUrl,
  go,
  lobbyUrl,
  loginUrl,
  playerUrl,
  profileUrl,
  userUrl,
} from '../src/navigation';

/**
 * 入口 URL 助手：拆成多个 Vite 入口后，所有跳转都走同一套拼接规则，
 * 避免各页面自己拼路径导致漏前缀或多斜杠。
 */
describe('入口 URL 助手', () => {
  test('gameUrl 拼出游戏入口，并规范化 path 的前导斜杠', () => {
    expect(gameUrl('snake')).toBe('/lobby/game/snake');
    expect(gameUrl('snake', '/room/abc')).toBe('/lobby/game/snake/room/abc');
    expect(gameUrl('snake', 'room/abc')).toBe('/lobby/game/snake/room/abc');
  });

  test('用户侧入口是固定路径', () => {
    expect(lobbyUrl()).toBe('/lobby/');
    expect(loginUrl()).toBe('/lobby/login');
    expect(profileUrl()).toBe('/lobby/me');
    expect(userUrl('u1')).toBe('/lobby/user/u1');
  });

  test('playerUrl 指向游戏内的玩家资料页', () => {
    expect(playerUrl('chess', 'p1')).toBe('/lobby/game/chess/player/p1');
  });

  test('go 是接受字符串 URL 的函数（node 下不触发跳转）', () => {
    expect(typeof go).toBe('function');
  });
});
