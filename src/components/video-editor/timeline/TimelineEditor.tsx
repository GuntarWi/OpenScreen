import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import { useTimelineContext } from "dnd-timeline";
import { Button } from "@/components/ui/button";
import { Plus, Scissors, ZoomIn, ZoomOut, MessageSquare, ChevronDown, Check, Sparkles, Trash2, GripVertical, Volume2, VolumeX, Eye, EyeOff, Gauge, Clapperboard, AudioLines, MousePointer2, Layers3, ImageIcon, Diamond, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import TimelineWrapper from "./TimelineWrapper";
import Row from "./Row";
import Item from "./Item";
import KeyframeMarkers from "./KeyframeMarkers";
import type { Range, Span } from "dnd-timeline";
import type { BackgroundItem, ZoomRegion, TrimRegion, AnnotationRegion, CursorTrack, EffectRegion, CursorSmoothing, VideoAsset, VideoClip, AudioClip, TimelineTrack, TimelineTrackItemType, TimelineTrackTemplate, SpeedRegion } from "../types";
import { RECORDING_ASSET_ID } from "../types";
import { BACKGROUND_TRACK_ID, getBackgroundItemLabel } from "../backgroundUtils";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AspectRatio, getAspectRatioLabel, RESOLUTION_PRESETS } from "@/utils/aspectRatioUtils";
import { formatShortcut } from "@/utils/platformUtils";
import { findClipTransformKeyframeAtTime } from "@/utils/clipTransformKeyframes";
import { TIMELINE_SIDEBAR_WIDTH } from "./constants";

const CURSOR_ITEM_ID = "cursor-track";

const DRAG_GHOST_COLOR: Record<TimelineRenderItem['variant'], string> = {
  background: '#22c55e',
  clip: '#7c3aed',
  audio: '#0ea5e9',
  zoom: '#21916A',
  trim: '#ef4444',
  effect: '#EC4899',
  annotation: '#EC4899',
  cursor: '#4C8BF5',
  speed: '#F59E0B',
};
const FALLBACK_RANGE_MS = 1000;
const TARGET_MARKER_COUNT = 12;
const TIMELINE_SIDEBAR_FALLBACK_WIDTH = TIMELINE_SIDEBAR_WIDTH;
const TIMELINE_FIT_END_BUFFER_MS = 280;
const TIMELINE_SCROLL_TAIL_PX = 220;

