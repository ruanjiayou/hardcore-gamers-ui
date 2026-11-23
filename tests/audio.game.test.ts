import { describe, test, expect } from 'bun:test';
import { resolveGameAudio, type SfxKey } from '../src/services/audio';
import type { VoicePack } from '../src/services/api';
import { FALLBACK_PACK } from '../src/stores/audio';

const makePack = (games: VoicePack['games']): VoicePack => ({
  id: 'test',
  name: '测试',
  desc: '',
  cover: '',
  isDefault: true,
  requirePermission: false,
  hasPermission: true,
  bgm: [{ url: '/common/bgm.mp3', label: '通用' }],
  sfx: { click: '/common/click.mp3', win: '/common/win.mp3', move: '/common/move.mp3' },
  games,
});

describe('按游戏解析音效', () => {
  test('游戏专属 sfx 覆盖通用键，未配置的键沿用通用', () => {
    const pack = makePack({ gomoku: { bgm: [], sfx: { move: '/gomoku/move.mp3' } } });
    const audio = resolveGameAudio(pack, 'gomoku');
    expect(audio.sfx.move).toBe('/gomoku/move.mp3');
    expect(audio.sfx.click).toBe('/common/click.mp3');
    expect(audio.bgm).toEqual([{ url: '/common/bgm.mp3', label: '通用' }]);
  });

  test('游戏专属 bgm 非空时整体覆盖，空数组回退通用', () => {
    const pack = makePack({
      snake: { bgm: [{ url: '/snake/bgm.mp3', label: '蛇' }], sfx: {} },
      chess: { bgm: [], sfx: {} },
    });
    expect(resolveGameAudio(pack, 'snake').bgm).toEqual([{ url: '/snake/bgm.mp3', label: '蛇' }]);
    expect(resolveGameAudio(pack, 'chess').bgm[0].url).toBe('/common/bgm.mp3');
  });

  test('未传游戏或游戏未配置时返回通用配置', () => {
    const pack = makePack({ gomoku: { bgm: [], sfx: { move: '/gomoku/move.mp3' } } });
    expect(resolveGameAudio(pack).sfx.move).toBe('/common/move.mp3');
    expect(resolveGameAudio(pack, 'xiangqi').sfx.move).toBe('/common/move.mp3');
    expect(resolveGameAudio(null, 'gomoku').sfx).toEqual({});
  });

  test('兜底包也按游戏提供不同的操作音', () => {
    const moves = ['gomoku', 'xiangqi', 'othello', 'chess', '2048', 'tetris', 'snake']
      .map(game => resolveGameAudio(FALLBACK_PACK, game).sfx.move as string);
    expect(moves.every(url => url.startsWith('/audio/classic/'))).toBe(true);
    expect(new Set(moves).size).toBe(7);
    const keys: SfxKey[] = ['click', 'win', 'lose', 'move', 'collect'];
    for (const key of keys) {
      expect(resolveGameAudio(FALLBACK_PACK, 'snake').sfx[key]).toMatch(/^\/audio\//);
    }
  });
});
