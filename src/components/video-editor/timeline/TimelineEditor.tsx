import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import { Button } from "@/components/ui/button";
import { Plus, Scissors, ZoomIn, MessageSquare, ChevronDown, Check, Sparkles, Clapperboard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import TimelineWrapper from "./TimelineWrapper";
import Row from "./Row";
import Item from "./Item";
import KeyframeMarkers from "./KeyframeMarkers";
import type { Range, Span } from "dnd-timeline";
import type { ZoomRegion, TrimRegion, AnnotationRegion, CursorTrack, EffectRegion, CursorSmoothing, ClipSegment, OverlayVideoAsset, OverlayVideoRegion } from "../types";
import { Switch } from "@/components/ui/switch";
import { v4 as uuidv4 } from 'uuid';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AspectRatio, getAspectRatioLabel, RESOLUTION_PRESETS, type ResolutionPreset } from "@/utils/aspectRatioUtils";
import { formatShortcut } from "@/utils/platformUtils";

const ZOOM_ROW_ID = "row-zoom";
const VIDEO_ROW_ID = "row-video";
const OVERLAY_ROW_ID = "row-overlay";
const TRIM_ROW_ID = "row-trim";
const EFFECT_ROW_ID = "row-effect";
const CURSOR_ROW_ID = "row-cursor";
const ANNOTATION_ROW_ID = "row-annotation";
const CURSOR_ITEM_ID = "cursor-track";
const FALLBACK_RANGE_MS = 1000;
const TARGET_MARKER_COUNT = 12;

interface TimelineEditorProps {
  videoDuration: number;
  currentTime: number;
  onSeek?: (time: number) => void;
  clipSegments?: ClipSegment[];
  onClipSpanChange?: (id: string, span: Span) => void;
  onClipSplit?: () => void;
  onClipDelete?: (id: string) => void;
  selectedClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
  zoomRegions: ZoomRegion[];
  onZoomAdded: (span: Span) => void;
  onZoomSpanChange: (id: string, span: Span) => void;
  onZoomDelete: (id: string) => void;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  trimRegions?: TrimRegion[];
  onTrimAdded?: (span: Span) => void;
  onTrimSpanChange?: (id: string, span: Span) => void;
  onTrimDelete?: (id: string) => void;
  selectedTrimId?: string | null;
  onSelectTrim?: (id: string | null) => void;
  annotationRegions?: AnnotationRegion[];
  onAnnotationAdded?: (span: Span) => void;
  onAnnotationSpanChange?: (id: string, span: Span) => void;
  onAnnotationDelete?: (id: string) => void;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  overlayAssets?: OverlayVideoAsset[];
  overlayRegions?: OverlayVideoRegion[];
  onOverlaySpanChange?: (id: string, span: Span) => void;
  onOverlayDelete?: (id: string) => void;
  onOverlaySplit?: () => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  onOverlayAssetDrop?: (assetId: string, startMs: number) => void;
  effectRegions?: EffectRegion[];
  onEffectAdded?: (span: Span) => void;
  onEffectSpanChange?: (id: string, span: Span) => void;
  onEffectDelete?: (id: string) => void;
  selectedEffectId?: string | null;
  onSelectEffect?: (id: string | null) => void;
  cursorTrack?: CursorTrack | null;
  selectedCursorId?: string | null;
  onSelectCursor?: (id: string | null) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  resolutionPresetId: string;
  onResolutionPresetChange: (presetId: string) => void;
  cursorEnabled?: boolean;
  onCursorEnabledChange?: (enabled: boolean) => void;
  cursorSmoothing?: CursorSmoothing;
  onCursorSmoothingChange?: (smoothing: CursorSmoothing) => void;
  paddingKeyframes?: { id: string; timeMs: number; value: number }[];
}

interface TimelineScaleConfig {
  intervalMs: number;
  gridMs: number;
  minItemDurationMs: number;
  defaultItemDurationMs: number;
  minVisibleRangeMs: number;
}

interface TimelineRenderItem {
  id: string;
  rowId: string;
  span: Span;
  label: string;
  zoomDepth?: number;
  variant: 'zoom' | 'trim' | 'annotation' | 'cursor' | 'effect' | 'clip' | 'overlay';
  annotationType?: AnnotationRegion['type'];
}

const SCALE_CANDIDATES = [
  { intervalSeconds: 0.25, gridSeconds: 0.05 },
  { intervalSeconds: 0.5, gridSeconds: 0.1 },
  { intervalSeconds: 1, gridSeconds: 0.25 },
  { intervalSeconds: 2, gridSeconds: 0.5 },
  { intervalSeconds: 5, gridSeconds: 1 },
  { intervalSeconds: 10, gridSeconds: 2 },
  { intervalSeconds: 15, gridSeconds: 3 },
  { intervalSeconds: 30, gridSeconds: 5 },
  { intervalSeconds: 60, gridSeconds: 10 },
  { intervalSeconds: 120, gridSeconds: 20 },
  { intervalSeconds: 300, gridSeconds: 30 },
  { intervalSeconds: 600, gridSeconds: 60 },
  { intervalSeconds: 900, gridSeconds: 120 },
  { intervalSeconds: 1800, gridSeconds: 180 },
  { intervalSeconds: 3600, gridSeconds: 300 },
];

