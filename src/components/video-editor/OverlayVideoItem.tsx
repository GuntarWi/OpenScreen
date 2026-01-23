import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { cn } from "@/lib/utils";
import type { OverlayVideoRegion } from "./types";

interface OverlayVideoItemProps {
  region: OverlayVideoRegion;
  containerWidth: number;
  containerHeight: number;
  currentTimeMs: number;
  isPlaying: boolean;
  isSelected: boolean;
  parentTransform: string; // Zoom transform applied to parent layer - used to force Rnd remount
  onSelect: (id: string) => void;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
}

const HANDLE_COLOR = "#7c3aed";

const isOverlayDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  const raw = (window as any).__openscreen_debugOverlay;
  return raw !== false && raw !== 'off' && raw !== 0;
};

const formatOverlayDebugPayload = (payload: Record<string, unknown>) => {
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

const logOverlayDebugExpanded = (label: string, payload: Record<string, unknown>) => {
  if (!isOverlayDebugEnabled()) return;
  const formatted = formatOverlayDebugPayload(payload);
  console.log(`${label}\n${formatted}`);
};

export function OverlayVideoItem({
  region,
  containerWidth,
  containerHeight,
  currentTimeMs,
  isPlaying,
  isSelected,
  parentTransform,
  onSelect,
  onPositionChange,
  onSizeChange,
}: OverlayVideoItemProps) {
  const isDraggingRef = useRef(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [mountId, setMountId] = useState(0);
  const wasVisibleRef = useRef(false);

  const x = (region.position.x / 100) * containerWidth;
  const y = (region.position.y / 100) * containerHeight;
  const width = (region.size.width / 100) * containerWidth;
  const height = (region.size.height / 100) * containerHeight;

  const transformKey = parentTransform === 'none' || parentTransform === '' ? 'no-zoom' : 'zoomed';

  logOverlayDebugExpanded('[Overlay Debug][item-render]', {
    id: region.id,
    mountId,
    transformKey,
    posPercent: { x: region.position.x, y: region.position.y },
    containerSize: { w: containerWidth, h: containerHeight },
    calculatedPx: { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) },
  });

  const isActive = currentTimeMs >= region.startMs && currentTimeMs <= region.endMs;
  const isVisible = isActive || isSelected;

  useEffect(() => {
    if (isVisible && !wasVisibleRef.current) {
      setMountId(prev => {
        logOverlayDebugExpanded('[Overlay Debug][visibility-change]', { id: region.id, becameVisible: true, newMountId: prev + 1 });
        return prev + 1;
      });
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, region.id]);

  if (!isVisible) {
    return null;
  }

  const borderRadius = region.borderRadius ?? 0;
  const getParentSize = (_node?: HTMLElement | null) => {
    return { width: containerWidth, height: containerHeight };
  };

  const rndKey = `${region.id}-${containerWidth}-${containerHeight}-${mountId}-${transformKey}`;

  return (
    <Rnd
      key={rndKey}
      position={{ x, y }}
      size={{ width, height }}
      data-overlay-id={region.id}
      data-overlay-asset-id={region.assetId}
      onDragStart={() => {
        isDraggingRef.current = true;
        setIsInteracting(true);
      }}
      onDragStop={(_e, d) => {
        const parentSize = getParentSize(d.node);
        if (parentSize.width <= 0 || parentSize.height <= 0) return;
        const xPercent = (d.x / parentSize.width) * 100;
        const yPercent = (d.y / parentSize.height) * 100;
        onPositionChange(region.id, { x: xPercent, y: yPercent });
        setTimeout(() => {
          isDraggingRef.current = false;
          setIsInteracting(false);
        }, 50);
      }}
      onResizeStart={() => {
        setIsInteracting(true);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        setIsInteracting(false);
        const parentSize = getParentSize(ref);
        if (parentSize.width <= 0 || parentSize.height <= 0) return;
        const xPercent = (position.x / parentSize.width) * 100;
        const yPercent = (position.y / parentSize.height) * 100;
        const widthPercent = (ref.offsetWidth / parentSize.width) * 100;
        const heightPercent = (ref.offsetHeight / parentSize.height) * 100;
        onPositionChange(region.id, { x: xPercent, y: yPercent });
        onSizeChange(region.id, { width: widthPercent, height: heightPercent });
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onSelect(region.id);
      }}
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
