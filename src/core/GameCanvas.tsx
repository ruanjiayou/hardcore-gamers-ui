import React, { useEffect, useRef } from "react";

/**
 * 通用游戏画布容器：只负责提供一个 <canvas> 并在 ready 时回调。
 * 具体渲染由 GameManager 按需加载的游戏模块（2D Canvas 或 Babylon 3D）接管。
 */
export default function GameCanvas({ onReady, ready }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && onReady && ready) {
      onReady(canvasRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
}