function calculateTimelineScale(durationSeconds: number): TimelineScaleConfig {
  const totalMs = Math.max(0, Math.round(durationSeconds * 1000));

  const selectedCandidate = SCALE_CANDIDATES.find((candidate) => {
    if (durationSeconds <= 0) {
      return true;
    }
    const markers = durationSeconds / candidate.intervalSeconds;
    return markers <= TARGET_MARKER_COUNT;
  }) ?? SCALE_CANDIDATES[SCALE_CANDIDATES.length - 1];

  const intervalMs = Math.round(selectedCandidate.intervalSeconds * 1000);
  const gridMs = Math.round(selectedCandidate.gridSeconds * 1000);

  // Set minItemDurationMs to 1ms for maximum granularity
  const minItemDurationMs = 1;
  const defaultItemDurationMs = Math.min(
    Math.max(minItemDurationMs, intervalMs * 2),
    totalMs > 0 ? totalMs : intervalMs * 2,
  );

  const minVisibleRangeMs = totalMs > 0
    ? Math.min(Math.max(intervalMs * 3, minItemDurationMs * 6, 1000), totalMs)
    : Math.max(intervalMs * 3, minItemDurationMs * 6, 1000);

  return {
    intervalMs,
    gridMs,
    minItemDurationMs,
    defaultItemDurationMs,
    minVisibleRangeMs,
  };
}

function createInitialRange(totalMs: number): Range {
  if (totalMs > 0) {
    return { start: 0, end: totalMs };
  }

  return { start: 0, end: FALLBACK_RANGE_MS };
}

function formatTimeLabel(milliseconds: number, intervalMs: number) {
  const totalSeconds = milliseconds / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const fractionalDigits = intervalMs < 250 ? 2 : intervalMs < 1000 ? 1 : 0;

  if (hours > 0) {
    const minutesString = minutes.toString().padStart(2, "0");
    const secondsString = Math.floor(seconds)
      .toString()
      .padStart(2, "0");
    return `${hours}:${minutesString}:${secondsString}`;
  }

  if (fractionalDigits > 0) {
    const secondsWithFraction = seconds.toFixed(fractionalDigits);
    const [wholeSeconds, fraction] = secondsWithFraction.split(".");
    return `${minutes}:${wholeSeconds.padStart(2, "0")}.${fraction}`;
  }

  return `${minutes}:${Math.floor(seconds).toString().padStart(2, "0")}`;
}

