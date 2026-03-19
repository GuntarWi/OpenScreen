import React from "react";
import { useTimelineContext } from "dnd-timeline";

interface Keyframe {
  id: string;
  time: number;
  color?: string;
  title?: string;
  clipId?: string;
  kind?: 'clipTransform' | 'padding';
}

interface KeyframeMarkersProps {
  keyframes: Keyframe[];
  selectedKeyframeIds: string[];
  setSelectedKeyframeIds: React.Dispatch<React.SetStateAction<string[]>>;
  onSelectKeyframe?: (keyframe: Keyframe) => void;
}

const KeyframeMarkers: React.FC<KeyframeMarkersProps> = ({
  keyframes,
  selectedKeyframeIds,
  setSelectedKeyframeIds,
  onSelectKeyframe,
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
            onClick={(e) => {
              e.stopPropagation();
              const shouldToggle = e.metaKey || e.ctrlKey || e.shiftKey;
              setSelectedKeyframeIds((prev) => (
                shouldToggle
                  ? (prev.includes(kf.id) ? prev.filter((id) => id !== kf.id) : [...prev, kf.id])
                  : [kf.id]
              ));
              onSelectKeyframe?.(kf);
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
