/**
 * 客户端要挡住"外来帧"（SB-053）。
 *
 * 同一个房间同时存在两个运行时（僵尸对局没停干净）时，它们会往同一个频道
 * 交替广播快照 —— 僵尸那局里没有我的蛇。客户端照单全收的话，
 * 就会在两个对局的画面之间来回跳，「已出局」提示每 50ms 闪一次。
 */
import { describe, expect, test } from 'bun:test';
import LogicSnake from '../src/games/snake/Logic';

function makeLogic(myId = 'p1', members?: any[]) {
  const socket = { socket: { on() { }, off() { }, emit() { } } };
  const room = members ? { members } : undefined;
  return new LogicSnake(socket as any, { _id: myId, nickname: 'me', room_id: 'r1' }, 'endless', room as any) as any;
}

/** 一帧快照：snakes 里可以只放别人 */
function snap(snakes: any[], over: Partial<any> = {}) {
  return {
    w: 2000, h: 2000, radius: 12, tick: 10, variant: 'endless',
    players: snakes.map(s => ({ id: s.id, nickname: s.id })),
    food: [], foodFull: true,
    snakes,
    status: 'playing', winner: '', teamScores: {}, endsIn: 0,
    ...over,
  };
}

const mySnake = (id = 'p1', alive = true) => ({
  id, x: 100, y: 100, angle: 0, pts: [[100, 100], [90, 100]] as [number, number][],
  length: 20, alive, score: 7, best: 7, awaiting: false,
});

describe('贪吃蛇 · 外来帧防护', () => {
  test('见过自己的蛇之后，没有我的蛇的帧被整帧丢弃', () => {
    const logic = makeLogic();
    logic.applySnapshot(snap([mySnake()]));
    expect(logic.status).toBe('playing');
    expect(logic.snakes.length).toBe(1);

    // 僵尸对局那一帧：里面只有机器人，没有我
    logic.applySnapshot(snap([mySnake('robot-1')]));
    // 状态不被这一帧覆盖：我的蛇还在、分数还是 7、状态还是 playing
    expect(logic.snakes.length).toBe(1);
    expect(logic.snakes[0].id).toBe('p1');
    expect(logic.status).toBe('playing');
  });

  test('外来帧不会把玩家误判成「已出局」（alive 仍为真）', () => {
    const logic = makeLogic();
    logic.applySnapshot(snap([mySnake()]));
    logic.applySnapshot(snap([mySnake('robot-1')]));
    expect(logic.view().alive).toBe(true);
    expect(logic.awaiting).toBe(false);
  });

  test('还没进这一局时（快照里没有我）保持等待态，不报出局', () => {
    const logic = makeLogic();
    logic.applySnapshot(snap([mySnake('robot-1')]));
    expect(logic.status).toBe('waiting');
    expect(logic.snakes.length).toBe(0);
  });

  test('观战者（member_type=viewer）本来就没有蛇，快照照常应用', () => {
    const logic = makeLogic('p1', [{ _id: 'p1', member_type: 'viewer' }]);
    logic.applySnapshot(snap([mySnake('robot-1')]));
    expect(logic.status).toBe('playing');
    expect(logic.snakes.length).toBe(1);
  });

  test('换局后重新计数：新局的第一帧（还没有我）不再当成外来帧', () => {
    const logic = makeLogic();
    logic.applySnapshot(snap([mySnake()]));
    // 服务端下发新对局：match_id 变了 → 「见过自己的蛇」要清掉
    logic.setState({ match_id: 'm2', variant: 'endless' });
    logic.applySnapshot(snap([mySnake('robot-1')]));
    expect(logic.status).toBe('waiting');
  });

  test('自己那条蛇死了（还在快照里）不会被当成外来帧丢掉', () => {
    const logic = makeLogic();
    logic.applySnapshot(snap([mySnake()]));
    logic.applySnapshot(snap([mySnake('p1', false)]));
    expect(logic.status).toBe('playing');
    expect(logic.view().alive).toBe(false);
  });
});
