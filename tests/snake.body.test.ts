import { describe, test, expect } from 'bun:test';
import LogicSnake, {
  DEFAULT_SNAKE_PARAMS,
  snakeCruiseSpeed,
  truncatePathInPlace,
} from '../src/games/snake/Logic';

/**
 * 服务端 50ms 一次快照，客户端 60fps 渲染。
 * 复现「头部流畅、尾巴一顿一顿」：服务端每 tick 把身体路径往前推、
 * 尾部按身长裁掉；再沿路径每 22px 采一个点发给客户端。
 */
const SPEED = snakeCruiseSpeed(DEFAULT_SNAKE_PARAMS.bodyLength);
const TICK = 0.05;
const LENGTH = DEFAULT_SNAKE_PARAMS.bodyLength;
const STEP = 4; // 服务端 path 的点间距

/** 服务端蛇的权威模拟：path（密集点）+ 沿 path 的采样输出 */
function makeServer() {
  let x = 300;
  let y = 300;
  let angle = 0;
  const path: [number, number][] = [];
  for (let d = 0; d <= LENGTH; d += STEP) path.push([x - d, y]);

  return {
    get head() { return { x, y, angle }; },
    /** 推进一个 tick（dt 秒），返回发给客户端的快照字段 */
    tick(dt: number) {
      const nx = x + Math.cos(angle) * SPEED * dt;
      const ny = y + Math.sin(angle) * SPEED * dt;
      const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / STEP));
      for (let i = n; i >= 1; i--) path.unshift([x + ((nx - x) * i) / n, y + ((ny - y) * i) / n]);
      x = nx;
      y = ny;
      truncatePathInPlace(path, LENGTH);
      // 沿 path 每 22px 采一点 + 精确尾点（与服务端 snakeSpine 同规则）
      const pts: [number, number][] = [[Math.round(path[0][0]), Math.round(path[0][1])]];
      let next = 22;
      let acc = 0;
      for (let i = 1; i < path.length; i++) {
        const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        while (acc + seg >= next) {
          const t = (next - acc) / seg;
          pts.push([
            Math.round(path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t),
            Math.round(path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t),
          ]);
          next += 22;
        }
        acc += seg;
      }
      const tail = path[path.length - 1];
      const last = pts[pts.length - 1];
      if (Math.hypot(tail[0] - last[0], tail[1] - last[1]) > 1e-6) pts.push([Math.round(tail[0]), Math.round(tail[1])]);
      return { x, y, angle, pts, length: LENGTH };
    },
    turn(next: number) { angle = next; },
  };
}

/** 假 socket */
function makeSocket() {
  return { socket: { on() { }, off() { }, emit() { } } } as any;
}

function makeLogic() {
  const logic = new LogicSnake(makeSocket(), { _id: 'p1', nickname: 'tester', room_id: 'r1' });
  return logic;
}

function snapshot(s: ReturnType<typeof makeServer> extends { tick: (dt: number) => infer R } ? R : never) {
  return {
    match_id: 'm1',
    players: [{ _id: 'p1', member_type: 'player', nickname: 'tester' }],
    variant: 'endless',
    snake: {
      w: 4800,
      h: 3400,
      radius: 15,
      tick: 1,
      variant: 'endless',
      food: [],
      snakes: [{ id: 'p1', ...s, alive: true, score: 0, best: 0, invincible: 0, boosting: false, boostHeld: false, respawnIn: 0, respawns: 0, magnet: 0, star: 0 }],
      status: 'playing',
      winner: '',
    },
  };
}

/** 渲染尾点（蛇身折线的最后一个点） */
function tailOf(logic: LogicSnake) {
  const me = logic.view().snakes.find(s => s.mine)!;
  return me.pts[me.pts.length - 1];
}

describe('贪吃蛇身体：尾巴连续滑动（不随快照跳格）', () => {
  test('服务端 20Hz 快照 + 客户端 60fps 渲染时，尾巴每帧位移连续', async () => {
    const server = makeServer();
    const logic = makeLogic();

    // 先喂一帧快照建立初始状态
    let s = server.tick(0);
    logic.setState(snapshot(s));

    // 跑 2 秒：每 16ms 渲染一帧，每 50ms 服务端推一次快照
    const tailSteps: number[] = [];
    let prev = tailOf(logic);
    let now = 0;
    for (let frame = 0; frame < 120; frame++) {
      now += 16;
      if (frame % 3 === 0) {
        s = server.tick(TICK);
        logic.setState(snapshot(s));
      }
      const cur = tailOf(logic);
      tailSteps.push(Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
      prev = cur;
      await new Promise(r => setTimeout(r, 4));
    }
    logic.destroy();

    // 一帧的位移应该与「速度 × 帧长」同量级（1.8px 左右）
    const max = Math.max(...tailSteps);
    const avg = tailSteps.reduce((a, b) => a + b, 0) / tailSteps.length;
    expect(avg).toBeGreaterThan(0.2);
    // 关键：不能出现「跳格」—— 某帧位移远大于其它帧
    expect(max).toBeLessThan(avg * 4 + 2);
  });

  test('尾巴不会在快照到达的瞬间瞬移（位移不超过同量级）', async () => {
    const server = makeServer();
    const logic = makeLogic();
    let s = server.tick(0);
    logic.setState(snapshot(s));

    // 先让本地跑一会儿，进入「路径已建立」的状态
    for (let i = 0; i < 10; i++) {
      s = server.tick(TICK);
      logic.setState(snapshot(s));
      await new Promise(r => setTimeout(r, 8));
    }

    const before = tailOf(logic);
    s = server.tick(TICK);
    logic.setState(snapshot(s));
    const after = tailOf(logic);
    logic.destroy();

    // 快照刚落地的一帧，尾巴最多前进一格（服务端一 tick 的推进量 ≈ 5.5px）
    const jump = Math.hypot(after[0] - before[0], after[1] - before[1]);
    expect(jump).toBeLessThan(12);
  });
});
