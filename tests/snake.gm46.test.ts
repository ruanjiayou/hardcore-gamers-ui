import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-46（本轮需求逐条钉住）：
 * 1. 预览里的糖果头要和进游戏一样（主色圆盘 + 眼睛靠前）—— 两边共用 `head.ts`；
 * 2. 皮肤页的关闭键换成返回左箭头；
 * 3. buff 不要文案，只留图标；
 * 4. 小地图顶到右上角（关闭键删了）；
 * 5. 磁铁不要蓝色边框、图标放大；星星不要黄色背景；
 * 6. 道具数量变多、生效时间变长；
 * 7. 无敌罩改成包住整条身体的最小圆；
 * 8. 出局弹框里补名次；
 * 9. 对战页 HUD 顶部显示今日全游戏最高分。
 */

describe('GM-46 渲染层：道具 / buff / 小地图 / 弹框', () => {
  test('道具不再画彩色底圆（磁铁没有蓝边、星星没有黄底），图标放大', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('constisItem=kind===SNAKE_KIND_MAGNET||kind===SNAKE_KIND_STAR');
    expect(ts).toContain('if(!isItem)');
    // 磁铁图标 0.95r（GM-50 从 0.82 又放大一档），星星 0.9r 描边（GM-51 改线框后缩了一点）
    expect(ts).toContain('constR=r*0.95');
    expect(ts).toContain('drawStar(r*0.9,r*0.38)');
    // 星星不再用黄色填充
    expect(ts).not.toContain("g.fillStyle='#fffbeb'");
  });

  test('buff 只留图标，不再写文案', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('BUFF_ICONS');
    expect(ts).toContain('chip.innerHTML=c.icon');
    // 牌子里不再有「加速中 / 磁吸 N.Ns」这种可见文字（只剩 title/aria-label）
    expect(ts).not.toContain('chip.textContent');
    const css = compact(read('src/pages/game/snake/styles/room.css'));
    // 图标尺寸走独立类名（GM-50）：`.snake-buff svg` 会把倒计时环那层 svg 也命中
    expect(css).toContain('.snake-buff-icon');
    expect(ts).toContain('class="snake-buff-icon"');
  });

  test('小地图顶到安全区 + 10（原为躲关闭键留 60）', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('return{x:Math.max(12,cssW-w-12),y:topInset+10,w,h}');
  });

  test('出局弹框显示名次（第 N 名 / 共 M 条蛇）', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('第${myRank}名/共${total}条蛇');
    // 名次算进签名，结算后弹框里的数字会跟着刷新
    expect(ts).toContain('${myRank}');
  });

  test('HUD 顶部显示今日全游戏最高分，而不是自己的分数', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain('ui.hudScore.textContent=String(s.todayBest||0)');
    expect(ts).toContain("hudBestLabel.textContent='今日最高'");
    const logic = compact(read('src/games/snake/Logic.ts'));
    expect(logic).toContain('this.todayBest=snap.todayBest');
    expect(logic).toContain('todayBest:this.todayBest');
    // 服务端快照要带这个字段
    const api = compact(read('../hardcore-gamers-api/src/services/SnakeRuntimeService.ts'));
    expect(api).toContain('todayBest:this.todayBestScore()');
  });
});

describe('GM-46 皮肤预览与对局同一套头部', () => {
  test('预览与对局都调同一个 drawSnakeHead', () => {
    expect(read('src/games/snake/head.ts')).toContain('export function drawSnakeHead');
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain("import{drawSnakeHead}from'./head';");
    expect(ts).toContain('drawSnakeHead(ctx,hx,hy,angle');
    const pv = compact(read('src/components/SkinPreview.tsx'));
    expect(pv).toContain("import{drawSnakeHead}from'../games/snake/head';");
    // 预览头朝上（身体在下方），前进方向是 -π/2；传 +π/2 眼睛会翻到身体那一侧
    expect(pv).toContain('drawSnakeHead(ctx,cx,headY,-Math.PI/2');
    expect(pv).toContain('skinAccent(bodyImg)');
    // 预览里不再有自己那套「裁贴图 + 眼睛写死在下方」的画法
    expect(pv).not.toContain('ctx.arc(cx+R*0.42*side');
  });

  test('皮肤页的按钮是返回（箭头），不是关闭', () => {
    const sk = compact(read('src/pages/game/snake/Skins.tsx'));
    expect(sk).toContain('game-back-arrow');
    expect(sk).not.toContain('game-backis-close');
    expect(sk).not.toContain('>×<');
  });
});

describe('GM-46 服务端数值：道具更多、更久', () => {
  test('道具数量 8 → 16，磁铁 9s / 星星 4s', () => {
    const rules = compact(read('../hardcore-gamers-api/src/games/snake/rules.ts'));
    expect(rules).toContain('exportconstSNAKE_ITEM_COUNT=16');
    expect(rules).toContain("key:'magnet',label:'磁铁',weight:50,radius:15,durationMs:9000");
    expect(rules).toContain("key:'star',label:'星星',weight:50,radius:15,durationMs:4000");
  });

  test('出生护盾与星星用同一套护盾色', () => {
    const ts = compact(read('src/games/snake/Scene2D.ts'));
    expect(ts).toContain("constSHIELD_RGB='96,165,250'");
    // 不再按 star/invincible 分成两种颜色
    expect(ts).not.toContain("'251,191,36'");
  });
});
