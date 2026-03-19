import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { cn } from "@/lib/utils";
import type { VideoClip } from "./types";
import type { ClipInteractionRect } from "./videoPlayback/clipPixiRenderer";
import type { InteractionRect } from "@/utils/recordingInteractionLayout";

interface ClipVideoItemProps {
  region: VideoClip;
  containerWidth: number;
  containerHeight: number;
  interactionRect: ClipInteractionRect | null;
  currentTimeMs: number;
  isPlaying: boolean;
  isSelected: boolean;
  parentTransform: string; // Zoom transform applied to parent layer - used to force Rnd remount
  onSelect: (id: string) => void;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
  onRectChange?: (id: string, rect: InteractionRect) => void;
}

const HANDLE_COLOR = "#7c3aed";

type ClipDebugWindow = Window & {
  __openscreen_debugClips?: boolean | string | number;
  __openscreen_debugOverlay?: boolean | string | number;
};

const isClipDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  const debugWindow = window as ClipDebugWindow;
  const raw = debugWindow.__openscreen_debugClips ?? debugWindow.__openscreen_debugOverlay;
  return raw !== false && raw !== 'off' && raw !== 0;
};

const formatClipDebugPayload = (payload: Record<string, unknown>) => {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (value instanceof Map) {
        return Object.fromEntries(value);
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    }, 2);
  } catch (error) {
    return `[Unserializable payload: ${String(error)}]`;
  }
};

const logClipDebugExpanded = (label: string, payload: Record<string, unknown>) => {
  if (!isClipDebugEnabled()) return;
  const formatted = formatClipDebugPayload(payload);
  console.log(`${label}\n${formatted}`);
};

