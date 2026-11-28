import { describe, expect, test } from 'bun:test';
import LogicSnake from '../src/games/snake/Logic';

/**
 * 蛇皮肤透传：`setState` 收进来的 `snakes[].skin` 必须原样出现在 `view()` 里。
 *
 * 背景（线上故障）：服务端快照原来**只**在 `players[]` 里带 skin，`snakes[]` 没有，
 * 客户端只认 `snake.skin` → 每条蛇都是空串 → 全场统一回退默认皮肤（蓝色斜线），
 * 玩家自己装备的「糖果」根本不生效。服务端补了 `snakes[].skin`，这里盯住客户端不丢字段：
 * 渲染层（`Scene2D.skinPattern` / `assetHeadImage`）拿的就是 `view().snakes[].skin`。
 */

function makeLogic(myId = 'me') {
  const socket = { socket: { on() { }, off() { }, emit() { } } };
  return new LogicSnake(socket as any, { _id: myId, nickname: 't', room_id: 'r1' });
}

const CANDY = 'arcade_snake_snake_candy';
const NEON = 'arcade_snake_snake_neon';

function snakeOf(id: string, x: number, skin: string) {
  return {
    id,
    team: '',
    skin,
    x,
    y: 300,
    angle: 0,
    pts: [[x, 300], [x - 20, 300]] as [number, number][],
    length: 160,
    alive: true,
    score: 0,
    best: 0,
    invincible: 0,
    boosting: false,
    boostHeld: false,
    magnet: 0,
    star: 0,
    respawnIn: 0,
    respawns: 0,
    awaiting: false,
  };
}

/** 一帧快照：players 用库里的形态（_id），snakes 用运行时形态（id + skin） */
function snapshot(snakes: ReturnType<typeof snakeOf>[]) {
  return {
    match_id: 'm1',
    players: snakes.map(s => ({
      _id: s.id,
      member_type: 'player',
      role: 'snake',
      nickname: s.id,
      team: '',
    })),
    variant: 'endless',
    snake: {
      w: 4800,
      h: 3400,
      radius: 15,
      tick: 1,
      variant: 'endless',
      food: [],
      snakes,
      status: 'playing',
      winner: '',
      endsIn: 0,
    },
  };
}

const skinOf = (logic: any, id: string) => logic.view().snakes.find((s: any) => s.id === id)?.skin;

describe('贪吃蛇皮肤 · 快照到渲染', () => {
  test('自己的蛇：装备的皮肤出现在 view() 里', () => {
    const logic = makeLogic('me');
    logic.setState(snapshot([snakeOf('me', 300, CANDY)]));
    expect(skinOf(logic, 'me')).toBe(CANDY);
  });

  test('远端蛇（人机）：没装备就是空串，渲染层回退默认皮肤', () => {
    const logic = makeLogic('me');
    logic.setState(snapshot([snakeOf('me', 300, CANDY), snakeOf('bot', 600, '')]));
    expect(skinOf(logic, 'me')).toBe(CANDY);
    expect(skinOf(logic, 'bot')).toBe('');
  });

  test('每条蛇各用各的皮肤（不会全场串成同一张）', () => {
    const logic = makeLogic('me');
    logic.setState(snapshot([
      snakeOf('me', 300, CANDY),
      snakeOf('bot1', 600, ''),
      snakeOf('bot2', 900, NEON),
    ]));
    const view = logic.view();
    expect(view.snakes.map((s: any) => s.skin)).toEqual([CANDY, '', NEON]);
  });

  test('缺 skin 字段（旧服务端）不会崩，按空串处理', () => {
    const logic = makeLogic('me');
    const s: any = snakeOf('me', 300, CANDY);
    delete s.skin;
    logic.setState(snapshot([s]));
    expect(skinOf(logic, 'me')).toBe('');
  });
});
