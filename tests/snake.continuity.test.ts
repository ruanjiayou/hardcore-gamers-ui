import { describe, expect, test } from 'bun:test';
import LogicSnake from '../src/games/snake/Logic';

/**
 * 蛇身连续性：尾巴必须贴着身体连续滑动，不能"每 50ms 跳一格"。
 *
 * 背景：服务端 20Hz 推一帧，快照里的 pts 是"那一瞬间的位置"。
 * 渲染层若只向这组离散目标插值，尾巴就会在目标不动时停住，
 * 等下一帧快照到达才跳一下 —— 肉眼看到的就是"尾部间隔前进"。
 *
 * 修法：
 * - 自己的蛇：服务端 spine 必须精确覆盖到尾巴（否则客户端插值找不到落点）；
 * - 远端蛇：Logic 维护本地连续路径，每帧自己往前推。
 *
 * 这个测试盯住"尾巴每帧都动"，防止以后改渲染又退回跳跃式。
 */

function makeLogic() {
  const socket = { socket: { on() { }, off() { }, emit() { } } };
  // player._id 就是 myId（Logic 用 getter 从 player 取）
  return new LogicSnake(socket as any, { _id: 'me', nickname: 't', room_id: 'r1' });
}

/** 造一条自己的蛇的快照（服务端 spine：等距采样，末点是精确尾巴） */
function mySnakeSnap(id: string, x: number, y: number, length = 160) {
  const pts: [number, number][] = [];
  // 头在 x，身长沿 -x 方向展开；末点是精确尾巴（服务端补尾点后的形状）
  for (let i = 0; i * 22 < length; i++) pts.push([x - i * 22, y]);
  pts.push([x - length, y]);
  return { id, x, y, angle: 0, pts, length, alive: true, score: 0, best: 0 };
}

describe('蛇身连续性 · 尾巴不跳跃', () => {
  test('自己的蛇：本地路径每帧推进，尾巴连续滑动（不出现静止帧）', () => {
    const logic = makeLogic() as any;
    logic.predAlive = true;
    logic.snap = {
      x: 600, y: 600, angle: 0,
      pts: mySnakeSnap('me', 600, 600).pts,
      length: 160,
      at: Date.now(),
    };
    logic.targetAngle = 0;
    // 本地连续路径（服务端快照的 spine 建路径，之后每帧自己往前推）
    logic.myPath = {
      path: mySnakeSnap('me', 600, 600).pts.map((p: any) => [p[0], p[1]] as [number, number]),
      length: 160,
      at: Date.now(),
    };

    // 连续取若干帧的尾巴位置
    const tails: [number, number][] = [];
    let t = logic.myPath.at + 16;
    for (let i = 0; i < 8; i++) {
      const pred = logic.predict(t);
      expect(pred).toBeTruthy();
      logic.myPath.at = t - 16;
      logic.advanceMyPath(t, pred);
      const p = logic.myPath.path;
      tails.push(p[p.length - 1]);
      t += 16;
    }

    // 相邻两帧的尾巴位移必须都 > 0（有位移），且量级合理（不是一次跳很远）
    for (let i = 1; i < tails.length; i++) {
      const d = Math.hypot(tails[i][0] - tails[i - 1][0], tails[i][1] - tails[i - 1][1]);
      expect(d).toBeGreaterThan(0.05);
      expect(d).toBeLessThan(12);
    }
  });

  test('自己的蛇：快照身长与 spine 弧长一致（尾点必须覆盖到身长末端）', () => {
    // 这是服务端补尾点的意义所在：spine 的弧长必须等于身长，
    // 客户端按身长截断才能命中尾点。少一截 → 尾巴冻结。
    const logic = makeLogic() as any;
    const pts = mySnakeSnap('me', 600, 600).pts;
    let arc = 0;
    for (let i = 1; i < pts.length; i++) {
      arc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    expect(arc).toBe(160);
  });

  test('远端蛇：本地路径每帧推进，尾巴连续滑动', () => {
    const logic = makeLogic() as any;
    const remote = {
      id: 'other', x: 1000, y: 800, angle: 0,
      pts: mySnakeSnap('other', 1000, 800).pts,
      length: 160, alive: true, score: 0, best: 0,
    };
    // 先同步一条远端蛇进本地路径
    logic.snakes = [{ ...remote, mine: false, invincible: 0, boosting: false, boostHeld: false, magnet: 0, star: 0, respawnIn: 0, respawns: 0, team: '', skin: '' }];
    logic.syncRemotePaths([remote], Date.now());

    const rp = logic.remotePaths.get('other');
    expect(rp).toBeTruthy();
    expect(rp.path.length).toBeGreaterThan(2);

    // 逐帧推进，记录尾巴位置
    const tails: [number, number][] = [];
    let t = Date.now();
    for (let i = 0; i < 6; i++) {
      t += 16;
      rp.at = t - 16;
      logic.advanceRemotePaths(t);
      const p = logic.remotePaths.get('other');
      tails.push(p.path[p.path.length - 1]);
    }

    for (let i = 1; i < tails.length; i++) {
      const d = Math.hypot(tails[i][0] - tails[i - 1][0], tails[i][1] - tails[i - 1][1]);
      expect(d).toBeGreaterThan(0.05);
    }
  });

  test('远端蛇：本地路径头会向权威位置纠偏（不无限漂移）', () => {
    const logic = makeLogic() as any;
    const remote = {
      id: 'other', x: 1000, y: 800, angle: 0,
      pts: mySnakeSnap('other', 1000, 800).pts,
      length: 160, alive: true, score: 0, best: 0,
    };
    logic.snakes = [{ ...remote, mine: false, invincible: 0, boosting: false, boostHeld: false, magnet: 0, star: 0, respawnIn: 0, respawns: 0, team: '', skin: '' }];
    logic.syncRemotePaths([remote], Date.now());
    const rp = logic.remotePaths.get('other');

    // 人为把本地头挪偏 10px
    rp.path[0] = [rp.path[0][0] + 10, rp.path[0][1]];
    logic.correctRemotePaths();
    const err = Math.hypot(rp.path[0][0] - 1000, rp.path[0][1] - 800);
    expect(err).toBeLessThan(10);
  });
});
