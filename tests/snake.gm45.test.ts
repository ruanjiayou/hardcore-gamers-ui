import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceLocalPath, pushPathHead, type RemotePath } from '../src/games/snake/Logic';
import { bodySegments, skinCell } from '../src/games/snake/skin';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-45：
 * 1. 「匀速时某一节超前」—— 路径头部的折返段（掉帧把一帧拆成两小步时产生），
 *    一次就永久刻在路径里，按弧长取锚点那一节永远错位；
 * 2. 食物密度 ×2.5、食物/道具不再画光晕、道具放大；
 * 3. 加速/磁吸的半透明效果改成排行榜下方的 buff 文字牌；
 * 4. 对战页去掉右上角关闭键，出局弹框是唯一出口；
 * 5. 糖果这类「单图圆贴图」皮肤的头部改成主色圆盘 + 眼睛靠前。
 */

function straight(len = 400): RemotePath {
  const path: [number, number][] = [];
  for (let d = 0; d <= len; d += 4) path.push([1000 - d, 500]);
  return { path, length: len, at: 0 };
}

describe('GM-45 蛇身：路径头部绝不产生折返段', () => {
  test('pushPathHead：新头在后方时只替换头点，不插点', () => {
    const path: [number, number][] = [[100, 0], [90, 0], [80, 0]];
    pushPathHead(path, 97, 0.2, 0.4);
    expect(path.length).toBe(3);
    expect(path[0][0]).toBeCloseTo(97, 5);
  });

  test('pushPathHead：亚像素抖动只挪头点', () => {
    const path: [number, number][] = [[100, 0], [90, 0]];
    pushPathHead(path, 100.2, 0, 0.4);
    expect(path.length).toBe(2);
    expect(path[0][0]).toBeCloseTo(100.2, 5);
  });

  test('pushPathHead：向前推进才插点，且每次插入都成为新的头', () => {
    const path: [number, number][] = [[100, 0], [90, 0]];
    pushPathHead(path, 101, 0);
    pushPathHead(path, 102, 0);
    expect(path.length).toBe(4);
    expect(path.map(p => p[0])).toEqual([102, 101, 100, 90]);
  });

  test('掉帧（一帧拆成多小步）后，锚点间距仍等于节距（旧实现会永久压缩 4px）', () => {
    const rp = straight();
    const cell = skinCell(15, true);
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      // 每 17 帧来一次 50ms 的掉帧 → step > 4px，旧实现会分成两小步并折返
      const dt = i % 17 === 3 ? 0.05 : 0.016;
      advanceLocalPath(rp, 0, 110, dt, false);
      const segs = bodySegments(rp.path, cell.step, 1, 18);
      for (let k = 1; k < segs.length; k++) {
        const gap = Math.hypot(segs[k].x - segs[k - 1].x, segs[k].y - segs[k - 1].y);
        worst = Math.max(worst, Math.abs(gap - cell.step));
      }
    }
    // 直线上锚点间距必须精确等于节距（旧实现在掉帧后固定差 4.4px）
    expect(worst).toBeLessThan(0.05);
  });

  test('转弯 + 掉帧：路径上不出现 >120° 的折返', () => {
    const rp = straight();
    let angle = 0;
    for (let i = 0; i < 200; i++) {
      const dt = i % 13 === 5 ? 0.045 : 0.016;
      angle += (110 / 58) * dt;
      advanceLocalPath(rp, angle, 110, dt, false);
    }
    const pts = rp.path;
    for (let i = 1; i + 1 < pts.length; i++) {
      const ax = pts[i][0] - pts[i - 1][0];
      const ay = pts[i][1] - pts[i - 1][1];
      const bx = pts[i + 1][0] - pts[i][0];
      const by = pts[i + 1][1] - pts[i][1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      expect((ax * bx + ay * by) / (la * lb)).toBeGreaterThan(-0.5);
    }
  });
});

describe('GM-45 场景：食物 / 道具 / buff / 关闭键', () => {
  test('食物与道具不再画光晕（精灵只留实体圆）', () => {
    const ts = read('src/games/snake/Scene2D.ts');
    expect(ts).not.toContain('r * 2.1');
    // 精灵画布只为实体 + 脉动留余量（GM-snake-50 加了 tight 档：徽标里的静态图标不留）
    expect(ts).toContain('Math.ceil(r * (tight ? 2.35 : 3.1))');
  });

  test('加速光环与磁吸范围圈都删掉了（改成 buff 文字牌）', () => {
    const ts = read('src/games/snake/Scene2D.ts');
    expect(ts).not.toContain('haloR');
    expect(ts).not.toContain('magnetR * this.zoom');
    expect(ts).toContain('snake-buffs');
    expect(ts).toContain('renderBuffs');
  });

  test('buff 条挂在排行榜（hud-players）下面', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain("hud.append(hudMode,hudScores,hudPlayers,buffs)");
    const css = read('src/pages/game/snake/styles/room.css');
    expect(css).toContain('.snake-buffs');
    expect(css).toContain('.snake-buff.star');
  });

  test('对战页沉浸 HUD 不再有关闭键；出局弹框是唯一出口', () => {
    const tsx = compact(read('src/pages/game/snake/Room.tsx'));
    expect(tsx).not.toContain('hud-btnhud-close');
    // 死亡弹框的「退出」按场景分流（团队=结束本局，无尽=离开房间）
    expect(tsx).toContain("logic?.on?.('exit',()=>handleExit())");
  });

  test('团队模式出局也给弹框，但只有无尽能重生', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain("kind='death'");
    expect(ts).toContain("constcanRespawn=s.variant==='endless'&&s.awaiting");
    expect(ts).toContain("ui.deathRespawn.style.display=canRespawn?'':'none'");
  });

  test('单图圆贴图的头部用主色圆盘（不再把身体贴图裁一块贴头上）', () => {
    // GM-snake-46 把这套画法抽到了 head.ts（对局与皮肤预览共用），断言跟着搬过去
    const head = compact(read('src/games/snake/head.ts'));
    expect(head).toContain('art.body&&!art.roundBody');
    expect(head).toContain('tintWhite(art.accent,0.58)');
    // 眼睛往前挪到 0.54R（旧 0.42R 太靠中心）
    expect(head).toContain('ex*r*0.54');
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('constroundBody=skinIsRound(bodyImg)');
    expect(ts).toContain('drawSnakeHead(ctx,hx,hy,angle');
    expect(ts).toContain('skinAccent(bodyImg)');
    expect(read('src/services/assets.ts')).toContain('export function skinAccent');
  });
});