function PlaybackCursor({ 
  currentTimeMs, 
  seekDurationMs,
  onSeek,
  timelineRef,
}: { 
  currentTimeMs: number; 
  seekDurationMs: number;
  onSeek?: (time: number) => void;
  timelineRef: React.RefObject<HTMLDivElement>;
}) {
  const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onSeek) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - sidebarWidth;
      
      // Allow dragging outside to 0 or max, but clamp the value
      const relativeMs = pixelsToValue(clickX);
      const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, seekDurationMs));
      
      onSeek(absoluteMs / 1000);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ew-resize';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };
  }, [isDragging, onSeek, timelineRef, sidebarWidth, range.start, seekDurationMs, pixelsToValue]);

  if (seekDurationMs <= 0 || currentTimeMs < 0) {
    return null;
  }

  const clampedTime = Math.min(currentTimeMs, seekDurationMs);
  
  if (clampedTime < range.start || clampedTime > range.end) {
    return null;
  }

  const offset = valueToPixels(clampedTime - range.start);

  return (
    <div
      className="absolute top-0 bottom-0 z-50 group/cursor"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth - 1}px`,
        pointerEvents: 'none', // Allow clicks to pass through to timeline, but we'll enable pointer events on the handle
      }}
    >
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-[#34B27B] shadow-[0_0_10px_rgba(52,178,123,0.5)] cursor-ew-resize pointer-events-auto hover:shadow-[0_0_15px_rgba(52,178,123,0.7)] transition-shadow"
        style={{
          [sideProperty]: `${offset}px`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent timeline click
          setIsDragging(true);
        }}
      >
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
          style={{ width: '16px', height: '16px' }}
        >
          <div className="w-3 h-3 mx-auto mt-[2px] bg-[#34B27B] rotate-45 rounded-sm shadow-lg border border-white/20" />
        </div>
      </div>
    </div>
  );
}

function TimelineAxis({
  intervalMs,
  timelineDurationMs,
  currentTimeMs,
}: {
  intervalMs: number;
  timelineDurationMs: number;
  currentTimeMs: number;
}) {
  const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
  const sideProperty = direction === "rtl" ? "right" : "left";

  const markers = useMemo(() => {
    if (intervalMs <= 0) {
      return { markers: [], minorTicks: [] };
    }

    const maxTime = timelineDurationMs > 0 ? timelineDurationMs : range.end;
    const visibleStart = Math.max(0, Math.min(range.start, maxTime));
    const visibleEnd = Math.min(range.end, maxTime);
    const markerTimes = new Set<number>();

    const firstMarker = Math.ceil(visibleStart / intervalMs) * intervalMs;

    for (let time = firstMarker; time <= maxTime; time += intervalMs) {
      if (time >= visibleStart && time <= visibleEnd) {
        markerTimes.add(Math.round(time));
      }
    }

    if (visibleStart <= maxTime) {
      markerTimes.add(Math.round(visibleStart));
    }
    
    if (timelineDurationMs > 0) {
      markerTimes.add(Math.round(timelineDurationMs));
    }

    const sorted = Array.from(markerTimes)
      .filter(time => time <= maxTime)
      .sort((a, b) => a - b);

    // Generate minor ticks (4 ticks between major intervals)
    const minorTicks = [];
    const minorInterval = intervalMs / 5;
    
    for (let time = firstMarker; time <= maxTime; time += minorInterval) {
      if (time >= visibleStart && time <= visibleEnd) {
        // Skip if it's close to a major marker
        const isMajor = Math.abs(time % intervalMs) < 1;
        if (!isMajor) {
          minorTicks.push(time);
        }
      }
    }

    return { 
      markers: sorted.map((time) => ({
        time,
        label: formatTimeLabel(time, intervalMs),
      })), 
      minorTicks 
    };
  }, [intervalMs, range.end, range.start, timelineDurationMs]);

  return (
    <div
      className="h-8 bg-[#09090b] border-b border-white/5 relative overflow-hidden select-none"
      style={{
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${sidebarWidth}px`,
      }}
    >
      {/* Minor Ticks */}
      {markers.minorTicks.map((time) => {
        const offset = valueToPixels(time - range.start);
        return (
          <div
            key={`minor-${time}`}
            className="absolute bottom-0 h-1 w-[1px] bg-white/5"
            style={{ [sideProperty]: `${offset}px` }}
          />
        );
      })}

      {/* Major Markers */}
      {markers.markers.map((marker) => {
        const offset = valueToPixels(marker.time - range.start);
        const markerStyle: React.CSSProperties = {
          position: "absolute",
          bottom: 0,
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          [sideProperty]: `${offset}px`,
        };

        return (
          <div key={marker.time} style={markerStyle}>
            <div className="flex flex-col items-center pb-1">
              <div className="h-2 w-[1px] bg-white/20 mb-1" />
              <span
                className={cn(
                  "text-[10px] font-medium tabular-nums tracking-tight",
                  marker.time === currentTimeMs ? "text-[#34B27B]" : "text-slate-500"
                )}
              >
                {marker.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({
  items,
  timelineDurationMs,
  seekDurationMs,
  intervalMs,
  currentTimeMs,
  onSeek,
  onSelectZoom,
  onSelectTrim,
  onSelectClip,
  onSelectAnnotation,
  onSelectOverlay,
  onSelectEffect,
  onSelectCursor,
  onOverlayAssetDrop,
  selectedClipId,
  selectedZoomId,
  selectedTrimId,
  selectedAnnotationId,
  selectedOverlayId,
  selectedEffectId,
  selectedCursorId,
}: {
  items: TimelineRenderItem[];
  timelineDurationMs: number;
  seekDurationMs: number;
  intervalMs: number;
  currentTimeMs: number;
  onSeek?: (time: number) => void;
  onSelectZoom?: (id: string | null) => void;
  onSelectTrim?: (id: string | null) => void;
  onSelectClip?: (id: string | null) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onSelectOverlay?: (id: string | null) => void;
  onSelectEffect?: (id: string | null) => void;
  onSelectCursor?: (id: string | null) => void;
  onOverlayAssetDrop?: (assetId: string, startMs: number) => void;
  selectedClipId?: string | null;
  selectedZoomId: string | null;
  selectedTrimId?: string | null;
  selectedAnnotationId?: string | null;
  selectedOverlayId?: string | null;
  selectedEffectId?: string | null;
  selectedCursorId?: string | null;
}) {
  const { setTimelineRef, style, sidebarWidth, range, pixelsToValue } = useTimelineContext();
  const localTimelineRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    setTimelineRef(node);
    localTimelineRef.current = node;
  }, [setTimelineRef]);

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || seekDurationMs <= 0) return;
    
    // Only clear selection if clicking on empty space (not on items)
    // This is handled by event propagation - items stop propagation
    onSelectClip?.(null);
    onSelectZoom?.(null);
    onSelectTrim?.(null);
    onSelectAnnotation?.(null);
    onSelectOverlay?.(null);
    onSelectEffect?.(null);
    onSelectCursor?.(null);

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left - sidebarWidth;
    
    if (clickX < 0) return;
    
    const relativeMs = pixelsToValue(clickX);
    const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, seekDurationMs));
    const timeInSeconds = absoluteMs / 1000;
    
    onSeek(timeInSeconds);
  }, [onSeek, onSelectClip, onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectOverlay, onSelectEffect, onSelectCursor, seekDurationMs, sidebarWidth, range.start, pixelsToValue]);

  const handleOverlayDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!onOverlayAssetDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [onOverlayAssetDrop]);

  const handleOverlayDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!onOverlayAssetDrop || !localTimelineRef.current) return;
    const assetId = event.dataTransfer.getData('application/x-overlay-asset');
    if (!assetId) return;
    event.preventDefault();
    const rect = localTimelineRef.current.getBoundingClientRect();
    const dropX = event.clientX - rect.left - sidebarWidth;
    if (dropX < 0) return;
    const relativeMs = pixelsToValue(dropX);
    const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, timelineDurationMs));
    onOverlayAssetDrop(assetId, absoluteMs);
  }, [onOverlayAssetDrop, sidebarWidth, range.start, pixelsToValue, timelineDurationMs]);

  const clipItems = items.filter(item => item.rowId === VIDEO_ROW_ID);
  const overlayItems = items.filter(item => item.rowId === OVERLAY_ROW_ID);
  const zoomItems = items.filter(item => item.rowId === ZOOM_ROW_ID);
  const trimItems = items.filter(item => item.rowId === TRIM_ROW_ID);
  const effectItems = items.filter(item => item.rowId === EFFECT_ROW_ID);
  const cursorItems = items.filter(item => item.rowId === CURSOR_ROW_ID);
  const annotationItems = items.filter(item => item.rowId === ANNOTATION_ROW_ID);

  return (
    <div
      ref={setRefs}
      style={style}
      className="select-none bg-[#09090b] min-h-[140px] relative cursor-pointer group"
      onClick={handleTimelineClick}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />
      <TimelineAxis intervalMs={intervalMs} timelineDurationMs={timelineDurationMs} currentTimeMs={currentTimeMs} />
      <PlaybackCursor 
        currentTimeMs={currentTimeMs} 
        seekDurationMs={seekDurationMs} 
        onSeek={onSeek}
        timelineRef={localTimelineRef}
      />
      
      <Row id={VIDEO_ROW_ID}>
        {clipItems.map((item) => (
          <Item
            id={item.id}
            key={item.id}
            rowId={item.rowId}
            span={item.span}
            isSelected={item.id === selectedClipId}
            onSelect={() => onSelectClip?.(item.id)}
            variant="clip"
          >
            {item.label}
          </Item>
        ))}
      </Row>

      <Row id={OVERLAY_ROW_ID} onDrop={handleOverlayDrop} onDragOver={handleOverlayDragOver}>
        {overlayItems.map((item) => (
          <Item
            id={item.id}
            key={item.id}
            rowId={item.rowId}
            span={item.span}
            isSelected={item.id === selectedOverlayId}
            onSelect={() => onSelectOverlay?.(item.id)}
            variant="overlay"
          >
            {item.label}
          </Item>
        ))}
      </Row>

      <Row id={ZOOM_ROW_ID}>
        {zoomItems.map((item) => (
          <Item
            id={item.id}
            key={item.id}
            rowId={item.rowId}
            span={item.span}
            isSelected={item.id === selectedZoomId}
            onSelect={() => onSelectZoom?.(item.id)}
            zoomDepth={item.zoomDepth}
            variant="zoom"
          >
            {item.label}
          </Item>
        ))}
      </Row>

      {effectItems.length > 0 && (
        <Row id={EFFECT_ROW_ID}>
          {effectItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedEffectId}
              onSelect={() => onSelectEffect?.(item.id)}
              variant="effect"
            >
              {item.label}
            </Item>
          ))}
        </Row>
      )}

      {trimItems.length > 0 && (
        <Row id={TRIM_ROW_ID}>
          {trimItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedTrimId}
              onSelect={() => onSelectTrim?.(item.id)}
              variant="trim"
            >
              {item.label}
            </Item>
          ))}
        </Row>
      )}

      {cursorItems.length > 0 && (
        <Row id={CURSOR_ROW_ID}>
          {cursorItems.map((item) => (
            <Item
              id={item.id}
              key={item.id}
              rowId={item.rowId}
              span={item.span}
              isSelected={item.id === selectedCursorId}
              onSelect={() => onSelectCursor?.(item.id)}
              variant="cursor"
            >
              {item.label}
            </Item>
          ))}
        </Row>
      )}

      <Row id={ANNOTATION_ROW_ID}>
        {annotationItems.map((item) => (
          <Item
            id={item.id}
            key={item.id}
            rowId={item.rowId}
            span={item.span}
            isSelected={item.id === selectedAnnotationId}
            onSelect={() => onSelectAnnotation?.(item.id)}
            variant="annotation"
            annotationType={item.annotationType}
          >
            {item.label}
          </Item>
        ))}
      </Row>
    </div>
  );
}

