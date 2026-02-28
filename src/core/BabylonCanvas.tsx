import React, { useEffect, useRef, Fragment } from "react";

export default function BabylonCanvas({ onReady }: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && onReady) {
      onReady(canvasRef.current);
    }
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
}