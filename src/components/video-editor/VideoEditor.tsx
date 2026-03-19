

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Circle, Monitor, Square } from "lucide-react";

import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import PlaybackControls from "./PlaybackControls";
import TimelineEditor from "./timeline/TimelineEditor";
import { SettingsPanel } from "./SettingsPanel";
import { ExportDialog } from "./ExportDialog";
import { ProjectToolbar } from "./ProjectToolbar";

import type { Span } from "dnd-timeline";
import {
  DEFAULT_ZOOM_DEPTH,
  clampFocusToDepth,
  DEFAULT_CROP_REGION,
  DEFAULT_SCREEN_OFFSET,
  DEFAULT_CLIP_POSITION,
  DEFAULT_CLIP_SIZE,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  DEFAULT_ANNOTATION_EFFECTS,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_EFFECT_REGION,
  DEFAULT_SPEED_REGION,
  RECORDING_ASSET_ID,
  type SpeedRegion,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type TrimRegion,
  type AnnotationRegion,
  type VideoAsset,
  type VideoClip,
  type AudioClip,
  type TimelineTrack,
  type TimelineTrackItemType,
  type TimelineTrackType,
  type TimelineTrackTemplate,
  type EffectRegion,
  type CropRegion,
  type ScreenOffset,
  type FigureData,
  type CursorTrack,
  type CursorStyle,
  type CursorSmoothing,
  type End2EndParams,
  type PaddingKeyframe,
} from "./types";
import { interpolatePadding } from "@/utils/paddingKeyframes";
import { normalizeClipCrop } from "@/utils/clipLayout";
import {
  resolveRecordingLayoutFromVisibleRect,
  resolveRecordingVisibleRect,
  type InteractionRect,
} from "@/utils/recordingInteractionLayout";
import { VideoExporter, type ExportProgress, type ExportQuality } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue, getResolutionPreset } from "@/utils/aspectRatioUtils";
import { getAssetPath } from "@/lib/assetPath";
import { useScreenRecorder } from "@/hooks/useScreenRecorder";
import {
  getSourceOffsetForTimelineOffsetMs,
  withUpdatedClipDuration,
} from "./clipSpeedUtils";

const WALLPAPER_COUNT = 18;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);

const TRACK_HEIGHT_DEFAULT = 36;
const TRACK_ORDER_STEP = 10;
const GENERATED_RECORDING_NAME_RE = /^recording-\d+$/i;
const DEFAULT_IMAGE_DURATION_MS = 3000;

function buildBaseTrack(
  id: string,
  type: TimelineTrackType,
  itemType: TimelineTrackItemType,
  name: string,
  order: number,
): TimelineTrack {
  return {
    id,
    type,
    itemType,
    name,
    order,
    height: TRACK_HEIGHT_DEFAULT,
    locked: false,
    hidden: false,
    muted: false,
    collapsed: false,
  };
}

function withNormalizedClipDuration(clip: VideoClip): VideoClip {
  return withUpdatedClipDuration({
    ...clip,
    crop: normalizeClipCrop(clip.crop),
  });
}

function ensureTrackHeights(input: TimelineTrack[]): TimelineTrack[] {
  return input.map((track) => ({
    ...track,
    height: typeof track.height === 'number' && Number.isFinite(track.height)
      ? Math.max(36, Math.min(160, track.height))
      : TRACK_HEIGHT_DEFAULT,
  }));
}

function isUniversalTrack(track: TimelineTrack): boolean {
  return track.type === 'generic' || track.itemType === 'mixed';
}

function canTrackAcceptItemType(track: TimelineTrack, itemType: TimelineTrackItemType): boolean {
  if (track.type === 'recording') {
    return itemType === 'videoClip';
  }
  return track.itemType === itemType || isUniversalTrack(track);
}

function shouldRenameTrackToUniversal(name: string): boolean {
  return /^(video|audio|zoom|trim|annotations|cursor|speed|shake|perspective)\s+\d+$/i.test(name.trim());
}

function getFileStem(value: string): string {
  const normalized = value.replace(/\\/g, '/').split('?')[0].split('#')[0];
  const basename = normalized.split('/').pop() ?? normalized;
  const lastDot = basename.lastIndexOf('.');
  return lastDot > 0 ? basename.slice(0, lastDot) : basename;
}

function normalizeRecordingAssetKind(asset: VideoAsset): VideoAsset {
  if (asset.kind === 'audio') {
    return asset;
  }

  if (asset.id === RECORDING_ASSET_ID) {
    return asset.kind === 'recording' ? asset : { ...asset, kind: 'recording' };
  }

  const nameStem = getFileStem(asset.name ?? '');
  const srcStem = getFileStem(asset.src ?? '');
  const isGeneratedRecording =
    GENERATED_RECORDING_NAME_RE.test(nameStem) ||
    GENERATED_RECORDING_NAME_RE.test(srcStem);

  if (!isGeneratedRecording) {
    return asset;
  }

  return asset.kind === 'recording' ? asset : { ...asset, kind: 'recording' };
}

