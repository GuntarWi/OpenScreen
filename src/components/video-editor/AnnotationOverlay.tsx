import { useRef } from "react";
import { Rnd } from "react-rnd";
import type { AnnotationRegion } from "./types";
import { cn } from "@/lib/utils";
import { getArrowComponent } from "./ArrowSvgs";

interface AnnotationOverlayProps {
  annotation: AnnotationRegion;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
  onClick: (id: string) => void;
  zIndex: number;
  isSelectedBoost: boolean; // Boost z-index when selected for easy editing
  renderContent?: boolean;
  ghostOpacity?: number;
  currentTimeMs: number;
}

export function AnnotationContentView({ annotation }: { annotation: AnnotationRegion }) {
  const renderArrow = () => {
    const direction = annotation.figureData?.arrowDirection || 'right';
    const color = annotation.figureData?.color || '#34B27B';
    const strokeWidth = annotation.figureData?.strokeWidth || 4;

    const ArrowComponent = getArrowComponent(direction);
    return <ArrowComponent color={color} strokeWidth={strokeWidth} />;
  };

  switch (annotation.type) {
    case 'text':
      return (
        <div
          className="w-full h-full flex items-center p-2 overflow-hidden"
          style={{
            justifyContent: annotation.style.textAlign === 'left' ? 'flex-start' : 
                          annotation.style.textAlign === 'right' ? 'flex-end' : 'center',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              color: annotation.style.color,
              backgroundColor: annotation.style.backgroundColor,
              fontSize: `${annotation.style.fontSize}px`,
              fontFamily: annotation.style.fontFamily,
              fontWeight: annotation.style.fontWeight,
              fontStyle: annotation.style.fontStyle,
              textDecoration: annotation.style.textDecoration,
              textAlign: annotation.style.textAlign,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              boxDecorationBreak: 'clone',
              WebkitBoxDecorationBreak: 'clone',
              padding: '0.1em 0.2em',
              borderRadius: '4px',
              lineHeight: '1.4',
            }}
          >
            {annotation.content}
          </span>
        </div>
      );

    case 'image':
      if (annotation.content) {
        return (
          <img
            src={annotation.content}
            alt="Annotation"
            className="w-full h-full object-contain"
            draggable={false}
          />
        );
      }
      return (
        <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
          No image
        </div>
      );

    case 'emoji':
      if (annotation.content) {
        return (
          <img
            src={annotation.content}
            alt={annotation.emojiAlt || "Emoji"}
            className="w-full h-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.25)]"
            draggable={false}
          />
        );
      }
      return (
        <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
          No emoji selected
        </div>
      );

    case 'figure':
      if (!annotation.figureData) {
        return (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
            No arrow data
          </div>
        );
      }

      return (
        <div className="w-full h-full flex items-center justify-center p-2">
          {renderArrow()}
        </div>
      );

    default:
      return null;
  }
}

function computeEffectState(annotation: AnnotationRegion, currentTimeMs: number, isSelected: boolean) {
  const fadeInMs = annotation.fadeInMs ?? 240;
  const fadeOutMs = annotation.fadeOutMs ?? 240;
  const enterEffect = annotation.enterEffect || 'none';
  const exitEffect = annotation.exitEffect || 'none';

  const start = annotation.startMs ?? 0;
  const end = annotation.endMs ?? 0;

  const isActive = currentTimeMs >= start && currentTimeMs <= end;
  const isWithin = isActive || isSelected;

  if (!isWithin) {
    return { opacity: 0, scale: 1 };
  }

  const progressIn = Math.max(0, Math.min(1, fadeInMs > 0 ? (currentTimeMs - start) / fadeInMs : 1));
  const progressOut = Math.max(0, Math.min(1, fadeOutMs > 0 ? (end - currentTimeMs) / fadeOutMs : 1));

  let opacity = 1;
  let scale = 1;

  const enterAlpha = enterEffect === 'fade' || enterEffect === 'pop' ? progressIn : 1;
  const exitAlpha = exitEffect === 'fade' || exitEffect === 'pop' ? progressOut : 1;
  opacity = Math.max(0, Math.min(1, enterAlpha * exitAlpha));

  if (enterEffect === 'pop') {
    const popScale = 0.82 + 0.18 * progressIn;
    scale *= popScale;
  }
  if (exitEffect === 'pop') {
    const tailScale = 0.9 + 0.1 * progressOut;
    scale *= tailScale;
  }

  if (isSelected && !isActive) {
    opacity = Math.min(opacity, 0.35);
    scale = 1;
  }

  return { opacity, scale };
}

