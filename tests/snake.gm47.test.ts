import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-47：
 * 1. 主页排行榜没数据 —— 根因是 Redis `SET key value 60`（缺 `EX`）语法错误，
 *    缓存一写就抛异常、socket 回调不回来；顺带把排行榜数据从全局 store 挪到组件局部；
 * 2. 皮肤预览里黑眼睛贴在身体那一侧 —— 前进方向传成了 `+π/2`（朝身体），应为 `-π/2`（朝上）；
 * 3. 无敌罩要 AABB 外接圆（最长边当直径）+ 连续平滑，不能整圈跳。
 */

describe('GM-47 主页排行榜', () => {
  test('榜单请求失败不再把页面挂在转圈上', () => {
    const lb = compact(read('src/components/Leaderboard.tsx'));
    // 请求序号：过期响应直接丢弃
    expect(lb).toContain('reqRef.current!==id');
    // 5s 超时兜底
    expect(lb).toContain('setTimeout(');
    expect(lb).toContain('setLoading(false)');
    // 数据用自己的 state，不再写全局 store（多实例会互相覆盖）
    expect(lb).toContain('const[rows,setRows]=useState<any[]>([])');
    expect(lb).not.toContain('store.game.setLeaderboard');
    expect(lb).not.toContain('store.game.leaderboard.length');
  });

  test('服务端榜单缓存按 ioredis 的 SET ... EX 语义写（否则 Redis 回 syntax error）', () => {
    const cache = compact(read('../hardcore-gamers-api/src/services/LeaderboardCache.ts'));
    expect(cache).toContain('BOARD_TTL);');
    expect(cache).toContain("'EX',BOARD_TTL");
    expect(cache).toContain("set(key:string,value:string,mode:'EX',seconds:number)");
    // 榜单接口对缓存故障容错：读失败当未命中、写失败不影响返回
    const svc = compact(read('../hardcore-gamers-api/src/services/PlayerService.ts'));
    expect(svc).toContain('boardCache.get(game_id,board).catch(()=>null)');
    expect(svc).toContain('boardCache.set(game_id,board,rows).catch(()=>{})');
  });
});

describe('GM-47 预览朝向', () => {
  test('竖直预览前进方向朝上（-π/2），眼睛远离身体', () => {
    const pv = compact(read('src/components/SkinPreview.tsx'));
    expect(pv).toContain('drawSnakeHead(ctx,cx,headY,-Math.PI/2');
    // 头画在 headY（顶部），身体从 headY 往下 —— 方向必须朝上
    expect(pv).toContain('constheadY=PAD+R*1.06');
  });
});

describe('GM-47 无敌罩（口径已被 GM-snake-49 覆盖：只罩蛇头）', () => {
  test('不再有最小包围圆 / 包围盒外接圆，只保留头圈', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).not.toContain('enclosePath');
    expect(ts).not.toContain('boundCircle');
    // 每帧都给 drawSnakes 传 dt（头圈扩散依赖帧间隔）
    expect(ts).toContain('drawSnakes(now,view,dt)');
    expect(ts).toContain('privatedrawSnakes(now:number,view:WorldRect,dt:number)');
    expect(ts).toContain('1-Math.exp(-dt/60)');
    // 护盾消失时清掉系数，下次从 0.2 重新扩散
    expect(ts).toContain('this.shieldScales.delete(snake.id)');
  });
});
