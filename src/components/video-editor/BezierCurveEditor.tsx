import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipTransformBezier } from "./types";

interface BezierCurveEditorProps {
  value: ClipTransformBezier;
  onChange: (curve: ClipTransformBezier) => void;
}

const WIDTH = 148;
const HEIGHT = 92;
const PADDING = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toSvgX = (value: number) => PADDING + clamp(value, 0, 1) * (WIDTH - PADDING * 2);
const toSvgY = (value: number) => HEIGHT - PADDING - clamp(value, 0, 1) * (HEIGHT - PADDING * 2);
const fromSvgX = (value: number) => clamp((value - PADDING) / (WIDTH - PADDING * 2), 0, 1);
const fromSvgY = (value: number) => clamp((HEIGHT - PADDING - value) / (HEIGHT - PADDING * 2), 0, 1);

export function BezierCurveEditor({ value, onChange }: BezierCurveEditorProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragHandleRef = useRef<"p1" | "p2" | null>(null);
  const [dragHandle, setDragHandle] = useState<"p1" | "p2" | null>(null);

  const points = useMemo(() => ({
    p0: { x: PADDING, y: HEIGHT - PADDING },
    p1: { x: toSvgX(value.x1), y: toSvgY(value.y1) },
    p2: { x: toSvgX(value.x2), y: toSvgY(value.y2) },
    p3: { x: WIDTH - PADDING, y: PADDING },
  }), [value.x1, value.x2, value.y1, value.y2]);

  useEffect(() => {
    const updateFromPointer = (clientX: number, clientY: number) => {
      const handle = dragHandleRef.current;
      const svg = svgRef.current;
      if (!handle || !svg) return;

      const rect = svg.getBoundingClientRect();
      const nextX = fromSvgX(clientX - rect.left);
      const nextY = fromSvgY(clientY - rect.top);

      if (handle === "p1") {
        onChange({ ...value, x1: nextX, y1: nextY });
      } else {
        onChange({ ...value, x2: nextX, y2: nextY });
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateFromPointer(event.clientX, event.clientY);
    };

    const handlePointerUp = () => {
      dragHandleRef.current = null;
      setDragHandle(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onChange, value]);

  return (
    <div className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-lg border border-white/10 bg-black/30"
      >
        <path
          d={`M ${PADDING} ${PADDING} L ${PADDING} ${HEIGHT - PADDING} L ${WIDTH - PADDING} ${HEIGHT - PADDING}`}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
        />
        <path
          d={`M ${points.p0.x} ${points.p0.y} C ${points.p1.x} ${points.p1.y}, ${points.p2.x} ${points.p2.y}, ${points.p3.x} ${points.p3.y}`}
          fill="none"
          stroke="#34B27B"
          strokeWidth="2"
        />
        <path
          d={`M ${points.p0.x} ${points.p0.y} L ${points.p1.x} ${points.p1.y}`}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
        />
        <path
          d={`M ${points.p3.x} ${points.p3.y} L ${points.p2.x} ${points.p2.y}`}
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="1"
        />
        {([
          { key: "p1" as const, point: points.p1 },
          { key: "p2" as const, point: points.p2 },
        ]).map(({ key, point }) => (
          <g key={key}>
            <circle
              cx={point.x}
              cy={point.y}
              r={dragHandle === key ? 6 : 5}
              fill="#34B27B"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="1.5"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dragHandleRef.current = key;
                setDragHandle(key);
              }}
            />
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 font-mono">
        <div>P1 {value.x1.toFixed(2)}, {value.y1.toFixed(2)}</div>
        <div>P2 {value.x2.toFixed(2)}, {value.y2.toFixed(2)}</div>
      </div>
    </div>
  );
}
