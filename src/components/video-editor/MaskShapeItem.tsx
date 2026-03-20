import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { cn } from "@/lib/utils";
import type { MaskItem, MaskPathPoint } from "./types";
import type { InteractionRect } from "@/utils/recordingInteractionLayout";
import {
  getActiveMaskPath,
  getRenderableMaskPathsAtTime,
  getMaskPathBounds,
  getMaskPaths,
  resolveMaskPathsAtTime,
} from "@/utils/maskPathKeyframes";

interface MaskShapeItemProps {
  mask: MaskItem;
  containerWidth: number;
  containerHeight: number;
  currentTimeMs: number;
  isPlaying: boolean;
  isSelected: boolean;
  targetClipVisible: boolean;
  onSelect: (id: string) => void;
  onRectChange: (id: string, rect: InteractionRect) => void;
  onChange?: (id: string, patch: Partial<MaskItem>) => void;
}

type PixelPoint = {
  id: string;
  x: number;
  y: number;
  inX: number;
  inY: number;
  outX: number;
  outY: number;
};

type BoxSelection = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

type DragTarget =
  | { type: "anchor"; pointId: string }
  | { type: "in"; pointId: string }
  | { type: "out"; pointId: string }
  | { type: "whole" };

const HANDLE_COLOR = "#14b8a6";
const INACTIVE_COLOR = "rgba(148, 163, 184, 0.7)";

const toPixelPoint = (point: MaskPathPoint, width: number, height: number): PixelPoint => ({
  id: point.id,
  x: (point.x / 100) * width,
  y: (point.y / 100) * height,
  inX: (point.inX / 100) * width,
  inY: (point.inY / 100) * height,
  outX: (point.outX / 100) * width,
  outY: (point.outY / 100) * height,
});

const toPercentPoint = (point: PixelPoint, width: number, height: number): MaskPathPoint => ({
  id: point.id,
  x: (point.x / width) * 100,
  y: (point.y / height) * 100,
  inX: (point.inX / width) * 100,
  inY: (point.inY / height) * 100,
  outX: (point.outX / width) * 100,
  outY: (point.outY / height) * 100,
});

const buildPathSvg = (points: PixelPoint[]) => {
  if (points.length < 2) {
    return "";
  }

  const [first, ...rest] = points;
  const segments = rest.map((point, index) => {
    const previous = points[index];
    return `C ${previous.outX} ${previous.outY}, ${point.inX} ${point.inY}, ${point.x} ${point.y}`;
  });
  const last = points[points.length - 1];
  segments.push(`C ${last.outX} ${last.outY}, ${first.inX} ${first.inY}, ${first.x} ${first.y}`);
  return `M ${first.x} ${first.y} ${segments.join(" ")} Z`;
};

const buildShapePath = (
  shape: MaskItem["shape"],
  position: { x: number; y: number },
  size: { width: number; height: number },
  points: PixelPoint[],
  width: number,
  height: number,
) => {
  if (shape === "path") {
    return buildPathSvg(points);
  }

  const x = (position.x / 100) * width;
  const y = (position.y / 100) * height;
  const rectWidth = (size.width / 100) * width;
  const rectHeight = (size.height / 100) * height;

  if (shape === "ellipse") {
    const rx = rectWidth / 2;
    const ry = rectHeight / 2;
    const cx = x + rx;
    const cy = y + ry;
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }

  return `M ${x} ${y} H ${x + rectWidth} V ${y + rectHeight} H ${x} Z`;
};

const sampleCubic = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) => {
  const oneMinusT = 1 - t;
  return {
    x:
      oneMinusT * oneMinusT * oneMinusT * p0.x +
      3 * oneMinusT * oneMinusT * t * p1.x +
      3 * oneMinusT * t * t * p2.x +
      t * t * t * p3.x,
    y:
      oneMinusT * oneMinusT * oneMinusT * p0.y +
      3 * oneMinusT * oneMinusT * t * p1.y +
      3 * oneMinusT * t * t * p2.y +
      t * t * t * p3.y,
  };
};