interface TimelineEditorProps {
  videoDuration: number;
  currentTime: number;
  onSeek?: (time: number) => void;
  tracks: TimelineTrack[];
  selectedTrackId?: string | null;
  onSelectTrack?: (id: string | null) => void;
  onTrackHeightChange?: (trackId: string, height: number) => void;
  onTrackOrderChange?: (sourceTrackId: string, targetTrackId: string, placement: 'before' | 'after') => void;
  onTrackMuteChange?: (trackId: string, muted: boolean) => void;
  onTrackHiddenChange?: (trackId: string, hidden: boolean) => void;
  onTrackDelete?: (trackId: string) => void;
  onTrackAutoTypeChange?: (trackId: string, itemId: string, itemType: TimelineTrackItemType) => void;
  onCreateTrack?: (template: TimelineTrackTemplate) => void;
  backgroundItems?: BackgroundItem[];
  onBackgroundSpanChange?: (id: string, span: Span) => void;
  onBackgroundDelete?: (id: string) => void;
  onBackgroundTrackChange?: (id: string, trackId: string) => void;
  selectedBackgroundId?: string | null;
  onSelectBackground?: (id: string | null) => void;
  videoClips?: VideoClip[];
  audioClips?: AudioClip[];
  onClipSpanChange?: (id: string, span: Span) => void;
  onClipChange?: (id: string, patch: Partial<VideoClip>) => void;
  onClipTransformKeyframeAddOrUpdate?: (id: string) => void;
  onClipTransformKeyframeDelete?: (id: string, keyframeId: string) => void;
  onPaddingKeyframesChange?: (keyframes: { id: string; timeMs: number; value: number }[]) => void;
  onAudioClipSpanChange?: (id: string, span: Span) => void;
  onClipSplit?: () => void;
  onClipDelete?: (id: string) => void;
  onAudioClipDelete?: (id: string) => void;
  onClipOrderChange?: (orderedIds: string[]) => void;
  onClipTrackChange?: (id: string, trackId: string) => void;
  onAudioClipTrackChange?: (id: string, trackId: string) => void;
  selectedClipId?: string | null;
  selectedAudioClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
  onSelectAudioClip?: (id: string | null) => void;
  zoomRegions: ZoomRegion[];
  onZoomAdded: (span: Span) => void;
  onZoomSpanChange: (id: string, span: Span) => void;
  onZoomDelete: (id: string) => void;
  onZoomTrackChange?: (id: string, trackId: string) => void;
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  trimRegions?: TrimRegion[];
  onTrimAdded?: (span: Span) => void;
  onTrimSpanChange?: (id: string, span: Span) => void;
  onTrimDelete?: (id: string) => void;
  onTrimTrackChange?: (id: string, trackId: string) => void;
  selectedTrimId?: string | null;
  onSelectTrim?: (id: string | null) => void;
  annotationRegions?: AnnotationRegion[];
  onAnnotationAdded?: (span: Span) => void;
  onAnnotationSpanChange?: (id: string, span: Span) => void;
  onAnnotationDelete?: (id: string) => void;
  onAnnotationTrackChange?: (id: string, trackId: string) => void;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  videoAssets?: VideoAsset[];
  onClipAssetDrop?: (assetId: string, startMs: number, trackId?: string) => void;
  onBackgroundAssetDrop?: (assetId: string, startMs?: number, trackId?: string) => void;
  onAudioAssetDrop?: (assetId: string, startMs: number, trackId?: string) => void;
  effectRegions?: EffectRegion[];
  onEffectAdded?: (span: Span) => void;
  onEffectSpanChange?: (id: string, span: Span) => void;
  onEffectDelete?: (id: string) => void;
  onEffectTrackChange?: (id: string, trackId: string) => void;
  selectedEffectId?: string | null;
  onSelectEffect?: (id: string | null) => void;
  speedRegions?: SpeedRegion[];
  onSpeedAdded?: (span: Span) => void;
  onSpeedSpanChange?: (id: string, span: Span) => void;
  onSpeedDelete?: (id: string) => void;
  onSpeedTrackChange?: (id: string, trackId: string) => void;
  selectedSpeedId?: string | null;
  onSelectSpeed?: (id: string | null) => void;
  cursorTrack?: CursorTrack | null;
  onCursorTrackChange?: (trackId: string) => void;
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

interface TimelineKeyframeMarker {
  id: string;
  time: number;
  rawId?: string;
  kind: 'clipTransform' | 'padding';
  color?: string;
  title?: string;
  clipId?: string;
}

interface TimelineRenderItem {
  id: string;
  rowId: string;
  span: Span;
  label: string;
  zoomDepth?: number;
  variant: 'background' | 'zoom' | 'trim' | 'annotation' | 'cursor' | 'effect' | 'clip' | 'audio' | 'speed';
  annotationType?: AnnotationRegion['type'];
  speedValue?: number;
  keyframes?: TimelineKeyframeMarker[];
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

function getTimelineFitEndBufferMs(totalMs: number): number {
  if (totalMs <= 0) {
    return 0;
  }

  return Math.min(600, Math.max(TIMELINE_FIT_END_BUFFER_MS, Math.round(totalMs * 0.08)));
}

function getTimelineScrollTailMs(
  visibleRangeMs: number,
  viewportWidth: number,
  minimumVisibleRangeMs: number,
): number {
  if (visibleRangeMs <= 0 || viewportWidth <= 0) {
    return minimumVisibleRangeMs;
  }

  return Math.max(
    minimumVisibleRangeMs,
    Math.round((visibleRangeMs / viewportWidth) * TIMELINE_SCROLL_TAIL_PX),
  );
}

function createInitialRange(totalMs: number, trailingBufferMs = 0): Range {
  if (totalMs > 0) {
    return { start: 0, end: totalMs + Math.max(0, trailingBufferMs) };
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
  const effectiveSidebarWidth = sidebarWidth || TIMELINE_SIDEBAR_FALLBACK_WIDTH;
  const sideProperty = direction === "rtl" ? "right" : "left";
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !onSeek) return;
      
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left - effectiveSidebarWidth;
      
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
  }, [effectiveSidebarWidth, isDragging, onSeek, timelineRef, range.start, seekDurationMs, pixelsToValue]);

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
        [sideProperty === "right" ? "marginRight" : "marginLeft"]: `${effectiveSidebarWidth}px`,
        pointerEvents: 'none', // Allow clicks to pass through to timeline, but we'll enable pointer events on the handle
      }}
    >
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-[#34B27B] cursor-ew-resize pointer-events-auto"
        style={{
          [sideProperty]: `${offset}px`,
        }}
        onMouseDown={(e) => {
          e.stopPropagation(); // Prevent timeline click
          setIsDragging(true);
        }}
      >
        <div className="absolute inset-y-0 left-1/2 w-[10px] -translate-x-1/2 bg-[#34B27B]/10 pointer-events-none" />
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[#34B27B] shadow-[0_0_0_1px_rgba(52,178,123,0.22)] pointer-events-none" />
        <div
          className="absolute -top-1 left-1/2 -translate-x-1/2 hover:scale-125 transition-transform"
          style={{ width: '16px', height: '16px' }}
        >
          <div className="w-3 h-3 mx-auto mt-[2px] bg-[#34B27B] rotate-45 rounded-sm shadow-[0_0_14px_rgba(52,178,123,0.45)] border border-white/20" />
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
  const effectiveSidebarWidth = sidebarWidth || TIMELINE_SIDEBAR_FALLBACK_WIDTH;
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
    <div className="sticky top-0 z-40 flex h-8 select-none border-b border-white/5 bg-[#09090b]/95 backdrop-blur-sm">
      <div
        className="shrink-0 border-r border-white/5 bg-[#131316]"
        style={{ width: effectiveSidebarWidth }}
      />
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />

        {markers.minorTicks.map((time) => {
          const offset = valueToPixels(time - range.start);
          return (
            <div
              key={`minor-${time}`}
              className="absolute bottom-0 h-1.5 w-[1px] bg-white/10"
              style={{ [sideProperty]: `${offset}px` }}
            />
          );
        })}

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
                <div className="mb-1 h-2.5 w-[1px] bg-white/25" />
                <span
                  className={cn(
                    "text-[10px] font-medium tabular-nums tracking-tight",
                    marker.time === currentTimeMs ? "text-[#34B27B]" : "text-slate-400",
                  )}
                >
                  {marker.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Timeline({
  items,
  tracks,
  selectedTrackId,
  onSelectTrack,
  timelineDurationMs,
  seekDurationMs,
  intervalMs,
  currentTimeMs,
  onSeek,
  onSelectBackground,
  onSelectZoom,
  onSelectTrim,
  onSelectClip,
  onSelectAudioClip,
  onSelectAnnotation,
  onSelectEffect,
  onSelectCursor,
  onClipAssetDrop,
  onBackgroundAssetDrop,
  onAudioAssetDrop,
  onTrackHeightChange,
  onTrackOrderChange,
  onTrackMuteChange,
  onTrackHiddenChange,
  onTrackDelete,
  onTrackAutoTypeChange,
  selectedBackgroundId,
  selectedClipId,
  selectedAudioClipId,
  selectedZoomId,
  selectedTrimId,
  selectedAnnotationId,
  selectedEffectId,
  selectedCursorId,
  selectedSpeedId,
  onSelectSpeed,
  selectedKeyframeIds,
  onSelectKeyframes,
}: {
  items: TimelineRenderItem[];
  tracks: TimelineTrack[];
  selectedTrackId?: string | null;
  onSelectTrack?: (id: string | null) => void;
  timelineDurationMs: number;
  seekDurationMs: number;
  intervalMs: number;
  currentTimeMs: number;
  onSeek?: (time: number) => void;
  onSelectBackground?: (id: string | null) => void;
  onSelectZoom?: (id: string | null) => void;
  onSelectTrim?: (id: string | null) => void;
  onSelectClip?: (id: string | null) => void;
  onSelectAudioClip?: (id: string | null) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onSelectEffect?: (id: string | null) => void;
  onSelectCursor?: (id: string | null) => void;
  onClipAssetDrop?: (assetId: string, startMs: number, trackId?: string) => void;
  onBackgroundAssetDrop?: (assetId: string, startMs?: number, trackId?: string) => void;
  onAudioAssetDrop?: (assetId: string, startMs: number, trackId?: string) => void;
  onTrackHeightChange?: (trackId: string, height: number) => void;
  onTrackOrderChange?: (sourceTrackId: string, targetTrackId: string, placement: 'before' | 'after') => void;
  onTrackMuteChange?: (trackId: string, muted: boolean) => void;
  onTrackHiddenChange?: (trackId: string, hidden: boolean) => void;
  onTrackDelete?: (trackId: string) => void;
  onTrackAutoTypeChange?: (trackId: string, itemId: string, itemType: TimelineTrackItemType) => void;
  selectedBackgroundId?: string | null;
  selectedClipId?: string | null;
  selectedAudioClipId?: string | null;
  selectedZoomId: string | null;
  selectedTrimId?: string | null;
  selectedAnnotationId?: string | null;
  selectedEffectId?: string | null;
  selectedCursorId?: string | null;
  selectedSpeedId?: string | null;
  onSelectSpeed?: (id: string | null) => void;
  selectedKeyframeIds?: string[];
  onSelectKeyframes?: (ids: string[]) => void;
}) {
  const { setTimelineRef, style, sidebarWidth, range, pixelsToValue, valueToPixels } = useTimelineContext();
  const effectiveSidebarWidth = sidebarWidth || TIMELINE_SIDEBAR_FALLBACK_WIDTH;
  const localTimelineRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ trackId: string; startY: number; startHeight: number } | null>(null);
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ trackId: string; placement: 'before' | 'after' } | null>(null);

  const setRefs = useCallback((node: HTMLDivElement | null) => {
    setTimelineRef(node);
    localTimelineRef.current = node;
  }, [setTimelineRef]);

  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || seekDurationMs <= 0) return;
    
    // Only clear selection if clicking on empty space (not on items)
    // This is handled by event propagation - items stop propagation
    onSelectClip?.(null);
    onSelectAudioClip?.(null);
    onSelectBackground?.(null);
    onSelectZoom?.(null);
    onSelectTrim?.(null);
    onSelectAnnotation?.(null);
    onSelectEffect?.(null);
    onSelectCursor?.(null);
    onSelectKeyframes?.([]);

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left - effectiveSidebarWidth;
    
    if (clickX < 0) return;
    
    const relativeMs = pixelsToValue(clickX);
    const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, seekDurationMs));
    const timeInSeconds = absoluteMs / 1000;
    
    onSeek(timeInSeconds);
  }, [onSeek, onSelectClip, onSelectAudioClip, onSelectBackground, onSelectZoom, onSelectTrim, onSelectAnnotation, onSelectEffect, onSelectCursor, onSelectKeyframes, seekDurationMs, effectiveSidebarWidth, range.start, pixelsToValue]);

  const handleMediaDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (draggingTrackId) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      return;
    }

    if (!onClipAssetDrop && !onAudioAssetDrop && !onBackgroundAssetDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [draggingTrackId, onAudioAssetDrop, onBackgroundAssetDrop, onClipAssetDrop]);

  const getDropPlacement = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    return event.clientY < midpoint ? 'before' as const : 'after' as const;
  }, []);

  const handleRowDrop = useCallback((event: React.DragEvent<HTMLDivElement>, track: TimelineTrack) => {
    const sourceTrackId = draggingTrackId;
    if (sourceTrackId) {
      event.preventDefault();
      event.stopPropagation();
      const placement = getDropPlacement(event);
      setDropIndicator(null);
      setDraggingTrackId(null);
      if (sourceTrackId !== track.id) {
        onTrackOrderChange?.(sourceTrackId, track.id, placement);
      }
      return;
    }

    if (!localTimelineRef.current) return;
    const assetId = event.dataTransfer.getData('application/x-clip-asset');
    const audioAssetId = event.dataTransfer.getData('application/x-audio-asset');
    if (!assetId && !audioAssetId) return;
    event.preventDefault();
    if (track.type === 'recording') {
      return;
    }
    const rect = localTimelineRef.current.getBoundingClientRect();
    const dropX = event.clientX - rect.left - effectiveSidebarWidth;
    if (dropX < 0) return;
    const relativeMs = pixelsToValue(dropX);
    const absoluteMs = Math.max(0, range.start + relativeMs);
    if (assetId) {
      if (track.type === 'background') {
        onBackgroundAssetDrop?.(assetId, absoluteMs, track.id);
        return;
      }
      if (track.itemType !== 'mixed' && track.itemType !== 'videoClip') {
        onTrackAutoTypeChange?.(track.id, assetId, 'videoClip');
      }
      onClipAssetDrop?.(assetId, absoluteMs, track.id);
    } else if (audioAssetId) {
      if (track.itemType !== 'mixed' && track.itemType !== 'audioClip') {
        onTrackAutoTypeChange?.(track.id, audioAssetId, 'audioClip');
      }
      onAudioAssetDrop?.(audioAssetId, absoluteMs, track.id);
    }
  }, [draggingTrackId, getDropPlacement, onAudioAssetDrop, onBackgroundAssetDrop, onClipAssetDrop, onTrackAutoTypeChange, onTrackOrderChange, effectiveSidebarWidth, range.start, pixelsToValue]);

  const itemsByRow = useMemo(() => {
    const map = new Map<string, TimelineRenderItem[]>();
    items.forEach((item) => {
      const list = map.get(item.rowId);
      if (list) {
        list.push(item);
      } else {
        map.set(item.rowId, [item]);
      }
    });
    return map;
  }, [items]);

  const [dragPreview, setDragPreview] = useState<{
    activeId: string;
    sourceRowId: string;
    overRowId: string;
    variant: TimelineRenderItem['variant'];
    span: Span;
  } | null>(null);

  useDndMonitor({
    onDragStart: (event) => {
      const id = event.active.id as string;
      const item = items.find((i) => i.id === id);
      if (!item) return;
      setDragPreview({ activeId: id, sourceRowId: item.rowId, overRowId: item.rowId, variant: item.variant, span: item.span });
    },
    onDragMove: (event) => {
      const id = event.active.id as string;
      const item = items.find((i) => i.id === id);
      if (!item || !localTimelineRef.current) return;
      const translated = event.active.rect.current.translated;
      if (!translated) return;
      const timelineLeft = localTimelineRef.current.getBoundingClientRect().left;
      const itemX = translated.left - (timelineLeft + effectiveSidebarWidth);
      const rawStart = range.start + pixelsToValue(itemX);
      const duration = item.span.end - item.span.start;
      const start = Math.max(0, rawStart);
      const overRowId = (event.over?.id as string | undefined) ?? item.rowId;
      setDragPreview({ activeId: id, sourceRowId: item.rowId, overRowId, variant: item.variant, span: { start, end: start + duration } });
    },
    onDragEnd: () => setDragPreview(null),
    onDragCancel: () => setDragPreview(null),
  });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }
      onTrackHeightChange?.(state.trackId, state.startHeight + (event.clientY - state.startY));
    };

    const handleMouseUp = () => {
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onTrackHeightChange]);

  const beginTrackResize = useCallback((event: React.MouseEvent<HTMLDivElement>, track: TimelineTrack) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      trackId: track.id,
      startY: event.clientY,
      startHeight: track.collapsed ? 36 : track.height,
    };
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleTrackDragStart = useCallback((event: React.DragEvent<HTMLDivElement>, trackId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-track-id', trackId);
    event.dataTransfer.setData('text/plain', trackId);
    setDraggingTrackId(trackId);
    setDropIndicator(null);
  }, []);

  const handleTrackDragEnd = useCallback(() => {
    setDraggingTrackId(null);
    setDropIndicator(null);
  }, []);

  const handleTrackDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, trackId: string) => {
    const sourceTrackId = draggingTrackId;
    if (!sourceTrackId || sourceTrackId === trackId || sourceTrackId === BACKGROUND_TRACK_ID || trackId === BACKGROUND_TRACK_ID) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropIndicator({
      trackId,
      placement: getDropPlacement(event),
    });
  }, [draggingTrackId, getDropPlacement]);

  const handleTrackDrop = useCallback((event: React.DragEvent<HTMLDivElement>, targetTrackId: string) => {
    const sourceTrackId = draggingTrackId;
    const placement = getDropPlacement(event);
    setDropIndicator(null);
    setDraggingTrackId(null);
    if (!sourceTrackId || sourceTrackId === targetTrackId || sourceTrackId === BACKGROUND_TRACK_ID || targetTrackId === BACKGROUND_TRACK_ID) {
      return;
    }
    event.preventDefault();
    onTrackOrderChange?.(sourceTrackId, targetTrackId, placement);
  }, [draggingTrackId, getDropPlacement, onTrackOrderChange]);

  const getTrackTypeIcon = useCallback((track: TimelineTrack) => {
    switch (track.type) {
      case 'background':
        return <ImageIcon className="h-3.5 w-3.5" />;
      case 'recording':
      case 'video':
        return <Clapperboard className="h-3.5 w-3.5" />;
      case 'generic':
        return <Layers3 className="h-3.5 w-3.5" />;
      case 'audio':
        return <AudioLines className="h-3.5 w-3.5" />;
      case 'zoom':
        return <ZoomIn className="h-3.5 w-3.5" />;
      case 'trim':
        return <Scissors className="h-3.5 w-3.5" />;
      case 'effect':
        return <Sparkles className="h-3.5 w-3.5" />;
      case 'annotation':
        return <MessageSquare className="h-3.5 w-3.5" />;
      case 'cursor':
        return <MousePointer2 className="h-3.5 w-3.5" />;
      case 'speed':
        return <Gauge className="h-3.5 w-3.5" />;
      default:
        return <Clapperboard className="h-3.5 w-3.5" />;
    }
  }, []);

  const renderTrackLabel = useCallback((track: TimelineTrack) => (
    <div
      className={cn(
        "relative flex w-full items-center gap-1 rounded-md px-1 text-[11px] text-slate-300 transition-colors",
        draggingTrackId === track.id && "opacity-50",
        track.hidden && "opacity-55",
        selectedTrackId === track.id && "bg-white/10 ring-1 ring-[#34B27B]/40",
        dropIndicator?.trackId === track.id && "bg-white/5 ring-1 ring-white/10",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelectTrack?.(track.id);
      }}
      onDragOver={(event) => handleTrackDragOver(event, track.id)}
      onDragLeave={() => setDropIndicator((current) => (current?.trackId === track.id ? null : current))}
      onDrop={(event) => handleTrackDrop(event, track.id)}
      title={track.name}
    >
      <div
        draggable={track.type !== 'recording' && track.type !== 'background'}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-slate-400 transition",
          track.type !== 'recording' && track.type !== 'background'
            ? "hover:bg-white/10 hover:text-slate-200 cursor-grab active:cursor-grabbing"
            : "opacity-40 cursor-default",
        )}
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => handleTrackDragStart(event, track.id)}
        onDragEnd={handleTrackDragEnd}
        title={track.type === 'background' ? 'Background track stays fixed at the bottom' : track.type === 'recording' ? 'Recording track stays fixed' : 'Drag to reorder track'}
      >
        <GripVertical className="h-3 w-3" />
      </div>
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-slate-400"
        title={track.name}
      >
        {getTrackTypeIcon(track)}
      </div>
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
        onClick={(event) => {
          event.stopPropagation();
          onTrackHiddenChange?.(track.id, !track.hidden);
        }}
        title={track.hidden ? 'Show track' : 'Hide track'}
      >
        {track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        type="button"
        disabled={track.type === 'recording' || track.type === 'background'}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-slate-400 transition hover:bg-[#ef4444]/10 hover:text-[#ef4444] disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-slate-400"
        onClick={(event) => {
          event.stopPropagation();
          if (track.type === 'recording' || track.type === 'background') {
            return;
          }
          onTrackDelete?.(track.id);
        }}
        title={track.type === 'background' ? 'Background track cannot be deleted' : track.type === 'recording' ? 'Recording track cannot be deleted' : 'Delete track'}
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {track.type !== 'recording' && track.type !== 'background' ? (
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
          onClick={(event) => {
            event.stopPropagation();
            onTrackMuteChange?.(track.id, !track.muted);
          }}
          title={track.muted ? 'Unmute track' : 'Mute track'}
        >
          {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
        </button>
      ) : null}
      <div
        className="absolute inset-x-0 bottom-[-7px] h-3 cursor-ns-resize"
        onMouseDown={(event) => beginTrackResize(event, track)}
        title="Drag to resize track"
      >
        <div className="mx-auto mt-[5px] h-[2px] w-10 rounded-full bg-white/10" />
      </div>
    </div>
  ), [beginTrackResize, draggingTrackId, dropIndicator, getTrackTypeIcon, handleTrackDragEnd, handleTrackDragOver, handleTrackDragStart, handleTrackDrop, onSelectTrack, onTrackDelete, onTrackHiddenChange, onTrackMuteChange, selectedTrackId]);

  return (
    <div
      ref={setRefs}
      style={style}
      className="select-none bg-[#09090b] min-h-[140px] min-w-0 relative cursor-pointer group h-full overflow-hidden"
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
      <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {tracks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((track) => (
            <Row
              key={track.id}
              id={track.id}
              height={track.collapsed ? 36 : track.height}
              selected={selectedTrackId === track.id}
              sidebar={renderTrackLabel(track)}
              indicatorPlacement={dropIndicator?.trackId === track.id ? dropIndicator.placement : null}
              onClick={(event) => {
                event.stopPropagation();
                onSelectTrack?.(track.id);
              }}
              onDrop={(event) => handleRowDrop(event, track)}
              onDragOver={handleMediaDragOver}
              onDragLeave={() => setDropIndicator((current) => (current?.trackId === track.id ? null : current))}
            >
              {dragPreview && dragPreview.overRowId === track.id && dragPreview.overRowId !== dragPreview.sourceRowId && (() => {
                const ghostLeft = valueToPixels(Math.max(0, dragPreview.span.start) - range.start);
                const ghostWidth = Math.max(4, valueToPixels(dragPreview.span.end - dragPreview.span.start));
                const color = DRAG_GHOST_COLOR[dragPreview.variant];
                return (
                  <div
                    key="drag-ghost"
                    className="absolute pointer-events-none z-50"
                    style={{
                      left: ghostLeft,
                      width: ghostWidth,
                      top: 2,
                      bottom: 2,
                      borderRadius: 6,
                      border: `2px solid ${color}`,
                      backgroundColor: `${color}26`,
                    }}
                  />
                );
              })()}
              {(itemsByRow.get(track.id) ?? []).map((item) => (
                <Item
                  id={item.id}
                  key={item.id}
                  rowId={item.rowId}
                  span={item.span}
                  trackHeight={track.collapsed ? 36 : track.height}
                  isSelected={
                    (item.variant === 'background' && item.id === selectedBackgroundId) ||
                    (item.variant === 'clip' && item.id === selectedClipId) ||
                    (item.variant === 'audio' && item.id === selectedAudioClipId) ||
                    (item.variant === 'zoom' && item.id === selectedZoomId) ||
                    (item.variant === 'trim' && item.id === selectedTrimId) ||
                    (item.variant === 'effect' && item.id === selectedEffectId) ||
                    (item.variant === 'cursor' && item.id === selectedCursorId) ||
                    (item.variant === 'annotation' && item.id === selectedAnnotationId) ||
                    (item.variant === 'speed' && item.id === selectedSpeedId)
                  }
                  onSelect={() => {
                    switch (item.variant) {
                      case 'background':
                        onSelectBackground?.(item.id);
                        break;
                      case 'clip':
                        onSelectClip?.(item.id);
                        break;
                      case 'audio':
                        onSelectAudioClip?.(item.id);
                        break;
                      case 'zoom':
                        onSelectZoom?.(item.id);
                        break;
                      case 'trim':
                        onSelectTrim?.(item.id);
                        break;
                      case 'effect':
                        onSelectEffect?.(item.id);
                        break;
                      case 'cursor':
                        onSelectCursor?.(item.id);
                        break;
                      case 'annotation':
                        onSelectAnnotation?.(item.id);
                        break;
                      case 'speed':
                        onSelectSpeed?.(item.id);
                        break;
                      default:
                        break;
                    }
                  }}
                  variant={item.variant}
                  zoomDepth={item.zoomDepth}
                  annotationType={item.annotationType}
                  speedValue={item.speedValue}
                  keyframes={item.keyframes?.map((keyframe) => ({
                    id: keyframe.id,
                    time: keyframe.time,
                    isSelected: (selectedKeyframeIds ?? []).includes(keyframe.id),
                    isCurrent: Math.abs(keyframe.time - currentTimeMs) <= 50,
                  }))}
                  onKeyframeSelect={(keyframeId, time, mode) => {
                    onSelectClip?.(item.id);
                    if (mode === "toggle") {
                      const nextSelection = (selectedKeyframeIds ?? []).includes(keyframeId)
                        ? (selectedKeyframeIds ?? []).filter((id) => id !== keyframeId)
                        : [...(selectedKeyframeIds ?? []), keyframeId];
                      onSelectKeyframes?.(nextSelection);
                    } else {
                      onSelectKeyframes?.([keyframeId]);
                    }
                    onSeek?.(time / 1000);
                  }}
                >
                  {item.label}
                </Item>
              ))}
            </Row>
          ))}
      </div>
    </div>
  );
}

