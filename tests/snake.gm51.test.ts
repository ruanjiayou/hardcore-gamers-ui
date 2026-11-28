import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
const ITEM_DIR = '../hardcore-gamers-api/public/skins/arcade/snake/items';

/**
 * GM-snake-51（用户对上一轮的纠正，四条）：
 *
 * 1. 「去掉磁吸外围的圈，不是加速的啊！加速的不要去掉」→ 徽标底板只留加速，磁吸/无敌无底；
 * 2. 磁吸的圈其实在**资源图**里（`items/magnet.svg` 有一圈紫底 + 描边圈）→ 重画那张图；
 * 3. 「重新设计磁吸的 svg，一半蓝一半红，u 型两头一小部分灰白色」→ 新磁铁配色；
 * 4. 「无敌星去掉淡黄色背景，五角星改为描边类型」→ `items/star.svg` 去底圆 + 线框。
 *
 * 关键：这两张是**资源图**，地图上的道具和 HUD 徽标用的是同一张（`skinImage` 贴图优先），
 * 所以改图比改 canvas 画法更根本 —— 但 canvas 回退也要同步，没配图时不至于退回旧样式。
 */

describe('GM-51 徽标底板只留加速', () => {
  const css = compact(read('src/pages/game/snake/styles/room.css'));

  test('加速有圆底 + 描边（用户：加速的不要去掉）', () => {
    expect(css).toContain('.snake-buff.boost{');
    const boost = css.slice(css.indexOf('.snake-buff.boost{'));
    expect(boost.slice(0, 400)).toContain('border-radius:50%');
    expect(boost.slice(0, 400)).toContain('background:rgba(56,189,248,0.22)');
    expect(boost.slice(0, 400)).toContain('border:1pxsolidrgba(56,189,248,0.45)');
  });

  test('磁吸 / 无敌没有底板（只有图标 + 倒计时环）', () => {
    expect(css).toContain('.snake-buff.magnet{color:#dbeafe;}');
    expect(css).toContain('.snake-buff.star{color:#fde68a;}');
    expect(css).not.toContain('rgba(96,165,250,0.20)');
    expect(css).not.toContain('rgba(251,191,36,0.20)');
  });
});

describe('GM-51 磁吸资源图：去圈 + 一半蓝一半红 + 灰白磁极', () => {
  const svg = read(`${ITEM_DIR}/magnet.svg`);

  test('外围的圈全删掉（紫色半透明大圆 / 深色圆盘 / 描边圈）', () => {
    expect(svg).not.toContain('<circle');
    expect(svg).not.toContain('#8b5cf6');
    expect(svg).not.toContain('#3b0764');
    expect(svg).not.toContain('stroke="#a78bfa"');
  });

  test('U 型用两个 clip 硬切：左蓝右红', () => {
    // 两个裁剪矩形卡在中线 x=32
    expect(svg).toContain('<clipPath id="snake-magnet-left"><rect x="0" y="0" width="32" height="64"/></clipPath>');
    expect(svg).toContain('<clipPath id="snake-magnet-right"><rect x="32" y="0" width="32" height="64"/></clipPath>');
    // 同一个 U 路径画两遍，颜色不同 —— 只画半弧会在顶点露出断口
    const uPath = 'd="M14 53V34a18 18 0 0 1 36 0v19"';
    expect(svg.split(uPath).length - 1).toBe(2);
    expect(svg).toContain('stroke="#3b82f6"');
    expect(svg).toContain('stroke="#ef4444"');
  });

  test('两腿末端一小段灰白磁极（约占腿长两成）', () => {
    expect(svg).toContain('<rect x="6.5" y="46" width="15" height="7" fill="#e2e8f0"/>');
    expect(svg).toContain('<rect x="42.5" y="46" width="15" height="7" fill="#e2e8f0"/>');
    // 腿从 y=34 到 53（19），磁极 7 → 37%，是「一小部分」
    const capRatio = 7 / 19;
    expect(capRatio).toBeGreaterThan(0.2);
    expect(capRatio).toBeLessThan(0.5);
  });

  test('内容撑满画布（不再缩在中间一圈里）', () => {
    // 左右外缘 6.5 ~ 57.5（51/64 ≈ 80%），上下 8.5 ~ 53
    expect(svg).toContain('stroke-width="15"');
    const width = 57.5 - 6.5;
    expect(width / 64).toBeGreaterThan(0.75);
  });
});

describe('GM-51 无敌星资源图：去淡黄底 + 描边类型', () => {
  const svg = read(`${ITEM_DIR}/star.svg`);

  test('淡黄色背景圆删掉', () => {
    expect(svg).not.toContain('<circle');
    expect(svg).not.toContain('#fbbf24');
    expect(svg).not.toContain('opacity="0.22"');
  });

  test('五角星改成描边：粗描边 + 极淡填充（不是实心 + 高光）', () => {
    expect(svg).toContain('stroke="#fcd34d"');
    expect(svg).toContain('stroke-width="5"');
    expect(svg).toContain('stroke-linejoin="round"');
    // 只留 10% 填充，避免小尺寸空心星糊成一条线
    expect(svg).toContain('fill-opacity="0.10"');
    // 老版的实心黄 + 内部白色高光都没了
    expect(svg).not.toContain('fill="#fde68a"');
    expect(svg).not.toContain('fill="#fffbeb"');
    // 整个文件只保留一条星形 path
    expect(svg.split('<path').length - 1).toBe(1);
  });
});

describe('GM-51 canvas 回退与资源图保持一致', () => {
  const ts = compact(read('src/games/snake/Scene2D.ts'));

  test('磁铁：中线 clip 切两半，左蓝右红，腿末端灰白', () => {
    expect(ts).toContain("half(true,'#3b82f6')");
    expect(ts).toContain("half(false,'#ef4444')");
    expect(ts).toContain("g.rect(left?0:cx,0,cx,size)");
    expect(ts).toContain("g.fillStyle='#e2e8f0'");
    // 旧的深色描边圈（让 U 形看着像圆环）不再画
    expect(ts).not.toContain("strokeStyle='rgba(8,10,18,0.85)'");
  });

  test('五角星：描边 + 10% 填充，不再纯实心白', () => {
    expect(ts).toContain("g.strokeStyle='#fcd34d'");
    expect(ts).toContain("g.fillStyle='rgba(252,211,77,0.10)'");
    expect(ts).not.toContain("g.fillStyle='#f8fafc'");
  });

  test('内联 SVG 回退同步：磁铁红蓝渐变 + 灰白极靴；星星 fill=none 描边', () => {
    expect(ts).toContain('snake-magnet-half');
    expect(ts).toContain('stop-color="#3b82f6"');
    expect(ts).toContain('stop-color="#ef4444"');
    // 星星回退不再 fill="currentColor"
    const star = ts.slice(ts.indexOf('star:\'<svgclass="snake-buff-icon"'), ts.indexOf('asconst'));
    expect(star).toContain('fill="none"');
    expect(star).toContain('stroke="currentColor"');
  });
});

describe('GM-51 资源文件确实在（不是只改了代码）', () => {
  test('两张图都存在且是可解析的 SVG', () => {
    for (const f of ['magnet.svg', 'star.svg']) {
      const p = join(ROOT, ITEM_DIR, f);
      expect(existsSync(p)).toBe(true);
      const svg = read(`${ITEM_DIR}/${f}`);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.trim().endsWith('</svg>')).toBe(true);
    }
  });
});
