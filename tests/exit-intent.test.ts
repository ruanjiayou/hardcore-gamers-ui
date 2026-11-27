import { describe, test, expect } from 'bun:test';
import { resolveExitIntent, resolveLeaveToast } from '../src/core/exitIntent';

describe('对局页关闭按钮的退出语义', () => {
  test('单机游戏：说"退出游戏"，不弹"房间已解散"', () => {
    const intent = resolveExitIntent({
      isSoloGame: true,
      roomStatus: 'playing',
      isEndlessArena: false,
    });
    expect(intent.kind).toBe('exit-game');
    expect(intent.confirmText).toBe('退出游戏');
    expect(intent.endsMatch).toBe(false);
    // 服务端回 '房间已解散'（临时房销毁），但用户只该看到"已退出游戏"
    expect(resolveLeaveToast(intent, '房间已解散')).toBe('已退出游戏');
  });

  test('官方房间等待态：说"退出房间"', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'waiting',
      isEndlessArena: false,
    });
    expect(intent.kind).toBe('exit-room');
    expect(intent.confirmText).toBe('退出房间');
    expect(resolveLeaveToast(intent, '已离开房间')).toBe('已退出房间');
  });

  test('官方房间对局中：主按钮是"结束游戏"（结束本局回到房间）', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'playing',
      isEndlessArena: false,
    });
    expect(intent.kind).toBe('end-game');
    expect(intent.confirmText).toBe('结束游戏');
    expect(intent.endsMatch).toBe(true);
  });

  test('无尽竞技房：常驻对局，随时可以"退出房间"', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'playing',
      isEndlessArena: true,
    });
    expect(intent.kind).toBe('exit-room');
    expect(intent.endsMatch).toBe(false);
  });

  test('组队模式认输后（本局已结束）：回到"退出房间"', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'playing',
      isEndlessArena: false,
      endedMatch: true,
    });
    expect(intent.kind).toBe('exit-room');
  });

  test('自建房房主离开（房间真的没了）：保留服务端"房间已解散"提示', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'waiting',
      isEndlessArena: false,
    });
    expect(resolveLeaveToast(intent, '房间已解散')).toBe('房间已解散');
  });
});

describe('UI-101 退出弹框按玩法与房主身份分化', () => {
  test('团队房房主（等待态）：提示「解散房间」', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'waiting',
      isEndlessArena: false,
      isTeamRoom: true,
      canDisband: true,
    });
    expect(intent.kind).toBe('disband-room');
    expect(intent.title).toBe('解散房间');
    expect(intent.confirmText).toBe('解散房间');
    expect(intent.endsMatch).toBe(false);
  });

  test('团队房非房主（等待态）：提示「离开房间」', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'waiting',
      isEndlessArena: false,
      isTeamRoom: true,
      canDisband: false,
    });
    expect(intent.kind).toBe('leave-room');
    expect(intent.title).toBe('离开房间');
    expect(intent.confirmText).toBe('离开房间');
    expect(intent.successMessage).toBe('已离开房间');
    expect(resolveLeaveToast(intent, '已离开房间')).toBe('已离开房间');
  });

  test('团队房对局中（未认输）：仍是「结束游戏」', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'playing',
      isEndlessArena: false,
      isTeamRoom: true,
      canDisband: true,
    });
    expect(intent.kind).toBe('end-game');
    expect(intent.endsMatch).toBe(true);
  });

  test('无尽竞技房：即使房主身份也只「退出房间」，无解散意图', () => {
    const intent = resolveExitIntent({
      isSoloGame: false,
      roomStatus: 'playing',
      isEndlessArena: true,
      isTeamRoom: true,
      canDisband: true,
    });
    expect(intent.kind).toBe('exit-room');
    expect(intent.title).toBe('退出房间');
    expect(intent.confirmText).toBe('退出房间');
    expect(intent.endsMatch).toBe(false);
  });
});
