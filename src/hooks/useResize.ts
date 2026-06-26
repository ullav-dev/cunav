"use client";

import { useState, useCallback, useRef } from "react";

interface UseResizeOptions {
  initial: number;
  min: number;
  max: number;
  axis: "x" | "y";
  reverse?: boolean;
}

export function useResize({ initial, min, max, axis, reverse = false }: UseResizeOptions) {
  const [size, setSize] = useState(initial);
  const sizeRef = useRef(initial);
  sizeRef.current = size;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = axis === "x" ? e.clientX : e.clientY;
    const startSize = sizeRef.current;

    function onMove(ev: MouseEvent) {
      const delta = (axis === "x" ? ev.clientX : ev.clientY) - startPos;
      const next = Math.min(max, Math.max(min, startSize + (reverse ? -delta : delta)));
      setSize(next);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [axis, min, max, reverse]);

  return { size, onMouseDown };
}
