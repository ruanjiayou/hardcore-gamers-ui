import { useEffect, useRef, useState } from 'react';
import {
  assetAltImage,
  assetHeadImage,
  assetImage,
  assetTailImage,
  loadGameAssets,
} from '../services/assets';
import { bodySegments, partAngle, tailCenter } from '../games/snake/skin';
import type { AssetManifestItem } from '../services/api';

/** 与 Scene2D 同一套比例：锚点间距 1.0×直径，贴图 1.3×直径（重叠 23% 不露缝） */
const SKIN_STEP = 1.0;
const SKIN_SIZE = 1.3;

/**
 * 皮肤预览（GM-snake-39）：按 `skinType` 画一条**迷你蛇**，而不是甩一个方块纹理。
 *
 * 为什么不用 `<img src={item.url}>`：单图皮肤看着是一块花纹，头身/头身尾/交替身体
 * 三种类型在方块缩略图里**长得一模一样**，玩家根本看不出区别。画一条短蛇
 * （头 + 4 节身体 + 尾）才能一眼看出「这个有尾巴」「这个身体是两色交替的」。
 *
 * 画法与对局内 `Scene2D.drawBodySkin` 完全同源（同一个 `skin.ts` 几何）：
 * 单图/头身用 `CanvasPattern` 描边，交替身体沿路径分节贴图，头尾按朝向旋转。
 */
export default function SkinPreview({
  game,
  item,
  width = 58,
  height = 26,
}: {
  game: string;
  item: AssetManifestItem;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // 清单到手时图片可能还在解码：拿不到图就让 effect 再跑一次
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadGameAssets(game).then(() => { if (alive) setTick(v => v + 1); });
    return () => { alive = false; };
  }, [game, item.id]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    drawPreview(canvas, game, item, width, height);
  }, [game, item, width, height, tick]);

  return (
    <canvas
      ref={ref}
      className="settings-skin-swatch"
      style={{ width, height }}
      aria-label={item.label}
    />
  );
}

/** 画一条躺在画布中间的小蛇：头在右、尾在左 */
function drawPreview(
  canvas: HTMLCanvasElement,
  game: string,
  item: AssetManifestItem,
  w: number,
  h: number,
): void {
  if (typeof window === 'undefined') return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const R = h * 0.21;
  const cy = h / 2;
  const headX = w - R * 1.6;
  const tailX = R * 1.6;
  /** pts[0] 是蛇头 → 头在右端，往左走到尾 */
  const pts: [number, number][] = [];
  for (let x = headX; x > tailX; x -= 1.5) pts.push([x, cy]);
  pts.push([tailX, cy]);

  const body = assetImage(game, item.id);
  const alt = assetAltImage(game, item.id);
  const head = assetHeadImage(game, item.id);
  const tail = assetTailImage(game, item.id);

  // 底色描边：有身体图就用它的平铺图案（单图/头身这一类就靠这一步出花纹）
  let stroke: string | CanvasPattern = '#94a3b8';
  if (body) {
    const p = ctx.createPattern(body, 'repeat');
    if (p) stroke = p;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = R * 2;
  ctx.stroke();

  // 交替身体：沿路径分节贴图，从尾向头叠（与对局内一致）
  if (alt) {
    const size = R * 2 * SKIN_SIZE;
    const half = size / 2;
    const segs = bodySegments(pts, R * 2 * SKIN_STEP, 2);
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      const img = s.slot === 0 ? body : alt;
      if (!img) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle + Math.PI / 2);
      ctx.drawImage(img, -half, -half, size, size);
      ctx.restore();
    }
  }

  // 尾巴：内缩一个半径，尖端落在路径末端
  if (tail) {
    const c = tailCenter(pts, R);
    if (c) {
      const d = R * 2.12;
      ctx.save();
      ctx.translate(c[0], c[1]);
      ctx.rotate(partAngle('tail', 0, pts) + Math.PI / 2);
      ctx.drawImage(tail, -d / 2, -d / 2, d, d);
      ctx.restore();
    }
  }

  // 头：圆底（没头图时就是纯色圆）+ 头图
  const d = R * 2.12;
  ctx.beginPath();
  ctx.arc(headX, cy, R * 1.06, 0, Math.PI * 2);
  ctx.fillStyle = typeof stroke === 'string' ? stroke : '#94a3b8';
  ctx.fill();
  if (head) {
    ctx.save();
    ctx.translate(headX, cy);
    ctx.rotate(Math.PI / 2); // 前进方向 = +x
    ctx.drawImage(head, -d / 2, -d / 2, d, d);
    ctx.restore();
  }
}