export default function TimelineEditor({
  videoDuration,
  currentTime,
  onSeek,
  tracks,
  selectedTrackId,
  onSelectTrack,
  onTrackHeightChange,
  onTrackOrderChange,
  onTrackMuteChange,
  onTrackHiddenChange,
  onTrackDelete,
  onTrackAutoTypeChange,
  onCreateTrack,
  backgroundItems = [],
  onBackgroundSpanChange,
  onBackgroundDelete,
  onBackgroundTrackChange,
  selectedBackgroundId,
  onSelectBackground,
  videoClips = [],
  audioClips = [],
  onClipSpanChange,
  onClipChange,
  onClipTransformKeyframeAddOrUpdate,
  onPaddingKeyframesChange,
  onAudioClipSpanChange,
  onClipSplit,
  onClipDelete,
  onAudioClipDelete,
  onClipOrderChange,
  onClipTrackChange,
  onAudioClipTrackChange,
  selectedClipId,
  selectedAudioClipId,
  onSelectClip,
  onSelectAudioClip,
  zoomRegions,
  onZoomAdded,
  onZoomSpanChange,
  onZoomDelete,
  onZoomTrackChange,
  selectedZoomId,
  onSelectZoom,
  trimRegions = [],
  onTrimAdded,
  onTrimSpanChange,
  onTrimDelete,
  onTrimTrackChange,
  selectedTrimId,
  onSelectTrim,
  annotationRegions = [],
  onAnnotationAdded,
  onAnnotationSpanChange,
  onAnnotationDelete,
  onAnnotationTrackChange,
  selectedAnnotationId,
  onSelectAnnotation,
  videoAssets = [],
  onClipAssetDrop,
  onBackgroundAssetDrop,
  onAudioAssetDrop,
  effectRegions = [],
  onEffectAdded,
  onEffectSpanChange,
  onEffectDelete,
  onEffectTrackChange,
  selectedEffectId,
  onSelectEffect,
  speedRegions = [],
  onSpeedAdded,
  onSpeedSpanChange,
  onSpeedDelete,
  onSpeedTrackChange,
  selectedSpeedId,
  onSelectSpeed,
  cursorTrack,
  onCursorTrackChange,
  selectedCursorId,
  onSelectCursor,
  cursorEnabled,
  onCursorEnabledChange,
  aspectRatio,
  onAspectRatioChange,
  resolutionPresetId,
  paddingKeyframes = [],
  onResolutionPresetChange,
}: TimelineEditorProps) {
  const videoDurationMs = useMemo(() => Math.max(0, Math.round(videoDuration * 1000)), [videoDuration]);
  const backgroundMaxEndMs = useMemo(
    () => backgroundItems.reduce((max, item) => Math.max(max, item.endMs), 0),
    [backgroundItems],
  );
  const clipMaxEndMs = useMemo(
    () => videoClips.reduce((max, clip) => Math.max(max, clip.endMs), 0),
    [videoClips],
  );
  const audioMaxEndMs = useMemo(
    () => audioClips.reduce((max, clip) => Math.max(max, clip.endMs), 0),
    [audioClips],
  );
  const timelineDurationMs = useMemo(
    () => Math.max(videoDurationMs, backgroundMaxEndMs, clipMaxEndMs, audioMaxEndMs),
    [videoDurationMs, backgroundMaxEndMs, clipMaxEndMs, audioMaxEndMs],
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
  const clipTrackOrder = useMemo(
    () => [...videoClips].sort((a, b) => b.zIndex - a.zIndex),
    [videoClips],
  );
  const clipOrderIds = useMemo(
    () => clipTrackOrder.map((clip) => clip.id),
    [clipTrackOrder],
  );
  const isRecordingClip = useCallback(
    (clip: VideoClip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID,
    [],
  );

  const [range, setRange] = useState<Range>(() => createInitialRange(timelineDurationMs, getTimelineFitEndBufferMs(timelineDurationMs)));
  const [selectedKeyframeIds, setSelectedKeyframeIds] = useState<string[]>([]);
  const pendingKeyframeSelectionTimeRef = useRef<number | null>(null);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const timelineSelectionAreaRef = useRef<HTMLDivElement | null>(null);
  const suppressClearKeyframeClickRef = useRef(false);
  const horizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const previousTimelineDurationMsRef = useRef(timelineDurationMs);
  const syncingHorizontalScrollRef = useRef(false);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [boxSelection, setBoxSelection] = useState<null | {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }>(null);
  const [shortcuts, setShortcuts] = useState({
    pan: 'Shift + Ctrl + Scroll',
    zoom: 'Ctrl + Scroll'
  });
  const initialFitBufferMs = useMemo(
    () => getTimelineFitEndBufferMs(timelineDurationMs),
    [timelineDurationMs],
  );
  const initialVisibleRangeMs = useMemo(
    () => Math.max(1, timelineDurationMs + initialFitBufferMs),
    [initialFitBufferMs, timelineDurationMs],
  );
  const scrollTailMs = useMemo(
    () => getTimelineScrollTailMs(initialVisibleRangeMs, timelineViewportWidth, timelineScale.minVisibleRangeMs),
    [initialVisibleRangeMs, timelineScale.minVisibleRangeMs, timelineViewportWidth],
  );
  const scrollableTimelineDurationMs = useMemo(
    () => timelineDurationMs + initialFitBufferMs + scrollTailMs,
    [initialFitBufferMs, scrollTailMs, timelineDurationMs],
  );
  const selectedKeyframeId = selectedKeyframeIds[0] ?? null;
  const selectedClip = useMemo(
    () => selectedClipId ? videoClips.find((clip) => clip.id === selectedClipId) ?? null : null,
    [selectedClipId, videoClips],
  );
  const selectedTransformClip = useMemo(
    () => selectedClip ?? null,
    [selectedClip],
  );
  const canKeyframeSelectedClip = Boolean(
    selectedTransformClip &&
    currentTimeMs >= selectedTransformClip.startMs &&
    currentTimeMs <= selectedTransformClip.endMs,
  );
  const selectedTransformKeyframeAtPlayhead = useMemo(
    () => selectedTransformClip
      ? findClipTransformKeyframeAtTime(selectedTransformClip.transformKeyframes, currentTimeMs)
      : null,
    [currentTimeMs, selectedTransformClip],
  );
  const timelineKeyframes = useMemo(() => {
    const clipMarkers = clipTrackOrder
      .flatMap((clip) => (clip.transformKeyframes ?? []).map((keyframe) => ({
        id: `clip-transform:${keyframe.id}`,
        time: keyframe.timeMs,
        rawId: keyframe.id,
        kind: 'clipTransform' as const,
        color: '#34B27B',
        title: `Transform keyframe @ ${(keyframe.timeMs / 1000).toFixed(2)}s`,
        clipId: clip.id,
      })));

    const paddingMarkers = paddingKeyframes.map((keyframe) => ({
      id: `padding:${keyframe.id}`,
      time: keyframe.timeMs,
      rawId: keyframe.id,
      kind: 'padding' as const,
      color: '#f59e0b',
      title: `Screen keyframe @ ${(keyframe.timeMs / 1000).toFixed(2)}s`,
    }));

    return [...clipMarkers, ...paddingMarkers].sort((a, b) => a.time - b.time);
  }, [clipTrackOrder, paddingKeyframes]);
  const selectedTimelineKeyframes = useMemo(
    () => timelineKeyframes.filter((keyframe) => selectedKeyframeIds.includes(keyframe.id)),
    [selectedKeyframeIds, timelineKeyframes],
  );

  const zoomByFactor = useCallback((factor: number) => {
    setRange((prev) => {
      const currentSpan = Math.max(1, prev.end - prev.start);
      const desiredSpan = Math.max(timelineScale.minVisibleRangeMs, Math.round(currentSpan * factor));
      const maxSpan = Math.max(scrollableTimelineDurationMs || desiredSpan, desiredSpan);
      const nextSpan = Math.min(desiredSpan, maxSpan);
      const center = prev.start + currentSpan / 2;
      let start = Math.round(center - nextSpan / 2);
      let end = start + nextSpan;

      if (scrollableTimelineDurationMs > 0) {
        if (start < 0) {
          start = 0;
          end = nextSpan;
        }
        if (end > scrollableTimelineDurationMs) {
          end = scrollableTimelineDurationMs;
          start = Math.max(0, end - nextSpan);
        }
      }

      return { start, end };
    });
  }, [scrollableTimelineDurationMs, timelineScale.minVisibleRangeMs]);

  const handleZoomInRange = useCallback(() => zoomByFactor(0.7), [zoomByFactor]);
  const handleZoomOutRange = useCallback(() => zoomByFactor(1.4), [zoomByFactor]);
  const handleZoomResetRange = useCallback(() => {
    setRange(createInitialRange(timelineDurationMs, initialFitBufferMs));
  }, [initialFitBufferMs, timelineDurationMs]);

  useEffect(() => {
    formatShortcut(['shift', 'mod', 'Scroll']).then(pan => {
      formatShortcut(['mod', 'Scroll']).then(zoom => {
        setShortcuts({ pan, zoom });
      });
    });
  }, []);

  useEffect(() => {
    setSelectedKeyframeIds((prev) => prev.filter((id) => timelineKeyframes.some((keyframe) => keyframe.id === id)));
  }, [timelineKeyframes]);

  const beginBoxSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-keyframe-marker="true"]') ||
      target.closest('[data-timeline-item="true"]') ||
      target.closest('button, input, select, textarea, [role="button"]')
    ) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    setBoxSelection({ startX, startY, endX: startX, endY: startY });
  }, []);

  useEffect(() => {
    if (!boxSelection) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const container = timelineSelectionAreaRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setBoxSelection((current) => (
        current
          ? {
              ...current,
              endX: event.clientX - rect.left,
              endY: event.clientY - rect.top,
            }
          : current
      ));
    };

    const handlePointerUp = () => {
      setBoxSelection((current) => {
        if (!current) return current;
        const minX = Math.min(current.startX, current.endX);
        const minY = Math.min(current.startY, current.endY);
        const maxX = Math.max(current.startX, current.endX);
        const maxY = Math.max(current.startY, current.endY);
        const dragDistance = Math.abs(current.endX - current.startX) + Math.abs(current.endY - current.startY);
        if (dragDistance < 6) {
          return null;
        }

        const container = timelineSelectionAreaRef.current;
        if (!container) {
          return null;
        }
        const containerRect = container.getBoundingClientRect();
        const nextSelection = Array.from(container.querySelectorAll<HTMLElement>('[data-keyframe-id]'))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const left = rect.left - containerRect.left;
            const right = rect.right - containerRect.left;
            const top = rect.top - containerRect.top;
            const bottom = rect.bottom - containerRect.top;
            return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
          })
          .map((node) => node.dataset.keyframeId)
          .filter((id): id is string => Boolean(id));
        suppressClearKeyframeClickRef.current = true;
        setSelectedKeyframeIds(nextSelection);
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [boxSelection]);

  useEffect(() => {
    const pendingTime = pendingKeyframeSelectionTimeRef.current;
    if (!selectedTransformClip || pendingTime === null) {
      return;
    }

    const keyframe = findClipTransformKeyframeAtTime(selectedTransformClip.transformKeyframes, pendingTime);
    if (!keyframe) {
      return;
    }

    setSelectedKeyframeIds([`clip-transform:${keyframe.id}`]);
    pendingKeyframeSelectionTimeRef.current = null;
  }, [selectedTransformClip]);

  const addKeyframe = useCallback(() => {
    if (!selectedTransformClip || !onClipTransformKeyframeAddOrUpdate || !canKeyframeSelectedClip) {
      return;
    }

    pendingKeyframeSelectionTimeRef.current = currentTimeMs;
    onClipTransformKeyframeAddOrUpdate(selectedTransformClip.id);
  }, [
    canKeyframeSelectedClip,
    currentTimeMs,
    onClipTransformKeyframeAddOrUpdate,
    selectedTransformClip,
  ]);

  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedTimelineKeyframes.length) return;

    const clipGroups = new Map<string, string[]>();
    const paddingIds: string[] = [];

    selectedTimelineKeyframes.forEach((keyframe) => {
      if (keyframe.kind === 'clipTransform' && keyframe.clipId) {
        const list = clipGroups.get(keyframe.clipId) ?? [];
        list.push(keyframe.rawId ?? keyframe.id);
        clipGroups.set(keyframe.clipId, list);
      } else if (keyframe.kind === 'padding' && keyframe.rawId) {
        paddingIds.push(keyframe.rawId);
      }
    });

    clipGroups.forEach((keyframeIds, clipId) => {
      const clip = videoClips.find((item) => item.id === clipId);
      if (!clip || !onClipChange) return;
      onClipChange(clipId, {
        transformKeyframes: (clip.transformKeyframes ?? []).filter((keyframe) => !keyframeIds.includes(keyframe.id)),
      });
    });

    if (paddingIds.length && onPaddingKeyframesChange) {
      onPaddingKeyframesChange(paddingKeyframes.filter((keyframe) => !paddingIds.includes(keyframe.id)));
    } else if (paddingIds.length) {
      toast.info('Screen keyframes are edited in the Screen panel');
    }

    setSelectedKeyframeIds([]);
  }, [onClipChange, onPaddingKeyframesChange, paddingKeyframes, selectedTimelineKeyframes, videoClips]);

  const duplicateSelectedKeyframes = useCallback(() => {
    if (!selectedTimelineKeyframes.length) return;

    const earliestTime = Math.min(...selectedTimelineKeyframes.map((keyframe) => keyframe.time));
    const nextSelectedIds: string[] = [];
    const clipGroups = new Map<string, string[]>();
    const paddingIds: string[] = [];

    selectedTimelineKeyframes.forEach((keyframe) => {
      if (keyframe.kind === 'clipTransform' && keyframe.clipId) {
        const list = clipGroups.get(keyframe.clipId) ?? [];
        list.push(keyframe.rawId ?? keyframe.id);
        clipGroups.set(keyframe.clipId, list);
      } else if (keyframe.kind === 'padding' && keyframe.rawId) {
        paddingIds.push(keyframe.rawId);
      }
    });

    clipGroups.forEach((keyframeIds, clipId) => {
      const clip = videoClips.find((item) => item.id === clipId);
      if (!clip || !onClipChange) return;
      const duplicates = (clip.transformKeyframes ?? [])
        .filter((keyframe) => keyframeIds.includes(keyframe.id))
        .map((keyframe) => {
          const newId = `clip-transform-${Math.round(currentTimeMs)}-${Math.random().toString(36).slice(2, 8)}`;
          nextSelectedIds.push(`clip-transform:${newId}`);
          return {
            ...keyframe,
            id: newId,
            timeMs: Math.max(0, Math.round(currentTimeMs + (keyframe.timeMs - earliestTime))),
          };
        });

      onClipChange(clipId, {
        transformKeyframes: [...(clip.transformKeyframes ?? []), ...duplicates],
      });
    });

    if (paddingIds.length && onPaddingKeyframesChange) {
      const duplicates = paddingKeyframes
        .filter((keyframe) => paddingIds.includes(keyframe.id))
        .map((keyframe) => {
          const newId = `padding-${Math.round(currentTimeMs)}-${Math.random().toString(36).slice(2, 8)}`;
          nextSelectedIds.push(`padding:${newId}`);
          return {
            ...keyframe,
            id: newId,
            timeMs: Math.max(0, Math.round(currentTimeMs + (keyframe.timeMs - earliestTime))),
          };
        });
      onPaddingKeyframesChange([...paddingKeyframes, ...duplicates]);
    }

    if (nextSelectedIds.length) {
      setSelectedKeyframeIds(nextSelectedIds);
    }
  }, [currentTimeMs, onClipChange, onPaddingKeyframesChange, paddingKeyframes, selectedTimelineKeyframes, videoClips]);

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

  const deleteSelectedAudioClip = useCallback(() => {
    if (!selectedAudioClipId || !onAudioClipDelete || !onSelectAudioClip) return;
    onAudioClipDelete(selectedAudioClipId);
    onSelectAudioClip(null);
  }, [selectedAudioClipId, onAudioClipDelete, onSelectAudioClip]);

  const deleteSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
    onAnnotationDelete(selectedAnnotationId);
    onSelectAnnotation(null);
  }, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

  const deleteSelectedSpeed = useCallback(() => {
    if (!selectedSpeedId || !onSpeedDelete || !onSelectSpeed) return;
    onSpeedDelete(selectedSpeedId);
    onSelectSpeed(null);
  }, [selectedSpeedId, onSpeedDelete, onSelectSpeed]);

  useEffect(() => {
    if (videoDurationMs === 0) return;
    setRange(createInitialRange(timelineDurationMs, initialFitBufferMs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDurationMs]); // intentionally excludes timelineDurationMs/initialFitBufferMs: only reset view on video/project change, not on clip additions

  useEffect(() => {
    const previousTimelineDurationMs = previousTimelineDurationMsRef.current;
    previousTimelineDurationMsRef.current = timelineDurationMs;

    if (previousTimelineDurationMs <= 0 || timelineDurationMs <= previousTimelineDurationMs) {
      return;
    }

    const previousFitRange = createInitialRange(
      previousTimelineDurationMs,
      getTimelineFitEndBufferMs(previousTimelineDurationMs),
    );
    const wasShowingFullTimeline =
      Math.abs(range.start - previousFitRange.start) <= 1 &&
      Math.abs(range.end - previousFitRange.end) <= 1;

    if (!wasShowingFullTimeline) {
      return;
    }

    setRange(createInitialRange(timelineDurationMs, initialFitBufferMs));
  }, [initialFitBufferMs, range.end, range.start, timelineDurationMs]);

  useEffect(() => {
    if (videoDurationMs === 0 || safeMinDurationMs <= 0) {
      return;
    }

    zoomRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, videoDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(videoDurationMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, Math.max(0, videoDurationMs - safeMinDurationMs)));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, videoDurationMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onZoomSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    trimRegions.forEach((region) => {
      const clampedStart = Math.max(0, Math.min(region.startMs, videoDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(videoDurationMs, Math.max(minEnd, region.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, Math.max(0, videoDurationMs - safeMinDurationMs)));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, videoDurationMs));

      if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
        onTrimSpanChange?.(region.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    videoClips.forEach((clip) => {
      if (!onClipSpanChange) return;
      const maxEnd = timelineDurationMs;
      if (maxEnd <= 0) return;
      const clampedStart = Math.max(0, Math.min(clip.startMs, maxEnd));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(maxEnd, Math.max(minEnd, clip.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, Math.max(0, maxEnd - safeMinDurationMs)));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, maxEnd));

      if (normalizedStart !== clip.startMs || normalizedEnd !== clip.endMs) {
        onClipSpanChange(clip.id, { start: normalizedStart, end: normalizedEnd });
      }
    });

    audioClips.forEach((clip) => {
      if (!onAudioClipSpanChange) return;
      if (timelineDurationMs <= 0) return;
      const clampedStart = Math.max(0, Math.min(clip.startMs, timelineDurationMs));
      const minEnd = clampedStart + safeMinDurationMs;
      const clampedEnd = Math.min(timelineDurationMs, Math.max(minEnd, clip.endMs));
      const normalizedStart = Math.max(0, Math.min(clampedStart, Math.max(0, timelineDurationMs - safeMinDurationMs)));
      const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, timelineDurationMs));

      if (normalizedStart !== clip.startMs || normalizedEnd !== clip.endMs) {
        onAudioClipSpanChange(clip.id, { start: normalizedStart, end: normalizedEnd });
      }
    });
  }, [zoomRegions, trimRegions, videoClips, audioClips, videoDurationMs, timelineDurationMs, safeMinDurationMs, onZoomSpanChange, onTrimSpanChange, onClipSpanChange, onAudioClipSpanChange]);

  const hasOverlap = useCallback((newSpan: Span, excludeId?: string, targetRowId?: string | null): boolean => {
    // Determine which row the item belongs to
    const isZoomItem = zoomRegions.some(r => r.id === excludeId);
    const isTrimItem = trimRegions.some(r => r.id === excludeId);
    const isClipItem = videoClips.some(r => r.id === excludeId);
    const isAudioItem = audioClips.some(r => r.id === excludeId);
    const isAnnotationItem = annotationRegions.some(r => r.id === excludeId);
    const isEffectItem = effectRegions.some(r => r.id === excludeId);

    if (isAnnotationItem || isEffectItem || isAudioItem) {
      return false;
    }

    // Helper to check overlap against a specific set of regions
    const checkOverlap = (regions: (ZoomRegion | TrimRegion | VideoClip)[]) => {
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
      const target = videoClips.find((clip) => clip.id === excludeId);
      if (!target) {
        return false;
      }
      if (isRecordingClip(target)) {
        const recordingClips = videoClips.filter(isRecordingClip);
        return checkOverlap(recordingClips);
      }
      const destinationTrackId = targetRowId ?? target.trackId;
      const siblingClips = videoClips.filter((clip) => clip.trackId === destinationTrackId);
      return checkOverlap(siblingClips);
    }

    return false;
  }, [zoomRegions, trimRegions, videoClips, audioClips, annotationRegions, effectRegions, isRecordingClip]);

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

  // Unified split handler - splits the active clip at the playhead
  const handleUnifiedSplit = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onClipSplit) {
      return;
    }
    onClipSplit();
  }, [videoDuration, videoDurationMs, onClipSplit]);

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

  const handleAddSpeed = useCallback(() => {
    if (!videoDuration || videoDuration === 0 || videoDurationMs === 0 || !onSpeedAdded) {
      return;
    }

    const startPos = Math.max(0, Math.min(currentTimeMs, videoDurationMs));
    const defaultDuration = Math.min(2000, videoDurationMs);
    const endPos = Math.min(startPos + defaultDuration, videoDurationMs);

    onSpeedAdded({ start: startPos, end: endPos });
  }, [videoDuration, videoDurationMs, currentTimeMs, onSpeedAdded]);

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
      if (e.key === 'x' || e.key === 'X') {
        handleAddSpeed();
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
        if (e.shiftKey) {
          if (selectedKeyframeIds.length > 0) {
            duplicateSelectedKeyframes();
          }
          return;
        }
        if (selectedKeyframeId) {
          deleteSelectedKeyframe();
        } else if (selectedBackgroundId) {
          onBackgroundDelete?.(selectedBackgroundId);
        } else if (selectedZoomId) {
          deleteSelectedZoom();
        } else if (selectedTrimId) {
          deleteSelectedTrim();
        } else if (selectedClipId) {
          deleteSelectedClip();
        } else if (selectedAudioClipId) {
          deleteSelectedAudioClip();
        } else if (selectedEffectId) {
          deleteSelectedEffect();
        } else if (selectedAnnotationId) {
          deleteSelectedAnnotation();
        } else if (selectedSpeedId) {
          deleteSelectedSpeed();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addKeyframe, handleAddZoom, handleAddTrim, handleUnifiedSplit, handleAddAnnotation, handleAddEffect, handleAddSpeed, deleteSelectedKeyframe, duplicateSelectedKeyframes, deleteSelectedZoom, deleteSelectedTrim, deleteSelectedClip, deleteSelectedAudioClip, deleteSelectedEffect, deleteSelectedAnnotation, deleteSelectedSpeed, selectedKeyframeId, selectedKeyframeIds.length, selectedBackgroundId, selectedZoomId, selectedTrimId, selectedClipId, selectedAudioClipId, selectedEffectId, selectedAnnotationId, selectedSpeedId, annotationRegions, currentTime, onBackgroundDelete, onSelectAnnotation, onSelectEffect]);

  const clampedRange = useMemo<Range>(() => {
    if (timelineDurationMs === 0) {
      return range;
    }

    return {
      start: Math.max(0, Math.min(range.start, scrollableTimelineDurationMs)),
      end: Math.min(range.end, scrollableTimelineDurationMs),
    };
  }, [range, scrollableTimelineDurationMs, timelineDurationMs]);
  const visibleRangeMs = useMemo(
    () => Math.max(1, clampedRange.end - clampedRange.start),
    [clampedRange.end, clampedRange.start],
  );
  const horizontalScrollWidth = useMemo(() => {
    if (timelineViewportWidth <= 0) {
      return 0;
    }

    if (scrollableTimelineDurationMs <= 0 || scrollableTimelineDurationMs <= visibleRangeMs) {
      return timelineViewportWidth;
    }

    return Math.max(
      timelineViewportWidth,
      Math.round((scrollableTimelineDurationMs / visibleRangeMs) * timelineViewportWidth),
    );
  }, [scrollableTimelineDurationMs, timelineViewportWidth, visibleRangeMs]);
  const maxHorizontalScrollLeft = useMemo(
    () => Math.max(0, horizontalScrollWidth - timelineViewportWidth),
    [horizontalScrollWidth, timelineViewportWidth],
  );
  const hasHorizontalOverflow = maxHorizontalScrollLeft > 0;

  const timelineItems = useMemo<TimelineRenderItem[]>(() => {
    const backgrounds: TimelineRenderItem[] = backgroundItems.map((item, index) => ({
      id: item.id,
      rowId: item.trackId || BACKGROUND_TRACK_ID,
      span: { start: item.startMs, end: item.endMs },
      label: `${getBackgroundItemLabel(item, videoAssets, index)} · ${Math.max(0, (item.endMs - item.startMs) / 1000).toFixed(1)}s`,
      variant: 'background',
    }));

    const clips: TimelineRenderItem[] = clipTrackOrder.map((clip, index) => {
      const asset = videoAssets.find((item) => item.id === clip.assetId);
      const isRecording = isRecordingClip(clip);
      const labelBase = asset?.name || (isRecording ? 'Recording' : `Clip ${index + 1}`);
      const durationSec = Math.max(0, (clip.endMs - clip.startMs) / 1000).toFixed(1);
      return {
        id: clip.id,
        rowId: clip.trackId || (isRecording ? 'track-recording' : `track-video-${index + 1}`),
        span: { start: clip.startMs, end: clip.endMs },
        label: `${labelBase} · ${durationSec}s`,
        variant: 'clip',
        keyframes: (clip.transformKeyframes ?? [])
          .filter((keyframe) => keyframe.timeMs >= clip.startMs && keyframe.timeMs <= clip.endMs)
          .sort((a, b) => a.timeMs - b.timeMs)
          .map((keyframe) => ({
            id: `clip-transform:${keyframe.id}`,
            rawId: keyframe.id,
            time: keyframe.timeMs,
            kind: 'clipTransform' as const,
            color: '#34B27B',
            title: `Transform keyframe @ ${(keyframe.timeMs / 1000).toFixed(2)}s`,
            clipId: clip.id,
          })),
      };
    });

    const audios: TimelineRenderItem[] = audioClips.map((clip, index) => {
      const asset = videoAssets.find((item) => item.id === clip.assetId);
      const labelBase = asset?.name || `Audio ${index + 1}`;
      const durationSec = Math.max(0, (clip.endMs - clip.startMs) / 1000).toFixed(1);
      return {
        id: clip.id,
        rowId: clip.trackId || `track-audio-${index + 1}`,
        span: { start: clip.startMs, end: clip.endMs },
        label: `${labelBase} · ${durationSec}s`,
        variant: 'audio',
      };
    });

    const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
      id: region.id,
      rowId: region.trackId || 'track-zoom-1',
      span: { start: region.startMs, end: region.endMs },
      label: `Zoom ${index + 1}`,
      zoomDepth: region.depth,
      variant: 'zoom',
    }));

    const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
      id: region.id,
      rowId: region.trackId || 'track-trim-1',
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
        rowId: region.trackId || `track-effect-${region.type}-1`,
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
        rowId: region.trackId || 'track-annotation-1',
        span: { start: region.startMs, end: region.endMs },
        label,
        variant: 'annotation',
        annotationType: region.type,
      };
    });

    const cursors: TimelineRenderItem[] = cursorEnabled && cursorTrack && cursorTrack.events.length > 0 && videoDurationMs > 0
      ? [{
          id: CURSOR_ITEM_ID,
          rowId: cursorTrack.trackId || 'track-cursor-1',
          span: { start: 0, end: videoDurationMs },
          label: 'Cursor',
          variant: 'cursor',
        }]
      : [];

    const speeds: TimelineRenderItem[] = speedRegions.map((region) => ({
      id: region.id,
      rowId: region.trackId || 'track-speed-1',
      span: { start: region.startMs, end: region.endMs },
      label: `${region.speed.toFixed(2)}×`,
      variant: 'speed',
      speedValue: region.speed,
    }));

    return [...backgrounds, ...clips, ...audios, ...zooms, ...effects, ...trims, ...cursors, ...annotations, ...speeds];
  }, [backgroundItems, clipTrackOrder, audioClips, videoAssets, zoomRegions, trimRegions, effectRegions, annotationRegions, speedRegions, cursorEnabled, cursorTrack, videoDurationMs, isRecordingClip]);

  useEffect(() => {
    const node = timelineViewportRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      setTimelineViewportWidth(node.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const node = horizontalScrollRef.current;
    if (!node) {
      return;
    }

    if (!hasHorizontalOverflow || scrollableTimelineDurationMs <= visibleRangeMs) {
      syncingHorizontalScrollRef.current = true;
      node.scrollLeft = 0;
      requestAnimationFrame(() => {
        syncingHorizontalScrollRef.current = false;
      });
      return;
    }

    const maxRangeStart = Math.max(0, scrollableTimelineDurationMs - visibleRangeMs);
    const nextScrollLeft = maxRangeStart > 0
      ? (clampedRange.start / maxRangeStart) * maxHorizontalScrollLeft
      : 0;

    if (Math.abs(node.scrollLeft - nextScrollLeft) <= 1) {
      return;
    }

    syncingHorizontalScrollRef.current = true;
    node.scrollLeft = nextScrollLeft;
    requestAnimationFrame(() => {
      syncingHorizontalScrollRef.current = false;
    });
  }, [
    clampedRange.start,
    hasHorizontalOverflow,
    maxHorizontalScrollLeft,
    scrollableTimelineDurationMs,
    visibleRangeMs,
  ]);

  const handleHorizontalScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (syncingHorizontalScrollRef.current) {
      return;
    }

    if (!hasHorizontalOverflow || maxHorizontalScrollLeft <= 0) {
      return;
    }

    const scrollLeft = event.currentTarget.scrollLeft;

    setRange((prev) => {
      const visibleDuration = Math.max(1, prev.end - prev.start);
      const maxRangeStart = Math.max(0, scrollableTimelineDurationMs - visibleDuration);

      if (maxRangeStart <= 0) {
        return prev;
      }

      const nextStart = Math.round((scrollLeft / maxHorizontalScrollLeft) * maxRangeStart);
      if (nextStart === prev.start) {
        return prev;
      }

      return {
        start: nextStart,
        end: nextStart + visibleDuration,
      };
    });
  }, [hasHorizontalOverflow, maxHorizontalScrollLeft, scrollableTimelineDurationMs]);

  const clampSpanToRange = useCallback((span: Span, maxMs: number): Span => {
    if (maxMs <= 0) return span;
    const rawDuration = Math.max(span.end - span.start, 0);
    const minDuration = Math.min(Math.max(safeMinDurationMs, 1), maxMs);
    const duration = Math.min(Math.max(rawDuration, minDuration), maxMs);
    const start = Math.max(0, Math.min(span.start, maxMs - duration));
    return { start, end: start + duration };
  }, [safeMinDurationMs]);

  const handleItemSpanChange = useCallback((id: string, span: Span) => {
    // Check if it's a zoom or trim item
    if (id === CURSOR_ITEM_ID) {
      return;
    }
    const backgroundItem = backgroundItems.find((item) => item.id === id);
    const clip = videoClips.find((item) => item.id === id);
    if (backgroundItem) {
      const maxMs = scrollableTimelineDurationMs > 0 ? scrollableTimelineDurationMs : timelineDurationMs;
      onBackgroundSpanChange?.(id, clampSpanToRange(span, maxMs));
    } else
    if (clip) {
      const maxMs = scrollableTimelineDurationMs > 0 ? scrollableTimelineDurationMs : timelineDurationMs;
      onClipSpanChange?.(id, clampSpanToRange(span, maxMs));
    } else if (audioClips.some((item) => item.id === id)) {
      const maxMs = scrollableTimelineDurationMs > 0 ? scrollableTimelineDurationMs : timelineDurationMs;
      onAudioClipSpanChange?.(id, clampSpanToRange(span, maxMs));
    } else if (zoomRegions.some(r => r.id === id)) {
      onZoomSpanChange(id, clampSpanToRange(span, videoDurationMs));
    } else if (trimRegions.some(r => r.id === id)) {
      onTrimSpanChange?.(id, clampSpanToRange(span, videoDurationMs));
    } else if (effectRegions.some(r => r.id === id)) {
      onEffectSpanChange?.(id, clampSpanToRange(span, videoDurationMs));
    } else if (annotationRegions.some(r => r.id === id)) {
      onAnnotationSpanChange?.(id, clampSpanToRange(span, videoDurationMs));
    } else if (speedRegions.some(r => r.id === id)) {
      onSpeedSpanChange?.(id, clampSpanToRange(span, videoDurationMs));
    }
  }, [backgroundItems, videoClips, audioClips, zoomRegions, trimRegions, effectRegions, annotationRegions, speedRegions, onBackgroundSpanChange, onClipSpanChange, onAudioClipSpanChange, onZoomSpanChange, onTrimSpanChange, onEffectSpanChange, onAnnotationSpanChange, onSpeedSpanChange, clampSpanToRange, videoDurationMs, timelineDurationMs, scrollableTimelineDurationMs]);

  const handleItemDrop = useCallback((activeId: string, overId: string | null) => {
    if (!overId) return;
    const activeItem = timelineItems.find((item) => item.id === activeId);
    const targetTrack = tracks.find((track) => track.id === overId);
    if (activeItem && targetTrack) {
      const variantToItemType: Record<TimelineRenderItem['variant'], TimelineTrackItemType> = {
        background: 'background',
        clip: 'videoClip',
        audio: 'audioClip',
        zoom: 'zoom',
        trim: 'trim',
        effect: 'effect',
        annotation: 'annotation',
        cursor: 'cursor',
        speed: 'speed',
      };
      const nextItemType = variantToItemType[activeItem.variant];
      const activeClip = activeItem.variant === 'clip'
        ? videoClips.find((clip) => clip.id === activeItem.id)
        : null;
      const activeIsRecordingClip = Boolean(activeClip && isRecordingClip(activeClip));

      if (targetTrack.type === 'recording') {
        if (!(activeItem.variant === 'clip' && activeIsRecordingClip)) {
          return;
        }
      } else if (targetTrack.type === 'background') {
        if (activeItem.variant !== 'background') {
          return;
        }
      } else if (activeIsRecordingClip) {
        return;
      }

      if (targetTrack.itemType !== 'mixed' && nextItemType !== targetTrack.itemType) {
        onTrackAutoTypeChange?.(targetTrack.id, activeItem.id, nextItemType);
      }
      switch (activeItem.variant) {
        case 'background':
          onBackgroundTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'clip':
          onClipTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'audio':
          onAudioClipTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'zoom':
          onZoomTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'trim':
          onTrimTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'effect':
          onEffectTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'annotation':
          onAnnotationTrackChange?.(activeItem.id, targetTrack.id);
          return;
        case 'cursor':
          onCursorTrackChange?.(targetTrack.id);
          return;
        case 'speed':
          onSpeedTrackChange?.(activeItem.id, targetTrack.id);
          return;
        default:
          return;
      }
    }

    if (!onClipOrderChange) return;
    if (!videoClips.some((clip) => clip.id === activeId)) return;
    const itemTarget = videoClips.some((clip) => clip.id === overId) ? overId : null;
    if (!itemTarget || itemTarget === activeId) return;
    const nextOrder = [...clipOrderIds];
    const fromIndex = nextOrder.indexOf(activeId);
    const toIndex = nextOrder.indexOf(itemTarget);
    if (fromIndex === -1 || toIndex === -1) return;
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, activeId);
    onClipOrderChange(nextOrder);
  }, [onClipOrderChange, videoClips, clipOrderIds, timelineItems, tracks, onBackgroundTrackChange, onClipTrackChange, onAudioClipTrackChange, onZoomTrackChange, onTrimTrackChange, onEffectTrackChange, onAnnotationTrackChange, onCursorTrackChange, onSpeedTrackChange, onTrackAutoTypeChange, isRecordingClip]);

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
            onClick={() => onCreateTrack?.('generic')}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
            title="Create universal track"
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleUnifiedSplit}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            title="Split Clip (S)"
          >
            <Scissors className="w-4 h-4" />
          </Button>
          <Button
            onClick={addKeyframe}
            variant="ghost"
            size="icon"
            disabled={!canKeyframeSelectedClip}
            className="h-7 w-7 text-slate-400 disabled:opacity-40 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
            title={canKeyframeSelectedClip ? "Add or update transform keyframe (F)" : "Select a visual clip and move the playhead onto it to keyframe transform"}
          >
            <Diamond
              className="w-4 h-4"
              fill={selectedTransformKeyframeAtPlayhead ? 'currentColor' : 'none'}
            />
          </Button>
          <Button
            onClick={duplicateSelectedKeyframes}
            variant="ghost"
            size="icon"
            disabled={selectedKeyframeIds.length === 0}
            className="h-7 w-7 text-slate-400 disabled:opacity-40 hover:text-[#34B27B] hover:bg-[#34B27B]/10 transition-all"
            title="Duplicate selected keyframes (⌘/Ctrl + Shift + D)"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            onClick={
              selectedKeyframeIds.length > 0
                ? deleteSelectedKeyframe
                : selectedBackgroundId
                  ? () => onBackgroundDelete?.(selectedBackgroundId)
                  : selectedAudioClipId
                    ? deleteSelectedAudioClip
                    : deleteSelectedClip
            }
            variant="ghost"
            size="icon"
            disabled={!selectedKeyframeIds.length && !selectedClipId && !selectedAudioClipId && !selectedBackgroundId}
            className="h-7 w-7 text-slate-400 disabled:opacity-40 hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-all"
            title={selectedKeyframeIds.length > 0 ? "Delete selected keyframes (⌘/Ctrl + D)" : "Delete selected item (⌘/Ctrl + D)"}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleZoomOutRange}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#7dd3fc] hover:bg-[#0ea5e9]/10 transition-all"
            title="Zoom timeline out"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleZoomInRange}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#7dd3fc] hover:bg-[#0ea5e9]/10 transition-all"
            title="Zoom timeline in"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            onClick={handleZoomResetRange}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all"
            title="Reset timeline zoom"
          >
            Fit
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
          <Button
            onClick={handleAddSpeed}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-[#F59E0B] hover:bg-[#F59E0B]/10 transition-all"
            title="Add Speed (X)"
          >
            <Gauge className="w-4 h-4" />
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
      <div
        ref={timelineSelectionAreaRef}
        className="flex-1 overflow-hidden bg-[#09090b] relative"
        onPointerDown={beginBoxSelection}
        onClick={() => {
          if (suppressClearKeyframeClickRef.current) {
            suppressClearKeyframeClickRef.current = false;
            return;
          }
          setSelectedKeyframeIds([]);
        }}
      >
        <div ref={timelineViewportRef} className="h-full min-h-0 overflow-hidden">
          <TimelineWrapper
            range={clampedRange}
            videoDuration={scrollableTimelineDurationMs / 1000}
            hasOverlap={hasOverlap}
            onRangeChange={setRange}
            minItemDurationMs={timelineScale.minItemDurationMs}
            minVisibleRangeMs={timelineScale.minVisibleRangeMs}
            gridSizeMs={timelineScale.gridMs}
            onItemSpanChange={handleItemSpanChange}
            onItemDrop={handleItemDrop}
            >
              <KeyframeMarkers
                keyframes={timelineKeyframes}
                selectedKeyframeIds={selectedKeyframeIds}
                setSelectedKeyframeIds={setSelectedKeyframeIds}
                onSelectKeyframe={(keyframe) => {
                  if (keyframe.kind === 'clipTransform' && keyframe.clipId) {
                    onSelectClip?.(keyframe.clipId);
                  }
                  onSeek?.(keyframe.time / 1000);
                }}
              />
            <Timeline
              items={timelineItems}
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              onSelectTrack={onSelectTrack}
              timelineDurationMs={timelineDurationMs}
              seekDurationMs={timelineDurationMs}
              intervalMs={timelineScale.intervalMs}
              currentTimeMs={currentTimeMs}
              onSeek={onSeek}
              onSelectBackground={onSelectBackground}
              onSelectClip={onSelectClip}
              onSelectAudioClip={onSelectAudioClip}
              onSelectZoom={onSelectZoom}
              onSelectTrim={onSelectTrim}
              onSelectAnnotation={onSelectAnnotation}
              onSelectEffect={onSelectEffect}
              onSelectCursor={onSelectCursor}
              selectedKeyframeIds={selectedKeyframeIds}
              onSelectKeyframes={setSelectedKeyframeIds}
              onClipAssetDrop={onClipAssetDrop}
              onBackgroundAssetDrop={onBackgroundAssetDrop}
              onAudioAssetDrop={onAudioAssetDrop}
              onTrackHeightChange={onTrackHeightChange}
              onTrackOrderChange={onTrackOrderChange}
              onTrackMuteChange={onTrackMuteChange}
              onTrackHiddenChange={onTrackHiddenChange}
              onTrackDelete={onTrackDelete}
              onTrackAutoTypeChange={onTrackAutoTypeChange}
              selectedBackgroundId={selectedBackgroundId}
              selectedClipId={selectedClipId}
              selectedAudioClipId={selectedAudioClipId}
              selectedZoomId={selectedZoomId}
              selectedTrimId={selectedTrimId}
              selectedAnnotationId={selectedAnnotationId}
              selectedEffectId={selectedEffectId}
              selectedCursorId={selectedCursorId}
              selectedSpeedId={selectedSpeedId}
              onSelectSpeed={onSelectSpeed}
            />
          </TimelineWrapper>
        </div>
        {boxSelection ? (
          <div
            className="pointer-events-none absolute border border-[#34B27B]/60 bg-[#34B27B]/10"
            style={{
              left: Math.min(boxSelection.startX, boxSelection.endX),
              top: Math.min(boxSelection.startY, boxSelection.endY),
              width: Math.abs(boxSelection.endX - boxSelection.startX),
              height: Math.abs(boxSelection.endY - boxSelection.startY),
            }}
          />
        ) : null}
      </div>
      <div className="shrink-0 border-t border-white/5 bg-[#0d0d10]">
        <div
          ref={horizontalScrollRef}
          className={cn(
            "h-4 overflow-y-hidden custom-scrollbar",
            hasHorizontalOverflow ? "overflow-x-auto" : "overflow-x-hidden opacity-50",
          )}
          onScroll={handleHorizontalScroll}
        >
          <div style={{ width: horizontalScrollWidth || '100%', height: 1 }} />
        </div>
      </div>
    </div>
  );
}
