import { describe, test, expect } from 'bun:test';
import LogicSnake, {
  SNAKE_SPEED,
  SNAKE_TURN_RATE,
} from '../src/games/snake/Logic';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 假 socket：只记录 emit，避免测试依赖真实连接 */
function makeSocket() {
  const sent: any[] = [];
  const socket = {
    socket: {
      on() { },
      off() { },
      emit(ev: string, ...args: any[]) { sent.push({ ev, args }); },
    },
  };
  return { socket: socket as any, sent };
}

/** 造一条朝右、笔直向后的蛇：head 在 (300,300)，身体每 18px 一个点 */
function snake(id: string, x = 300, y = 300, angle = 0, length = 110) {
  const pts: [number, number][] = [];
  for (let d = 0; d <= length; d += 18) {
    pts.push([Math.round(x - Math.cos(angle) * d), Math.round(y - Math.sin(angle) * d)]);
  }
  return {
    id, x, y, angle, pts, length,
    alive: true, score: 0, best: 0,
    invincible: 0, boosting: 0, boostCd: 0, respawnIn: 0, respawns: 0,
  };
}

function makeState(food: [number, number][] = [], extra: any[] = [], headX = 300) {
  return {
    match_id: 'm1',
    players: [{ _id: 'p1', member_type: 'player', nickname: 'tester' }],
    variant: 'endless',
    snake: {
      w: 3600,
      h: 2600,
      radius: 12,
      tick: 1,
      variant: 'endless',
      food,
      snakes: [snake('p1', headX), ...extra],
      status: 'playing',
      winner: '',
    },
  };
}

function makeLogic(food: [number, number][] = [], extra: any[] = []) {
  const { socket, sent } = makeSocket();
  const logic = new LogicSnake(socket, { _id: 'p1', nickname: 'tester', room_id: 'r1' });
  logic.setState(makeState(food, extra));
  return { logic, sent };
}

const me = (logic: LogicSnake) => logic.view().snakes.find(s => s.mine)!;

describe('贪吃蛇本地预测（连续像素）', () => {
  test('快照刚落地的瞬间不超前：蛇头就是服务端坐标', () => {
    const { logic } = makeLogic();
    expect(me(logic).x).toBeCloseTo(300, 1);
    expect(me(logic).y).toBeCloseTo(300, 1);
  });

  test('时间推移后沿朝向前推，但最多前推 200ms（不会跑飞）', async () => {
    const { logic } = makeLogic();
    await sleep(250);
    const a = me(logic);
    // 200ms × 170px/s = 34px
    expect(a.x - 300).toBeGreaterThan(SNAKE_SPEED * 0.15);
    expect(a.x - 300).toBeLessThan(SNAKE_SPEED * 0.21 + 1);
    await sleep(400);
    const b = me(logic);
    // 再久也不会继续前推，等新快照校准
    expect(b.x).toBeCloseTo(a.x, 3);
  });

  test('预测吃掉的食物会先从本地画面隐藏', async () => {
    // 食物在蛇头正前方 25px：落地瞬间还在，前推 100ms 后应被隐藏
    const { logic } = makeLogic([[325, 300]]);
    expect(logic.view().food.length).toBe(1);
    await sleep(120);
    expect(logic.view().food.length).toBe(0);
  });

  test('瞄准立即生效：转向方向由目标角决定，且受最大角速度限制', async () => {
    const { logic } = makeLogic();
    logic.aim(Math.PI / 2); // 目标：向下
    await sleep(150);
    const s = me(logic);
    expect(s.y).toBeGreaterThan(300);
    // 150ms 最多转 0.69 弧度，不可能一步到位
    const maxTurn = SNAKE_TURN_RATE * 0.15;
    expect(s.angle).toBeGreaterThan(0.3);
    expect(s.angle).toBeLessThan(maxTurn + 0.25);
  });

  test('朝向上报被节流：连续瞄准只发 1~2 个包，最后一个角度必须上报', async () => {
    const { logic, sent } = makeLogic();
    for (let i = 0; i < 12; i++) logic.aim(i * 0.05);
    await sleep(80);
    const aims = sent.filter(x => x.args?.[1]?.angle !== undefined);
    expect(aims.length).toBeGreaterThanOrEqual(1);
    expect(aims.length).toBeLessThanOrEqual(2);
    expect(aims[aims.length - 1].args[1].angle).toBeCloseTo(11 * 0.05, 5);
    logic.destroy();
  });

  test('输入与上报解耦：aim 立刻改本地角度但不同步发包；静止时不再重复上报', async () => {
    const { logic, sent } = makeLogic();
    logic.aim(1.2);
    expect(logic.aimAngle).toBeCloseTo(1.2, 5);
    expect(sent.length).toBe(0); // 网络不在输入路径上
    await sleep(120);
    const aims = sent.filter(x => x.args?.[1]?.angle !== undefined);
    expect(aims.length).toBe(1); // 角度没变，定时器不会一直发包
    expect(aims[0].args[1].angle).toBeCloseTo(1.2, 5);
    logic.destroy();
  });

  test('没有任何输入时不拿默认角度覆盖服务端出生朝向', async () => {
    const { logic, sent } = makeLogic();
    await sleep(120);
    expect(sent.filter(x => x.args?.[1]?.angle !== undefined).length).toBe(0);
    logic.destroy();
  });

  test('慢网时本地为主：快照间隔变大后放宽预测上限，蛇继续前进不被 200ms 钉住', async () => {
    const { logic } = makeLogic();
    // 真实页面每帧都会调用 view()（校正量按帧衰减），测试里也模拟这个渲染循环
    const render = setInterval(() => logic.view(), 16);
    // 三次慢快照（~260ms 间隔）：快照位置按服务端速度连续推进，贴近真实网络
    let headX = 300;
    for (let i = 0; i < 3; i++) {
      await sleep(260);
      headX += SNAKE_SPEED * 0.26;
      logic.setState(makeState([], [], headX));
    }
    expect(logic.stale).toBe(true);
    const before = me(logic);
    await sleep(260);
    const after = me(logic);
    clearInterval(render);
    // 正常网络下 260ms 最多前推 200ms（34px）；慢网时本地继续主导，不会被钉住
    expect(after.x - before.x).toBeGreaterThan(SNAKE_SPEED * 0.2);
    expect(after.x).toBeGreaterThan(headX);
    logic.destroy();
  });

  test('关闭/离开时发独立的分数同步事件（客户端不带分数）', () => {
    const { logic, sent } = makeLogic();
    let exited = 0;
    logic.on('exit', () => { exited++; });
    logic.exit();
    const syncs = sent.filter(x => x.ev === 'room:sync-score');
    expect(syncs.length).toBe(1);
    expect(syncs[0].args[0]).toEqual({ room_id: 'r1', player_id: 'p1' });
    expect(exited).toBe(1);
    logic.destroy();
  });
});
