import React, { useEffect, useRef, Fragment } from "react";

export default function BabylonCanvas({ onReady, ready }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && onReady && ready) {
      onReady(canvasRef.current);
    }
  }, [ready]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}