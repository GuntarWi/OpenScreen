import React from "react";
import { useTimelineContext } from "dnd-timeline";

interface Keyframe {
  id: string;
  time: number;
  rawId?: string;
  color?: string;
  title?: string;
  clipId?: string;
  maskId?: string;
  pathId?: string;
  kind: 'clipTransform' | 'maskPath' | 'padding';
}

interface KeyframeMarkersProps {
  keyframes: Keyframe[];
  selectedKeyframeIds: string[];
  onKeyframePointerDown?: (
    event: React.PointerEvent,
    keyframe: Keyframe,
    mode: "replace" | "toggle",
  ) => void;
}

const KeyframeMarkers: React.FC<KeyframeMarkersProps> = ({
  keyframes,
  selectedKeyframeIds,
  onKeyframePointerDown,
}) => {
  const { sidebarWidth, range, valueToPixels } = useTimelineContext();
  return (
    <>
      {keyframes.map((kf) => {
        const offset = valueToPixels(kf.time - range.start);
        const isSelected = selectedKeyframeIds.includes(kf.id);
        return (
          <div
            key={kf.id}
            className={`absolute cursor-pointer ${isSelected ? 'ring-2 ring-[#34B27B]' : ''}`}
            style={{ left: `${sidebarWidth + offset - 8}px`, top: '11px', zIndex: 40 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onKeyframePointerDown?.(e, kf, e.metaKey || e.ctrlKey || e.shiftKey ? "toggle" : "replace");
            }}
            title={kf.title ?? `Keyframe @ ${kf.time}ms`}
            data-keyframe-marker="true"
            data-keyframe-id={kf.id}
          >
            <div
              style={{
                width: '10px',
                height: '10px',
                background: kf.color ?? '#ffe100',
                transform: 'rotate(45deg)',
                border: 'none',
                opacity: isSelected ? 1 : 0.72,
                transition: 'opacity 0.15s',
              }}
            />
          </div>
        );
      })}
    </>
  );
};

export default KeyframeMarkers;