export default function VideoEditor() {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [defaultImageClipDurationMs, setDefaultImageClipDurationMs] = useState(DEFAULT_IMAGE_DURATION_MS);
  const [wallpaper, setWallpaper] = useState<string>(WALLPAPER_PATHS[0]);
  const [shadowIntensity, setShadowIntensity] = useState(0);
  const [showBlur, setShowBlur] = useState(false);
  const [motionBlurEnabled, setMotionBlurEnabled] = useState(true);
  const [borderRadius, setBorderRadius] = useState(0);
  const [padding, setPadding] = useState(50);
  const [paddingKeyframes, setPaddingKeyframes] = useState<PaddingKeyframe[]>([]);
  const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
  const [screenOffset, setScreenOffset] = useState<ScreenOffset>(DEFAULT_SCREEN_OFFSET);
  const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [videoAssets, setVideoAssets] = useState<VideoAsset[]>([]);
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const [audioClips, setAudioClips] = useState<AudioClip[]>([]);
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
  const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [effectRegions, setEffectRegions] = useState<EffectRegion[]>([]);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
  const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
  const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [cursorTrack, setCursorTrack] = useState<CursorTrack | null>(null);
  const [selectedCursorId, setSelectedCursorId] = useState<string | null>(null);
  const [cursorEnabled, setCursorEnabled] = useState<boolean>(true);
  const [cursorSmoothing, setCursorSmoothing] = useState<CursorSmoothing>('none');
  const [quadraticSmoothingStrength, setQuadraticSmoothingStrength] = useState<number>(0.5);
  const [end2endParams, setEnd2endParams] = useState<End2EndParams>({
    dwellTimeMs: 300,
    stillEpsilonPx: 3,
    minJumpDistancePx: 18,
    minTimeBetweenEndpointsMs: 200,
    arrivalFraction: 0.6,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolutionPresetId, setResolutionPresetId] = useState<string>('auto');
  const [exportQuality, setExportQuality] = useState<ExportQuality>('good');

  // Project save/load state
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [autoSaveEnabled] = useState(true);
  const [selectedSourceName, setSelectedSourceName] = useState("Screen");
  const [hasSelectedSource, setHasSelectedSource] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [isAppendingRecording, setIsAppendingRecording] = useState(false);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);
  const nextClipIdRef = useRef(1);
  const nextAudioClipIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextEffectIdRef = useRef(1);
  const nextSpeedIdRef = useRef(1);
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
  const nextAssetIdRef = useRef(1);
  const nextClipZIndexRef = useRef(1);
  const nextTrackIdRef = useRef(1);
  const exporterRef = useRef<VideoExporter | null>(null);
  const lastVideoPathRef = useRef<string | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const mutedTrackIds = useMemo(
    () => new Set(tracks.filter((track) => track.muted).map((track) => track.id)),
    [tracks],
  );
  const hiddenTrackIds = useMemo(
    () => new Set(tracks.filter((track) => track.hidden).map((track) => track.id)),
    [tracks],
  );
  const selectedTrack = useMemo(
    () => (selectedTrackId ? tracks.find((track) => track.id === selectedTrackId) ?? null : null),
    [selectedTrackId, tracks],
  );

  const createTrack = useCallback((
    type: TimelineTrackType,
    itemType: TimelineTrackItemType,
    name: string,
    patch: Partial<TimelineTrack> = {},
  ): TimelineTrack => {
    const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0);
    return {
      id: `track-${nextTrackIdRef.current++}`,
      type,
      itemType,
      name,
      order: maxOrder + TRACK_ORDER_STEP,
      height: TRACK_HEIGHT_DEFAULT,
      locked: false,
      hidden: false,
      muted: false,
      collapsed: false,
      ...patch,
    };
  }, [tracks]);

  const buildDefaultTracks = useCallback((
    sourceVideoClips: VideoClip[],
    sourceAudioClips: AudioClip[],
    sourceZoomRegions: ZoomRegion[],
    sourceTrimRegions: TrimRegion[],
    sourceEffectRegions: EffectRegion[],
    sourceAnnotationRegions: AnnotationRegion[],
    sourceCursorTrack: CursorTrack | null,
  ) => {
    const defaultTracks: TimelineTrack[] = [];
    let order = TRACK_ORDER_STEP;

    if (sourceVideoClips.some((clip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID)) {
      defaultTracks.push(buildBaseTrack('track-recording', 'recording', 'videoClip', 'Recording', order));
      order += TRACK_ORDER_STEP;
    }

    const overlayCount = sourceVideoClips.filter((clip) => !(clip.applyCamera || clip.assetId === RECORDING_ASSET_ID)).length;
    for (let index = 0; index < overlayCount; index += 1) {
      defaultTracks.push(buildBaseTrack(`track-video-${index + 1}`, 'video', 'videoClip', `Video ${index + 1}`, order));
      order += TRACK_ORDER_STEP;
    }

    const audioCount = sourceAudioClips.length;
    for (let index = 0; index < audioCount; index += 1) {
      defaultTracks.push(buildBaseTrack(`track-audio-${index + 1}`, 'audio', 'audioClip', `Audio ${index + 1}`, order));
      order += TRACK_ORDER_STEP;
    }

    if (sourceAnnotationRegions.length) {
      defaultTracks.push(buildBaseTrack('track-annotation-1', 'annotation', 'annotation', 'Annotations', order));
      order += TRACK_ORDER_STEP;
    }

    if (sourceEffectRegions.length) {
      const perspectiveCount = sourceEffectRegions.filter((region) => region.type === 'perspective').length;
      const shakeCount = sourceEffectRegions.filter((region) => region.type === 'shake').length;
      if (perspectiveCount) {
        defaultTracks.push(buildBaseTrack('track-effect-perspective-1', 'effect', 'effect', 'Perspective', order));
        order += TRACK_ORDER_STEP;
      }
      if (shakeCount) {
        defaultTracks.push(buildBaseTrack('track-effect-shake-1', 'effect', 'effect', 'Shake', order));
        order += TRACK_ORDER_STEP;
      }
    }

    if (sourceZoomRegions.length) {
      defaultTracks.push(buildBaseTrack('track-zoom-1', 'zoom', 'zoom', 'Zoom', order));
      order += TRACK_ORDER_STEP;
    }

    if (sourceTrimRegions.length) {
      defaultTracks.push(buildBaseTrack('track-trim-1', 'trim', 'trim', 'Trim', order));
      order += TRACK_ORDER_STEP;
    }

    if (sourceCursorTrack?.events.length) {
      defaultTracks.push(buildBaseTrack('track-cursor-1', 'cursor', 'cursor', 'Cursor', order));
      order += TRACK_ORDER_STEP;
    }

    return ensureTrackHeights(defaultTracks);
  }, []);

  const migrateItemsToTracks = useCallback((
    inputTracks: TimelineTrack[],
    sourceVideoClips: VideoClip[],
    sourceAudioClips: AudioClip[],
    sourceZoomRegions: ZoomRegion[],
    sourceTrimRegions: TrimRegion[],
    sourceEffectRegions: EffectRegion[],
    sourceAnnotationRegions: AnnotationRegion[],
    sourceCursorTrack: CursorTrack | null,
    sourceSpeedRegions?: SpeedRegion[],
  ) => {
    const preparedTracks = ensureTrackHeights(inputTracks.length ? inputTracks : buildDefaultTracks(
      sourceVideoClips,
      sourceAudioClips,
      sourceZoomRegions,
      sourceTrimRegions,
      sourceEffectRegions,
      sourceAnnotationRegions,
      sourceCursorTrack,
    ));

    const tracksForItemType = (itemType: TimelineTrackItemType, options?: { excludeRecording?: boolean }) =>
      preparedTracks
        .filter((track) => {
          if (options?.excludeRecording && track.type === 'recording') {
            return false;
          }
          return canTrackAcceptItemType(track, itemType);
        })
        .sort((a, b) => a.order - b.order);

    const recordingTracks = preparedTracks.filter((track) => track.type === 'recording');
    const genericTracks = preparedTracks.filter((track) => isUniversalTrack(track) && track.type !== 'recording').sort((a, b) => a.order - b.order);
    const videoTracks = tracksForItemType('videoClip', { excludeRecording: true });
    const audioTracks = tracksForItemType('audioClip');
    const zoomTracks = tracksForItemType('zoom');
    const trimTracks = tracksForItemType('trim');
    const effectTracks = preparedTracks
      .filter((track) => track.type !== 'recording' && (track.itemType === 'effect' || isUniversalTrack(track)))
      .sort((a, b) => a.order - b.order);
    const annotationTracks = tracksForItemType('annotation');
    const cursorTracks = tracksForItemType('cursor');

    let nextVideoIndex = 0;
    let nextAudioIndex = 0;

    const nextTrackIdFor = (pool: TimelineTrack[], fallbackId: string, cursor = { value: 0 }) => {
      if (!pool.length) return fallbackId;
      const track = pool[Math.min(cursor.value, pool.length - 1)];
      cursor.value += 1;
      return track.id;
    };

    const videoCursor = { value: 0 };
    const audioCursor = { value: 0 };

    const migratedVideoClips = sourceVideoClips.map((clip) => {
      if (clip.trackId && preparedTracks.some((track) => track.id === clip.trackId)) {
        return clip;
      }
      const trackId = clip.applyCamera || clip.assetId === RECORDING_ASSET_ID
        ? recordingTracks[0]?.id ?? 'track-recording'
        : nextTrackIdFor(videoTracks, `track-video-${++nextVideoIndex}`, videoCursor);
      return { ...clip, trackId };
    });

    const migratedAudioClips = sourceAudioClips.map((clip) => {
      if (clip.trackId && preparedTracks.some((track) => track.id === clip.trackId)) {
        return clip;
      }
      const trackId = nextTrackIdFor(audioTracks, `track-audio-${++nextAudioIndex}`, audioCursor);
      return { ...clip, trackId };
    });

    const migratedZoomRegions = sourceZoomRegions.map((region) => ({
      ...region,
      trackId: region.trackId && preparedTracks.some((track) => track.id === region.trackId)
        ? region.trackId
        : (zoomTracks[0]?.id ?? 'track-zoom-1'),
    }));

    const migratedTrimRegions = sourceTrimRegions.map((region) => ({
      ...region,
      trackId: region.trackId && preparedTracks.some((track) => track.id === region.trackId)
        ? region.trackId
        : (trimTracks[0]?.id ?? 'track-trim-1'),
    }));

    const effectBuckets = new Map<string, TimelineTrack[]>();
    effectTracks.forEach((track) => {
      if (isUniversalTrack(track)) {
        return;
      }
      const key = track.name.toLowerCase().includes('shake') ? 'shake' : 'perspective';
      const bucket = effectBuckets.get(key);
      if (bucket) bucket.push(track);
      else effectBuckets.set(key, [track]);
    });

    const migratedEffectRegions = sourceEffectRegions.map((region) => {
      if (region.trackId && preparedTracks.some((track) => track.id === region.trackId)) {
        return region;
      }
      if (genericTracks.length > 0) {
        return {
          ...region,
          trackId: genericTracks[0].id,
        };
      }
      const bucket = effectBuckets.get(region.type) ?? [];
      return {
        ...region,
        trackId: bucket[0]?.id ?? `track-effect-${region.type}-1`,
      };
    });

    const migratedAnnotationRegions = sourceAnnotationRegions.map((region) => ({
      ...region,
      trackId: region.trackId && preparedTracks.some((track) => track.id === region.trackId)
        ? region.trackId
        : (annotationTracks[0]?.id ?? 'track-annotation-1'),
    }));

    const migratedCursorTrack = sourceCursorTrack
      ? {
          ...sourceCursorTrack,
          trackId: sourceCursorTrack.trackId && preparedTracks.some((track) => track.id === sourceCursorTrack.trackId)
            ? sourceCursorTrack.trackId
            : (cursorTracks[0]?.id ?? 'track-cursor-1'),
        }
      : null;

    const speedTracks = tracksForItemType('speed');
    const migratedSpeedRegions = (sourceSpeedRegions ?? []).map((region) => ({
      ...region,
      trackId: region.trackId && preparedTracks.some((track) => track.id === region.trackId)
        ? region.trackId
        : (speedTracks[0]?.id ?? 'track-speed-1'),
    }));

    return {
      tracks: preparedTracks,
      videoClips: migratedVideoClips,
      audioClips: migratedAudioClips,
      zoomRegions: migratedZoomRegions,
      trimRegions: migratedTrimRegions,
      effectRegions: migratedEffectRegions,
      annotationRegions: migratedAnnotationRegions,
      cursorTrack: migratedCursorTrack,
      speedRegions: migratedSpeedRegions,
    };
  }, [buildDefaultTracks]);

  // Compute current padding from keyframes (for preview)
  const currentPadding = useMemo(() => {
    return interpolatePadding(paddingKeyframes, currentTime * 1000, padding);
  }, [paddingKeyframes, currentTime, padding]);

  const renderedVideoClips = useMemo(() => {
    const videoTracks = tracks
      .filter((track) => track.type === 'recording' || track.itemType === 'videoClip' || isUniversalTrack(track))
      .sort((a, b) => a.order - b.order);

    const trackBaseZIndex = new Map<string, number>();
    videoTracks.forEach((track, index) => {
      // Higher tracks in the timeline render in front of lower tracks,
      // including the recording track if it sits between overlays.
      trackBaseZIndex.set(track.id, (videoTracks.length - index) * 1000);
    });

    return videoClips.map((clip) => {
      const baseZIndex = clip.trackId ? trackBaseZIndex.get(clip.trackId) ?? 0 : 0;
      return {
        ...clip,
        zIndex: baseZIndex + Math.max(clip.zIndex, 0),
      };
    });
  }, [tracks, videoClips]);

  const visibleVideoClips = useMemo(
    () => renderedVideoClips.filter((clip) => !(clip.trackId && hiddenTrackIds.has(clip.trackId))),
    [hiddenTrackIds, renderedVideoClips],
  );

  const visibleAnnotationRegions = useMemo(
    () => annotationRegions.filter((region) => !(region.trackId && hiddenTrackIds.has(region.trackId))),
    [annotationRegions, hiddenTrackIds],
  );

  const visibleEffectRegions = useMemo(
    () => effectRegions.filter((region) => !(region.trackId && hiddenTrackIds.has(region.trackId))),
    [effectRegions, hiddenTrackIds],
  );

  const visibleCursorTrack = useMemo(
    () => (cursorTrack && cursorTrack.trackId && hiddenTrackIds.has(cursorTrack.trackId) ? null : cursorTrack),
    [cursorTrack, hiddenTrackIds],
  );
  const timelineContentEndMs = useMemo(() => Math.max(
    Math.round(duration * 1000),
    ...videoClips.map((clip) => clip.endMs),
    ...audioClips.map((clip) => clip.endMs),
    ...zoomRegions.map((region) => region.endMs),
    ...trimRegions.map((region) => region.endMs),
    ...effectRegions.map((region) => region.endMs),
    ...annotationRegions.map((region) => region.endMs),
    ...speedRegions.map((region) => region.endMs),
  ), [
    annotationRegions,
    audioClips,
    duration,
    effectRegions,
    speedRegions,
    trimRegions,
    videoClips,
    zoomRegions,
  ]);

  useEffect(() => {
    const hasAnyItems =
      videoClips.length > 0 ||
      audioClips.length > 0 ||
      zoomRegions.length > 0 ||
      trimRegions.length > 0 ||
      effectRegions.length > 0 ||
      annotationRegions.length > 0 ||
      speedRegions.length > 0 ||
      (cursorTrack?.events?.length ?? 0) > 0;

    const needsMigration =
      (!tracks.length && hasAnyItems) ||
      videoClips.some((clip) => !clip.trackId) ||
      audioClips.some((clip) => !clip.trackId) ||
      zoomRegions.some((region) => !region.trackId) ||
      trimRegions.some((region) => !region.trackId) ||
      effectRegions.some((region) => !region.trackId) ||
      annotationRegions.some((region) => !region.trackId) ||
      speedRegions.some((region) => !region.trackId) ||
      Boolean(cursorTrack && !cursorTrack.trackId);

    if (!needsMigration) {
      return;
    }

    const migrated = migrateItemsToTracks(
      tracks,
      videoClips,
      audioClips,
      zoomRegions,
      trimRegions,
      effectRegions,
      annotationRegions,
      cursorTrack,
      speedRegions,
    );

    setTracks(migrated.tracks);
    setVideoClips(migrated.videoClips.map((clip) => withNormalizedClipDuration({
      ...clip,
      playbackRate: clip.playbackRate ?? 1,
    })));
    setAudioClips(migrated.audioClips);
    setZoomRegions(migrated.zoomRegions);
    setTrimRegions(migrated.trimRegions);
    setEffectRegions(migrated.effectRegions);
    setAnnotationRegions(migrated.annotationRegions);
    setCursorTrack(migrated.cursorTrack);
    if (migrated.speedRegions) setSpeedRegions(migrated.speedRegions);
  }, [tracks, videoClips, audioClips, zoomRegions, trimRegions, effectRegions, annotationRegions, speedRegions, cursorTrack, migrateItemsToTracks]);

  const ensureTrackForType = useCallback((
    itemType: TimelineTrackItemType,
    factory: () => TimelineTrack,
    predicate?: (track: TimelineTrack) => boolean,
  ) => {
    const match = tracks
      .filter((track) => canTrackAcceptItemType(track, itemType))
      .filter((track) => (predicate ? predicate(track) : true))
      .sort((a, b) => a.order - b.order)[0];

    if (match) {
      return { trackId: match.id, createdTrack: null as TimelineTrack | null };
    }

    const createdTrack = factory();
    setTracks((prev) => ensureTrackHeights([...prev, createdTrack]));
    return { trackId: createdTrack.id, createdTrack };
  }, [tracks]);

  const findAvailableVideoTrackId = useCallback((startMs: number, endMs: number) => {
    const overlayTracks = tracks
      .filter((track) => track.type !== 'recording' && (track.itemType === 'videoClip' || isUniversalTrack(track)))
      .sort((a, b) => a.order - b.order);

    for (const track of overlayTracks) {
      const hasOverlap = videoClips.some((clip) =>
        clip.trackId === track.id &&
        !(clip.applyCamera || clip.assetId === RECORDING_ASSET_ID) &&
        !(endMs <= clip.startMs || startMs >= clip.endMs),
      );

      if (!hasOverlap) {
        return track.id;
      }
    }

    return null;
  }, [tracks, videoClips]);

  const createNamedTrack = useCallback((type: TimelineTrackType, itemType: TimelineTrackItemType, prefix: string, predicate?: (track: TimelineTrack) => boolean) => {
    const count = tracks.filter((track) => track.type === type && (!predicate || predicate(track))).length + 1;
    return createTrack(type, itemType, `${prefix} ${count}`);
  }, [createTrack, tracks]);

  const handleTrackAutoTypeChange = useCallback((trackId: string, _itemId: string, _itemType: TimelineTrackItemType) => {
    void _itemId;
    void _itemType;
    setTracks((prev) => prev.map((track) => {
      if (track.id !== trackId || track.type === 'recording') {
        return track;
      }

      const nextUniversalCount = prev.filter((candidate) => candidate.id !== trackId && candidate.type === 'generic').length + 1;
      return {
        ...track,
        type: 'generic',
        itemType: 'mixed',
        name: shouldRenameTrackToUniversal(track.name) ? `Track ${nextUniversalCount}` : track.name,
      };
    }));
  }, []);

  const handleCreateTrack = useCallback((template: TimelineTrackTemplate) => {
    let track: TimelineTrack;

    switch (template) {
      case 'generic':
        track = createNamedTrack('generic', 'mixed', 'Track');
        break;
      case 'video':
        track = createNamedTrack('video', 'videoClip', 'Video');
        break;
      case 'audio':
        track = createNamedTrack('audio', 'audioClip', 'Audio');
        break;
      case 'zoom':
        track = createNamedTrack('zoom', 'zoom', 'Zoom');
        break;
      case 'trim':
        track = createNamedTrack('trim', 'trim', 'Trim');
        break;
      case 'annotation':
        track = createNamedTrack('annotation', 'annotation', 'Annotations');
        break;
      case 'speed':
        track = createNamedTrack('speed', 'speed', 'Speed');
        break;
      case 'effect-shake':
        track = createNamedTrack('effect', 'effect', 'Shake', (candidate) => candidate.name.toLowerCase().includes('shake'));
        break;
      case 'effect-perspective':
      default:
        track = createNamedTrack('effect', 'effect', 'Perspective', (candidate) => candidate.name.toLowerCase().includes('perspective'));
        break;
    }

    setTracks((prev) => ensureTrackHeights([...prev, track]));
    setSelectedTrackId(track.id);
    setSelectedClipId(null);
    setSelectedAudioClipId(null);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
    setSelectedEffectId(null);
    setSelectedSpeedId(null);
    setSelectedCursorId(null);
  }, [createNamedTrack]);

  // Helper to convert file path to proper file:// URL
  const toFileUrl = useCallback((filePath: string): string => {
    // Normalize path separators to forward slashes
    const normalized = filePath.replace(/\\/g, '/');

    // Check if it's a Windows absolute path (e.g., C:/Users/...)
    if (normalized.match(/^[a-zA-Z]:/)) {
      const fileUrl = `file:///${normalized}`;
      return fileUrl;
    }

    // Unix-style absolute path
    const fileUrl = `file://${normalized}`;
    return fileUrl;
  }, []);

  // Helper to get filename from path (browser-safe)
  const getBasename = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1];
  };

  // Helper to remove file extension
  const removeExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.substring(0, lastDot) : filename;
  };

  // Serialize project state to JSON
  const serializeProject = useCallback((): string => {
    const project = {
      version: "1.0.0",
      savedAt: new Date().toISOString(),
      videoReference: {
        path: videoFilePath || '',
        filename: videoFilePath ? getBasename(videoFilePath) : '',
        duration: duration
      },

      // Timeline & Editing
      zoomRegions,
      effectRegions,
      annotationRegions,
      videoAssets,
      videoClips,
      audioClips,
      tracks,

      // Cursor Data
      cursorTrack,
      cursorEnabled,
      cursorSmoothing,
      quadraticSmoothingStrength,
      end2endParams,

      // Visual Settings
      wallpaper,
      shadowIntensity,
      showBlur,
      motionBlurEnabled,
      borderRadius,
      padding,
      paddingKeyframes,
      cropRegion,
      screenOffset,
      defaultImageClipDurationMs,

      // Export Settings
      aspectRatio,
      exportQuality,

      // ID Counters
      idCounters: {
        nextZoomId: nextZoomIdRef.current,
        nextClipId: nextClipIdRef.current,
        nextAudioClipId: nextAudioClipIdRef.current,
        nextTrimId: nextTrimIdRef.current,
        nextEffectId: nextEffectIdRef.current,
        nextAnnotationId: nextAnnotationIdRef.current,
        nextAnnotationZIndex: nextAnnotationZIndexRef.current,
        nextAssetId: nextAssetIdRef.current,
        nextClipZIndex: nextClipZIndexRef.current,
        nextTrackId: nextTrackIdRef.current,
      }
    };

    return JSON.stringify(project, null, 2);
  }, [
    videoFilePath, duration, zoomRegions, effectRegions,
    annotationRegions, videoAssets, videoClips, audioClips, tracks, cursorTrack, cursorEnabled, cursorSmoothing,
    quadraticSmoothingStrength, end2endParams, wallpaper, shadowIntensity,
    showBlur, motionBlurEnabled, borderRadius, padding, paddingKeyframes, cropRegion, screenOffset,
    defaultImageClipDurationMs, aspectRatio, exportQuality
  ]);

  // Deserialize project state from JSON
  const deserializeProject = useCallback(async (projectData: string): Promise<boolean> => {
    try {
      const project: any = JSON.parse(projectData);

      // Validate version
      if (project.version !== "1.0.0") {
        toast.error(`Unsupported project version: ${project.version}`);
        return false;
      }

      // Check video exists
      const videoCheck = await window.electronAPI.checkVideoFileExists(project.videoReference.path);
      if (!videoCheck.exists) {
        toast.error(
          `Video file not found: ${project.videoReference.filename}. Please locate the video file.`,
          { duration: 6000 }
        );

        // Open file picker to locate video
        const pickerResult = await window.electronAPI.openVideoFilePicker();
        if (!pickerResult.success || !pickerResult.path) {
          return false;
        }

        // Update video reference
        project.videoReference.path = pickerResult.path;
      }

      // Set video path
      await window.electronAPI.setCurrentVideoPath(project.videoReference.path);
      setVideoFilePath(project.videoReference.path);
      setVideoPath(toFileUrl(project.videoReference.path));

      // Restore timeline state (with legacy migration)

      const legacyAssets: VideoAsset[] = Array.isArray(project.overlayAssets) ? project.overlayAssets : [];
      const legacyClips: VideoClip[] = Array.isArray(project.overlayRegions) ? project.overlayRegions : [];
      const legacySegments: { id: string; startMs: number; endMs: number }[] = Array.isArray(project.clipSegments)
        ? project.clipSegments
        : [];

      const recordingAsset: VideoAsset = {
        id: RECORDING_ASSET_ID,
        name: project.videoReference?.filename || 'Recording',
        src: toFileUrl(project.videoReference.path),
        durationMs: Math.max(0, Math.round((project.videoReference?.duration || 0) * 1000)),
        width: 0,
        height: 0,
        kind: 'recording',
      };

      const savedAssets: VideoAsset[] = Array.isArray(project.videoAssets)
        ? project.videoAssets
        : legacyAssets;
      const withRecordingAsset = savedAssets.some((asset) => asset.id === RECORDING_ASSET_ID)
        ? savedAssets
        : [recordingAsset, ...savedAssets];
      setVideoAssets(withRecordingAsset.map(normalizeRecordingAssetKind));

      let resolvedClips: VideoClip[] = Array.isArray(project.videoClips) ? project.videoClips : [];
      const resolvedAudioClips: AudioClip[] = Array.isArray(project.audioClips) ? project.audioClips : [];
      if (!resolvedClips.length) {
        const recordingClips: VideoClip[] = legacySegments.length
          ? legacySegments.map((seg) => ({
              id: seg.id || `clip-${nextClipIdRef.current++}`,
              assetId: RECORDING_ASSET_ID,
              startMs: Math.round(seg.startMs),
              endMs: Math.round(seg.endMs),
              sourceStartMs: Math.round(seg.startMs),
              position: { x: 0, y: 0 },
              size: { width: 100, height: 100 },
              zIndex: 0,
              playbackRate: 1,
              applyCamera: true,
            }))
          : [{
              id: `clip-${nextClipIdRef.current++}`,
              assetId: RECORDING_ASSET_ID,
              startMs: 0,
              endMs: Math.max(0, Math.round((project.videoReference?.duration || 0) * 1000)),
              sourceStartMs: 0,
              position: { x: 0, y: 0 },
              size: { width: 100, height: 100 },
              zIndex: 0,
              playbackRate: 1,
              applyCamera: true,
            }];

        const overlayClips: VideoClip[] = legacyClips.map((region) => ({
          ...region,
          sourceStartMs: region.sourceStartMs ?? 0,
          playbackRate: region.playbackRate ?? 1,
          applyCamera: region.applyCamera ?? false,
        }));

        resolvedClips = [...recordingClips, ...overlayClips];
      }

      const migratedTimeline = migrateItemsToTracks(
        Array.isArray(project.tracks) ? project.tracks : [],
        resolvedClips,
        resolvedAudioClips,
        Array.isArray(project.zoomRegions) ? project.zoomRegions : [],
        Array.isArray(project.trimRegions) ? project.trimRegions : [],
        Array.isArray(project.effectRegions) ? project.effectRegions : [],
        Array.isArray(project.annotationRegions) ? project.annotationRegions : [],
        project.cursorTrack ?? null,
      );

      setTracks(migratedTimeline.tracks);
      setZoomRegions(migratedTimeline.zoomRegions);
      setTrimRegions(migratedTimeline.trimRegions);
      setEffectRegions(migratedTimeline.effectRegions);
      setAnnotationRegions(migratedTimeline.annotationRegions);
      setVideoClips(migratedTimeline.videoClips.map((clip) => withNormalizedClipDuration({
        ...clip,
        playbackRate: clip.playbackRate ?? 1,
      })));
      setAudioClips(migratedTimeline.audioClips);

      // Restore cursor data
      setCursorTrack(migratedTimeline.cursorTrack);
      setCursorEnabled(project.cursorEnabled ?? true);
      setCursorSmoothing(project.cursorSmoothing || 'none');
      setQuadraticSmoothingStrength(project.quadraticSmoothingStrength ?? 0.5);
      setEnd2endParams(project.end2endParams || {
        dwellTimeMs: 300,
        stillEpsilonPx: 3,
        minJumpDistancePx: 18,
        minTimeBetweenEndpointsMs: 200,
        arrivalFraction: 0.6,
      });

      // Restore visual settings
      setWallpaper(project.wallpaper || '/wallpapers/wallpaper1.jpg');
      setShadowIntensity(project.shadowIntensity ?? 0);
      setShowBlur(project.showBlur ?? false);
      setMotionBlurEnabled(project.motionBlurEnabled ?? true);
      setBorderRadius(project.borderRadius ?? 0);
      setPadding(project.padding ?? 50);
      setPaddingKeyframes(project.paddingKeyframes || []);
      setCropRegion(project.cropRegion || DEFAULT_CROP_REGION);
      setDefaultImageClipDurationMs(
        typeof project.defaultImageClipDurationMs === 'number' && Number.isFinite(project.defaultImageClipDurationMs)
          ? Math.max(500, Math.round(project.defaultImageClipDurationMs))
          : DEFAULT_IMAGE_DURATION_MS,
      );
      if (project.screenOffset && typeof project.screenOffset.x === 'number' && typeof project.screenOffset.y === 'number') {
        setScreenOffset({ x: project.screenOffset.x, y: project.screenOffset.y });
      } else {
        setScreenOffset(DEFAULT_SCREEN_OFFSET);
      }

      // Restore export settings
      setAspectRatio(project.aspectRatio || '16:9');
      setExportQuality(project.exportQuality || 'good');

      // Restore ID counters
      if (project.idCounters) {
        nextZoomIdRef.current = project.idCounters.nextZoomId;
        nextClipIdRef.current = project.idCounters.nextClipId;
        nextAudioClipIdRef.current = project.idCounters.nextAudioClipId || nextAudioClipIdRef.current;
        nextTrimIdRef.current = project.idCounters.nextTrimId;
        nextEffectIdRef.current = project.idCounters.nextEffectId;
        nextAnnotationIdRef.current = project.idCounters.nextAnnotationId;
        nextAnnotationZIndexRef.current = project.idCounters.nextAnnotationZIndex;
        nextAssetIdRef.current = project.idCounters.nextAssetId || nextAssetIdRef.current;
        nextClipZIndexRef.current = project.idCounters.nextClipZIndex || nextClipZIndexRef.current;
        nextTrackIdRef.current = project.idCounters.nextTrackId || nextTrackIdRef.current;
      }

      setHasUnsavedChanges(false);
      toast.success('Project loaded successfully');
      return true;

    } catch (error) {
      console.error('Failed to deserialize project:', error);
      toast.error(`Failed to load project: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }, [toFileUrl]);

  const computeTrimRegionsFromClips = useCallback((clips: VideoClip[], totalMs: number): TrimRegion[] => {
    if (totalMs <= 0) return [];
    const recordingClips = clips.filter((clip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID);
    if (!recordingClips.length) {
      return [{
        id: `trim-${nextTrimIdRef.current++}`,
        startMs: 0,
        endMs: totalMs,
      }];
    }

    const sorted = [...recordingClips].sort((a, b) => a.startMs - b.startMs);
    const trims: TrimRegion[] = [];
    let cursor = 0;

    for (const clip of sorted) {
      const start = Math.max(0, Math.min(clip.startMs, totalMs));
      const end = Math.max(start, Math.min(clip.endMs, totalMs));
      if (start > cursor) {
        trims.push({
          id: `trim-${nextTrimIdRef.current++}`,
          startMs: cursor,
          endMs: start,
        });
      }
      cursor = Math.max(cursor, end);
    }

    if (cursor < totalMs) {
      trims.push({
        id: `trim-${nextTrimIdRef.current++}`,
        startMs: cursor,
        endMs: totalMs,
      });
    }

    return trims.filter(r => r.endMs > r.startMs);
  }, []);

  const loadProjectFromPath = useCallback(async (projectPath: string) => {
    const loadResult = await window.electronAPI.loadProject(projectPath);

    if (!loadResult.success || !loadResult.data) {
      toast.error(loadResult.message || 'Failed to load project');
      return false;
    }

    const success = await deserializeProject(loadResult.data);

    if (success) {
      setCurrentProjectPath(projectPath);
      setError(null);
    }

    return success;
  }, [deserializeProject]);

  useEffect(() => {
    async function loadVideo() {
      try {
        const pendingProject = await window.electronAPI.getCurrentProjectPath?.();
        if (pendingProject?.success && pendingProject.path) {
          const loaded = await loadProjectFromPath(pendingProject.path);
          await window.electronAPI.clearCurrentProjectPath?.();
          if (loaded) {
            return;
          }
        }

        const result = await window.electronAPI.getCurrentVideoPath();
        if (result.success && result.path) {
          const videoUrl = toFileUrl(result.path);
          setVideoPath(videoUrl);
          setVideoFilePath(result.path);
        } else {
          setError('No video to load. Please record or select a video.');
        }
      } catch (err) {
        setError('Error loading video: ' + String(err));
      } finally {
        setLoading(false);
      }
    }
    loadVideo();
  }, [loadProjectFromPath]);

  const isRecordingClip = useCallback(
    (clip: VideoClip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID,
    [],
  );

  // Reset recording clip(s) when a new video loads or duration changes from zero to a real value
  useEffect(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    if (!videoPath || totalMs <= 0) return;

    const recordingAsset: VideoAsset = {
      id: RECORDING_ASSET_ID,
      name: videoFilePath ? getBasename(videoFilePath) : 'Recording',
      src: videoPath,
      durationMs: totalMs,
      width: 0,
      height: 0,
      kind: 'recording',
    };

    setVideoAssets((prev) => {
      const existing = prev.find((asset) => asset.id === RECORDING_ASSET_ID);
      if (!existing) {
        return [recordingAsset, ...prev];
      }
      const needsUpdate = (
        existing.src !== recordingAsset.src ||
        existing.durationMs !== recordingAsset.durationMs ||
        existing.name !== recordingAsset.name
      );
      if (!needsUpdate) return prev;
      return [recordingAsset, ...prev.filter((asset) => asset.id !== RECORDING_ASSET_ID)];
    });

    const recordingClips = videoClips.filter(isRecordingClip);
    const hasInvalidRange = recordingClips.some((clip) => clip.startMs < 0 || clip.endMs <= clip.startMs);
    const shouldReset = lastVideoPathRef.current !== videoPath || recordingClips.length === 0 || hasInvalidRange;
    if (shouldReset) {
      const id = `clip-${nextClipIdRef.current++}`;
      const { trackId } = ensureTrackForType(
        'videoClip',
        () => createTrack('recording', 'videoClip', 'Recording', { id: 'track-recording', order: TRACK_ORDER_STEP }),
        (track) => track.type === 'recording',
      );
      const single: VideoClip = {
        id,
        trackId,
        assetId: RECORDING_ASSET_ID,
        startMs: 0,
        endMs: totalMs,
        sourceStartMs: 0,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 0,
        playbackRate: 1,
        applyCamera: true,
      };
      setVideoClips((prev) => {
        const nonRecording = prev.filter((clip) => !isRecordingClip(clip));
        return [...nonRecording, single];
      });
      setSelectedClipId(id);
      lastVideoPathRef.current = videoPath;
    }
  }, [videoPath, duration, videoFilePath, videoClips, isRecordingClip, ensureTrackForType, createTrack]);

  useEffect(() => {
    const secondaryRecordingAssetIds = new Set(
      videoAssets
        .filter((asset) => asset.id !== RECORDING_ASSET_ID && asset.kind === 'recording')
        .map((asset) => asset.id),
    );
    if (!secondaryRecordingAssetIds.size) {
      return;
    }

    setVideoClips((prev) => {
      let changed = false;
      const next = prev.map((clip) => {
        if (clip.applyCamera || !secondaryRecordingAssetIds.has(clip.assetId)) {
          return clip;
        }

        if ((clip.borderRadius ?? 0) === borderRadius) {
          return clip;
        }

        changed = true;
        return { ...clip, borderRadius };
      });

      return changed ? next : prev;
    });
  }, [videoAssets, videoClips, borderRadius]);

  // Keep trim regions in sync with recording clips
  useEffect(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    if (totalMs <= 0) {
      setTrimRegions([]);
      return;
    }
    setTrimRegions(computeTrimRegionsFromClips(videoClips, totalMs));
  }, [videoClips, duration, computeTrimRegionsFromClips]);

  useEffect(() => {
    if (!videoFilePath) {
      setCursorTrack(null);
      setSelectedCursorId(null);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const result = await window.electronAPI.loadCursorData(videoFilePath);
        if (!mounted) return;
        if (!result.success || !result.data) {
          setCursorTrack(null);
          return;
        }
        const parsed = JSON.parse(result.data);
        const events = Array.isArray(parsed?.events) ? parsed.events : [];
        const style = parsed?.style ?? {};
        const preset = style.preset === 'arrow' || style.preset === 'dot' || style.preset === 'circle'
          ? style.preset
          : DEFAULT_CURSOR_STYLE.preset;
        const sizePx = typeof style.sizePx === 'number' && Number.isFinite(style.sizePx)
          ? style.sizePx
          : DEFAULT_CURSOR_STYLE.sizePx;
        setCursorTrack({
          events,
          style: {
            preset,
            sizePx,
            offsetMs: typeof parsed?.style?.offsetMs === 'number' ? parsed.style.offsetMs : undefined,
            offsetX: typeof parsed?.style?.offsetX === 'number' ? parsed.style.offsetX : undefined,
            offsetY: typeof parsed?.style?.offsetY === 'number' ? parsed.style.offsetY : undefined,
          },
        });
      } catch (err) {
        if (mounted) {
          setCursorTrack(null);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [videoFilePath]);

  // Initialize default wallpaper with resolved asset path
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resolvedPath = await getAssetPath('wallpapers/wallpaper1.jpg');
        if (mounted) {
          setWallpaper(resolvedPath);
        }
      } catch (err) {
        // If resolution fails, keep the fallback
        console.warn('Failed to resolve default wallpaper path:', err);
      }
    })();
    return () => { mounted = false };
  }, []);

  // Track changes for unsaved changes indicator
  useEffect(() => {
    // Skip if no video loaded yet
    if (!videoPath) return;

    // Mark as having unsaved changes whenever state changes
    setHasUnsavedChanges(true);
  }, [
    videoPath, zoomRegions, effectRegions, annotationRegions, videoAssets, videoClips, audioClips, tracks,
    cursorTrack, cursorEnabled, cursorSmoothing, wallpaper,
    shadowIntensity, showBlur, motionBlurEnabled, borderRadius,
    padding, cropRegion, screenOffset, aspectRatio, exportQuality
  ]);

  // Auto-save functionality
  useEffect(() => {
    if (!autoSaveEnabled || !currentProjectPath || !hasUnsavedChanges) {
      return;
    }

    // Auto-save after 30 seconds of inactivity
    const timer = setTimeout(async () => {
      const projectData = serializeProject();
      const result = await window.electronAPI.saveProject(
        projectData,
        getBasename(currentProjectPath)
      );

      if (result.success) {
        setHasUnsavedChanges(false);
        toast.info('Auto-saved', { duration: 2000 });
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [autoSaveEnabled, currentProjectPath, hasUnsavedChanges, serializeProject]);

  // Warn before closing with unsaved changes
  useEffect(() => {
    if (window.electronAPI) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Shows browser confirmation dialog
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function togglePlayPause() {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (isPlaying) {
      playback.pause();
    } else {
      playback.play().catch(err => console.error('Video play failed:', err));
    }
  }

  function handleSeek(time: number) {
    const playback = videoPlaybackRef.current;
    if (!playback) return;
    playback.seekToTimelineTime(time);
  }

  const formatRecordingElapsed = (seconds: number) => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  };

  useEffect(() => {
    const audioAssets = new Map(
      videoAssets
        .filter((asset) => asset.kind === 'audio')
        .map((asset) => [asset.id, asset]),
    );
    const audioElements = audioElementsRef.current;

    audioClips.forEach((clip) => {
      const asset = audioAssets.get(clip.assetId);
      if (!asset) return;

      let element = audioElements.get(clip.id);
      if (!element) {
        element = new Audio(asset.src);
        element.preload = 'auto';
        audioElements.set(clip.id, element);
      }

      if (element.src !== asset.src) {
        element.src = asset.src;
        element.load();
      }

      const isTrackMuted = Boolean(clip.trackId && mutedTrackIds.has(clip.trackId));
      const isTrackHidden = Boolean(clip.trackId && hiddenTrackIds.has(clip.trackId));
      element.volume = clip.muted || isTrackMuted || isTrackHidden ? 0 : Math.max(0, Math.min(1, clip.volume ?? 1));
    });

    for (const [clipId, element] of audioElements.entries()) {
      if (audioClips.some((clip) => clip.id === clipId)) continue;
      element.pause();
      audioElements.delete(clipId);
    }

    return () => {
      if (isPlaying) return;
      for (const element of audioElements.values()) {
        element.pause();
      }
    };
  }, [audioClips, hiddenTrackIds, isPlaying, mutedTrackIds, videoAssets]);

  useEffect(() => {
    const currentTimeMs = Math.round(currentTime * 1000);
    const audioAssets = new Map(
      videoAssets
        .filter((asset) => asset.kind === 'audio')
        .map((asset) => [asset.id, asset]),
    );

    for (const clip of audioClips) {
      const element = audioElementsRef.current.get(clip.id);
      const asset = audioAssets.get(clip.assetId);
      if (!element || !asset) continue;

      const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
      const sourceStartMs = clip.sourceStartMs ?? 0;
      const sourceEndMs = clip.sourceEndMs ?? Math.min(asset.durationMs || clipDurationMs, sourceStartMs + clipDurationMs);
      const effectiveDurationMs = Math.max(0, sourceEndMs - sourceStartMs);
      const isActive = currentTimeMs >= clip.startMs && currentTimeMs < clip.endMs && effectiveDurationMs > 0;

      if (!isActive) {
        if (!element.paused) {
          element.pause();
        }
        continue;
      }

      const localMs = currentTimeMs - clip.startMs;
      const targetMs = Math.max(
        sourceStartMs,
        Math.min(sourceStartMs + localMs, sourceEndMs),
      );
      const targetSeconds = targetMs / 1000;

      if (!Number.isFinite(element.currentTime) || Math.abs(element.currentTime - targetSeconds) > 0.12) {
        try {
          element.currentTime = targetSeconds;
        } catch {
          // Ignore seek sync failures for unsupported sources.
        }
      }

      const isTrackMuted = Boolean(clip.trackId && mutedTrackIds.has(clip.trackId));
      const isTrackHidden = Boolean(clip.trackId && hiddenTrackIds.has(clip.trackId));
      element.volume = clip.muted || isTrackMuted || isTrackHidden ? 0 : Math.max(0, Math.min(1, clip.volume ?? 1));

      if (isPlaying) {
        void element.play().catch(() => {
          // Ignore autoplay and decode failures in the editor preview.
        });
      } else if (!element.paused) {
        element.pause();
      }
    }
  }, [audioClips, currentTime, hiddenTrackIds, isPlaying, mutedTrackIds, videoAssets]);

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) setSelectedTrackId(null);
    if (id) setSelectedTrimId(null);
    if (id) setSelectedCursorId(null);
    if (id) setSelectedEffectId(null);
    if (id) setSelectedClipId(null);
    if (id) setSelectedAudioClipId(null);
  }, []);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedClipId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedAudioClipId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
    }
  }, []);

  const handleSelectAudioClip = useCallback((id: string | null) => {
    setSelectedAudioClipId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedClipId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
    }
  }, []);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedZoomId(null);
      setSelectedClipId(null);
      setSelectedAudioClipId(null);
      setSelectedAnnotationId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedClipId(null);
      setSelectedAudioClipId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
    }
  }, []);

  const handleSelectEffect = useCallback((id: string | null) => {
    setSelectedEffectId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedClipId(null);
      setSelectedAudioClipId(null);
      setSelectedCursorId(null);
      setSelectedSpeedId(null);
    }
  }, []);

  const handleSelectSpeed = useCallback((id: string | null) => {
    setSelectedSpeedId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedClipId(null);
      setSelectedAudioClipId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
    }
  }, []);

  const handleSelectTrack = useCallback((id: string | null) => {
    setSelectedTrackId(id);
    if (id) {
      setSelectedClipId(null);
      setSelectedAudioClipId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedEffectId(null);
      setSelectedSpeedId(null);
      setSelectedCursorId(null);
    }
  }, []);

  const handleSpeedAdded = useCallback((span: Span) => {
    const id = `speed-${nextSpeedIdRef.current++}`;
    const { trackId } = ensureTrackForType('speed', () => createNamedTrack('speed', 'speed', 'Speed'));
    const newRegion: SpeedRegion = {
      ...DEFAULT_SPEED_REGION,
      id,
      trackId,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setSpeedRegions((prev) => [...prev, newRegion]);
    setSelectedSpeedId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
    setSelectedEffectId(null);
  }, [ensureTrackForType, createNamedTrack]);

  const handleSpeedSpanChange = useCallback((id: string, span: Span) => {
    setSpeedRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    );
  }, []);

  const handleSpeedDelete = useCallback((id: string) => {
    setSpeedRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedSpeedId === id) {
      setSelectedSpeedId(null);
    }
  }, [selectedSpeedId]);

  const handleSpeedChange = useCallback((id: string, patch: Partial<SpeedRegion>) => {
    setSpeedRegions((prev) =>
      prev.map((region) => (region.id === id ? { ...region, ...patch } : region)),
    );
  }, []);

  const handleSpeedTrackChange = useCallback((id: string, trackId: string) => {
    setSpeedRegions((prev) => prev.map((region) => (
      region.id === id ? { ...region, trackId } : region
    )));
  }, []);

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const { trackId } = ensureTrackForType('zoom', () => createNamedTrack('zoom', 'zoom', 'Zoom'));
    const newRegion: ZoomRegion = {
      id,
      trackId,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: DEFAULT_ZOOM_DEPTH,
      focus: { cx: 0.5, cy: 0.5 },
    };
    setZoomRegions((prev) => [...prev, newRegion]);
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [ensureTrackForType, createNamedTrack]);

  const handleTrimAdded = useCallback((span: Span) => {
    const id = `trim-${nextTrimIdRef.current++}`;
    const { trackId } = ensureTrackForType('trim', () => createNamedTrack('trim', 'trim', 'Trim'));
    const newRegion: TrimRegion = {
      id,
      trackId,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setTrimRegions((prev) => [...prev, newRegion]);
    setSelectedTrimId(id);
    setSelectedZoomId(null);
    setSelectedAnnotationId(null);
  }, [ensureTrackForType, createNamedTrack]);

  const handleClipSpanChange = useCallback((id: string, span: Span) => {
    setVideoClips((prev) => {
      const target = prev.find((clip) => clip.id === id);
      if (!target) return prev;

      const minDuration = 100;

      if (isRecordingClip(target)) {
        const recording = [...prev].filter(isRecordingClip).sort((a, b) => a.startMs - b.startMs);
        const idx = recording.findIndex((clip) => clip.id === id);
        if (idx === -1) return prev;

        const prevEnd = idx > 0 ? recording[idx - 1].endMs : 0;
        const nextStart = idx < recording.length - 1 ? recording[idx + 1].startMs : Number.POSITIVE_INFINITY;
        const maxStart = Number.isFinite(nextStart) ? nextStart - minDuration : Number.POSITIVE_INFINITY;
        const roundedStart = Math.round(span.start);
        const roundedEnd = Math.round(span.end);
        const clampedStart = Math.max(prevEnd, Math.min(roundedStart, maxStart));
        const unclampedEnd = Math.max(clampedStart + minDuration, roundedEnd);
        const clampedEnd = Number.isFinite(nextStart)
          ? Math.min(unclampedEnd, nextStart)
          : unclampedEnd;

        return prev.map((clip) => (
          clip.id === id
            ? { ...clip, startMs: clampedStart, endMs: clampedEnd, sourceStartMs: clampedStart }
            : clip
        ));
      }

      const clampedStart = Math.max(0, Math.round(span.start));
      const clampedEnd = Math.max(clampedStart + minDuration, Math.round(span.end));
      return prev.map((clip) => (
        clip.id === id
          ? { ...clip, startMs: clampedStart, endMs: clampedEnd }
          : clip
      ));
    });
  }, [isRecordingClip]);

  const handleClipSplit = useCallback(() => {
    const totalMs = Math.max(0, timelineContentEndMs);
    if (totalMs <= 0) return;
    const playheadMs = Math.max(0, Math.min(Math.round(currentTime * 1000), totalMs));

    setVideoClips((prev) => {
      const target = prev.find((clip) => playheadMs > clip.startMs && playheadMs < clip.endMs);
      if (!target) {
        toast.error('Place the playhead inside the clip to split');
        return prev;
      }

      const localSplit = playheadMs - target.startMs;
      const sourceStart = target.sourceStartMs ?? 0;
      const defaultSourceEnd = sourceStart + (target.endMs - target.startMs);
      const sourceEnd = typeof target.sourceEndMs === 'number' ? target.sourceEndMs : defaultSourceEnd;
      const sourceSplit = Math.min(
        sourceEnd,
        sourceStart + getSourceOffsetForTimelineOffsetMs(target, Math.max(0, localSplit)),
      );

      const firstId = `clip-${nextClipIdRef.current++}`;
      const secondId = `clip-${nextClipIdRef.current++}`;

      const first: VideoClip = {
        ...target,
        id: firstId,
        endMs: playheadMs,
        sourceEndMs: sourceSplit,
      };
      const second: VideoClip = {
        ...target,
        id: secondId,
        startMs: playheadMs,
        sourceStartMs: sourceSplit,
      };

      const remaining = prev.filter((clip) => clip.id !== target.id);
      const updated = [
        ...remaining,
        withNormalizedClipDuration(first),
        withNormalizedClipDuration(second),
      ].sort((a, b) => a.startMs - b.startMs);
      setSelectedClipId(secondId);
      return updated;
    });
  }, [currentTime, timelineContentEndMs]);

  const handleClipDelete = useCallback((id: string) => {
    setVideoClips((prev) => {
      const target = prev.find((clip) => clip.id === id);
      if (!target) return prev;

      if (isRecordingClip(target)) {
        const recording = prev.filter(isRecordingClip);
        if (recording.length <= 1) {
          toast.error('Cannot remove the only recording clip');
          return prev;
        }
      }

      const updated = prev.filter((clip) => clip.id !== id);
      if (selectedClipId === id) {
        setSelectedClipId(updated.length ? updated[updated.length - 1].id : null);
      }
      return updated;
    });
  }, [isRecordingClip, selectedClipId]);

  const handleAudioClipSpanChange = useCallback((id: string, span: Span) => {
    setAudioClips((prev) =>
      prev.map((clip) =>
        clip.id === id
          ? (() => {
              const startMs = Math.max(0, Math.round(span.start));
              return {
                ...clip,
                startMs,
                endMs: Math.max(startMs + 100, Math.round(span.end)),
              };
            })()
          : clip,
      ),
    );
  }, []);

  const handleAudioClipDelete = useCallback((id: string) => {
    setAudioClips((prev) => prev.filter((clip) => clip.id !== id));
    if (selectedAudioClipId === id) {
      setSelectedAudioClipId(null);
    }
  }, [selectedAudioClipId]);

  const handleEffectAdded = useCallback((span: Span) => {
    const id = `effect-${nextEffectIdRef.current++}`;
    const { trackId } = ensureTrackForType(
      'effect',
      () => createNamedTrack('effect', 'effect', 'Perspective'),
      (track) => track.name.toLowerCase().includes('perspective'),
    );
    const newRegion: EffectRegion = {
      ...DEFAULT_EFFECT_REGION,
      id,
      trackId,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setEffectRegions((prev) => [...prev, newRegion]);
    setSelectedEffectId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [ensureTrackForType, createNamedTrack]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleTrimSpanChange = useCallback((id: string, span: Span) => {
    setTrimRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleEffectSpanChange = useCallback((id: string, span: Span) => {
    setEffectRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              focus: clampFocusToDepth(focus, region.depth),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === selectedZoomId
          ? {
              ...region,
              depth,
              focus: clampFocusToDepth(region.focus, depth),
            }
          : region,
      ),
    );
  }, [selectedZoomId]);

  const handleZoomDelete = useCallback((id: string) => {
    setZoomRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedZoomId === id) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId]);

  const handleTrimDelete = useCallback((id: string) => {
    setTrimRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedTrimId === id) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId]);

  const handleEffectDelete = useCallback((id: string) => {
    setEffectRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedEffectId === id) {
      setSelectedEffectId(null);
    }
  }, [selectedEffectId]);

  const handleEffectChange = useCallback((id: string, patch: Partial<EffectRegion>) => {
    const nextType = patch.type;
    const nextTrackId = nextType
      ? ensureTrackForType(
          'effect',
          () => createNamedTrack('effect', 'effect', nextType === 'shake' ? 'Shake' : 'Perspective'),
          (track) => track.name.toLowerCase().includes(nextType),
        ).trackId
      : null;
    setEffectRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, ...patch, ...(nextTrackId ? { trackId: nextTrackId } : {}) }
          : region,
      ),
    );
  }, [ensureTrackForType, createNamedTrack]);

  const handleAnnotationAdded = useCallback((span: Span) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
    const { trackId } = ensureTrackForType('annotation', () => createNamedTrack('annotation', 'annotation', 'Annotations'));
    const newRegion: AnnotationRegion = {
      id,
      trackId,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      type: 'text',
      content: 'Enter text...',
      position: { ...DEFAULT_ANNOTATION_POSITION },
      size: { ...DEFAULT_ANNOTATION_SIZE },
      style: { ...DEFAULT_ANNOTATION_STYLE },
      zIndex,
      layer: 'foreground',
      fadeInMs: DEFAULT_ANNOTATION_EFFECTS.fadeInMs,
      fadeOutMs: DEFAULT_ANNOTATION_EFFECTS.fadeOutMs,
      enterEffect: DEFAULT_ANNOTATION_EFFECTS.enterEffect,
      exitEffect: DEFAULT_ANNOTATION_EFFECTS.exitEffect,
    };
    setAnnotationRegions((prev) => [...prev, newRegion]);
    setSelectedAnnotationId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedEffectId(null);
  }, [ensureTrackForType, createNamedTrack]);

  const handleAddItemToTrack = useCallback((trackId: string) => {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
      return;
    }

    const videoDurationMs = Math.max(0, Math.round(duration * 1000));
    const startMs = Math.max(0, Math.min(Math.round(currentTime * 1000), videoDurationMs || Number.MAX_SAFE_INTEGER));
    const buildSpan = (preferredDurationMs: number) => {
      const safeDurationMs = Math.max(1, preferredDurationMs);
      const endMs = videoDurationMs > 0
        ? Math.min(videoDurationMs, startMs + Math.min(preferredDurationMs, videoDurationMs))
        : startMs + safeDurationMs;
      return {
        startMs,
        endMs: Math.max(startMs + 1, endMs),
      };
    };

    switch (track.itemType) {
      case 'zoom': {
        const span = buildSpan(1000);
        const id = `zoom-${nextZoomIdRef.current++}`;
        const newRegion: ZoomRegion = {
          id,
          trackId,
          startMs: span.startMs,
          endMs: span.endMs,
          depth: DEFAULT_ZOOM_DEPTH,
          focus: { cx: 0.5, cy: 0.5 },
        };
        setZoomRegions((prev) => [...prev, newRegion]);
        setSelectedTrackId(null);
        setSelectedZoomId(id);
        setSelectedTrimId(null);
        setSelectedAnnotationId(null);
        setSelectedEffectId(null);
        setSelectedClipId(null);
        setSelectedAudioClipId(null);
        setSelectedSpeedId(null);
        setSelectedCursorId(null);
        return;
      }
      case 'trim': {
        const span = buildSpan(1000);
        const id = `trim-${nextTrimIdRef.current++}`;
        const newRegion: TrimRegion = { id, trackId, startMs: span.startMs, endMs: span.endMs };
        setTrimRegions((prev) => [...prev, newRegion]);
        setSelectedTrackId(null);
        setSelectedTrimId(id);
        setSelectedZoomId(null);
        setSelectedAnnotationId(null);
        setSelectedEffectId(null);
        setSelectedClipId(null);
        setSelectedAudioClipId(null);
        setSelectedSpeedId(null);
        setSelectedCursorId(null);
        return;
      }
      case 'effect': {
        const span = buildSpan(1200);
        const id = `effect-${nextEffectIdRef.current++}`;
        const isShakeTrack = track.name.toLowerCase().includes('shake');
        const newRegion: EffectRegion = {
          ...DEFAULT_EFFECT_REGION,
          id,
          trackId,
          startMs: span.startMs,
          endMs: span.endMs,
          type: isShakeTrack ? 'shake' : 'perspective',
        };
        setEffectRegions((prev) => [...prev, newRegion]);
        setSelectedTrackId(null);
        setSelectedEffectId(id);
        setSelectedZoomId(null);
        setSelectedTrimId(null);
        setSelectedAnnotationId(null);
        setSelectedClipId(null);
        setSelectedAudioClipId(null);
        setSelectedSpeedId(null);
        setSelectedCursorId(null);
        return;
      }
      case 'annotation': {
        const span = buildSpan(1000);
        const id = `annotation-${nextAnnotationIdRef.current++}`;
        const newRegion: AnnotationRegion = {
          id,
          trackId,
          startMs: span.startMs,
          endMs: span.endMs,
          type: 'text',
          content: 'Enter text...',
          position: { ...DEFAULT_ANNOTATION_POSITION },
          size: { ...DEFAULT_ANNOTATION_SIZE },
          style: { ...DEFAULT_ANNOTATION_STYLE },
          zIndex: nextAnnotationZIndexRef.current++,
          layer: 'foreground',
          fadeInMs: DEFAULT_ANNOTATION_EFFECTS.fadeInMs,
          fadeOutMs: DEFAULT_ANNOTATION_EFFECTS.fadeOutMs,
          enterEffect: DEFAULT_ANNOTATION_EFFECTS.enterEffect,
          exitEffect: DEFAULT_ANNOTATION_EFFECTS.exitEffect,
        };
        setAnnotationRegions((prev) => [...prev, newRegion]);
        setSelectedTrackId(null);
        setSelectedAnnotationId(id);
        setSelectedZoomId(null);
        setSelectedTrimId(null);
        setSelectedEffectId(null);
        setSelectedClipId(null);
        setSelectedAudioClipId(null);
        setSelectedSpeedId(null);
        setSelectedCursorId(null);
        return;
      }
      case 'speed': {
        const span = buildSpan(2000);
        const id = `speed-${nextSpeedIdRef.current++}`;
        const newRegion: SpeedRegion = {
          ...DEFAULT_SPEED_REGION,
          id,
          trackId,
          startMs: span.startMs,
          endMs: span.endMs,
        };
        setSpeedRegions((prev) => [...prev, newRegion]);
        setSelectedTrackId(null);
        setSelectedSpeedId(id);
        setSelectedZoomId(null);
        setSelectedTrimId(null);
        setSelectedAnnotationId(null);
        setSelectedEffectId(null);
        setSelectedClipId(null);
        setSelectedAudioClipId(null);
        setSelectedCursorId(null);
        return;
      }
      default:
        toast.info('Select or drop media to add clips to video or audio tracks.');
    }
  }, [currentTime, duration, tracks]);

  const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleAnnotationTimingChange = useCallback((id: string, startMs: number, endMs: number) => {
    const clampedStart = Math.max(0, Math.min(startMs, endMs));
    const clampedEnd = Math.max(clampedStart + 1, endMs); // ensure minimal duration

    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(clampedStart), endMs: Math.round(clampedEnd) }
          : region,
      ),
    );
  }, []);

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId]);

  const handleAnnotationContentChange = useCallback((id: string, content: string) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        // Store content in type-specific fields
        if (region.type === 'text') {
          return { ...region, content, textContent: content };
        } else if (region.type === 'image') {
          return { ...region, content, imageContent: content };
        } else if (region.type === 'emoji') {
          return { ...region, content, emojiAlt: region.emojiAlt || 'Emoji' };
        }
        return { ...region, content };
      });
      return updated;
    });
  }, []);

  const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion['type']) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        const updatedRegion = { ...region, type };
        
        // Restore content from type-specific storage
        if (type === 'text') {
          updatedRegion.content = region.textContent || 'Enter text...';
        } else if (type === 'image') {
          updatedRegion.content = region.imageContent || '';
        } else if (type === 'figure') {
          updatedRegion.content = '';
          if (!region.figureData) {
            updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
          }
        } else if (type === 'emoji') {
          updatedRegion.content = region.content || region.imageContent || '';
          updatedRegion.emojiAlt = region.emojiAlt || 'Emoji';
        }

        if (!updatedRegion.layer) {
          updatedRegion.layer = 'foreground';
        }
        if (!updatedRegion.fadeInMs) {
          updatedRegion.fadeInMs = DEFAULT_ANNOTATION_EFFECTS.fadeInMs;
        }
        if (!updatedRegion.fadeOutMs) {
          updatedRegion.fadeOutMs = DEFAULT_ANNOTATION_EFFECTS.fadeOutMs;
        }
        if (!updatedRegion.enterEffect) {
          updatedRegion.enterEffect = DEFAULT_ANNOTATION_EFFECTS.enterEffect;
        }
        if (!updatedRegion.exitEffect) {
          updatedRegion.exitEffect = DEFAULT_ANNOTATION_EFFECTS.exitEffect;
        }
        
        return updatedRegion;
      });
      return updated;
    });
  }, []);

  const handleAnnotationEmojiChange = useCallback(
    (id: string, emoji: { src: string; alt?: string; category?: string }) => {
      setAnnotationRegions((prev) =>
        prev.map((region) => {
          if (region.id !== id) return region;
          return {
            ...region,
            type: 'emoji',
            content: emoji.src,
            emojiAlt: emoji.alt || 'Emoji',
            emojiCategory: emoji.category,
            layer: region.layer || 'foreground',
          };
        }),
      );
    },
    [],
  );

  const handleAnnotationLayerChange = useCallback((id: string, layer: AnnotationRegion['layer']) => {
    setAnnotationRegions((prev) =>
      prev.map((region) => (region.id === id ? { ...region, layer } : region)),
    );
  }, []);

  const handleAnnotationStyleChange = useCallback((id: string, style: Partial<AnnotationRegion['style']>) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, style: { ...region.style, ...style } }
          : region,
      ),
    );
  }, []);

  const handleAnnotationEffectChange = useCallback(
    (id: string, patch: Partial<AnnotationRegion>) => {
      setAnnotationRegions((prev) =>
        prev.map((region) => (region.id === id ? { ...region, ...patch } : region)),
      );
    },
    [],
  );

  const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, figureData }
          : region,
      ),
    );
  }, []);

  const handleAnnotationPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, position }
          : region,
      ),
    );
  }, []);

  const handleAnnotationSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, size }
          : region,
      ),
    );
  }, []);

  const loadMediaMetadata = useCallback((src: string, kind: 'video' | 'audio' | 'image') => {
    return new Promise<{ durationMs: number; width: number; height: number }>((resolve, reject) => {
      if (kind === 'image') {
        const image = new Image();
        if (src.startsWith('http')) {
          image.crossOrigin = 'anonymous';
        }

        let settled = false;
        const resolveOnce = () => {
          if (settled) return;
          settled = true;
          resolve({
            durationMs: Math.max(500, Math.round(defaultImageClipDurationMs)),
            width: image.naturalWidth || 0,
            height: image.naturalHeight || 0,
          });
        };
        const rejectOnce = () => {
          if (settled) return;
          settled = true;
          reject(new Error('Failed to load image metadata'));
        };

        image.addEventListener('load', resolveOnce, { once: true });
        image.addEventListener('error', rejectOnce, { once: true });
        image.src = src;

        if (image.complete && image.naturalWidth > 0) {
          resolveOnce();
        }
        return;
      }

      const media = kind === 'audio'
        ? document.createElement('audio')
        : document.createElement('video');

      media.preload = 'metadata';
      if (media instanceof HTMLVideoElement) {
        media.muted = true;
        media.playsInline = true;
      }
      if (src.startsWith('http')) {
        media.crossOrigin = 'anonymous';
      }

      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve({
          durationMs: Math.max(0, Math.round((media.duration || 0) * 1000)),
          width: media instanceof HTMLVideoElement ? media.videoWidth || 0 : 0,
          height: media instanceof HTMLVideoElement ? media.videoHeight || 0 : 0,
        });
      };
      const rejectOnce = () => {
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to load ${kind} metadata`));
      };

      media.addEventListener('loadedmetadata', resolveOnce, { once: true });
      media.addEventListener('error', rejectOnce, { once: true });
      media.src = src;
      try {
        media.load();
      } catch {
        // Ignore load errors for browsers that auto-load on src assignment.
      }

      if (media.readyState >= 1) {
        resolveOnce();
      }
    });
  }, [defaultImageClipDurationMs]);

  const inferAssetKind = useCallback((filePath: string): 'video' | 'audio' | 'image' => {
    const normalized = filePath.toLowerCase();
    if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(normalized)) {
      return 'audio';
    }
    if (/\.(png|jpe?g|webp|bmp|svg)$/i.test(normalized)) {
      return 'image';
    }
    return 'video';
  }, []);

  const handleAppendRecordedSegment = useCallback(async ({
    path,
    durationMs,
    fileName,
  }: {
    path: string;
    durationMs: number;
    fileName: string;
  }) => {
    setIsAppendingRecording(true);
    toast.loading('Adding recording to current timeline...', { id: 'append-recording' });
    const src = toFileUrl(path);
    const safeDurationMs = Math.max(100, Math.round(durationMs));

    try {
      let meta = {
        durationMs: safeDurationMs,
        width: 0,
        height: 0,
      };

      try {
        meta = await loadMediaMetadata(src, 'video');
      } catch (error) {
        console.warn('Failed to read continued recording metadata, using fallback duration.', error);
      }

      const assetId = `asset-${nextAssetIdRef.current++}`;
      const clipId = `clip-${nextClipIdRef.current++}`;
      const startMs = Math.max(0, timelineContentEndMs);
      const endMs = startMs + Math.max(100, meta.durationMs || safeDurationMs);
      const availableTrackId = findAvailableVideoTrackId(startMs, endMs);
      const createdTrack = availableTrackId ? null : createNamedTrack('generic', 'mixed', 'Track');
      const trackId = availableTrackId ?? createdTrack?.id;

      const asset: VideoAsset = normalizeRecordingAssetKind({
        id: assetId,
        name: removeExtension(fileName || getBasename(path)),
        src,
        durationMs: Math.max(100, meta.durationMs || safeDurationMs),
        width: meta.width,
        height: meta.height,
        kind: 'recording',
      });

      const clip: VideoClip = {
        id: clipId,
        trackId,
        assetId,
        startMs,
        endMs,
        sourceStartMs: 0,
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: nextClipZIndexRef.current++,
        playbackRate: 1,
        borderRadius,
        fit: 'contain',
        chromaKey: {
          enabled: false,
          color: '#00ff00',
          threshold: 0.35,
          softness: 0.15,
        },
      };

      if (createdTrack) {
        setTracks((prev) => ensureTrackHeights([...prev, createdTrack]));
      }
      setVideoAssets((prev) => [...prev, asset]);
      setVideoClips((prev) => [...prev, withNormalizedClipDuration(clip)]);
      handleSelectClip(clipId);
      handleSeek(startMs / 1000);
      toast.success('Recording appended to the current timeline', { id: 'append-recording' });
    } catch (error) {
      console.error('Failed to append recording to timeline:', error);
      toast.error('Failed to add recording to the current timeline', { id: 'append-recording' });
    } finally {
      setIsAppendingRecording(false);
    }
  }, [
    borderRadius,
    createNamedTrack,
    findAvailableVideoTrackId,
    handleSelectClip,
    loadMediaMetadata,
    timelineContentEndMs,
  ]);

  const { recording, toggleRecording } = useScreenRecorder({
    onRecordingSaved: handleAppendRecordedSegment,
    setCurrentVideoPathOnSave: false,
    switchToEditorOnSave: false,
  });

  useEffect(() => {
    let mounted = true;

    const syncSelectedSource = async () => {
      try {
        const source = await window.electronAPI.getSelectedSource();
        if (!mounted) return;
        if (source?.name) {
          setSelectedSourceName(source.name);
          setHasSelectedSource(true);
          return;
        }
      } catch (error) {
        console.warn('Failed to read selected source:', error);
      }

      if (!mounted) return;
      setSelectedSourceName("Screen");
      setHasSelectedSource(false);
    };

    syncSelectedSource();
    const interval = window.setInterval(syncSelectedSource, 1000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;

    if (recording) {
      if (!recordingStartedAt) {
        setRecordingStartedAt(Date.now());
      }
      timer = window.setInterval(() => {
        setRecordingElapsedSeconds((current) => current + 1);
      }, 1000);
    } else {
      setRecordingStartedAt(null);
      setRecordingElapsedSeconds(0);
    }

    return () => {
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [recording, recordingStartedAt]);

  const handleEditorRecordingToggle = useCallback(() => {
    if (!hasSelectedSource && !recording) {
      window.electronAPI.openSourceSelector();
      return;
    }

    if (recording) {
      toast.loading('Stopping recording and appending it to the current timeline...', { id: 'append-recording' });
    } else {
      toast.info('Recording will stay in this editor and append to the end of the timeline.', { id: 'append-recording' });
    }

    toggleRecording();
  }, [hasSelectedSource, recording, toggleRecording]);

  const handleAddMediaAssets = useCallback(async () => {
    const pickerResult = await (
      window.electronAPI.openVideoFilesPicker
        ? window.electronAPI.openVideoFilesPicker()
        : window.electronAPI.openVideoFilePicker()
    );

    if (!pickerResult.success) return;

    const paths = 'paths' in pickerResult && Array.isArray(pickerResult.paths)
      ? pickerResult.paths
      : 'path' in pickerResult && pickerResult.path
      ? [pickerResult.path]
      : [];

    if (!paths.length) return;

    const startMs = Math.max(0, Math.round(currentTime * 1000));
    let lastCreatedClipId: string | null = null;

    for (const path of paths) {
      const src = toFileUrl(path);
      if (videoAssets.some((asset) => asset.src === src)) {
        continue;
      }
      try {
        const kind = inferAssetKind(path);
        const meta = await loadMediaMetadata(src, kind);
        const asset: VideoAsset = normalizeRecordingAssetKind({
          id: `asset-${nextAssetIdRef.current++}`,
          name: getBasename(path),
          src,
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
          kind,
        });
        setVideoAssets((prev) => [...prev, asset]);

        if (kind !== 'audio') {
          const preferredDuration = kind === 'image'
            ? defaultImageClipDurationMs
            : asset.durationMs > 0
              ? asset.durationMs
              : 3000;
          const durationMs = Math.max(100, preferredDuration);
          const clipId = `clip-${nextClipIdRef.current++}`;
          const endMs = startMs + durationMs;
          const availableTrackId = findAvailableVideoTrackId(startMs, endMs);
          const { trackId } = availableTrackId
            ? { trackId: availableTrackId }
            : ensureTrackForType('videoClip', () => createNamedTrack('generic', 'mixed', 'Track'), (track) => track.type !== 'recording');
          const clip: VideoClip = {
            id: clipId,
            trackId,
            assetId: asset.id,
            startMs,
            endMs,
            sourceStartMs: 0,
            position: { ...DEFAULT_CLIP_POSITION },
            size: { ...DEFAULT_CLIP_SIZE },
            zIndex: nextClipZIndexRef.current++,
            playbackRate: 1,
            borderRadius: asset.kind === 'recording' ? borderRadius : 0,
            fit: 'contain',
            chromaKey: {
              enabled: false,
              color: '#00ff00',
              threshold: 0.35,
              softness: 0.15,
            },
          };

          setVideoClips((prev) => [...prev, withNormalizedClipDuration(clip)]);
          lastCreatedClipId = clipId;
        }
      } catch (error) {
        console.warn('Failed to load media metadata:', error);
      }
    }

    if (lastCreatedClipId) {
      handleSelectClip(lastCreatedClipId);
    }
  }, [borderRadius, currentTime, defaultImageClipDurationMs, inferAssetKind, loadMediaMetadata, videoAssets, toFileUrl, handleSelectClip, findAvailableVideoTrackId, ensureTrackForType, createNamedTrack]);

  const handleRemoveVideoAsset = useCallback((assetId: string) => {
    if (assetId === RECORDING_ASSET_ID) return;
    setVideoAssets((prev) => prev.filter((asset) => asset.id !== assetId));
    setVideoClips((prev) => prev.filter((clip) => clip.assetId !== assetId));
    setAudioClips((prev) => prev.filter((clip) => clip.assetId !== assetId));
    if (selectedClipId) {
      const stillExists = videoClips.some((clip) => clip.id === selectedClipId && clip.assetId !== assetId);
      if (!stillExists) setSelectedClipId(null);
    }
    if (selectedAudioClipId) {
      const stillExists = audioClips.some((clip) => clip.id === selectedAudioClipId && clip.assetId !== assetId);
      if (!stillExists) setSelectedAudioClipId(null);
    }
  }, [audioClips, videoClips, selectedAudioClipId, selectedClipId]);

  const handleAddClip = useCallback((assetId: string, startOverrideMs?: number, trackOverrideId?: string) => {
    const asset = videoAssets.find((item) => item.id === assetId);
    if (!asset || asset.kind === 'audio') return;

    const startMs = Math.max(0, Math.round(startOverrideMs ?? currentTime * 1000));
    const preferredDuration = asset.kind === 'image'
      ? defaultImageClipDurationMs
      : asset.durationMs > 0
        ? asset.durationMs
        : 3000;
    const durationMs = Math.max(100, preferredDuration);
    const endMs = startMs + durationMs;
    const availableTrackId = trackOverrideId ?? findAvailableVideoTrackId(startMs, endMs);
    const { trackId } = availableTrackId
      ? { trackId: availableTrackId }
      : ensureTrackForType('videoClip', () => createNamedTrack('generic', 'mixed', 'Track'), (track) => track.type !== 'recording');

    const newRegion: VideoClip = {
      id: `clip-${nextClipIdRef.current++}`,
      trackId,
      assetId,
      startMs,
      endMs,
      sourceStartMs: 0,
      position: { ...DEFAULT_CLIP_POSITION },
      size: { ...DEFAULT_CLIP_SIZE },
      zIndex: nextClipZIndexRef.current++,
      playbackRate: 1,
      borderRadius: asset.kind === 'recording' ? borderRadius : 0,
      fit: 'contain',
      chromaKey: {
        enabled: false,
        color: '#00ff00',
        threshold: 0.35,
        softness: 0.15,
      },
    };

    setVideoClips((prev) => [...prev, withNormalizedClipDuration(newRegion)]);
    handleSelectClip(newRegion.id);
  }, [videoAssets, currentTime, borderRadius, defaultImageClipDurationMs, handleSelectClip, findAvailableVideoTrackId, ensureTrackForType, createNamedTrack]);

  const handleAddAudioClip = useCallback((assetId: string, startOverrideMs?: number, trackOverrideId?: string) => {
    const asset = videoAssets.find((item) => item.id === assetId);
    if (!asset || asset.kind !== 'audio') return;

    const startMs = Math.max(0, Math.round(startOverrideMs ?? currentTime * 1000));
    const preferredDuration = asset.durationMs > 0 ? asset.durationMs : 3000;
    const durationMs = Math.max(100, preferredDuration);
    const endMs = startMs + durationMs;

    const newClip: AudioClip = {
      id: `audio-${nextAudioClipIdRef.current++}`,
      trackId: trackOverrideId ?? ensureTrackForType('audioClip', () => createNamedTrack('generic', 'mixed', 'Track'), (track) => track.type !== 'recording').trackId,
      assetId,
      startMs,
      endMs,
      sourceStartMs: 0,
      volume: 1,
      muted: false,
    };

    setAudioClips((prev) => [...prev, newClip]);
    handleSelectAudioClip(newClip.id);
  }, [videoAssets, currentTime, handleSelectAudioClip, ensureTrackForType, createNamedTrack]);

  const getEditableClipRect = useCallback((clip: VideoClip): InteractionRect | null => {
    if (!isRecordingClip(clip)) {
      return {
        x: clip.position.x,
        y: clip.position.y,
        width: clip.size.width,
        height: clip.size.height,
      };
    }

    const sourceVideo = videoPlaybackRef.current?.video;
    const sourceWidth = sourceVideo?.videoWidth || 0;
    const sourceHeight = sourceVideo?.videoHeight || 0;
    const stageWidth = getAspectRatioValue(aspectRatio);
    const stageHeight = 1;
    if (sourceWidth <= 0 || sourceHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) return null;

    const currentRect = resolveRecordingVisibleRect({
      stageWidth,
      stageHeight,
      sourceWidth,
      sourceHeight,
      cropRegion,
      padding: currentPadding,
      screenOffset,
    });
    if (!currentRect) return null;

    return {
      x: (currentRect.x / stageWidth) * 100,
      y: (currentRect.y / stageHeight) * 100,
      width: (currentRect.width / stageWidth) * 100,
      height: (currentRect.height / stageHeight) * 100,
    };
  }, [isRecordingClip, aspectRatio, cropRegion, currentPadding, screenOffset]);

  const handleClipRectChange = useCallback((id: string, rect: InteractionRect) => {
    const clip = videoClips.find((item) => item.id === id);
    if (!clip) return;

    if (isRecordingClip(clip)) {
      const sourceVideo = videoPlaybackRef.current?.video;
      const sourceWidth = sourceVideo?.videoWidth || 0;
      const sourceHeight = sourceVideo?.videoHeight || 0;
      const stageWidth = getAspectRatioValue(aspectRatio);
      const stageHeight = 1;
      if (sourceWidth <= 0 || sourceHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) return;

      const nextLayout = resolveRecordingLayoutFromVisibleRect({
        rect: {
          x: (rect.x / 100) * stageWidth,
          y: (rect.y / 100) * stageHeight,
          width: (rect.width / 100) * stageWidth,
          height: (rect.height / 100) * stageHeight,
        },
        stageWidth,
        stageHeight,
        sourceWidth,
        sourceHeight,
        cropRegion,
      });
      if (!nextLayout) return;

      setPadding(nextLayout.padding);
      setScreenOffset({
        x: stageWidth ? (nextLayout.screenOffsetPx.x / stageWidth) * 100 : 0,
        y: stageHeight ? (nextLayout.screenOffsetPx.y / stageHeight) * 100 : 0,
      });
      return;
    }

    setVideoClips((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              position: { x: rect.x, y: rect.y },
              size: { width: rect.width, height: rect.height },
            }
          : item,
      ),
    );
  }, [videoClips, isRecordingClip, aspectRatio, cropRegion, currentPadding, screenOffset]);

  const handleClipPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    const clip = videoClips.find((item) => item.id === id);
    if (!clip) return;
    const currentRect = getEditableClipRect(clip);
    if (!currentRect) return;
    handleClipRectChange(id, {
      ...currentRect,
      x: position.x,
      y: position.y,
    });
  }, [videoClips, getEditableClipRect, handleClipRectChange]);

  const handleClipSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    const clip = videoClips.find((item) => item.id === id);
    if (!clip) return;
    const currentRect = getEditableClipRect(clip);
    if (!currentRect) return;
    handleClipRectChange(id, {
      ...currentRect,
      width: size.width,
      height: size.height,
    });
  }, [videoClips, getEditableClipRect, handleClipRectChange]);

  const handleClipChange = useCallback((id: string, patch: Partial<VideoClip>) => {
    setVideoClips((prev) =>
      prev.map((clip) =>
        clip.id === id
          ? withNormalizedClipDuration({
              ...clip,
              ...patch,
              playbackRate: patch.playbackRate ?? clip.playbackRate ?? 1,
            })
          : clip,
      ),
    );
  }, []);

  const handleTrackHeightChange = useCallback((trackId: string, height: number) => {
    setTracks((prev) => prev.map((track) => (
      track.id === trackId
        ? { ...track, height: Math.max(36, Math.min(160, height)) }
        : track
    )));
  }, []);

  const handleTrackOrderChange = useCallback((sourceTrackId: string, targetTrackId: string, placement: 'before' | 'after') => {
    setTracks((prev) => {
      if (sourceTrackId === targetTrackId) {
        return prev;
      }

      const ordered = [...prev].sort((a, b) => a.order - b.order);
      const sourceIndex = ordered.findIndex((track) => track.id === sourceTrackId);
      const targetIndex = ordered.findIndex((track) => track.id === targetTrackId);

      if (sourceIndex === -1 || targetIndex === -1) {
        return prev;
      }

      const [moved] = ordered.splice(sourceIndex, 1);
      const normalizedTargetIndex = ordered.findIndex((track) => track.id === targetTrackId);
      if (normalizedTargetIndex === -1) {
        return prev;
      }
      const insertIndex = placement === 'before' ? normalizedTargetIndex : normalizedTargetIndex + 1;
      ordered.splice(insertIndex, 0, moved);

      return ordered.map((track, index) => ({
        ...track,
        order: (index + 1) * TRACK_ORDER_STEP,
      }));
    });
  }, []);

  const handleTrackMuteChange = useCallback((trackId: string, muted: boolean) => {
    setTracks((prev) => prev.map((track) => (
      track.id === trackId ? { ...track, muted } : track
    )));
  }, []);

  const handleTrackHiddenChange = useCallback((trackId: string, hidden: boolean) => {
    setTracks((prev) => prev.map((track) => (
      track.id === trackId ? { ...track, hidden } : track
    )));
  }, []);

  const handleTrackDelete = useCallback((trackId: string) => {
    const deletedClipIds = new Set(videoClips.filter((clip) => clip.trackId === trackId).map((clip) => clip.id));
    const deletedAudioIds = new Set(audioClips.filter((clip) => clip.trackId === trackId).map((clip) => clip.id));
    const deletedZoomIds = new Set(zoomRegions.filter((region) => region.trackId === trackId).map((region) => region.id));
    const deletedTrimIds = new Set(trimRegions.filter((region) => region.trackId === trackId).map((region) => region.id));
    const deletedEffectIds = new Set(effectRegions.filter((region) => region.trackId === trackId).map((region) => region.id));
    const deletedAnnotationIds = new Set(annotationRegions.filter((region) => region.trackId === trackId).map((region) => region.id));
    const deletedSpeedIds = new Set(speedRegions.filter((region) => region.trackId === trackId).map((region) => region.id));
    const deletesCursorTrack = cursorTrack?.trackId === trackId;

    setTracks((prev) => prev.filter((track) => track.id !== trackId));
    setVideoClips((prev) => prev.filter((clip) => clip.trackId !== trackId));
    setAudioClips((prev) => prev.filter((clip) => clip.trackId !== trackId));
    setZoomRegions((prev) => prev.filter((region) => region.trackId !== trackId));
    setTrimRegions((prev) => prev.filter((region) => region.trackId !== trackId));
    setEffectRegions((prev) => prev.filter((region) => region.trackId !== trackId));
    setAnnotationRegions((prev) => prev.filter((region) => region.trackId !== trackId));
    setSpeedRegions((prev) => prev.filter((region) => region.trackId !== trackId));

    if (deletesCursorTrack) {
      setCursorTrack(null);
      setSelectedCursorId(null);
    }

    if (selectedClipId && deletedClipIds.has(selectedClipId)) {
      setSelectedClipId(null);
    }
    if (selectedAudioClipId && deletedAudioIds.has(selectedAudioClipId)) {
      setSelectedAudioClipId(null);
    }
    if (selectedZoomId && deletedZoomIds.has(selectedZoomId)) {
      setSelectedZoomId(null);
    }
    if (selectedTrimId && deletedTrimIds.has(selectedTrimId)) {
      setSelectedTrimId(null);
    }
    if (selectedEffectId && deletedEffectIds.has(selectedEffectId)) {
      setSelectedEffectId(null);
    }
    if (selectedAnnotationId && deletedAnnotationIds.has(selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
    if (selectedSpeedId && deletedSpeedIds.has(selectedSpeedId)) {
      setSelectedSpeedId(null);
    }
    if (selectedTrackId === trackId) {
      setSelectedTrackId(null);
    }
  }, [
    annotationRegions,
    audioClips,
    cursorTrack,
    effectRegions,
    selectedAnnotationId,
    selectedAudioClipId,
    selectedClipId,
    selectedEffectId,
    selectedTrackId,
    selectedSpeedId,
    selectedTrimId,
    selectedZoomId,
    speedRegions,
    trimRegions,
    videoClips,
    zoomRegions,
  ]);

  const handleClipTrackChange = useCallback((id: string, trackId: string) => {
    setVideoClips((prev) => prev.map((clip) => (
      clip.id === id ? { ...clip, trackId } : clip
    )));
  }, []);

  const handleAudioClipTrackChange = useCallback((id: string, trackId: string) => {
    setAudioClips((prev) => prev.map((clip) => (
      clip.id === id ? { ...clip, trackId } : clip
    )));
  }, []);

  const handleZoomTrackChange = useCallback((id: string, trackId: string) => {
    setZoomRegions((prev) => prev.map((region) => (
      region.id === id ? { ...region, trackId } : region
    )));
  }, []);

  const handleTrimTrackChange = useCallback((id: string, trackId: string) => {
    setTrimRegions((prev) => prev.map((region) => (
      region.id === id ? { ...region, trackId } : region
    )));
  }, []);

  const handleEffectTrackChange = useCallback((id: string, trackId: string) => {
    setEffectRegions((prev) => prev.map((region) => (
      region.id === id ? { ...region, trackId } : region
    )));
  }, []);

  const handleAnnotationTrackChange = useCallback((id: string, trackId: string) => {
    setAnnotationRegions((prev) => prev.map((region) => (
      region.id === id ? { ...region, trackId } : region
    )));
  }, []);

  const handleCursorTrackChange = useCallback((trackId: string) => {
    setCursorTrack((prev) => (prev ? { ...prev, trackId } : prev));
  }, []);

  const handleClipOrderChange = useCallback((orderedIds: string[]) => {
    setVideoClips((prev) => {
      const byId = new Map(prev.map((clip) => [clip.id, clip]));
      const maxZ = orderedIds.length;
      const updated: VideoClip[] = [];

      orderedIds.forEach((id, index) => {
        const clip = byId.get(id);
        if (!clip) return;
        updated.push({ ...clip, zIndex: maxZ - index });
        byId.delete(id);
      });

      byId.forEach((clip) => {
        updated.push(clip);
      });

      const nextZ = updated.reduce((max, clip) => Math.max(max, clip.zIndex), 0) + 1;
      nextClipZIndexRef.current = Math.max(nextClipZIndexRef.current, nextZ);

      return updated;
    });
  }, []);

  const handleSelectCursor = useCallback((id: string | null) => {
    setSelectedCursorId(id);
    if (id) {
      setSelectedTrackId(null);
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedEffectId(null);
      setSelectedClipId(null);
    }
  }, []);

  const handleTrackNameChange = useCallback((trackId: string, name: string) => {
    setTracks((prev) => prev.map((track) => (
      track.id === trackId ? { ...track, name } : track
    )));
  }, []);

  const handleCursorStyleChange = useCallback((style: Partial<CursorStyle>) => {
    setCursorTrack((prev) => {
      if (!prev) return prev;
      return { ...prev, style: { ...prev.style, ...style } };
    });
  }, []);
  
  // Global Tab prevention
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Allow tab only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
      }

      if (e.key === ' ' || e.code === 'Space') {
        // Allow space only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        
        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (selectedClipId && !videoClips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, videoClips]);

  useEffect(() => {
    if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, trimRegions]);

  useEffect(() => {
    if (selectedEffectId && !effectRegions.some((region) => region.id === selectedEffectId)) {
      setSelectedEffectId(null);
    }
  }, [selectedEffectId, effectRegions]);

  useEffect(() => {
    if (selectedAnnotationId && !annotationRegions.some((region) => region.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, annotationRegions]);

  useEffect(() => {
    if (selectedCursorId && (!cursorTrack || cursorTrack.events.length === 0)) {
      setSelectedCursorId(null);
    }
  }, [selectedCursorId, cursorTrack]);

  useEffect(() => {
    if (selectedTrackId && !tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(null);
    }
  }, [selectedTrackId, tracks]);

  const handleExport = useCallback(async () => {
    if (!videoPath) {
      toast.error('No video loaded');
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error('Video not ready');
      return;
    }

    setShowExportDialog(true);
    setIsExporting(true);
    setExportProgress(null);
    setExportError(null);

    try {
      const wasPlaying = isPlaying;
      if (wasPlaying) {
        videoPlaybackRef.current?.pause();
      }

      // Get actual video dimensions to match recording resolution
      const video = videoPlaybackRef.current?.video;
      if (!video) {
        toast.error('Video not ready');
        return;
      }
      
      const aspectRatioValue = getAspectRatioValue(aspectRatio);
      const sourceWidth = video.videoWidth || 1920;
      const sourceHeight = video.videoHeight || 1080;
      
      let exportWidth: number;
      let exportHeight: number;
      let bitrate: number;

      // Check if a specific resolution preset is selected
      const resolutionPreset = getResolutionPreset(aspectRatio, resolutionPresetId);
      const hasCustomResolution = resolutionPreset && resolutionPreset.id !== 'auto' && resolutionPreset.width > 0;

      if (hasCustomResolution && resolutionPreset) {
        // Use the selected resolution preset
        exportWidth = resolutionPreset.width;
        exportHeight = resolutionPreset.height;
        
        // Calculate bitrate based on resolution
        const totalPixels = exportWidth * exportHeight;
        if (totalPixels <= 1280 * 720) {
          bitrate = 10_000_000; // 10 Mbps for 720p
        } else if (totalPixels <= 1920 * 1080) {
          bitrate = 20_000_000; // 20 Mbps for 1080p
        } else if (totalPixels <= 2560 * 1440) {
          bitrate = 50_000_000; // 50 Mbps for 1440p
        } else {
          bitrate = 80_000_000; // 80 Mbps for 4K
        }
      } else if (exportQuality === 'source') {
        // Use source resolution
        exportWidth = sourceWidth;
        exportHeight = sourceHeight;

        if (aspectRatioValue === 1) {
          // Square (1:1): use smaller dimension to avoid codec limits
          const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
          exportWidth = baseDimension;
          exportHeight = baseDimension;
        } else if (aspectRatioValue > 1) {
          // Landscape: find largest even dimensions that exactly match aspect ratio
          const baseWidth = Math.floor(sourceWidth / 2) * 2;
          // Iterate down from baseWidth to find exact match
          let found = false;
          for (let w = baseWidth; w >= 100 && !found; w -= 2) {
            const h = Math.round(w / aspectRatioValue);
            if (h % 2 === 0 && Math.abs((w / h) - aspectRatioValue) < 0.0001) {
              exportWidth = w;
              exportHeight = h;
              found = true;
            }
          }
          if (!found) {
            exportWidth = baseWidth;
            exportHeight = Math.floor((baseWidth / aspectRatioValue) / 2) * 2;
          }
        } else {
          // Portrait: find largest even dimensions that exactly match aspect ratio
          const baseHeight = Math.floor(sourceHeight / 2) * 2;
          // Iterate down from baseHeight to find exact match
          let found = false;
          for (let h = baseHeight; h >= 100 && !found; h -= 2) {
            const w = Math.round(h * aspectRatioValue);
            if (w % 2 === 0 && Math.abs((w / h) - aspectRatioValue) < 0.0001) {
              exportWidth = w;
              exportHeight = h;
              found = true;
            }
          }
          if (!found) {
            exportHeight = baseHeight;
            exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
          }
        }

        // Calculate visually lossless bitrate matching screen recording optimization
        const totalPixels = exportWidth * exportHeight;
        bitrate = 30_000_000;
        if (totalPixels > 1920 * 1080 && totalPixels <= 2560 * 1440) {
          bitrate = 50_000_000;
        } else if (totalPixels > 2560 * 1440) {
          bitrate = 80_000_000;
        }
      } else {
        // Use quality-based target resolution
        const targetHeight = exportQuality === 'medium' ? 720 : 1080;
        
        // Calculate dimensions maintaining aspect ratio
        exportHeight = Math.floor(targetHeight / 2) * 2; // Ensure even
        exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2; // Ensure even
        
        // Adjust bitrate for lower resolutions
        const totalPixels = exportWidth * exportHeight;
        if (totalPixels <= 1280 * 720) {
          bitrate = 10_000_000; // 10 Mbps for 720p
        } else if (totalPixels <= 1920 * 1080) {
          bitrate = 20_000_000; // 20 Mbps for 1080p
        } else {
          bitrate = 30_000_000;
        }
      }

      // Get preview CONTAINER dimensions for scaling
      // Use clip container dimensions to match preview rendering exactly
      const playbackRef = videoPlaybackRef.current;
      const clipContainer = playbackRef?.clipContainerRef?.current;
      const containerElement = playbackRef?.containerRef?.current;
      // Prefer clip container dimensions for accurate clip positioning
      const previewWidth = clipContainer?.clientWidth || containerElement?.clientWidth || 1920;
      const previewHeight = clipContainer?.clientHeight || containerElement?.clientHeight || 1080;



      const exporter = new VideoExporter({
        videoUrl: videoPath,
        width: exportWidth,
        height: exportHeight,
        frameRate: 60,
        bitrate,
        codec: 'avc1.640033',
        wallpaper,
        zoomRegions,
        trimRegions,
        showShadow: shadowIntensity > 0,
        shadowIntensity,
        showBlur,
        motionBlurEnabled,
        borderRadius,
        padding,
        paddingKeyframes,
        cropRegion,
        screenOffset,
        annotationRegions: visibleAnnotationRegions,
        videoAssets,
        videoClips: visibleVideoClips,
        effectRegions: visibleEffectRegions,
        previewWidth,
        previewHeight,
        onProgress: (progress: ExportProgress) => {
          setExportProgress(progress);
        },
      });

      exporterRef.current = exporter;
      const result = await exporter.export();

      if (result.success && result.blob) {
        const arrayBuffer = await result.blob.arrayBuffer();
        const timestamp = Date.now();
        const fileName = `export-${timestamp}.mp4`;
        
        const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);
        
        if (saveResult.cancelled) {
          toast.info('Export cancelled');
        } else if (saveResult.success) {
          toast.success(`Video exported successfully to ${saveResult.path}`);
        } else {
          setExportError(saveResult.message || 'Failed to save video');
          toast.error(saveResult.message || 'Failed to save video');
        }
      } else {
        setExportError(result.error || 'Export failed');
        toast.error(result.error || 'Export failed');
      }

      if (wasPlaying) {
        videoPlaybackRef.current?.play().catch(() => {});
      }
    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setExportError(errorMessage);
      toast.error(`Export failed: ${errorMessage}`);
    } finally {
      setIsExporting(false);
      exporterRef.current = null;
    }
  }, [videoPath, wallpaper, zoomRegions, trimRegions, shadowIntensity, showBlur, motionBlurEnabled, borderRadius, padding, paddingKeyframes, cropRegion, screenOffset, visibleAnnotationRegions, videoAssets, visibleVideoClips, visibleEffectRegions, isPlaying, aspectRatio, resolutionPresetId, exportQuality]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exporterRef.current.cancel();
      toast.info('Export cancelled');
      setShowExportDialog(false);
      setIsExporting(false);
      setExportProgress(null);
      setExportError(null);
    }
  }, []);

  // Project save/load handlers
  const handleSaveProject = useCallback(async () => {
    const projectData = serializeProject();

    // Generate suggested filename
    const timestamp = new Date().toISOString().split('T')[0];
    const videoName = videoFilePath
      ? removeExtension(getBasename(videoFilePath))
      : 'untitled';
    const suggestedFileName = `${videoName}-${timestamp}.openscreen`;

    const result = await window.electronAPI.saveProject(projectData, suggestedFileName);

    if (result.cancelled) {
      toast.info('Save cancelled');
      return;
    }

    if (result.success && result.path) {
      setCurrentProjectPath(result.path);
      setHasUnsavedChanges(false);
      toast.success(`Project saved to ${getBasename(result.path)}`);
    } else {
      toast.error(result.message || 'Failed to save project');
    }
  }, [serializeProject, videoFilePath]);

  const handleLoadProject = useCallback(async () => {
    const pickerResult = await window.electronAPI.openProjectFilePicker();

    if (pickerResult.cancelled || !pickerResult.path) {
      return;
    }
    await loadProjectFromPath(pickerResult.path);
  }, [loadProjectFromPath]);

  const handleNewProject = useCallback(async () => {
    // Open video file picker
    const pickerResult = await window.electronAPI.openVideoFilePicker();

    if (!pickerResult.success || !pickerResult.path) {
      return;
    }

    // Set video path
    await window.electronAPI.setCurrentVideoPath(pickerResult.path);
    setVideoFilePath(pickerResult.path);
    setVideoPath(toFileUrl(pickerResult.path));
    setError(null);

    // Reset all editing state
    setVideoClips([]);
    setAudioClips([]);
    setTracks([]);
    setZoomRegions([]);
    setEffectRegions([]);
    setAnnotationRegions([]);
    setSpeedRegions([]);
    setSelectedSpeedId(null);
    setVideoAssets([]);
    setSelectedClipId(null);
    setSelectedAudioClipId(null);
    setCursorTrack(null);
    setCurrentProjectPath(null);
    setHasUnsavedChanges(false);

    // Reset ID counters
    nextZoomIdRef.current = 1;
    nextClipIdRef.current = 1;
    nextAudioClipIdRef.current = 1;
    nextTrimIdRef.current = 1;
    nextEffectIdRef.current = 1;
    nextSpeedIdRef.current = 1;
    nextAnnotationIdRef.current = 1;
    nextAnnotationZIndexRef.current = 1;
    nextAssetIdRef.current = 1;
    nextClipZIndexRef.current = 1;
    nextTrackIdRef.current = 1;

    toast.success('New project created');
  }, [toFileUrl]);

  // Keyboard shortcuts for project operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S: Save
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        handleSaveProject();
      }
      // Cmd/Ctrl + Shift + S: Save As
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 's') {
        e.preventDefault();
        handleSaveProject(); // Always shows dialog
      }
      // Cmd/Ctrl + O: Open
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        handleLoadProject();
      }
      // Cmd/Ctrl + N: New
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewProject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveProject, handleLoadProject, handleNewProject]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-foreground">Loading video...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col h-screen bg-[#09090b] text-slate-200">
        <div
          className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center pl-20 pr-6 z-50"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <ProjectToolbar
              onSaveProject={handleSaveProject}
              onSaveProjectAs={handleSaveProject}
              onLoadProject={handleLoadProject}
              onNewProject={handleNewProject}
              hasUnsavedChanges={hasUnsavedChanges}
              currentProjectPath={currentProjectPath}
            />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-slate-400 text-base">No video loaded.</div>
            <div className="text-slate-500 text-sm leading-relaxed">
              Use <span className="text-slate-300 font-medium">Open Project</span> in the toolbar above to reload a saved project,<br />
              or <span className="text-slate-300 font-medium">New Project</span> to start fresh with a video file.
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
      <div
        className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center justify-between pl-20 pr-6 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <ProjectToolbar
            onSaveProject={handleSaveProject}
            onSaveProjectAs={handleSaveProject}
            onLoadProject={handleLoadProject}
            onNewProject={handleNewProject}
            hasUnsavedChanges={hasUnsavedChanges}
            currentProjectPath={currentProjectPath}
          />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="hidden md:flex flex-col items-end leading-none">
            <span className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Editor Recording
            </span>
            <span className="text-[11px] text-slate-400">
              {isAppendingRecording ? 'Appending to current timeline...' : 'Stays in this project and appends to the end'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.electronAPI.openSourceSelector()}
            disabled={recording || isAppendingRecording}
            className="h-8 gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
            title={hasSelectedSource ? selectedSourceName : 'Select source to continue recording'}
          >
            <Monitor className="h-4 w-4" />
            <span className="max-w-[180px] truncate text-xs">
              {hasSelectedSource ? selectedSourceName : 'Select Source'}
            </span>
          </Button>
          <Button
            size="sm"
            onClick={handleEditorRecordingToggle}
            disabled={isAppendingRecording}
            className={recording
              ? "h-8 gap-2 rounded-xl bg-red-500/15 px-3 text-red-300 hover:bg-red-500/20"
              : "h-8 gap-2 rounded-xl bg-[#34B27B] px-3 text-white hover:bg-[#2da06d] disabled:opacity-60"}
          >
            {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Circle className="h-3.5 w-3.5 fill-current" />}
            <span className="text-xs font-medium">
              {isAppendingRecording ? 'Appending...' : recording ? formatRecordingElapsed(recordingElapsedSeconds) : 'Continue Recording'}
            </span>
          </Button>
        </div>
      </div>

      <div className="flex-1 p-5 gap-4 flex min-h-0 relative">
        {/* Left Column - Video & Timeline */}
        <div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
          <PanelGroup direction="vertical" className="gap-3 min-h-0">
            {/* Top section: video preview and controls */}
            <Panel defaultSize={70} minSize={40}>
              <div className="w-full h-full min-h-0 flex flex-col bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
                {/* Video preview */}
                <div className="w-full min-h-0 flex-1 flex justify-center items-center overflow-hidden px-3 pt-3">
                  <div
                    className="relative max-h-full max-w-full overflow-hidden rounded-[20px] border border-white/10 bg-black/30 shadow-[0_20px_40px_rgba(0,0,0,0.28)]"
                    style={{
                      width: 'auto',
                      height: '100%',
                      aspectRatio: getAspectRatioValue(aspectRatio),
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                    }}
                  >
                    <VideoPlayback
                      aspectRatio={aspectRatio}
                      ref={videoPlaybackRef}
                      videoPath={videoPath || ''}
                      onDurationChange={setDuration}
                      onTimeUpdate={setCurrentTime}
                      currentTime={currentTime}
                      onPlayStateChange={setIsPlaying}
                      onError={setError}
                      wallpaper={wallpaper}
                      zoomRegions={zoomRegions}
                      selectedZoomId={selectedZoomId}
                      onSelectZoom={handleSelectZoom}
                      onZoomFocusChange={handleZoomFocusChange}
                      isPlaying={isPlaying}
                      showShadow={shadowIntensity > 0}
                      shadowIntensity={shadowIntensity}
                      showBlur={showBlur}
                      motionBlurEnabled={motionBlurEnabled}
                      borderRadius={borderRadius}
                      padding={currentPadding}
                      screenOffset={screenOffset}
                      cropRegion={cropRegion}
                      trimRegions={trimRegions}
                      effectRegions={visibleEffectRegions}
                      selectedEffectId={selectedEffectId}
                      speedRegions={speedRegions}
                      annotationRegions={visibleAnnotationRegions}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      onAnnotationPositionChange={handleAnnotationPositionChange}
                      onAnnotationSizeChange={handleAnnotationSizeChange}
                      videoAssets={videoAssets}
                      videoClips={visibleVideoClips}
                      selectedClipId={selectedClipId}
                      onSelectClip={handleSelectClip}
                      onClipPositionChange={handleClipPositionChange}
                      onClipSizeChange={handleClipSizeChange}
                      onClipRectChange={handleClipRectChange}
                      cursorTrack={visibleCursorTrack}
                      cursorEnabled={cursorEnabled}
                      cursorSmoothing={cursorSmoothing}
                      quadraticSmoothingStrength={quadraticSmoothingStrength}
                      end2endParams={end2endParams}
                    />
                  </div>
                </div>
                {/* Playback controls */}
                <div className="w-full shrink-0 px-3 pb-3 pt-2 flex justify-center items-center">
                  <div className="w-full max-w-[700px]">
                    <PlaybackControls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={timelineContentEndMs / 1000}
                      onTogglePlayPause={togglePlayPause}
                      onSeek={handleSeek}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="h-3 bg-[#09090b]/80 hover:bg-[#09090b] transition-colors rounded-full mx-4 flex items-center justify-center">
              <div className="w-8 h-1 bg-white/20 rounded-full"></div>
            </PanelResizeHandle>

            {/* Timeline section */}
            <Panel defaultSize={30} minSize={20}>
              <div className="h-full min-h-0 bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
                <TimelineEditor
                  videoDuration={duration}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  tracks={tracks}
                  selectedTrackId={selectedTrackId}
                  onSelectTrack={handleSelectTrack}
                  onTrackHeightChange={handleTrackHeightChange}
                  onTrackOrderChange={handleTrackOrderChange}
                  onTrackMuteChange={handleTrackMuteChange}
                  onTrackHiddenChange={handleTrackHiddenChange}
                  onTrackDelete={handleTrackDelete}
                  onTrackAutoTypeChange={handleTrackAutoTypeChange}
                  onCreateTrack={handleCreateTrack}
                  videoClips={videoClips}
                  audioClips={audioClips}
                  onClipSpanChange={handleClipSpanChange}
                  onClipChange={handleClipChange}
                  onAudioClipSpanChange={handleAudioClipSpanChange}
                  onClipSplit={handleClipSplit}
                  onClipDelete={handleClipDelete}
                  onAudioClipDelete={handleAudioClipDelete}
                  onClipTrackChange={handleClipTrackChange}
                  onAudioClipTrackChange={handleAudioClipTrackChange}
                  selectedClipId={selectedClipId}
                  selectedAudioClipId={selectedAudioClipId}
                  onSelectClip={handleSelectClip}
                  onSelectAudioClip={handleSelectAudioClip}
                  zoomRegions={zoomRegions}
                  onZoomAdded={handleZoomAdded}
                  onZoomSpanChange={handleZoomSpanChange}
                  onZoomDelete={handleZoomDelete}
                  onZoomTrackChange={handleZoomTrackChange}
                  selectedZoomId={selectedZoomId}
                  onSelectZoom={handleSelectZoom}
                  trimRegions={trimRegions}
                  onTrimAdded={handleTrimAdded}
                  onTrimSpanChange={handleTrimSpanChange}
                  onTrimDelete={handleTrimDelete}
                  onTrimTrackChange={handleTrimTrackChange}
                  selectedTrimId={selectedTrimId}
                  onSelectTrim={handleSelectTrim}
                  effectRegions={effectRegions}
                  onEffectAdded={handleEffectAdded}
                  onEffectSpanChange={handleEffectSpanChange}
                  onEffectDelete={handleEffectDelete}
                  onEffectTrackChange={handleEffectTrackChange}
                  selectedEffectId={selectedEffectId}
                  onSelectEffect={handleSelectEffect}
                  annotationRegions={annotationRegions}
                  onAnnotationAdded={handleAnnotationAdded}
                  onAnnotationSpanChange={handleAnnotationSpanChange}
                  onAnnotationDelete={handleAnnotationDelete}
                  onAnnotationTrackChange={handleAnnotationTrackChange}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelectAnnotation={handleSelectAnnotation}
                  speedRegions={speedRegions}
                  onSpeedAdded={handleSpeedAdded}
                  onSpeedSpanChange={handleSpeedSpanChange}
                  onSpeedDelete={handleSpeedDelete}
                  onSpeedTrackChange={handleSpeedTrackChange}
                  selectedSpeedId={selectedSpeedId}
                  onSelectSpeed={handleSelectSpeed}
                  videoAssets={videoAssets}
                  onClipAssetDrop={handleAddClip}
                  onAudioAssetDrop={handleAddAudioClip}
                  onClipOrderChange={handleClipOrderChange}
                  cursorTrack={cursorTrack}
                  onCursorTrackChange={handleCursorTrackChange}
                  selectedCursorId={selectedCursorId}
                  onSelectCursor={handleSelectCursor}
                  cursorEnabled={cursorEnabled}
                  onCursorEnabledChange={setCursorEnabled}
                  cursorSmoothing={cursorSmoothing}
                  onCursorSmoothingChange={setCursorSmoothing}
                  aspectRatio={aspectRatio}
                  onAspectRatioChange={setAspectRatio}
                  resolutionPresetId={resolutionPresetId}
                  onResolutionPresetChange={setResolutionPresetId}
                  paddingKeyframes={paddingKeyframes}
                />
              </div>
            </Panel>
          </PanelGroup>
        </div>

        {/* Right section: settings panel */}
        <SettingsPanel
          selected={wallpaper}
          onWallpaperChange={setWallpaper}
          selectedTrack={selectedTrack}
          onTrackNameChange={handleTrackNameChange}
          onTrackHeightChange={handleTrackHeightChange}
          onTrackHiddenChange={handleTrackHiddenChange}
          onTrackMuteChange={handleTrackMuteChange}
          onTrackDelete={handleTrackDelete}
          onAddItemToTrack={handleAddItemToTrack}
          selectedZoomDepth={selectedZoomId ? zoomRegions.find(z => z.id === selectedZoomId)?.depth : null}
          onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
          selectedZoomId={selectedZoomId}
          onZoomDelete={handleZoomDelete}
          selectedTrimId={selectedTrimId}
          onTrimDelete={handleTrimDelete}
          shadowIntensity={shadowIntensity}
          onShadowChange={setShadowIntensity}
          showBlur={showBlur}
          onBlurChange={setShowBlur}
          motionBlurEnabled={motionBlurEnabled}
          onMotionBlurChange={setMotionBlurEnabled}
          borderRadius={borderRadius}
          onBorderRadiusChange={setBorderRadius}
          padding={padding}
          onPaddingChange={setPadding}
          paddingKeyframes={paddingKeyframes}
          onPaddingKeyframesChange={setPaddingKeyframes}
          currentTime={currentTime}
          screenOffset={screenOffset}
          onScreenOffsetChange={(patch) => setScreenOffset(prev => ({ ...prev, ...patch }))}
          videoAssets={videoAssets}
          videoClips={videoClips}
          audioClips={audioClips}
          zoomRegions={zoomRegions}
          trimRegions={trimRegions}
          selectedClipId={selectedClipId}
          onVideoAssetAdd={handleAddMediaAssets}
          onVideoAssetRemove={handleRemoveVideoAsset}
          onClipAddToTimeline={handleAddClip}
          onAudioAddToTimeline={handleAddAudioClip}
          defaultImageClipDurationMs={defaultImageClipDurationMs}
          onDefaultImageClipDurationMsChange={setDefaultImageClipDurationMs}
          onClipChange={handleClipChange}
          onClipRectChange={handleClipRectChange}
          cropRegion={cropRegion}
          onCropChange={setCropRegion}
          aspectRatio={aspectRatio}
          videoElement={videoPlaybackRef.current?.video || null}
          exportQuality={exportQuality}
          onExportQualityChange={setExportQuality}
          onExport={handleExport}
          selectedAnnotationId={selectedAnnotationId}
          annotationRegions={annotationRegions}
          onAnnotationContentChange={handleAnnotationContentChange}
          onAnnotationTypeChange={handleAnnotationTypeChange}
          onAnnotationStyleChange={handleAnnotationStyleChange}
          onAnnotationTimingChange={handleAnnotationTimingChange}
          onAnnotationEffectChange={handleAnnotationEffectChange}
          onAnnotationEmojiChange={handleAnnotationEmojiChange}
          onAnnotationLayerChange={handleAnnotationLayerChange}
          onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
          onAnnotationDelete={handleAnnotationDelete}
          effectRegions={effectRegions}
          selectedEffectId={selectedEffectId}
          onEffectChange={handleEffectChange}
          onEffectDelete={handleEffectDelete}
          speedRegions={speedRegions}
          selectedSpeedId={selectedSpeedId}
          onSpeedChange={handleSpeedChange}
          onSpeedDelete={handleSpeedDelete}
          cursorTrack={cursorTrack}
          selectedCursorId={selectedCursorId}
          onCursorStyleChange={handleCursorStyleChange}
          cursorSmoothing={cursorSmoothing}
          onCursorSmoothingChange={setCursorSmoothing}
          quadraticSmoothingStrength={quadraticSmoothingStrength}
          onQuadraticSmoothingStrengthChange={setQuadraticSmoothingStrength}
          end2endParams={end2endParams}
          onEnd2endParamsChange={(p) => setEnd2endParams(prev => ({ ...prev, ...p }))}
        />
      </div>

      <Toaster theme="dark" className="pointer-events-auto" />
      
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        progress={exportProgress}
        isExporting={isExporting}
        error={exportError}
        onCancel={handleCancelExport}
      />
    </div>
  );
}
