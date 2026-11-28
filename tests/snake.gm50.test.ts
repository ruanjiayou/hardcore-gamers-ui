import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * GM-snake-50（四条纯视觉微调，逐条钉住）：
 *
 * 1. buff 倒计时环**太粗** → 线宽收到 2px；
 * 2. 环的端点要**圆头** → conic-gradient 做不到，换成 SVG 弧 `stroke-linecap: round`；
 * 3. 磁吸（以及无敌）徽标**不要外围的圈**，里面的内容放大 → 去掉圆形底板/描边，
 *    图标画布改成 tight（裁掉为脉动预留的空白）+ 磁铁本体放大；
 * 4. 无敌罩**再大一点** → 1.25 → 1.5 个身半径，外扩 7 → 8px。
 */

describe('GM-50 buff 倒计时环：细线 + 圆头', () => {
  const css = compact(read('src/pages/game/snake/styles/room.css'));
  const ts = compact(read('src/games/snake/Scene2D.ts'));

  test('不再用 conic-gradient + mask（那套端点必然是直角、最细也有 3px）', () => {
    // 只断言「规则」不在了：注释里还留着对老方案的说明
    expect(css).not.toContain('background:conic-gradient');
    expect(css).not.toContain('mask:radial-gradient(farthest-side');
    expect(css).not.toContain('.snake-buff.timed::after');
  });

  test('换成 SVG 弧：2px 线宽 + stroke-linecap: round', () => {
    expect(css).toContain('.snake-buff-ring');
    expect(css).toContain('stroke-width:2');
    expect(css).toContain('stroke-linecap:round');
    // 12 点起顺时针：SVG 圆默认从 3 点起画，转 -90°
    expect(css).toContain('transform:rotate(-90deg)');
  });

  test('环用 pathLength=100，每帧只写 stroke-dashoffset（不重建 DOM）', () => {
    expect(ts).toContain("constNS='http://www.w3.org/2000/svg'");
    expect(ts).toContain("createElementNS(NS,'circle')");
    expect(ts).toContain("circle.setAttribute('pathLength','100')");
    expect(ts).toContain("circle.setAttribute('stroke-dasharray','100')");
    // 剩余 100% → offset 0（整圈），剩余 0% → offset 100（空）
    expect(ts).toContain("setAttribute('stroke-dashoffset',String(((1-left)*100).toFixed(2))");
    // 进度弧节点按 chip 缓存，结构不变时零 DOM 操作
    expect(ts).toContain('privatebuffBars=newMap<string,SVGCircleElement>()');
    expect(ts).toContain('this.buffBars.set(c.cls,bar)');
  });

  test('轨道 + 进度两条同心圆，半径留出半根线宽，圆头不被视口切掉', () => {
    expect(ts).toContain("for(constclsof['track','bar']asconst)");
    expect(ts).toContain("circle.setAttribute('r','11.5')");
    // 注意 compact 会把字符串里的空格也吃掉，这里只断言属性名
    expect(ts).toContain("svg.setAttribute('viewBox',");
  });
});

describe('GM-50 徽标去掉外围的圈，图标放大', () => {
  const css = compact(read('src/pages/game/snake/styles/room.css'));
  const ts = compact(read('src/games/snake/Scene2D.ts'));

  test('基类只剩定位框（底板只给加速，见 snake.gm51.test.ts）', () => {
    const block = css.slice(css.indexOf('.snake-buff{'), css.indexOf('.snake-buff-ring'));
    expect(block).toContain('width:26px');
    expect(block).not.toContain('background:');
    expect(block).not.toContain('border-radius');
    expect(block).not.toContain('border:');
    // 磁吸 / 无敌没有底色（GM-snake-51 纠回：去掉的只是它们的圈，加速的留着）
    expect(css).not.toContain('rgba(96,165,250,0.20)');
    expect(css).not.toContain('rgba(251,191,36,0.20)');
  });

  test('图标画布放大：21px + tight 画布（裁掉为脉动预留的 3.1r 余量）', () => {
    expect(css).toContain('.snake-buff-art{width:21px;height:21px;');
    expect(ts).toContain('constsize=Math.ceil(r*(tight?2.35:3.1))');
    // 徽标走 tight，地图上的道具仍留脉动余量
    expect(ts).toContain('this.buildFoodSprite(kind,8,0,assetId,1,true)');
    // 图标尺寸用独立类名，别让 `.snake-buff svg` 把倒计时环也改小
    expect(css).toContain('.snake-buff-icon');
    expect(css.includes('.snake-buffsvg')).toBe(false);
  });

  test('磁铁本体再放大一档（0.82r → 0.95r）', () => {
    expect(ts).toContain('constR=r*0.95');
    expect(ts).not.toContain('constR=r*0.82');
    // 星星的尺寸/画法在 GM-snake-51 换成描边，见 snake.gm51.test.ts
    expect(ts).toContain('drawStar(');
  });
});

describe('GM-50 无敌罩更大', () => {
  const ts = compact(read('src/games/snake/Scene2D.ts'));

  test('半径 1.25 → 1.5 个身半径，外扩 7 → 8 屏幕像素', () => {
    expect(ts).toContain('constSHIELD_PAD_PX=8');
    expect(ts).toContain('this.state.radius*1.5*this.zoom+SHIELD_PAD_PX');
    expect(ts).not.toContain('*1.25*this.zoom');
  });

  test('圆心仍是蛇头（放大不能把「跟着头走」改掉）', () => {
    expect(ts).toContain('constcx=hx;constcy=hy;');
  });
});
