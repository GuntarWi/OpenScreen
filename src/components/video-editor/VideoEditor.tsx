

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

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
  DEFAULT_OVERLAY_POSITION,
  DEFAULT_OVERLAY_SIZE,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  DEFAULT_ANNOTATION_EFFECTS,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_EFFECT_REGION,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type TrimRegion,
  type ClipSegment,
  type AnnotationRegion,
  type OverlayVideoAsset,
  type OverlayVideoRegion,
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
import { VideoExporter, type ExportProgress, type ExportQuality } from "@/lib/exporter";
import { type AspectRatio, getAspectRatioValue, getResolutionPreset } from "@/utils/aspectRatioUtils";
import { getAssetPath } from "@/lib/assetPath";

const WALLPAPER_COUNT = 18;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);

export default function VideoEditor() {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [clipSegments, setClipSegments] = useState<ClipSegment[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [effectRegions, setEffectRegions] = useState<EffectRegion[]>([]);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [overlayAssets, setOverlayAssets] = useState<OverlayVideoAsset[]>([]);
  const [overlayRegions, setOverlayRegions] = useState<OverlayVideoRegion[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
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
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);
  const nextClipIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextEffectIdRef = useRef(1);
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
  const nextOverlayAssetIdRef = useRef(1);
  const nextOverlayIdRef = useRef(1);
  const nextOverlayZIndexRef = useRef(1);
  const exporterRef = useRef<VideoExporter | null>(null);
  const lastVideoPathRef = useRef<string | null>(null);

  // Compute current padding from keyframes (for preview)
  const currentPadding = useMemo(() => {
    return interpolatePadding(paddingKeyframes, currentTime * 1000, padding);
  }, [paddingKeyframes, currentTime, padding]);

  // Helper to convert file path to proper file:// URL
  const toFileUrl = (filePath: string): string => {
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
  };

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
      clipSegments,
      zoomRegions,
      effectRegions,
      annotationRegions,
      overlayAssets,
      overlayRegions,

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

      // Export Settings
      aspectRatio,
      exportQuality,

      // ID Counters
      idCounters: {
        nextZoomId: nextZoomIdRef.current,
        nextClipId: nextClipIdRef.current,
        nextTrimId: nextTrimIdRef.current,
        nextEffectId: nextEffectIdRef.current,
        nextAnnotationId: nextAnnotationIdRef.current,
        nextAnnotationZIndex: nextAnnotationZIndexRef.current,
        nextOverlayAssetId: nextOverlayAssetIdRef.current,
        nextOverlayId: nextOverlayIdRef.current,
        nextOverlayZIndex: nextOverlayZIndexRef.current,
      }
    };

    return JSON.stringify(project, null, 2);
  }, [
    videoFilePath, duration, clipSegments, zoomRegions, effectRegions,
    annotationRegions, overlayAssets, overlayRegions, cursorTrack, cursorEnabled, cursorSmoothing,
    quadraticSmoothingStrength, end2endParams, wallpaper, shadowIntensity,
    showBlur, motionBlurEnabled, borderRadius, padding, paddingKeyframes, cropRegion, screenOffset,
    aspectRatio, exportQuality
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

      // Restore timeline state
      setClipSegments(project.clipSegments || []);
      setZoomRegions(project.zoomRegions || []);
      setEffectRegions(project.effectRegions || []);
      setAnnotationRegions(project.annotationRegions || []);
      setOverlayAssets(project.overlayAssets || []);
      setOverlayRegions(project.overlayRegions || []);

      // Restore cursor data
      setCursorTrack(project.cursorTrack);
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
        nextTrimIdRef.current = project.idCounters.nextTrimId;
        nextEffectIdRef.current = project.idCounters.nextEffectId;
        nextAnnotationIdRef.current = project.idCounters.nextAnnotationId;
        nextAnnotationZIndexRef.current = project.idCounters.nextAnnotationZIndex;
        nextOverlayAssetIdRef.current = project.idCounters.nextOverlayAssetId || nextOverlayAssetIdRef.current;
        nextOverlayIdRef.current = project.idCounters.nextOverlayId || nextOverlayIdRef.current;
        nextOverlayZIndexRef.current = project.idCounters.nextOverlayZIndex || nextOverlayZIndexRef.current;
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

  const computeTrimRegionsFromSegments = useCallback((segments: ClipSegment[], totalMs: number): TrimRegion[] => {
    if (totalMs <= 0) return [];
    if (!segments.length) {
      return [{
        id: `trim-${nextTrimIdRef.current++}`,
        startMs: 0,
        endMs: totalMs,
      }];
    }

    const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
    const trims: TrimRegion[] = [];
    let cursor = 0;

    for (const seg of sorted) {
      const start = Math.max(0, Math.min(seg.startMs, totalMs));
      const end = Math.max(start, Math.min(seg.endMs, totalMs));
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

  // Reset clip segments when a new video loads or duration changes from zero to a real value
  useEffect(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    if (!videoPath || totalMs <= 0) return;

    const outOfRange = clipSegments.some((seg) => seg.endMs > totalMs);
    const shouldReset = lastVideoPathRef.current !== videoPath || clipSegments.length === 0 || outOfRange;
    if (shouldReset) {
      const id = `clip-${nextClipIdRef.current++}`;
      const single: ClipSegment = { id, startMs: 0, endMs: totalMs };
      setClipSegments([single]);
      setSelectedClipId(id);
      lastVideoPathRef.current = videoPath;
    }
  }, [videoPath, duration, clipSegments]);

  // Keep trim regions in sync with clip segments
  useEffect(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    if (totalMs <= 0 || clipSegments.length === 0) {
      setTrimRegions([]);
      return;
    }
    setTrimRegions(computeTrimRegionsFromSegments(clipSegments, totalMs));
  }, [clipSegments, duration, computeTrimRegionsFromSegments]);

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
    videoPath, clipSegments, zoomRegions, effectRegions, annotationRegions, overlayAssets, overlayRegions,
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
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
    if (id) setSelectedTrimId(null);
    if (id) setSelectedCursorId(null);
    if (id) setSelectedEffectId(null);
    if (id) setSelectedClipId(null);
    if (id) setSelectedOverlayId(null);
  }, []);

  const handleSelectClip = useCallback((id: string | null) => {
    setSelectedClipId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
      setSelectedOverlayId(null);
    }
  }, []);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedClipId(null);
      setSelectedAnnotationId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
      setSelectedOverlayId(null);
    }
  }, []);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedClipId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
      setSelectedOverlayId(null);
    }
  }, []);

  const handleSelectOverlay = useCallback((id: string | null) => {
    setSelectedOverlayId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedClipId(null);
      setSelectedCursorId(null);
      setSelectedEffectId(null);
      setSelectedAnnotationId(null);
    }
  }, []);

  const handleSelectEffect = useCallback((id: string | null) => {
    setSelectedEffectId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedClipId(null);
      setSelectedCursorId(null);
      setSelectedOverlayId(null);
    }
  }, []);

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: DEFAULT_ZOOM_DEPTH,
      focus: { cx: 0.5, cy: 0.5 },
    };
    setZoomRegions((prev) => [...prev, newRegion]);
    setSelectedZoomId(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, []);

  const handleTrimAdded = useCallback((span: Span) => {
    const id = `trim-${nextTrimIdRef.current++}`;
    const newRegion: TrimRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setTrimRegions((prev) => [...prev, newRegion]);
    setSelectedTrimId(id);
    setSelectedZoomId(null);
    setSelectedAnnotationId(null);
  }, []);

  const handleClipSpanChange = useCallback((id: string, span: Span) => {
    setClipSegments((prev) => {
      const totalMs = Math.max(0, Math.round(duration * 1000));
      const sorted = [...prev].sort((a, b) => a.startMs - b.startMs);
      const idx = sorted.findIndex((seg) => seg.id === id);
      if (idx === -1) return prev;

      const seg = sorted[idx];
      const prevEnd = idx > 0 ? sorted[idx - 1].endMs : 0;
      const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].startMs : totalMs;
      const minDuration = 100;

      const clampedStart = Math.max(prevEnd, Math.min(span.start, nextStart - minDuration));
      const clampedEnd = Math.max(clampedStart + minDuration, Math.min(span.end, nextStart));

      const updatedSeg = { ...seg, startMs: clampedStart, endMs: clampedEnd };
      const updated = prev.map((s) => (s.id === id ? updatedSeg : s));
      return updated;
    });
  }, [duration]);

  const handleClipSplit = useCallback(() => {
    const totalMs = Math.max(0, Math.round(duration * 1000));
    if (totalMs <= 0) return;
    const playheadMs = Math.max(0, Math.min(Math.round(currentTime * 1000), totalMs));

    setClipSegments((prev) => {
      const target = prev.find((seg) => playheadMs > seg.startMs && playheadMs < seg.endMs);
      if (!target) {
        toast.error('Place the playhead inside the clip to split');
        return prev;
      }

      const first: ClipSegment = {
        id: `clip-${nextClipIdRef.current++}`,
        startMs: target.startMs,
        endMs: playheadMs,
      };
      const second: ClipSegment = {
        id: `clip-${nextClipIdRef.current++}`,
        startMs: playheadMs,
        endMs: target.endMs,
      };

      const remaining = prev.filter((seg) => seg.id !== target.id);
      const updated = [...remaining, first, second].sort((a, b) => a.startMs - b.startMs);
      setSelectedClipId(second.id);
      return updated;
    });
  }, [currentTime, duration]);

  const handleClipDelete = useCallback((id: string) => {
    setClipSegments((prev) => {
      if (prev.length <= 1) {
        toast.error('Cannot remove the only clip');
        return prev;
      }
      const sorted = [...prev].sort((a, b) => a.startMs - b.startMs);
      const idx = sorted.findIndex((seg) => seg.id === id);
      if (idx === -1) return prev;
      const updated = sorted.filter((seg) => seg.id !== id);
      const fallback = updated[Math.min(updated.length - 1, Math.max(0, idx - 1))];
      setSelectedClipId(fallback.id);
      return updated;
    });
  }, []);

  const handleEffectAdded = useCallback((span: Span) => {
    const id = `effect-${nextEffectIdRef.current++}`;
    const newRegion: EffectRegion = {
      ...DEFAULT_EFFECT_REGION,
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setEffectRegions((prev) => [...prev, newRegion]);
    setSelectedEffectId(id);
    setSelectedZoomId(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, []);

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
    setEffectRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, ...patch }
          : region,
      ),
    );
  }, []);

  const handleAnnotationAdded = useCallback((span: Span) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
    const newRegion: AnnotationRegion = {
      id,
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
  }, []);

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

  const loadOverlayMetadata = useCallback((src: string) => {
    return new Promise<{ durationMs: number; width: number; height: number }>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      if (src.startsWith('http')) {
        video.crossOrigin = 'anonymous';
      }

      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        const durationMs = Math.max(0, Math.round((video.duration || 0) * 1000));
        resolve({
          durationMs,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
        });
      };
      const rejectOnce = () => {
        if (settled) return;
        settled = true;
        reject(new Error('Failed to load overlay metadata'));
      };

      video.addEventListener('loadedmetadata', resolveOnce, { once: true });
      video.addEventListener('error', rejectOnce, { once: true });
      video.src = src;
      try {
        video.load();
      } catch {
        // Ignore load errors for browsers that auto-load on src assignment.
      }

      if (video.readyState >= 1) {
        resolveOnce();
      }
    });
  }, []);

  const handleAddOverlayAssets = useCallback(async () => {
    const pickerResult = await (
      window.electronAPI.openVideoFilesPicker
        ? window.electronAPI.openVideoFilesPicker()
        : window.electronAPI.openVideoFilePicker()
    );

    if (!pickerResult.success) return;

    const paths = 'paths' in pickerResult && Array.isArray(pickerResult.paths)
      ? pickerResult.paths
      : pickerResult.path
      ? [pickerResult.path]
      : [];

    if (!paths.length) return;

    for (const path of paths) {
      const src = toFileUrl(path);
      if (overlayAssets.some((asset) => asset.src === src)) {
        continue;
      }
      try {
        const meta = await loadOverlayMetadata(src);
        const asset: OverlayVideoAsset = {
          id: `overlay-asset-${nextOverlayAssetIdRef.current++}`,
          name: getBasename(path),
          src,
          durationMs: meta.durationMs,
          width: meta.width,
          height: meta.height,
        };
        setOverlayAssets((prev) => [...prev, asset]);
      } catch (error) {
        console.warn('Failed to load overlay metadata:', error);
      }
    }
  }, [loadOverlayMetadata, overlayAssets, toFileUrl]);

  const handleRemoveOverlayAsset = useCallback((assetId: string) => {
    setOverlayAssets((prev) => prev.filter((asset) => asset.id !== assetId));
    setOverlayRegions((prev) => prev.filter((region) => region.assetId !== assetId));
    if (selectedOverlayId) {
      const stillExists = overlayRegions.some((region) => region.id === selectedOverlayId && region.assetId !== assetId);
      if (!stillExists) setSelectedOverlayId(null);
    }
  }, [overlayRegions, selectedOverlayId]);

  const handleAddOverlayRegion = useCallback((assetId: string, startOverrideMs?: number) => {
    const asset = overlayAssets.find((item) => item.id === assetId);
    if (!asset) return;

    const startMs = Math.max(0, Math.round(startOverrideMs ?? currentTime * 1000));
    const preferredDuration = asset.durationMs > 0 ? asset.durationMs : 3000;
    const durationMs = Math.max(100, preferredDuration);
    const endMs = startMs + durationMs;

    const newRegion: OverlayVideoRegion = {
      id: `overlay-${nextOverlayIdRef.current++}`,
      assetId,
      startMs,
      endMs,
      position: { ...DEFAULT_OVERLAY_POSITION },
      size: { ...DEFAULT_OVERLAY_SIZE },
      zIndex: nextOverlayZIndexRef.current++,
      borderRadius: 0,
      fit: 'contain',
      chromaKey: {
        enabled: false,
        color: '#00ff00',
        threshold: 0.35,
        softness: 0.15,
      },
    };

    setOverlayRegions((prev) => [...prev, newRegion]);
    handleSelectOverlay(newRegion.id);
  }, [overlayAssets, currentTime, handleSelectOverlay]);

  const handleOverlaySpanChange = useCallback((id: string, span: Span) => {
    setOverlayRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, startMs: Math.round(span.start), endMs: Math.round(span.end) }
          : region,
      ),
    );
  }, []);

  const handleOverlayDelete = useCallback((id: string) => {
    setOverlayRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedOverlayId === id) {
      setSelectedOverlayId(null);
    }
  }, [selectedOverlayId]);

  const handleOverlaySplit = useCallback(() => {
    const playheadMs = Math.round(currentTime * 1000);
    
    // Find overlay region that contains the playhead
    const target = overlayRegions.find(
      (region) => playheadMs > region.startMs && playheadMs < region.endMs
    );
    
    if (!target) {
      toast.error('Place the playhead inside an overlay to split');
      return;
    }

    const firstId = `overlay-region-${Date.now()}-1`;
    const secondId = `overlay-region-${Date.now()}-2`;

    const first: OverlayVideoRegion = {
      ...target,
      id: firstId,
      endMs: playheadMs,
    };
    
    const second: OverlayVideoRegion = {
      ...target,
      id: secondId,
      startMs: playheadMs,
    };

    setOverlayRegions((prev) => {
      const remaining = prev.filter((region) => region.id !== target.id);
      return [...remaining, first, second].sort((a, b) => a.startMs - b.startMs);
    });
    
    setSelectedOverlayId(secondId);
  }, [currentTime, overlayRegions]);

  const handleOverlayPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setOverlayRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, position }
          : region,
      ),
    );
  }, []);

  const handleOverlaySizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setOverlayRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, size }
          : region,
      ),
    );
  }, []);

  const handleOverlayRegionChange = useCallback((id: string, patch: Partial<OverlayVideoRegion>) => {
    setOverlayRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, ...patch }
          : region,
      ),
    );
  }, []);

  const handleSelectCursor = useCallback((id: string | null) => {
    setSelectedCursorId(id);
    if (id) {
      setSelectedZoomId(null);
      setSelectedTrimId(null);
      setSelectedAnnotationId(null);
      setSelectedEffectId(null);
      setSelectedOverlayId(null);
    }
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
    if (selectedClipId && !clipSegments.some((region) => region.id === selectedClipId)) {
      setSelectedClipId(null);
    }
  }, [selectedClipId, clipSegments]);

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
      // Use overlayContainerRef for overlays to match preview rendering exactly
      const playbackRef = videoPlaybackRef.current;
      const overlayContainer = playbackRef?.overlayContainerRef?.current;
      const containerElement = playbackRef?.containerRef?.current;
      // Prefer overlay container dimensions for accurate overlay positioning
      const previewWidth = overlayContainer?.clientWidth || containerElement?.clientWidth || 1920;
      const previewHeight = overlayContainer?.clientHeight || containerElement?.clientHeight || 1080;



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
        annotationRegions,
        overlayAssets,
        overlayRegions,
        effectRegions,
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
        videoPlaybackRef.current?.play();
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
  }, [videoPath, wallpaper, zoomRegions, trimRegions, shadowIntensity, showBlur, motionBlurEnabled, borderRadius, padding, paddingKeyframes, cropRegion, screenOffset, annotationRegions, overlayAssets, overlayRegions, effectRegions, isPlaying, aspectRatio, resolutionPresetId, exportQuality]);

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

    // Reset all editing state
    setClipSegments([]);
    setZoomRegions([]);
    setEffectRegions([]);
    setAnnotationRegions([]);
    setOverlayAssets([]);
    setOverlayRegions([]);
    setSelectedOverlayId(null);
    setCursorTrack(null);
    setCurrentProjectPath(null);
    setHasUnsavedChanges(false);

    // Reset ID counters
    nextZoomIdRef.current = 1;
    nextClipIdRef.current = 1;
    nextTrimIdRef.current = 1;
    nextEffectIdRef.current = 1;
    nextAnnotationIdRef.current = 1;
    nextAnnotationZIndexRef.current = 1;
    nextOverlayAssetIdRef.current = 1;
    nextOverlayIdRef.current = 1;
    nextOverlayZIndexRef.current = 1;

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
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-destructive">{error}</div>
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
      </div>

      <div className="flex-1 p-5 gap-4 flex min-h-0 relative">
        {/* Left Column - Video & Timeline */}
        <div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
          <PanelGroup direction="vertical" className="gap-3">
            {/* Top section: video preview and controls */}
            <Panel defaultSize={70} minSize={40}>
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
                {/* Video preview */}
                <div className="w-full flex justify-center items-center" style={{ flex: '1 1 auto', margin: '6px 0 0' }}>
                  <div className="relative" style={{ width: 'auto', height: '100%', aspectRatio: getAspectRatioValue(aspectRatio), maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
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
                      effectRegions={effectRegions}
                      selectedEffectId={selectedEffectId}
                      annotationRegions={annotationRegions}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      onAnnotationPositionChange={handleAnnotationPositionChange}
                      onAnnotationSizeChange={handleAnnotationSizeChange}
                      overlayAssets={overlayAssets}
                      overlayRegions={overlayRegions}
                      selectedOverlayId={selectedOverlayId}
                      onSelectOverlay={handleSelectOverlay}
                      onOverlayPositionChange={handleOverlayPositionChange}
                      onOverlaySizeChange={handleOverlaySizeChange}
                    cursorTrack={cursorTrack}
                    cursorEnabled={cursorEnabled}
                      cursorSmoothing={cursorSmoothing}
                      quadraticSmoothingStrength={quadraticSmoothingStrength}
                      end2endParams={end2endParams}
                    />
                  </div>
                </div>
                {/* Playback controls */}
                <div className="w-full flex justify-center items-center" style={{ height: '48px', flexShrink: 0, padding: '6px 12px', margin: '6px 0 6px 0' }}>
                  <div style={{ width: '100%', maxWidth: '700px' }}>
                    <PlaybackControls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
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
              <div className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
                <TimelineEditor
              videoDuration={duration}
              currentTime={currentTime}
              onSeek={handleSeek}
              clipSegments={clipSegments}
              onClipSpanChange={handleClipSpanChange}
              onClipSplit={handleClipSplit}
              onClipDelete={handleClipDelete}
              selectedClipId={selectedClipId}
              onSelectClip={handleSelectClip}
              zoomRegions={zoomRegions}
              onZoomAdded={handleZoomAdded}
              onZoomSpanChange={handleZoomSpanChange}
              onZoomDelete={handleZoomDelete}
              selectedZoomId={selectedZoomId}
              onSelectZoom={handleSelectZoom}
              effectRegions={effectRegions}
              onEffectAdded={handleEffectAdded}
              onEffectSpanChange={handleEffectSpanChange}
              onEffectDelete={handleEffectDelete}
              selectedEffectId={selectedEffectId}
              onSelectEffect={handleSelectEffect}
              annotationRegions={annotationRegions}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationSpanChange={handleAnnotationSpanChange}
              onAnnotationDelete={handleAnnotationDelete}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={handleSelectAnnotation}
              overlayAssets={overlayAssets}
              overlayRegions={overlayRegions}
              onOverlaySpanChange={handleOverlaySpanChange}
              onOverlayDelete={handleOverlayDelete}
              onOverlaySplit={handleOverlaySplit}
              selectedOverlayId={selectedOverlayId}
              onSelectOverlay={handleSelectOverlay}
              onOverlayAssetDrop={handleAddOverlayRegion}
              cursorTrack={cursorTrack}
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
          overlayAssets={overlayAssets}
          overlayRegions={overlayRegions}
          selectedOverlayId={selectedOverlayId}
          onOverlayAssetAdd={handleAddOverlayAssets}
          onOverlayAssetRemove={handleRemoveOverlayAsset}
          onOverlayAddToTimeline={handleAddOverlayRegion}
          onOverlayRegionChange={handleOverlayRegionChange}
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