export function ClipVideoItem({
  region,
  containerWidth,
  containerHeight,
  interactionRect,
  currentTimeMs,
  isPlaying,
  isSelected,
  parentTransform,
  onSelect,
  onPositionChange,
  onSizeChange,
  onRectChange,
}: ClipVideoItemProps) {
  const isDraggingRef = useRef(false);
  const dragRafRef = useRef<number | null>(null);
  const pendingRectRef = useRef<InteractionRect | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [liveRect, setLiveRect] = useState<InteractionRect | null>(null);
  const [mountId, setMountId] = useState(0);
  const wasVisibleRef = useRef(false);

  const anchor = region.anchor ?? { x: 0, y: 0 };
  const scale = Math.max(0.01, region.scale ?? 1);
  const rotationDeg = region.rotationDeg ?? 0;
  const selectionRect = interactionRect ?? {
    x: (region.position.x / 100) * containerWidth,
    y: (region.position.y / 100) * containerHeight,
    width: (region.size.width / 100) * containerWidth,
    height: (region.size.height / 100) * containerHeight,
  };
  const selectionBaseX = selectionRect.x;
  const selectionBaseY = selectionRect.y;
  const selectionBaseWidth = selectionRect.width;
  const selectionBaseHeight = selectionRect.height;
  const usesRenderedBoundsSelection = Boolean(interactionRect);
  const scaledOffsetX = selectionBaseWidth * anchor.x * (1 - scale);
  const scaledOffsetY = selectionBaseHeight * anchor.y * (1 - scale);
  const displayRect = liveRect ?? {
    x: usesRenderedBoundsSelection ? selectionBaseX : selectionBaseX + scaledOffsetX,
    y: usesRenderedBoundsSelection ? selectionBaseY : selectionBaseY + scaledOffsetY,
    width: usesRenderedBoundsSelection ? selectionBaseWidth : selectionBaseWidth * scale,
    height: usesRenderedBoundsSelection ? selectionBaseHeight : selectionBaseHeight * scale,
  };
  const x = displayRect.x;
  const y = displayRect.y;
  const width = displayRect.width;
  const height = displayRect.height;
  const lockAspectRatio = usesRenderedBoundsSelection && selectionBaseWidth > 0 && selectionBaseHeight > 0
    ? selectionBaseWidth / selectionBaseHeight
    : false;

  const transformKey = parentTransform === 'none' || parentTransform === '' ? 'no-zoom' : 'zoomed';

  logClipDebugExpanded('[Clip Debug][item-render]', {
    id: region.id,
    mountId,
    transformKey,
    posPercent: { x: region.position.x, y: region.position.y },
    scale,
    rotationDeg,
    anchor,
    interactionRect,
    usesRenderedBoundsSelection,
    containerSize: { w: containerWidth, h: containerHeight },
    basePx: { x: Math.round(selectionBaseX), y: Math.round(selectionBaseY), w: Math.round(selectionBaseWidth), h: Math.round(selectionBaseHeight) },
    calculatedPx: { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) },
  });

  const isActive = currentTimeMs >= region.startMs && currentTimeMs <= region.endMs;
  const isVisible = isActive;

  useEffect(() => {
    if (isVisible && !wasVisibleRef.current) {
      setMountId(prev => {
        logClipDebugExpanded('[Clip Debug][visibility-change]', { id: region.id, becameVisible: true, newMountId: prev + 1 });
        return prev + 1;
      });
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, region.id]);

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  const borderRadius = (region.borderRadius ?? 0) * scale;
  const getParentSize = (_node?: Element | null) => {
    void _node;
    return { width: containerWidth, height: containerHeight };
  };

  const emitRectChange = (nextRect: InteractionRect) => {
    if (onRectChange) {
      onRectChange(region.id, nextRect);
      return;
    }
    onPositionChange(region.id, { x: nextRect.x, y: nextRect.y });
    onSizeChange(region.id, { width: nextRect.width, height: nextRect.height });
  };

  const emitDisplayRectChange = (nextDisplayRect: InteractionRect) => {
    const parentSize = getParentSize();
    if (parentSize.width <= 0 || parentSize.height <= 0) return;

    if (usesRenderedBoundsSelection) {
      emitRectChange({
        x: (nextDisplayRect.x / parentSize.width) * 100,
        y: (nextDisplayRect.y / parentSize.height) * 100,
        width: (nextDisplayRect.width / parentSize.width) * 100,
        height: (nextDisplayRect.height / parentSize.height) * 100,
      });
      return;
    }

    const nextBaseWidth = nextDisplayRect.width / scale;
    const nextBaseHeight = nextDisplayRect.height / scale;
    const nextBaseX = nextDisplayRect.x - nextBaseWidth * anchor.x * (1 - scale);
    const nextBaseY = nextDisplayRect.y - nextBaseHeight * anchor.y * (1 - scale);
    emitRectChange({
      x: (nextBaseX / parentSize.width) * 100,
      y: (nextBaseY / parentSize.height) * 100,
      width: (nextBaseWidth / parentSize.width) * 100,
      height: (nextBaseHeight / parentSize.height) * 100,
    });
  };

  const scheduleDisplayRectChange = (nextDisplayRect: InteractionRect) => {
    setLiveRect(nextDisplayRect);
    pendingRectRef.current = nextDisplayRect;
    if (dragRafRef.current !== null) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      const rect = pendingRectRef.current;
      pendingRectRef.current = null;
      if (!rect) return;
      emitDisplayRectChange(rect);
    });
  };

  // Include position/size in key so Rnd remounts when stored values change (e.g. after project load).
  // react-rnd is uncontrolled — it ignores prop changes after mount unless the key forces a remount.
  const posKey = `${Math.round(region.position.x * 100)}-${Math.round(region.position.y * 100)}`;
  const sizeKey = `${Math.round(region.size.width * 100)}-${Math.round(region.size.height * 100)}`;
  const selectionRectKey = [
    Math.round(selectionBaseX * 10),
    Math.round(selectionBaseY * 10),
    Math.round(selectionBaseWidth * 10),
    Math.round(selectionBaseHeight * 10),
  ].join('-');
  const transformStateKey = [
    Math.round(scale * 1000),
    Math.round(rotationDeg * 100),
    Math.round(anchor.x * 1000),
    Math.round(anchor.y * 1000),
  ].join('-');
  const syncKey = isInteracting
    ? 'interacting'
    : `${posKey}-${sizeKey}-${selectionRectKey}`;
  const rndKey = `${region.id}-${containerWidth}-${containerHeight}-${mountId}-${transformKey}-${syncKey}-${transformStateKey}`;

  return (
    <Rnd
      key={rndKey}
      position={{ x, y }}
      size={{ width, height }}
      data-clip-id={region.id}
      data-clip-asset-id={region.assetId}
      onDragStart={() => {
        isDraggingRef.current = true;
        setIsInteracting(true);
        setLiveRect({ x, y, width, height });
      }}
      onDrag={(_e, d) => {
        scheduleDisplayRectChange({
          x: d.x,
          y: d.y,
          width,
          height,
        });
      }}
      onDragStop={(_e, d) => {
        void d.node;
        if (dragRafRef.current !== null) {
          window.cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;
        }
        const nextDisplayRect = {
          x: d.x,
          y: d.y,
          width,
          height,
        };
        pendingRectRef.current = null;
        emitDisplayRectChange(nextDisplayRect);
        setLiveRect(nextDisplayRect);
        setTimeout(() => {
          setLiveRect(null);
          isDraggingRef.current = false;
          setIsInteracting(false);
        }, 50);
      }}
      onResizeStart={() => {
        setIsInteracting(true);
        setLiveRect({ x, y, width, height });
      }}
      onResize={(_e, _direction, ref, _delta, position) => {
        scheduleDisplayRectChange({
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        });
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        if (dragRafRef.current !== null) {
          window.cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;
        }
        const nextDisplayRect = {
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        };
        pendingRectRef.current = null;
        emitDisplayRectChange(nextDisplayRect);
        setLiveRect(nextDisplayRect);
        setTimeout(() => {
          setLiveRect(null);
          setIsInteracting(false);
        }, 50);
      }}
      onMouseUp={() => {
        if (!isDraggingRef.current) {
          setLiveRect(null);
          setIsInteracting(false);
        }
      }}
      onTouchEnd={() => {
        if (!isDraggingRef.current) {
          setLiveRect(null);
          setIsInteracting(false);
        }
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onSelect(region.id);
      }}
      lockAspectRatio={lockAspectRatio}
      disableDragging={!isSelected || isPlaying}
      enableResizing={isSelected && !isPlaying}
      className={cn(
        isSelected ? "cursor-move" : "cursor-pointer"
      )}
      style={{
        zIndex: isSelected ? region.zIndex + 1000 : region.zIndex,
        pointerEvents: isSelected && !isPlaying ? "auto" : "none",
        border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
        boxShadow: isSelected ? `0 0 0 1px ${HANDLE_COLOR}55` : "none",
        backgroundColor: isSelected ? `${HANDLE_COLOR}14` : "transparent",
        borderRadius,
        transformOrigin: `${anchor.x * 100}% ${anchor.y * 100}%`,
        rotate: `${rotationDeg}deg`,
        transition: isInteracting ? "none" : "border 0.15s, box-shadow 0.15s, background-color 0.15s",
      }}
      resizeHandleStyles={{
        topLeft: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          left: "-6px",
          top: "-6px",
          cursor: "nwse-resize",
        },
        topRight: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          right: "-6px",
          top: "-6px",
          cursor: "nesw-resize",
        },
        bottomLeft: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          left: "-6px",
          bottom: "-6px",
          cursor: "nesw-resize",
        },
        bottomRight: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          right: "-6px",
          bottom: "-6px",
          cursor: "nwse-resize",
        },
      }}
    >
      <div className={cn("w-full h-full")} style={{ borderRadius }} />
    </Rnd>
  );
}