const findClosestSegmentIndex = (points: PixelPoint[], x: number, y: number) => {
  if (points.length < 2) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    for (let sampleIndex = 0; sampleIndex <= 24; sampleIndex += 1) {
      const t = sampleIndex / 24;
      const sample = sampleCubic(
        { x: current.x, y: current.y },
        { x: current.outX, y: current.outY },
        { x: next.inX, y: next.inY },
        { x: next.x, y: next.y },
        t,
      );
      const dx = sample.x - x;
      const dy = sample.y - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  return bestIndex;
};

export function MaskShapeItem({
  mask,
  containerWidth,
  containerHeight,
  currentTimeMs,
  isPlaying,
  isSelected,
  targetClipVisible,
  onSelect,
  onRectChange,
  onChange,
}: MaskShapeItemProps) {
  const isDraggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [primaryPointId, setPrimaryPointId] = useState<string | null>(null);
  const [selectedPointIds, setSelectedPointIds] = useState<string[]>([]);
  const [boxSelection, setBoxSelection] = useState<BoxSelection | null>(null);
  const isVisible = targetClipVisible && currentTimeMs >= mask.startMs && currentTimeMs <= mask.endMs;
  const isShapeEditable = (mask.matteMode ?? "shape") === "shape";
  const activePathId = mask.activePathId ?? getActiveMaskPath(mask).id;

  const resolvedPaths = useMemo(
    () => resolveMaskPathsAtTime(mask, currentTimeMs),
    [currentTimeMs, mask],
  );
  const renderablePathIds = useMemo(() => (
    new Set(getRenderableMaskPathsAtTime(mask, currentTimeMs).map((path) => path.id))
  ), [currentTimeMs, mask]);
  const activePath = resolvedPaths.find((path) => path.id === activePathId) ?? resolvedPaths[0] ?? null;
  const activePixelPoints = useMemo(
    () => (activePath?.pathPoints ?? []).map((point) => toPixelPoint(point, containerWidth, containerHeight)),
    [activePath, containerHeight, containerWidth],
  );

  useEffect(() => {
    const pointIds = new Set((activePath?.pathPoints ?? []).map((point) => point.id));
    setSelectedPointIds((prev) => {
      const next = prev.filter((id) => pointIds.has(id));
      if (!next.length && activePath?.pathPoints?.length) {
        return [activePath.pathPoints[0].id];
      }
      return next;
    });

    if (!primaryPointId || !pointIds.has(primaryPointId)) {
      setPrimaryPointId(activePath?.pathPoints?.[0]?.id ?? null);
    }
  }, [activePath, primaryPointId]);

  const updatePaths = useCallback((updater: (paths: ReturnType<typeof getMaskPaths>) => ReturnType<typeof getMaskPaths>, nextActivePathId?: string) => {
    if (!onChange) {
      return;
    }
    const nextPaths = updater(getMaskPaths(mask));
    onChange(mask.id, {
      paths: nextPaths,
      activePathId: nextActivePathId ?? activePathId ?? nextPaths[0]?.id,
    });
  }, [activePathId, mask, onChange]);

  const emitPathPointsChange = useCallback((nextPixelPoints: PixelPoint[]) => {
    if (!containerWidth || !containerHeight || !onChange || !activePath) {
      return;
    }

    const nextPathPoints = nextPixelPoints.map((point) => toPercentPoint(point, containerWidth, containerHeight));
    const bounds = getMaskPathBounds(nextPathPoints);

    updatePaths((paths) => paths.map((path) => (
      path.id === activePath.id
        ? {
            ...path,
            pathPoints: nextPathPoints,
            position: bounds?.position ?? path.position,
            size: bounds?.size ?? path.size,
          }
        : path
    )));
  }, [activePath, containerHeight, containerWidth, onChange, updatePaths]);

  const selectPath = useCallback((pathId: string) => {
    onSelect(mask.id);
    onChange?.(mask.id, { activePathId: pathId });
  }, [mask.id, onChange, onSelect]);

  const startPathDrag = useCallback((event: React.PointerEvent, target: DragTarget, points: PixelPoint[]) => {
    if (!isSelected || isPlaying || !onChange || !activePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect(mask.id);

    if (target.type !== "whole") {
      const append = event.metaKey || event.ctrlKey || event.shiftKey;
      setPrimaryPointId(target.pointId);
      setSelectedPointIds((prev) => {
        if (append) {
          return prev.includes(target.pointId)
            ? prev.filter((id) => id !== target.pointId)
            : [...prev, target.pointId];
        }
        return prev.includes(target.pointId) ? prev : [target.pointId];
      });
    }

    const selectedIds = target.type === "anchor"
      ? (selectedPointIds.includes(target.pointId) ? selectedPointIds : [target.pointId])
      : [];
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const basePoints = points.map((point) => ({ ...point }));

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      isDraggingRef.current = true;

      const nextPoints = basePoints.map((point) => {
        if (target.type === "whole") {
          return {
            ...point,
            x: point.x + deltaX,
            y: point.y + deltaY,
            inX: point.inX + deltaX,
            inY: point.inY + deltaY,
            outX: point.outX + deltaX,
            outY: point.outY + deltaY,
          };
        }

        if (target.type === "anchor") {
          if (!selectedIds.includes(point.id)) {
            return point;
          }
          return {
            ...point,
            x: point.x + deltaX,
            y: point.y + deltaY,
            inX: point.inX + deltaX,
            inY: point.inY + deltaY,
            outX: point.outX + deltaX,
            outY: point.outY + deltaY,
          };
        }

        if (point.id !== target.pointId) {
          return point;
        }

        if (target.type === "in") {
          return {
            ...point,
            inX: point.inX + deltaX,
            inY: point.inY + deltaY,
          };
        }

        return {
          ...point,
          outX: point.outX + deltaX,
          outY: point.outY + deltaY,
        };
      });

      emitPathPointsChange(nextPoints);
    };

    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      window.setTimeout(() => {
        isDraggingRef.current = false;
      }, 40);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }, [activePath, emitPathPointsChange, isPlaying, isSelected, mask.id, onChange, onSelect, selectedPointIds]);

  const beginBoxSelection = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!activePath || activePath.shape !== "path" || event.button !== 0 || isPlaying || !isSelected) {
      return;
    }
    if (event.target !== event.currentTarget) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    svgRef.current = event.currentTarget;
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    setBoxSelection({ startX, startY, endX: startX, endY: startY });
    event.preventDefault();
    event.stopPropagation();
  }, [activePath, isPlaying, isSelected]);

  useEffect(() => {
    if (!boxSelection || !activePath || activePath.shape !== "path") {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setBoxSelection((current) => (
        current
          ? { ...current, endX: event.clientX - rect.left, endY: event.clientY - rect.top }
          : current
      ));
    };

    const handlePointerUp = () => {
      setBoxSelection((current) => {
        if (!current) return null;
        const rect = {
          minX: Math.min(current.startX, current.endX),
          maxX: Math.max(current.startX, current.endX),
          minY: Math.min(current.startY, current.endY),
          maxY: Math.max(current.startY, current.endY),
        };
        const nextSelected = activePixelPoints
          .filter((point) => point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY)
          .map((point) => point.id);
        if (nextSelected.length) {
          setSelectedPointIds(nextSelected);
          setPrimaryPointId(nextSelected[0]);
        }
        return null;
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activePath, activePixelPoints, boxSelection]);

  if (!isVisible || !isShapeEditable || !activePath) {
    return null;
  }

  const activeShapePath = buildShapePath(
    activePath.shape,
    activePath.position,
    activePath.size,
    activePixelPoints,
    containerWidth,
    containerHeight,
  );

  const inactiveShapes = resolvedPaths.filter((path) => path.id !== activePath.id);
  const activePathRenderable = renderablePathIds.has(activePath.id);

  return (
    <div
      className="absolute inset-0"
      style={{ zIndex: 2500, pointerEvents: !isPlaying ? "auto" : "none" }}
      onClick={(event) => {
        event.stopPropagation();
        if (!isDraggingRef.current) {
          onSelect(mask.id);
        }
      }}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        width={containerWidth}
        height={containerHeight}
        onPointerDown={beginBoxSelection}
      >
        {inactiveShapes.map((path, index) => {
          const isRenderable = renderablePathIds.has(path.id);
          const pathD = buildShapePath(
            path.shape,
            path.position,
            path.size,
            (path.pathPoints ?? []).map((point) => toPixelPoint(point, containerWidth, containerHeight)),
            containerWidth,
            containerHeight,
          );
          return pathD ? (
            <path
              key={path.id}
              d={pathD}
              fill={isRenderable ? "rgba(148, 163, 184, 0.08)" : "rgba(71, 85, 105, 0.03)"}
              stroke={isRenderable ? INACTIVE_COLOR : "rgba(71, 85, 105, 0.55)"}
              strokeWidth={1.5}
              strokeDasharray={!isRenderable ? "4 4" : index % 2 === 0 ? "6 4" : undefined}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectPath(path.id);
              }}
            />
          ) : null;
        })}

        {activePath.shape === "path" && activeShapePath ? (
          <path
            d={activeShapePath}
            fill={activePathRenderable ? `${HANDLE_COLOR}18` : "rgba(71, 85, 105, 0.08)"}
            stroke={HANDLE_COLOR}
            strokeWidth={2}
            strokeOpacity={activePathRenderable ? 1 : 0.65}
            strokeDasharray={!activePathRenderable ? "4 4" : activePath.mode === "subtract" || activePath.invert ? "8 6" : undefined}
            onPointerDown={(event) => startPathDrag(event, { type: "whole" }, activePixelPoints)}
            onDoubleClick={(event) => {
              if (!isSelected || isPlaying || !onChange) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const svgRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              if (!svgRect) return;
              const x = event.clientX - svgRect.left;
              const y = event.clientY - svgRect.top;
              const segmentIndex = findClosestSegmentIndex(activePixelPoints, x, y);
              const nextPoint: PixelPoint = {
                id: `mask-point-${Math.random().toString(36).slice(2, 8)}`,
                x,
                y,
                inX: x,
                inY: y,
                outX: x,
                outY: y,
              };
              const nextPoints = [...activePixelPoints];
              nextPoints.splice(segmentIndex + 1, 0, nextPoint);
              emitPathPointsChange(nextPoints);
              setPrimaryPointId(nextPoint.id);
              setSelectedPointIds([nextPoint.id]);
            }}
          />
        ) : null}

        {activePath.shape === "path" ? activePixelPoints.map((point) => {
          const isPointSelected = selectedPointIds.includes(point.id);
          const isPrimary = point.id === primaryPointId;
          return (
            <g key={point.id}>
              {isPrimary ? (
                <>
                  <line x1={point.x} y1={point.y} x2={point.inX} y2={point.inY} stroke={`${HANDLE_COLOR}88`} strokeWidth={1.5} />
                  <line x1={point.x} y1={point.y} x2={point.outX} y2={point.outY} stroke={`${HANDLE_COLOR}88`} strokeWidth={1.5} />
                  <circle
                    cx={point.inX}
                    cy={point.inY}
                    r={4}
                    fill="#ffffff"
                    stroke={HANDLE_COLOR}
                    strokeWidth={2}
                    onPointerDown={(event) => startPathDrag(event, { type: "in", pointId: point.id }, activePixelPoints)}
                  />
                  <circle
                    cx={point.outX}
                    cy={point.outY}
                    r={4}
                    fill="#ffffff"
                    stroke={HANDLE_COLOR}
                    strokeWidth={2}
                    onPointerDown={(event) => startPathDrag(event, { type: "out", pointId: point.id }, activePixelPoints)}
                  />
                </>
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r={isPrimary ? 6 : isPointSelected ? 5.5 : 5}
                fill="#ffffff"
                stroke={HANDLE_COLOR}
                strokeWidth={2}
                onPointerDown={(event) => startPathDrag(event, { type: "anchor", pointId: point.id }, activePixelPoints)}
                onDoubleClick={(event) => {
                  if (!isSelected || isPlaying || activePixelPoints.length <= 3) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  const nextPoints = activePixelPoints.filter((candidate) => candidate.id !== point.id);
                  emitPathPointsChange(nextPoints);
                  const nextSelection = selectedPointIds.filter((id) => id !== point.id);
                  setSelectedPointIds(nextSelection);
                  setPrimaryPointId(nextSelection[0] ?? null);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  const append = event.metaKey || event.ctrlKey || event.shiftKey;
                  onSelect(mask.id);
                  setPrimaryPointId(point.id);
                  setSelectedPointIds((prev) => {
                    if (append) {
                      return prev.includes(point.id)
                        ? prev.filter((id) => id !== point.id)
                        : [...prev, point.id];
                    }
                    return [point.id];
                  });
                }}
              />
            </g>
          );
        }) : null}

        {boxSelection ? (
          <rect
            x={Math.min(boxSelection.startX, boxSelection.endX)}
            y={Math.min(boxSelection.startY, boxSelection.endY)}
            width={Math.abs(boxSelection.endX - boxSelection.startX)}
            height={Math.abs(boxSelection.endY - boxSelection.startY)}
            fill="rgba(20, 184, 166, 0.12)"
            stroke={HANDLE_COLOR}
            strokeDasharray="6 4"
          />
        ) : null}
      </svg>

      {activePath.shape !== "path" ? (() => {
        const x = (activePath.position.x / 100) * containerWidth;
        const y = (activePath.position.y / 100) * containerHeight;
        const width = (activePath.size.width / 100) * containerWidth;
        const height = (activePath.size.height / 100) * containerHeight;

        const emitRectChange = (nextRect: { x: number; y: number; width: number; height: number }) => {
          if (containerWidth <= 0 || containerHeight <= 0) {
            return;
          }
          onRectChange(mask.id, {
            x: (nextRect.x / containerWidth) * 100,
            y: (nextRect.y / containerHeight) * 100,
            width: (nextRect.width / containerWidth) * 100,
            height: (nextRect.height / containerHeight) * 100,
          });
        };

        return (
          <Rnd
            key={`${mask.id}-${activePath.id}-${Math.round(x)}-${Math.round(y)}-${Math.round(width)}-${Math.round(height)}`}
            position={{ x, y }}
            size={{ width, height }}
            disableDragging={!isSelected || isPlaying}
            enableResizing={isSelected && !isPlaying}
            onClick={() => {
              if (isDraggingRef.current) return;
              onSelect(mask.id);
            }}
            onDragStart={() => {
              isDraggingRef.current = true;
            }}
            onDragStop={(_event, data) => {
              emitRectChange({ x: data.x, y: data.y, width, height });
              window.setTimeout(() => {
                isDraggingRef.current = false;
              }, 40);
            }}
            onResizeStop={(_event, _direction, ref, _delta, position) => {
              emitRectChange({
                x: position.x,
                y: position.y,
                width: ref.offsetWidth,
                height: ref.offsetHeight,
              });
            }}
            className={cn(isSelected ? "cursor-move" : "cursor-pointer")}
            style={{
              zIndex: 2501,
              pointerEvents: !isPlaying ? "auto" : "none",
              border: `2px ${mask.mode === "subtract" || mask.invert ? "dashed" : "solid"} ${HANDLE_COLOR}`,
              boxShadow: isSelected ? `0 0 0 1px ${HANDLE_COLOR}55` : "none",
              backgroundColor: `${HANDLE_COLOR}18`,
              borderRadius: activePath.shape === "ellipse" ? "9999px" : 12,
            }}
            resizeHandleStyles={{
              topLeft: {
                width: "12px",
                height: "12px",
                backgroundColor: "white",
                border: `2px solid ${HANDLE_COLOR}`,
                borderRadius: "50%",
                left: "-6px",
                top: "-6px",
              },
              topRight: {
                width: "12px",
                height: "12px",
                backgroundColor: "white",
                border: `2px solid ${HANDLE_COLOR}`,
                borderRadius: "50%",
                right: "-6px",
                top: "-6px",
              },
              bottomLeft: {
                width: "12px",
                height: "12px",
                backgroundColor: "white",
                border: `2px solid ${HANDLE_COLOR}`,
                borderRadius: "50%",
                left: "-6px",
                bottom: "-6px",
              },
              bottomRight: {
                width: "12px",
                height: "12px",
                backgroundColor: "white",
                border: `2px solid ${HANDLE_COLOR}`,
                borderRadius: "50%",
                right: "-6px",
                bottom: "-6px",
              },
            }}
          >
            <div className="h-full w-full" style={{ borderRadius: activePath.shape === "ellipse" ? "9999px" : 12 }} />
          </Rnd>
        );
      })() : null}
    </div>
  );
}
