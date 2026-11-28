import { useEffect, useRef, useState } from 'react';
import {
  assetAltImage,
  assetHeadImage,
  assetImage,
  assetTailImage,
  loadGameAssets,
  skinAccent,
  skinIsRound,
  skinTile,
} from '../services/assets';
import {
  TAIL_SPAN,
  bodyBand,
  bodySegments,
  skinCell,
  tailPose,
  trimTail,
} from '../games/snake/skin';
import { drawSnakeHead } from '../games/snake/head';
import type { AssetManifestItem } from '../services/api';

/**
 * 皮肤预览（GM-snake-39 / 40 / 41 / 42）：画一条**组装好的整蛇**，竖直摆放。
 *
 * 为什么不用 `<img src={item.url}>`：身体图只是一张「一节蛇身」的贴图，
 * 单独看就是一块花纹，头身 / 头身尾 / 交替身体三种类型在方块缩略图里**长得一模一样**。
 * 画一条完整的小蛇（头 + N 节身体 + 尾）才能一眼看出「这个有尾巴」「身体是两色交替的」。
 *
 * GM-snake-42：
 * - **头在上、尾在下**竖着放：主页和皮肤卡片都是竖版布局，横着摆会被裁掉两头。
 * - 画法与对局内 `Scene2D.drawBodySkin` 完全同源（同一个 `skin.ts` 几何 + 同一个 `skinCell`），
 *   所以预览看到的大小比例就是进游戏后看到的比例。
 * - 尺寸由 CSS 决定（`ResizeObserver` 量父容器给的框），主页 132×150、列表卡片正方形都能用。
 * - 不铺底色、不描边、也不填透明角：圆贴图四角就是透的，蛇身靠相邻贴图重叠连起来，
 *   所以预览里看到的连不连、多粗，和进游戏后一模一样（`GM-snake-44` 定稿方案：
 *   圆贴图边长 = 身宽、不裁剪；满幅贴图放大 1.5 倍再裁到身宽带）。
 */

/** 预览里默认画几节身体：4 节刚好看出交替身体的两轮轮换 */
const DEFAULT_UNITS = 4;
const PAD = 3;

export default function SkinPreview({
  game,
  item,
  units = DEFAULT_UNITS,
  className = 'skin-preview-canvas',
}: {
  game: string;
  item: AssetManifestItem;
  /** 画几节身体（卡片小就少画两节，蛇能粗一点） */
  units?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // 清单到手时图片可能还在解码：拿不到图就让 effect 再跑一次
  const [tick, setTick] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    loadGameAssets(game).then(() => { if (alive) setTick(v => v + 1); });
    return () => { alive = false; };
  }, [game, item.id]);

  // 画布尺寸跟着容器走（列表是网格自适应列宽，主页是固定框）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox(prev => (
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height }
      ));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || box.w < 6 || box.h < 6) return;
    drawPreview(canvas, game, item, box.w, box.h, units);
  }, [game, item, box, units, tick]);

  return <canvas ref={ref} className={className} aria-label={item.label} />;
}

/** 画一条竖着躺在画布里的小蛇：头在最上、尾在最下，身体固定 `units` 节 */
function drawPreview(
  canvas: HTMLCanvasElement,
  game: string,
  item: AssetManifestItem,
  w: number,
  h: number,
  units: number,
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

  const body = skinTile(assetImage(game, item.id));
  const alt = skinTile(assetAltImage(game, item.id));
  const head = skinTile(assetHeadImage(game, item.id));
  const tail = skinTile(assetTailImage(game, item.id));

  // 半径按框子定：竖着要装下「头 + N 节身体 + 尾」，横着要装下最宽的那节贴图
  const roundBody = skinIsRound(assetImage(game, item.id));
  const tailSpan = tail ? TAIL_SPAN : 1.06;
  const unit = skinCell(1, roundBody);        // 单位半径下的一节
  const widest = Math.max(unit.size, 2.3);    // 头图是 2.3R，比圆贴图宽
  const needV = units * unit.step + tailSpan + 1.06;
  const R = Math.max(2.4, Math.min((h - PAD * 2) / needV, (w - PAD * 2) / widest));
  const cell = skinCell(R, roundBody);
  const cx = w / 2;
  const headY = PAD + R * 1.06;
  const tailY = h - PAD;

  /** pts[0] 是蛇头（最上）→ 往下走到尾 */
  const pts: [number, number][] = [];
  for (let y = headY; y < tailY; y += 1.5) pts.push([cx, y]);
  pts.push([cx, tailY]);

  // 身体：有尾图时先截掉尾段（那一段只有尾图）
  const bodyPts = tail ? trimTail(pts, TAIL_SPAN * R) : pts;
  if (bodyPts.length >= 2 && body) {
    const segs = bodySegments(bodyPts, cell.step, alt ? 2 : 1, R * 1.2);
    // 满幅贴图才需要裁到身宽带：圆贴图的四角本来就是透明的
    let draw = true; // 带子退化（路径太短）时整段不画，免得画一条没有轮廓的贴图串
    if (cell.clip) {
      const band = bodyBand(bodyPts, R);
      if (band.length < 3) draw = false;
      else {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(band[0][0], band[0][1]);
        for (let i = 1; i < band.length; i++) ctx.lineTo(band[i][0], band[i][1]);
        ctx.closePath();
        ctx.clip();
      }
    }
    if (draw) {
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        const img = s.slot === 0 ? body : alt;
        if (!img) continue;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle + Math.PI / 2);
        ctx.drawImage(img, -cell.size / 2, -cell.size / 2, cell.size, cell.size);
        ctx.restore();
      }
    }
    if (cell.clip && draw) ctx.restore();
  }

  // 尾巴：与对局**同一个姿态函数**（`tailPose`，GM-snake-48）——
  // 旋转中心在关节（身体截断点）而不是图心，接缝不会错开；竖直走时角度算出来 ≈0，
  // 「图像上方对准前进方向」的约定自然成立，不用像以前那样只靠「正好没转」。
  if (tail) {
    const pose = tailPose(pts, R, TAIL_SPAN * R);
    if (pose) {
      const d = R * 2.3;
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.angle + Math.PI / 2);
      ctx.drawImage(tail, -d / 2, pose.offset - d / 2, d, d);
      ctx.restore();
    }
  }

  // 蛇头：与对局**同一个函数**（GM-snake-46）。
  // `angle` 是**前进方向**：预览里蛇头在**上**、身体在**下**，所以前进方向是 `-π/2`（屏幕向上）。
  // 之前传的是 `+π/2`（canvas 里 +y 向下 = 朝身体），眼睛就全跑到头的下缘、脸朝身体，
  // 看起来「反了」；头图皮肤还会被旋转 180° 倒过来（GM-snake-47）。
  const bodyImg = assetImage(game, item.id);
  drawSnakeHead(ctx, cx, headY, -Math.PI / 2, {
    head,
    body,
    roundBody,
    spriteSize: cell.size,
    radius: R,
    accent: skinAccent(bodyImg),
    fallbackColor: '#4ade80',
  });
}
