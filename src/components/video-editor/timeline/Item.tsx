import { useItem } from "dnd-timeline";
import type { Span } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { ZoomIn, Scissors, MessageSquare, MousePointer2, Sparkles, Clapperboard, AudioLines, Gauge } from "lucide-react";
import glassStyles from "./ItemGlass.module.css";
import { clamp01 } from "../videoPlayback/mathUtils";

interface ItemProps {
  id: string;
  span: Span;
  rowId: string;
  children: React.ReactNode;
  trackHeight?: number;
  isSelected?: boolean;
  onSelect?: () => void;
  zoomDepth?: number;
  variant?: 'zoom' | 'trim' | 'annotation' | 'cursor' | 'effect' | 'clip' | 'audio' | 'speed';
  annotationType?: 'text' | 'image' | 'figure' | 'emoji';
  speedValue?: number;
}

const ZOOM_LABELS: Record<number, string> = {
  1: "1.25×",
  2: "1.5×",
  3: "1.8×",
  4: "2.2×",
  5: "3.5×",
  6: "5×",
};

function getSpeedRampSvg(speedValue: number | undefined) {
  const startY = 26;
  const peakBaseY = 10;
  const troughBaseY = 31;
  const normalizedFast = clamp01(((speedValue ?? 1) - 1) / 3);
  const normalizedSlow = clamp01((1 - (speedValue ?? 1)) / 0.9);
  const middleY = speedValue != null && speedValue < 1
    ? startY + (troughBaseY - startY) * normalizedSlow
    : startY - (startY - peakBaseY) * normalizedFast;

  return `M 0 ${startY} C 18 ${startY}, 32 ${middleY}, 50 ${middleY} C 68 ${middleY}, 82 ${startY}, 100 ${startY}`;
}

export default function Item({ 
  id, 
  span, 
  rowId, 
  isSelected = false, 
  trackHeight = 48,
  onSelect, 
  zoomDepth = 1,
  variant = 'zoom',
  children,
  annotationType,
  speedValue,
}: ItemProps) {
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id,
    span,
    data: { rowId },
  });

  const isZoom = variant === 'zoom';
  const isTrim = variant === 'trim';
  const isClip = variant === 'clip';
  const isCursor = variant === 'cursor';
  const isEffect = variant === 'effect';
  const isAudio = variant === 'audio';
  const isSpeed = variant === 'speed';
  
  const glassClass = isZoom 
    ? glassStyles.glassGreen 
    : isTrim 
    ? glassStyles.glassRed 
    : isClip
    ? glassStyles.glassPurple
    : isCursor
    ? glassStyles.glassBlue
    : isEffect
    ? glassStyles.glassPink
    : isAudio
    ? glassStyles.glassBlue
    : isSpeed
    ? glassStyles.glassYellow
    : glassStyles.glassYellow;
    
  const endCapColor = isZoom 
    ? '#21916A' 
    : isTrim 
    ? '#ef4444' 
    : isClip
    ? '#7c3aed'
    : isCursor
    ? '#4C8BF5'
    : isEffect
    ? '#EC4899'
    : isAudio
    ? '#0ea5e9'
    : isSpeed
    ? '#F59E0B'
    : '#B4A046';

  const itemHeight = Math.max(32, trackHeight - 2);

  return (
    <div
      ref={setNodeRef}
      style={{ ...itemStyle, height: itemHeight }}
      {...listeners}
      {...attributes}
      onPointerDownCapture={() => onSelect?.()}
      onClick={(event) => event.stopPropagation()}
      onDragOver={(event) => {
        if (!isClip) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      className="group"
    >
      <div style={{ ...itemContentStyle, height: itemHeight }}>
        <div
          className={cn(
            glassClass,
            "w-full h-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
            isSelected && glassStyles.selected
          )}
          style={{ height: itemHeight, color: '#fff' }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.();
          }}
        >
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.left)}
            style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
            title="Resize left"
          />
          <div
            className={cn(glassStyles.zoomEndCap, glassStyles.right)}
            style={{ cursor: 'col-resize', pointerEvents: 'auto', width: 8, opacity: 0.9, background: endCapColor }}
            title="Resize right"
          />
          {isSpeed ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-1 h-8 z-0">
              <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-full w-full">
                <path
                  fill="none"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={getSpeedRampSvg(speedValue)}
                />
                <circle cx="0" cy="26" r="1.9" fill="#ffffff" />
                <circle cx="50" cy={speedValue != null && speedValue < 1 ? 31 - (31 - 26) * clamp01((1 - speedValue) / 0.9) : 26 - (26 - 10) * clamp01(((speedValue ?? 1) - 1) / 3)} r="2.2" fill="#ffffff" />
                <circle cx="100" cy="26" r="1.9" fill="#ffffff" />
              </svg>
            </div>
          ) : null}
          {/* Content */}
          <div className={cn(
            "relative z-20 flex items-center gap-1.5 text-white/90 opacity-80 group-hover:opacity-100 transition-opacity select-none",
            isSpeed ? "pb-7" : "",
          )}>
            {isZoom ? (
              <>
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
                </span>
              </>
            ) : isTrim ? (
              <>
                <Scissors className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  Trim
                </span>
              </>
            ) : isClip ? (
              <>
                <Clapperboard className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            ) : isAudio ? (
              <>
                <AudioLines className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            ) : isCursor ? (
              <>
                <MousePointer2 className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  Cursor
                </span>
              </>
            ) : isEffect ? (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            ) : isSpeed ? (
              <>
                <Gauge className="w-3.5 h-3.5" />
                <span className="text-[11px] font-semibold tracking-tight">
                  {speedValue != null ? `1× → ${speedValue.toFixed(2)}× → 1×` : 'Speed'}
                </span>
              </>
            ) : (
              <>
                {annotationType === 'emoji' ? (
                  <Sparkles className="w-3.5 h-3.5" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5" />
                )}
                <span className="text-[11px] font-semibold tracking-tight">
                  {children}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
