import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import LogicSnake from '../src/games/snake/Logic';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-49（本轮四条需求）：
 *
 * 1. 无敌罩改回**只罩蛇头**（不再整条蛇的包围盒圆）；
 * 2. buff 倒计时环颜色固定成加速那种淡蓝（原来跟 currentColor 走，磁吸的 `#dbeafe`
 *    看起来就是白边）；
 * 3. 磁吸 / 无敌的徽标改用**道具自己的皮肤**（与地图上那颗道具同一套画法）；
 * 4. 网络抖动不再拖累自己：快照只登记、每帧最多消化最新一条。
 */

function makeLogic(myId = 'p1') {
  const socket = { socket: { on() { }, off() { }, emit() { } } };
  return new LogicSnake(socket as any, { _id: myId, nickname: 'me', room_id: 'r1' }, 'endless', undefined as any) as any;
}

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

describe('GM-49 无敌罩只罩蛇头', () => {
  test('圆心就是蛇头，半径 = 身半径的倍数 + 固定像素（GM-50 已放大到 1.5）', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('constcx=hx;constcy=hy;');
    expect(ts).toContain('this.state.radius*1.5*this.zoom+SHIELD_PAD_PX');
    // 整身包围盒那一套彻底删掉（连函数都不该留着）
    expect(ts).not.toContain('boundCircle');
    expect(ts).not.toContain('shieldCircle(');
  });

  test('只有出现系数做过渡：0.2 起步、τ=60ms 扩散到 1', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('return0.2+0.8*next;');
    expect(ts).toContain('1-Math.exp(-dt/60)');
    // 圆心不平滑（否则快速移动时圈会拖在头后面）
    expect(ts).not.toContain('cur.cx+=(');
    expect(ts).not.toContain('cur.cy+=(');
  });
});

describe('GM-49 buff 环改成淡蓝', () => {
  test('不再跟 currentColor（磁吸的 #dbeafe 看着就是白色）', () => {
    const css = compact(read('src/pages/game/snake/styles/room.css'));
    // GM-snake-50 换成 SVG 弧后，颜色写在 .bar 的 stroke 上
    expect(css).toContain('stroke:#7dd3fc');
    expect(css).not.toContain('stroke:currentColor');
    expect(css).not.toContain('conic-gradient(currentColor');
  });
});

describe('GM-49 buff 徽标用道具皮肤', () => {
  test('图标走地图道具的精灵生成（有皮肤贴皮肤、没有就是矢量道具）', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('privatebuffIcon(kind');
    // GM-snake-50：末位 tight=true —— 徽标只要图形本身，不要脉动预留的空白
    expect(ts).toContain('this.buildFoodSprite(kind,8,0,assetId,1,true)');
    // 半径倍率固定 1：徽标与地图缩放无关
    expect(ts).toContain('scale=this.zoom');
    // 徽标里放画布而不是内联 SVG
    expect(ts).toContain("c.art.className='snake-buff-art'");
    expect(ts).toContain('chip.appendChild(c.art)');
    const css = compact(read('src/pages/game/snake/styles/room.css'));
    expect(css).toContain('.snake-buff-art');
    expect(css).toContain('width:21px');
  });
});

describe('GM-49 网络抖动不再拖累自己', () => {
  test('收包只登记最新一条，处理留到渲染帧', () => {
    const logic = makeLogic();
    const before = logic.tick;
    logic.onRemoteAction({ snake: snap([mySnake()], { tick: 5 }) });
    expect(logic.pendingSnap).not.toBeNull();
    // 回调里完全没有处理：tick 还是旧的
    expect(logic.tick).toBe(before);

    logic.view();
    expect(logic.tick).toBe(5);
    expect(logic.pendingSnap).toBeNull();
  });

  test('一次 flush 十条也只算一条（最新者胜）', () => {
    const logic = makeLogic();
    for (let i = 1; i <= 10; i++) logic.queueSnapshot(snap([mySnake()], { tick: i }));
    logic.view();
    expect(logic.tick).toBe(10);
    expect(logic.snakes.length).toBe(1);
  });

  test('帧内消化不再广播 state，避免一次快照算两遍视图', () => {
    const logic = makeLogic();
    let emits = 0;
    logic.on('state', () => emits++);
    logic.queueSnapshot(snap([mySnake()]));
    logic.view();
    expect(emits).toBe(0);
    // 直接 applySnapshot（重连 / setState 这条一次性路径）仍然广播
    logic.applySnapshot(snap([mySnake()], { tick: 9 }));
    expect(emits).toBe(1);
  });

  test('慢网判定按「到达」间隔统计，不被合帧摊薄', () => {
    const ts = compact(read('src/games/snake/Logic.ts'));
    expect(ts).toContain('drainPendingSnapshot(){');
    // view() 开头就消化待处理快照（在取 now 之前）
    const viewAt = ts.indexOf('view():SnakeView{');
    const drainAt = ts.indexOf('this.drainPendingSnapshot();');
    expect(drainAt).toBeGreaterThan(viewAt);
    expect(ts.indexOf('constnow=Date.now();', viewAt)).toBeGreaterThan(drainAt);
    // 到达间隔在 queueSnapshot 里记，applySnapshot 里不再重复记
    expect(ts).toContain('privatelastArriveAt=0');
    expect(ts).toContain('if(gap>0&&gap<5000)');
    expect(ts).toContain('if(!this.draining)this.emitView();');
  });
});