export function AnnotationOverlay({
  annotation,
  isSelected,
  containerWidth,
  containerHeight,
  onPositionChange,
  onSizeChange,
  onClick,
  zIndex,
  isSelectedBoost,
  renderContent = true,
  ghostOpacity = 1,
  currentTimeMs,
}: AnnotationOverlayProps) {
  const x = (annotation.position.x / 100) * containerWidth;
  const y = (annotation.position.y / 100) * containerHeight;
  const width = (annotation.size.width / 100) * containerWidth;
  const height = (annotation.size.height / 100) * containerHeight;

  const isDraggingRef = useRef(false);
  const effect = computeEffectState(annotation, currentTimeMs, isSelected);

  return (
    <Rnd
      position={{ x, y }}
      size={{ width, height }}
      onDragStart={() => {
        isDraggingRef.current = true;
      }}
      onDragStop={(_e, d) => {
        const xPercent = (d.x / containerWidth) * 100;
        const yPercent = (d.y / containerHeight) * 100;
        onPositionChange(annotation.id, { x: xPercent, y: yPercent });
        
        // Reset dragging flag after a short delay to prevent click event
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 100);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        const xPercent = (position.x / containerWidth) * 100;
        const yPercent = (position.y / containerHeight) * 100;
        const widthPercent = (ref.offsetWidth / containerWidth) * 100;
        const heightPercent = (ref.offsetHeight / containerHeight) * 100;
        onPositionChange(annotation.id, { x: xPercent, y: yPercent });
        onSizeChange(annotation.id, { width: widthPercent, height: heightPercent });
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onClick(annotation.id);
      }}
      bounds="parent"
      className={cn(
        "cursor-move transition-all",
        isSelected && "ring-2 ring-[#34B27B] ring-offset-2 ring-offset-transparent"
      )}
      style={{
        zIndex: isSelectedBoost ? zIndex + 1000 : zIndex, // Boost selected annotation to ensure it's on top
        pointerEvents: isSelected ? 'auto' : 'none',
        border: isSelected ? '2px solid rgba(52, 178, 123, 0.8)' : 'none',
        backgroundColor: isSelected ? 'rgba(52, 178, 123, 0.1)' : 'transparent',
        boxShadow: isSelected ? '0 0 0 1px rgba(52, 178, 123, 0.35)' : 'none',
      }}
      enableResizing={isSelected}
      disableDragging={!isSelected}
      resizeHandleStyles={{
        topLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #34B27B' : 'none',
          borderRadius: '50%',
          left: '-6px',
          top: '-6px',
          cursor: 'nwse-resize',
        },
        topRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #34B27B' : 'none',
          borderRadius: '50%',
          right: '-6px',
          top: '-6px',
          cursor: 'nesw-resize',
        },
        bottomLeft: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #34B27B' : 'none',
          borderRadius: '50%',
          left: '-6px',
          bottom: '-6px',
          cursor: 'nesw-resize',
        },
        bottomRight: {
          width: '12px',
          height: '12px',
          backgroundColor: isSelected ? 'white' : 'transparent',
          border: isSelected ? '2px solid #34B27B' : 'none',
          borderRadius: '50%',
          right: '-6px',
          bottom: '-6px',
          cursor: 'nwse-resize',
        },
      }}
    >
      <div
        className={cn(
          "w-full h-full rounded-lg",
          annotation.type === 'text' && "bg-transparent",
          annotation.type === 'image' && "bg-transparent",
          annotation.type === 'figure' && "bg-transparent",
          annotation.type === 'emoji' && "bg-transparent",
          isSelected && "shadow-lg"
        )}
        style={
          !renderContent
            ? { opacity: 0.25, border: '1px dashed rgba(255,255,255,0.3)' }
            : {
                opacity: ghostOpacity * effect.opacity,
                transform: `scale(${effect.scale})`,
                transformOrigin: 'center',
              }
        }
      >
        {renderContent ? <AnnotationContentView annotation={annotation} /> : null}
      </div>
    </Rnd>
  );
}
