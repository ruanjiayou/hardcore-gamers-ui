/**
 * 蛇头绘制（`GM-snake-45` / `GM-snake-46`）：对局与皮肤预览**共用同一个函数**。
 *
 * 为什么单独抽出来：预览里原来自己实现了一套「裁一块身体贴图 + 两只眼睛」的画法，
 * 对局里改成了「主色圆盘 + 眼睛前移」，两边就分叉了 —— 预览里糖果头还是旧样子
 * （粉底是一块贴图的花纹、眼睛在头下方），用户一眼就看出不一致。
 *
 * 三种分支（与对局保持一致的语义）：
 * 1. 有头图 → 直接贴头图（水晶/森林/恐龙自带眼睛，不再叠代码眼睛）；
 * 2. 身体是满幅贴图（熔岩/霓虹/默认）→ 裁一块贴图裁圆，纹理连续；
 * 3. 身体是圆贴图（糖果/鳞片）→ **主色圆盘 + 径向渐变**，颜色取自贴图最饱和那批像素。
 *
 * 约定：`angle` 是**前进方向**（世界弧度），图像「上方」对齐前进方向。
 */

/** 主色往白色提亮的比例（0 = 原色，1 = 纯白） */
export function tintWhite(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

export interface HeadArt {
  /** 头图（有就贴，自带眼睛） */
  head: CanvasImageSource | null;
  /** 身体贴图（没头图时贴到头上） */
  body: CanvasImageSource | null;
  /** 身体贴图是否圆形（四角透明） */
  roundBody: boolean;
  /** 身体贴图的边长（屏幕像素） */
  spriteSize: number;
  /** 蛇身半径（屏幕像素） */
  radius: number;
  /** 圆贴图的主色（`skinAccent` 提取），头部圆盘用它 */
  accent: string;
  /** 连贴图都没有时的兜底色（玩家配色） */
  fallbackColor: string;
}

/** 头圆半径 = 1.06R（比身体略大一点，转弯时不会露出后面那一节） */
const HEAD_SCALE = 1.06;

export function drawSnakeHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  art: HeadArt,
): void {
  const r = art.radius;
  const hr = r * HEAD_SCALE;

  if (art.head) {
    // 头图是 64 画布里画 r=30 的圆（外圈 2px 透明），画大一点（2.3R）才盖得住头圆
    const d = r * 2.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.drawImage(art.head, -d / 2, -d / 2, d, d);
    ctx.restore();
    return; // 自带眼睛，不再画代码眼睛
  }

  if (art.body && !art.roundBody) {
    // 满幅贴图：裁一块贴上去，纹理是连续的，看起来就是「皮肤」
    const s = art.spriteSize;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.drawImage(art.body, -s / 2, -s / 2, s, s);
    ctx.restore();
  } else if (art.body) {
    // 圆贴图：主色圆盘。不要太深 —— 头比身体略深一点点，看得出是头又不至于像换了皮肤
    const grad = ctx.createRadialGradient(
      x - hr * 0.28, y - hr * 0.28, hr * 0.15,
      x, y, hr * 1.02,
    );
    grad.addColorStop(0, tintWhite(art.accent, 0.58));
    grad.addColorStop(1, tintWhite(art.accent, 0.14));
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  } else {
    // 资源没配完：退回玩家配色的圆头，别让蛇看起来没头
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, Math.PI * 2);
    ctx.fillStyle = art.fallbackColor;
    ctx.fill();
  }

  // 眼睛：往前（前进方向）0.54R、往中间收 0.38R —— 落在「脸」上而不是边缘
  const ex = Math.cos(angle);
  const ey = Math.sin(angle);
  const px = -ey;
  const py = ex;
  const eyeR = Math.max(1.2, r * 0.27);
  for (const side of [-1, 1]) {
    const cxp = x + ex * r * 0.54 + px * r * 0.38 * side;
    const cyp = y + ey * r * 0.54 + py * r * 0.38 * side;
    ctx.beginPath();
    ctx.arc(cxp, cyp, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,10,18,0.80)';
    ctx.fill();
    // 高光：一点小白点，第一眼就能认出是眼睛
    ctx.beginPath();
    ctx.arc(cxp - eyeR * 0.32, cyp - eyeR * 0.32, eyeR * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fill();
  }
}