export default function TimelineEditor({
  videoDuration,
  currentTime,
  onSeek,
  clipSegments = [],
  onClipSpanChange,
  onClipSplit,
  onClipDelete,
  selectedClipId,
  onSelectClip,
  zoomRegions,
  onZoomAdded,
  onZoomSpanChange,
  onZoomDelete,
  selectedZoomId,
  onSelectZoom,
  trimRegions = [],
  onTrimAdded,
  onTrimSpanChange,
  onTrimDelete,
  selectedTrimId,
  onSelectTrim,
  annotationRegions = [],
  onAnnotationAdded,
  onAnnotationSpanChange,
  onAnnotationDelete,
  selectedAnnotationId,
  onSelectAnnotation,
  overlayAssets = [],
  overlayRegions = [],
  onOverlaySpanChange,
  onOverlayDelete,
  onOverlaySplit,
  selectedOverlayId,
  onSelectOverlay,
  onOverlayAssetDrop,
  effectRegions = [],
  onEffectAdded,
  onEffectSpanChange,
  onEffectDelete,
  selectedEffectId,
  onSelectEffect,
  cursorTrack,
  selectedCursorId,
  onSelectCursor,
  cursorEnabled,
  onCursorEnabledChange,
  cursorSmoothing,
  onCursorSmoothingChange,
  aspectRatio,
  onAspectRatioChange,
  resolutionPresetId,
  paddingKeyframes = [],
  onResolutionPresetChange,
}: TimelineEditorProps) {
  const videoDurationMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
  const overlayMaxEndMs = useMemo(
    () => overlayRegions.reduce((max, region) => Math.max(max, region.endMs), 0),
    [overlayRegions],
  );
  const timelineDurationMs = useMemo(
    () => Math.max(videoDurationMs, overlayMaxEndMs),
    [videoDurationMs, overlayMaxEndMs],
  );
  const currentTimeMs = useMemo(() => Math.round(currentTime * 1000), [currentTime]);
  const timelineScale = useMemo(
    () => calculateTimelineScale(timelineDurationMs / 1000),
    [timelineDurationMs],
  );
  const safeMinDurationMs = useMemo(
    () => (timelineDurationMs > 0 ? Math.min(timelineScale.minItemDurationMs, timelineDurationMs) : timelineScale.minItemDurationMs),
    [timelineScale.minItemDurationMs, timelineDurationMs],
  );

  const [range, setRange] = useState<Range>(() => createInitialRange(timelineDurationMs));
  const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState({
    pan: 'Shift + Ctrl + Scroll',
    zoom: 'Ctrl + Scroll'
  });

  useEffect(() => {
    formatShortcut(['shift', 'mod', 'Scroll']).then(pan => {
      formatShortcut(['mod', 'Scroll']).then(zoom => {
        setShortcuts({ pan, zoom });
      });
    });
  }, []);

  // Add keyframe at current playhead position
  const addKeyframe = useCallback(() => {
    if (videoDurationMs === 0) return;
    const time = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    if (keyframes.some(kf => Math.abs(kf.time - time) < 1)) return;
    setKeyframes(prev => [...prev, { id: uuidv4(), time }]);
  }, [currentTimeMs, videoDurationMs, keyframes]);

  // Delete selected keyframe
  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedKeyframeId) return;
    setKeyframes(prev => prev.filter(kf => kf.id !== selectedKeyframeId));
    setSelectedKeyframeId(null);
  }, [selectedKeyframeId]);

  // Delete selected zoom item
  const deleteSelectedZoom = useCallback(() => {
    if (!selectedZoomId) return;
    onZoomDelete(selectedZoomId);
    onSelectZoom(null);
  }, [selectedZoomId, onZoomDelete, onSelectZoom]);

  // Delete selected trim item
  const deleteSelectedTrim = useCallback(() => {
    if (!selectedTrimId || !onTrimDelete || !onSelectTrim) return;
    onTrimDelete(selectedTrimId);
    onSelectTrim(null);
  }, [selectedTrimId, onTrimDelete, onSelectTrim]);

  const deleteSelectedEffect = useCallback(() => {
    if (!selectedEffectId || !onEffectDelete || !onSelectEffect) return;
    onEffectDelete(selectedEffectId);
    onSelectEffect(null);
  }, [selectedEffectId, onEffectDelete, onSelectEffect]);

  const deleteSelectedClip = useCallback(() => {
    if (!selectedClipId || !onClipDelete || !onSelectClip) return;
    onClipDelete(selectedClipId);
    onSelectClip(null);
  }, [selectedClipId, onClipDelete, onSelectClip]);

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
    onAnnotationDelete(selectedAnnotationId);
    onSelectAnnotation(null);
  }, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId || !onOverlayDelete || !onSelectOverlay) return;
    onOverlayDelete(selectedOverlayId);
    onSelectOverlay(null);
  }, [selectedOverlayId, onOverlayDelete, onSelectOverlay]);

  useEffect(() => {
    setRange(createInitialRange(timelineDurationMs));
  }, [timelineDurationMs]);

  useEffect(() => {
    if (videoDurationMs === 0 || safeMinDurationMs <= 0) {
      return;
    }

    zoomRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, videoDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(videoDurationMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, videoDurationMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, videoDurationMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onZoomSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    trimRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, videoDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(videoDurationMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, videoDurationMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, videoDurationMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onTrimSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    clipSegments.forEach((segment) => {
      const clampedStart = Math.max(0, Math.min(segment.startMs, videoDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(videoDurationMs, Math.max(minEnd, segment.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, videoDurationMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, videoDurationMs));

      if (normalizedStart !== segment.startMs || normalizedEnd !== segment.endMs) {
        onClipSpanChange?.(segment.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    overlayRegions.forEach((region) => {
      if (!onOverlaySpanChange) return;
      if (timelineDurationMs === 0) return;
      const clampedStart = Math.max(0, Math.min(region.startMs, timelineDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(timelineDurationMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, timelineDurationMs - safeMinDurationMs));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, timelineDurationMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onOverlaySpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });
  }, [zoomRegions, trimRegions, annotationRegions, clipSegments, overlayRegions, videoDurationMs, timelineDurationMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onAnnotationSpanChange, onClipSpanChange, onOverlaySpanChange]);

  const hasOverlap = useCallback((newSpan: Span, excludeId?: string): boolean => {
    // Determine which row the item belongs to
    const isZoomItem = zoomRegions.some(r => r.id === excludeId);
    const isTrimItem = trimRegions.some(r => r.id === excludeId);
    const isClipItem = clipSegments.some(r => r.id === excludeId);
    const isAnnotationItem = annotationRegions.some(r => r.id === excludeId);
    const isEffectItem = effectRegions.some(r => r.id === excludeId);
    const isOverlayItem = overlayRegions.some(r => r.id === excludeId);

    if (isAnnotationItem || isEffectItem || isOverlayItem) {
      return false;
    }

    // Helper to check overlap against a specific set of regions
    const checkOverlap = (regions: (ZoomRegion | TrimRegion | ClipSegment)[]) => {
      return regions.some((region) => {
        if (region.id === excludeId) return false;
        const gapBefore = newSpan.start - region.endMs;
        const gapAfter = region.startMs - newSpan.end;
        // Snap if gap is 2ms or less
        if (gapBefore > 0 && gapBefore <= 2) return true;
        if (gapAfter > 0 && gapAfter <= 2) return true;
        return !(newSpan.end <= region.startMs || newSpan.start >= region.endMs);
      });
    };

    if (isZoomItem) {
      return checkOverlap(zoomRegions);
    }

    if (isTrimItem) {
      return checkOverlap(trimRegions);
    }

    if (isClipItem) {
      return checkOverlap(clipSegments);
    }

    return false;
  }, [zoomRegions, trimRegions, clipSegments, annotationRegions, effectRegions, overlayRegions]);

  const handleAddZoom = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0) {
      return;
    }

    const defaultDuration = Math.min(1000, videoDurationMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Always place zoom at playhead
    const startPos = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    // Find the next zoom region after the playhead
    const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : videoDurationMs - startPos;

    // Check if playhead is inside any zoom region
    const isOverlapping = sorted.some(region => startPos >= region.startMs && startPos < region.endMs);
    if (isOverlapping || gapToNext <= 0) {
      toast.error("Cannot place zoom here", {
        description: "Zoom already exists at this location or not enough space available.",
      });
      return;
    }

    const actualDuration = Math.min(1000, gapToNext);
    onZoomAdded({ start: startPos, end: startPos + actualDuration });
  }, [videoDuration, videoDurationMs, currentTimeMs, zoomRegions, onZoomAdded]);

  const handleAddTrim = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onTrimAdded) {
      return;
    }

    const defaultDuration = Math.min(1000, videoDurationMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Always place trim at playhead
    const startPos = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    // Find the next trim region after the playhead
    const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
    const nextRegion = sorted.find(region => region.startMs > startPos);
    const gapToNext = nextRegion ? nextRegion.startMs - startPos : videoDurationMs - startPos;

    // Check if playhead is inside any trim region
    const isOverlapping = sorted.some(region => startPos >= region.startMs && startPos < region.endMs);
    if (isOverlapping || gapToNext <= 0) {
      toast.error("Cannot place trim here", {
        description: "Trim already exists at this location or not enough space available.",
      });
      return;
    }

    const actualDuration = Math.min(1000, gapToNext);
    onTrimAdded({ start: startPos, end: startPos + actualDuration });
  }, [videoDuration, videoDurationMs, currentTimeMs, trimRegions, onTrimAdded]);

  const handleSplitClip = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onClipSplit) {
      return;
    }
    onClipSplit();
  }, [videoDuration, videoDurationMs, onClipSplit]);

  const handleSplitOverlay = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onOverlaySplit) {
      return;
    }
    onOverlaySplit();
  }, [videoDuration, videoDurationMs, onOverlaySplit]);

  // Unified split handler - splits overlay if selected, otherwise splits main clip
  const handleUnifiedSplit = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0) {
      return;
    }
    if (selectedOverlayId && onOverlaySplit) {
      onOverlaySplit();
    } else if (onClipSplit) {
      onClipSplit();
    }
  }, [videoDuration, videoDurationMs, selectedOverlayId, onOverlaySplit, onClipSplit]);

  const handleAddAnnotation = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onAnnotationAdded) {
      return;
    }

    const defaultDuration = Math.min(1000, videoDurationMs);
    if (defaultDuration <= 0) {
      return;
    }

    // Multiple annotations can exist at the same timestamp
    const startPos = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    const endPos = Math.min(startPos + defaultDuration, videoDurationMs);
    
    onAnnotationAdded({ start: startPos, end: endPos });
  }, [videoDuration, videoDurationMs, currentTimeMs, onAnnotationAdded]);

  const handleAddEffect = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onEffectAdded) {
      return;
    }

    const startPos = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    const defaultDuration = Math.min(1200, videoDurationMs);
    const endPos = Math.min(startPos + defaultDuration, videoDurationMs);

    onEffectAdded({ start: startPos, end: endPos });
  }, [videoDuration, videoDurationMs, currentTimeMs, onEffectAdded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        addKeyframe();
      }
      if (e.key === 'z' || e.key === 'Z') {
        handleAddZoom();
      }
      if (e.key === 't' || e.key === 'T') {
        handleAddTrim();
      }
      if (e.key === 's' || e.key === 'S') {
        handleUnifiedSplit();
      }
      if (e.key === 'a' || e.key === 'A') {
        handleAddAnnotation();
      }
      if (e.key === 'e' || e.key === 'E') {
        handleAddEffect();
      }
      
      // Tab: Cycle through overlapping annotations at current time
      if (e.key === 'Tab' && annotationRegions.length > 0) {
        const currentTimeMs = Math.round(currentTime * 1000);
        const overlapping = annotationRegions
          .filter(a => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
          .sort((a, b) => a.zIndex - b.zIndex); // Sort by z-index
        
        if (overlapping.length > 0) {
          e.preventDefault(); 
          
          if (!selectedAnnotationId || !overlapping.some(a => a.id === selectedAnnotationId)) {
            onSelectAnnotation?.(overlapping[0].id);
          } else {
            // Cycle to next annotation
            const currentIndex = overlapping.findIndex(a => a.id === selectedAnnotationId);
            const nextIndex = e.shiftKey 
              ? (currentIndex - 1 + overlapping.length) % overlapping.length // Shift+Tab = backward
              : (currentIndex + 1) % overlapping.length; // Tab = forward
            onSelectAnnotation?.(overlapping[nextIndex].id);
          }
        }
      }    
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        if (selectedKeyframeId) {
          deleteSelectedKeyframe();
        } else if (selectedZoomId) {
          deleteSelectedZoom();
        } else if (selectedTrimId) {
          deleteSelectedTrim();
        } else if (selectedClipId) {
          deleteSelectedClip();
        } else if (selectedEffectId) {
          deleteSelectedEffect();
        } else if (selectedOverlayId) {
          deleteSelectedOverlay();
        } else if (selectedAnnotationId) {
          deleteSelectedAnnotation();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addKeyframe, handleAddZoom, handleAddTrim, handleUnifiedSplit, handleAddAnnotation, handleAddEffect, deleteSelectedKeyframe, deleteSelectedZoom, deleteSelectedTrim, deleteSelectedClip, deleteSelectedEffect, deleteSelectedOverlay, deleteSelectedAnnotation, selectedKeyframeId, selectedZoomId, selectedTrimId, selectedClipId, selectedEffectId, selectedOverlayId, selectedAnnotationId, annotationRegions, currentTime, onSelectAnnotation, onSelectEffect, onSelectOverlay]);

  const clampedRange = useMemo<Range>(() => {
    if (timelineDurationMs === 0) {
      return range;
    }

    return {
      start: Math.max(0, Math.min(range.start, timelineDurationMs)),
      end: Math.min(range.end, timelineDurationMs),
    };
  }, [range, timelineDurationMs]);

  const timelineItems = useMemo<TimelineRenderItem[]>(() => {
    const clips: TimelineRenderItem[] = clipSegments.map((segment, index) => ({
      id: segment.id,
      rowId: VIDEO_ROW_ID,
      span: { start: segment.startMs, end: segment.endMs },
      label: `Clip ${index + 1} · ${((segment.endMs - segment.startMs) / 1000).toFixed(1)}s`,
      variant: 'clip',
    }));

    const overlays: TimelineRenderItem[] = overlayRegions.map((region) => {
      const asset = overlayAssets.find((item) => item.id === region.assetId);
      const labelBase = asset?.name || 'Overlay';
      const durationSec = Math.max(0, (region.endMs - region.startMs) / 1000).toFixed(1);
      return {
        id: region.id,
        rowId: OVERLAY_ROW_ID,
        span: { start: region.startMs, end: region.endMs },
        label: `${labelBase} - ${durationSec}s`,
        variant: 'overlay',
      };
    });

    const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
      id: region.id,
      rowId: ZOOM_ROW_ID,
      span: { start: region.startMs, end: region.endMs },
      label: `Zoom ${index + 1}`,
      zoomDepth: region.depth,
      variant: 'zoom',
    }));

    const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
      id: region.id,
      rowId: TRIM_ROW_ID,
      span: { start: region.startMs, end: region.endMs },
      label: `Trim ${index + 1}`,
      variant: 'trim',
    }));

    const effects: TimelineRenderItem[] = effectRegions.map((region, index) => {
      const label =
        region.type === 'perspective'
          ? `Perspective ${index + 1}`
          : `Shake ${index + 1}`;
      return {
        id: region.id,
        rowId: EFFECT_ROW_ID,
        span: { start: region.startMs, end: region.endMs },
        label,
        variant: 'effect',
      };
    });

    const annotations: TimelineRenderItem[] = annotationRegions.map((region) => {
      let label: string;
      
      if (region.type === 'text') {
        // Show text preview
        const preview = region.content.trim() || 'Empty text';
        label = preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
      } else if (region.type === 'image') {
        label = 'Image';
      } else if (region.type === 'emoji') {
        label = region.emojiAlt ? `Emoji · ${region.emojiAlt}` : 'Emoji';
      } else {
        label = 'Annotation';
      }
      const durationSec = Math.max(0, (region.endMs - region.startMs) / 1000).toFixed(1);
      label = `${label} · ${durationSec}s`;
      
      return {
        id: region.id,
        rowId: ANNOTATION_ROW_ID,
        span: { start: region.startMs, end: region.endMs },
        label,
        variant: 'annotation',
        annotationType: region.type,
      };
    });

    const cursors: TimelineRenderItem[] = cursorEnabled && cursorTrack && cursorTrack.events.length > 0 && videoDurationMs > 0
      ? [{
          id: CURSOR_ITEM_ID,
          rowId: CURSOR_ROW_ID,
          span: { start: 0, end: videoDurationMs },
          label: 'Cursor',
          variant: 'cursor',
        }]
      : [];

    return [...clips, ...overlays, ...zooms, ...effects, ...trims, ...cursors, ...annotations];
  }, [clipSegments, overlayRegions, overlayAssets, zoomRegions, trimRegions, effectRegions, annotationRegions, cursorTrack, videoDurationMs]);

  const clampSpanToVideo = useCallback((span: Span): Span => {
    if (videoDurationMs <= 0) return span;
    const rawDuration = Math.max(span.end - span.start, 0);
    const minDuration = Math.min(Math.max(safeMinDurationMs, 1), videoDurationMs);
    const duration = Math.min(Math.max(rawDuration, minDuration), videoDurationMs);
    const start = Math.max(0, Math.min(span.start, videoDurationMs - duration));
    return { start, end: start + duration };
  }, [videoDurationMs, safeMinDurationMs]);

  const handleItemSpanChange = useCallback((id: string, span: Span) => {
    // Check if it's a zoom or trim item
    if (id === CURSOR_ITEM_ID) {
      return;
    }
    if (clipSegments.some(r => r.id === id)) {
      onClipSpanChange?.(id, clampSpanToVideo(span));
    } else if (zoomRegions.some(r => r.id === id)) {
      onZoomSpanChange(id, clampSpanToVideo(span));
    } else if (trimRegions.some(r => r.id === id)) {
      onTrimSpanChange?.(id, clampSpanToVideo(span));
    } else if (effectRegions.some(r => r.id === id)) {
      onEffectSpanChange?.(id, clampSpanToVideo(span));
    } else if (overlayRegions.some(r => r.id === id)) {
      onOverlaySpanChange?.(id, span);
    } else if (annotationRegions.some(r => r.id === id)) {
      onAnnotationSpanChange?.(id, clampSpanToVideo(span));
    }
  }, [clipSegments, zoomRegions, trimRegions, effectRegions, overlayRegions, annotationRegions, onClipSpanChange, onZoomSpanChange, onTrimSpanChange, onEffectSpanChange, onOverlaySpanChange, onAnnotationSpanChange, clampSpanToVideo]);

  if (!videoDuration || videoDuration === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-[#09090b] gap-3">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
          <Plus className="w-6 h-6 text-slate-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-300">No Video Loaded</p>
          <p className="text-xs text-slate-500 mt-1">Drag and drop a video to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#09090b] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-[#09090b]">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleUnifiedSplit}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            title={selectedOverlayId ? "Split Overlay (S)" : "Split Clip (S)"}
          >
            <Scissors className="w-4 h-4" />
          </Button>
          <Button
            onClick={deleteSelectedClip}
            variant="ghost"
            size="icon"
            disabled={!selectedClipId}
            className="h-7 w-7 text-slate-400 disabled:opacity-40 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
            title="Delete selected clip (⌘/Ctrl + D)"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddZoom}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
            title="Add Zoom (Z)"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddEffect}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#EC4899] hover:bg-[#EC4899]/10 transition-all"
            title="Add Effect (E)"
          >
            <Sparkles className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleAddAnnotation}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#B4A046] hover:bg-[#B4A046]/10 transition-all"
            title="Add Annotation (A)"
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all gap-1"
              >
                <span className="font-medium">{getAspectRatioLabel(aspectRatio)}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10">
              {(['16:9', '9:16', '1:1', '4:3', '4:5'] as AspectRatio[]).map((ratio) => (
                <DropdownMenuItem
                  key={ratio}
                  onClick={() => {
                    onAspectRatioChange(ratio);
                    onResolutionPresetChange('auto');
                  }}
                  className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3"
                >
                  <span>{getAspectRatioLabel(ratio)}</span>
                  {aspectRatio === ratio && <Check className="w-3 h-3 text-[#34B27B]" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all gap-1"
              >
                <span className="font-medium">
                  {RESOLUTION_PRESETS[aspectRatio].find(p => p.id === resolutionPresetId)?.label || 'Auto'}
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#1a1a1a] border-white/10">
              {RESOLUTION_PRESETS[aspectRatio].map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => onResolutionPresetChange(preset.id)}
                  className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="flex flex-col">
                    <span>{preset.label}</span>
                    {preset.platform && <span className="text-[10px] text-slate-500">{preset.platform}</span>}
                  </div>
                  {resolutionPresetId === preset.id && <Check className="w-3 h-3 text-[#34B27B]" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Cursor enable switch */}
        <div className="flex items-center gap-3 ml-3">
          <div className="flex items-center gap-2 p-1 rounded-md bg-white/5 border border-white/5">
            <div className="text-xs font-medium text-slate-200 mr-2">Cursor</div>
            <Switch
              checked={Boolean(cursorEnabled)}
              onCheckedChange={(v) => onCursorEnabledChange?.(Boolean(v))}
              className="data-[state=checked]:bg-[#34B27B]"
            />
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-[10px] text-slate-500 font-medium">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-sans">{shortcuts.pan}</kbd>
            <span>Pan</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[#34B27B] font-sans">{shortcuts.zoom}</kbd>            
            <span>Zoom</span>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-hidden bg-[#09090b] relative"
        onClick={() => setSelectedKeyframeId(null)}
      >
        <TimelineWrapper
          range={clampedRange}
          videoDuration={timelineDurationMs / 1000}
          hasOverlap={hasOverlap}
          onRangeChange={setRange}
          minItemDurationMs={timelineScale.minItemDurationMs}
          minVisibleRangeMs={timelineScale.minVisibleRangeMs}
          gridSizeMs={timelineScale.gridMs}
          onItemSpanChange={handleItemSpanChange}
        >
          <KeyframeMarkers
            keyframes={[
              ...keyframes,
              ...paddingKeyframes.map(kf => ({ id: kf.id, time: kf.timeMs }))
            ]}
            selectedKeyframeId={selectedKeyframeId}
            setSelectedKeyframeId={setSelectedKeyframeId}
          />
          <Timeline
            items={timelineItems}
            timelineDurationMs={timelineDurationMs}
            seekDurationMs={videoDurationMs}
            intervalMs={timelineScale.intervalMs}
            currentTimeMs={currentTimeMs}
            onSeek={onSeek}
            onSelectClip={onSelectClip}
            onSelectZoom={onSelectZoom}
            onSelectTrim={onSelectTrim}
            onSelectAnnotation={onSelectAnnotation}
            onSelectOverlay={onSelectOverlay}
            onSelectEffect={onSelectEffect}
            onSelectCursor={onSelectCursor}
            onOverlayAssetDrop={onOverlayAssetDrop}
            selectedClipId={selectedClipId}
            selectedZoomId={selectedZoomId}
            selectedTrimId={selectedTrimId}
            selectedAnnotationId={selectedAnnotationId}
            selectedOverlayId={selectedOverlayId}
            selectedEffectId={selectedEffectId}
            selectedCursorId={selectedCursorId}
        />
        </TimelineWrapper>
      </div>
    </div>
  );
}
