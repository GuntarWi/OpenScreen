import type React from "react";
import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { getAssetPath } from "@/lib/assetPath";
import { Application, Container, Sprite, Graphics, BlurFilter, Texture, VideoSource } from "pixi.js";
import {
  ZOOM_DEPTH_SCALES,
  RECORDING_ASSET_ID,
  DEFAULT_CURSOR_STYLE,
  type BackgroundItem,
  type ZoomRegion,
  type ZoomFocus,
  type ZoomDepth,
  type TrimRegion,
  type AnnotationRegion,
  type VideoAsset,
  type VideoClip,
  type CursorTrack,
  type CursorSmoothing,
  type End2EndParams,
  type EffectRegion,
  type ScreenOffset,
  type SpeedRegion,
} from "./types";
import { extractPausePointsFromDisplayEvents, evaluatePositionOnCRByTime, sampleCRPath } from "./end2endSmoother";
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from "./videoPlayback/constants";
import { clamp01 } from "./videoPlayback/mathUtils";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { applyZoomTransform } from "./videoPlayback/zoomTransform";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { ClipPixiRenderer } from "./videoPlayback/clipPixiRenderer";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { RetroGrid } from "@/components/ui/retro-grid";
import { Ripple } from "@/components/ui/ripple";
import { AnnotationContentView, AnnotationOverlay } from "./AnnotationOverlay";
import { ClipVideoItem } from "./ClipVideoItem";
import {
  computeEffectState,
  DEFAULT_EFFECT_STATE,
  getEffectPreviewFit,
  type CombinedEffectState,
} from "./videoPlayback/effectUtils";
import { getPlaybackRateForSpeedRegions } from "./speedRegionUtils";
import {
  getClipTimelineDurationMs,
  getSourceOffsetForTimelineOffsetMs,
  getSpeedAtTimelineOffset,
  getTimelineOffsetForSourceOffsetMs,
} from "./clipSpeedUtils";
import type { InteractionRect } from "@/utils/recordingInteractionLayout";
import { resolveRecordingVisibleRect } from "@/utils/recordingInteractionLayout";
import { computeClipLayout } from "@/utils/clipLayout";
import { resolveClipTransformStateAtTime } from "@/utils/clipTransformKeyframes";
import {
  DEFAULT_BACKGROUND_ACCENT_COLOR,
  DEFAULT_BACKGROUND_BACKDROP_COLOR,
  DEFAULT_BACKGROUND_VALUE,
  DEFAULT_RETRO_GRID_ANGLE,
  DEFAULT_RETRO_GRID_DENSITY,
  DEFAULT_RIPPLE_COUNT,
  DEFAULT_RIPPLE_SPEED,
  getBackgroundItemSource,
  getRetroGridCellSize,
  getRippleAnimationDurationSeconds,
  MAGICUI_RETRO_GRID_VALUE,
  MAGICUI_RIPPLE_VALUE,
  resolveActiveBackgroundItem,
} from "./backgroundUtils";

const PREVIEW_WORKSPACE_SCALE = 0.82;

interface VideoPlaybackProps {
  videoPath: string;
  onDurationChange: (duration: number) => void;
  onTimeUpdate: (time: number) => void;
  currentTime: number;
  onPlayStateChange: (playing: boolean) => void;
  onError: (error: string) => void;
  wallpaper?: string;
  backgroundItems?: BackgroundItem[];
  zoomRegions: ZoomRegion[];
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
  isPlaying: boolean;
  showShadow?: boolean;
  shadowIntensity?: number;
  showBlur?: boolean;
  showSafeFrameOverlay?: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  screenOffset?: ScreenOffset;
  cropRegion?: import('./types').CropRegion;
  trimRegions?: TrimRegion[];
  aspectRatio: AspectRatio;
  annotationRegions?: AnnotationRegion[];
  effectRegions?: EffectRegion[];
  selectedEffectId?: string | null;
  selectedAnnotationId?: string | null;
  onSelectAnnotation?: (id: string | null) => void;
  onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
  onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
  videoAssets?: VideoAsset[];
  videoClips?: VideoClip[];
  selectedClipId?: string | null;
  onSelectClip?: (id: string | null) => void;
  onClipPositionChange?: (id: string, position: { x: number; y: number }) => void;
  onClipSizeChange?: (id: string, size: { width: number; height: number }) => void;
  onClipRectChange?: (id: string, rect: InteractionRect) => void;
  cursorTrack?: CursorTrack | null;
  cursorEnabled?: boolean;
  cursorSmoothing?: CursorSmoothing;
  quadraticSmoothingStrength?: number;
  end2endParams?: End2EndParams;
  // Zoom follow options (optional)
  zoomFollowEnabled?: boolean;
  zoomFollowMode?: 'center' | 'anchor';
  zoomFollowDelayMs?: number;
  zoomFollowMinPaddingPx?: number;
  speedRegions?: SpeedRegion[];
}

export interface VideoPlaybackRef {
  video: HTMLVideoElement | null;
  app: Application | null;
  videoSprite: Sprite | null;
  videoContainer: Container | null;
  containerRef: React.RefObject<HTMLDivElement>;
  clipContainerRef: React.RefObject<HTMLDivElement>;
  play: () => Promise<void>;
  pause: () => void;
  seekToTimelineTime: (timeSeconds: number) => void;
}

function VideoPlayback(
  {
    videoPath,
    onDurationChange,
    onTimeUpdate,
    currentTime,
    onPlayStateChange,
    onError,
    wallpaper,
    backgroundItems = [],
    zoomRegions,
    selectedZoomId,
    onSelectZoom,
    onZoomFocusChange,
    isPlaying,
    showShadow,
    shadowIntensity = 0,
    showBlur,
    showSafeFrameOverlay = false,
    motionBlurEnabled = true,
    borderRadius = 0,
    padding = 50,
    screenOffset = { x: 0, y: 0 },
    cropRegion,
    trimRegions = [],
    aspectRatio,
    annotationRegions = [],
    effectRegions = [],
    selectedEffectId,
    selectedAnnotationId,
    onSelectAnnotation,
    onAnnotationPositionChange,
    onAnnotationSizeChange,
    videoAssets = [],
    videoClips = [],
    selectedClipId,
    onSelectClip,
    onClipPositionChange,
    onClipSizeChange,
    onClipRectChange,
    cursorTrack,
    cursorEnabled = true,
    cursorSmoothing = 'none',
    quadraticSmoothingStrength,
    end2endParams,
  // Zoom follow props
  zoomFollowEnabled = false,
  zoomFollowMode = 'center',
  zoomFollowDelayMs = 120,
  zoomFollowMinPaddingPx = 24,
  speedRegions = [],
  }: VideoPlaybackProps,
  ref: React.Ref<VideoPlaybackRef>
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workspaceViewportRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const videoSpriteRef = useRef<Sprite | null>(null);
  const videoContainerRef = useRef<Container | null>(null);
  const workspaceContainerRef = useRef<Container | null>(null);
  const cameraContainerRef = useRef<Container | null>(null);
  const timeUpdateAnimationRef = useRef<number | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const clipVideoLayerRef = useRef<HTMLDivElement | null>(null);
  const stageFrameRef = useRef<HTMLDivElement | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenGroupRef = useRef<HTMLDivElement | null>(null);
  const midgroundRef = useRef<HTMLDivElement | null>(null);
  const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorImageRef = useRef<HTMLImageElement | null>(null);
  const currentTimeRef = useRef(0);
  const clipEndMsRef = useRef(0);
  const videoDurationMsRef = useRef(0);
  const clipRendererRef = useRef<ClipPixiRenderer | null>(null);
  const videoClipsRef = useRef<VideoClip[]>([]);
  const videoAssetsRef = useRef<VideoAsset[]>([]);
  const selectedClipIdRef = useRef<string | null>(null);
  const extendedPlaybackRef = useRef(false);
  const extendedPlaybackRafRef = useRef<number | null>(null);
  const extendedPlaybackStartRef = useRef(0);
  const extendedPlaybackBaseMsRef = useRef(0);
  const extendedSeekTargetRef = useRef<number | null>(null);
  const gapSeekTargetRef = useRef<number | null>(null);
  const zoomRegionsRef = useRef<ZoomRegion[]>([]);
  const selectedZoomIdRef = useRef<string | null>(null);
  const effectRegionsRef = useRef<EffectRegion[]>([]);
  const selectedEffectIdRef = useRef<string | null>(null);
  const effectStateRef = useRef<CombinedEffectState>(DEFAULT_EFFECT_STATE);
  const animationStateRef = useRef({ scale: 1, focusX: DEFAULT_FOCUS.cx, focusY: DEFAULT_FOCUS.cy });
  const blurFilterRef = useRef<BlurFilter | null>(null);
  const isDraggingFocusRef = useRef(false);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const stageOffsetRef = useRef({ x: 0, y: 0 });
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const baseScaleRef = useRef(1);
  const baseOffsetRawRef = useRef({ x: 0, y: 0 });
  const baseOffsetRef = useRef({ x: 0, y: 0 });
  const baseMaskRawRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const screenOffsetPxRef = useRef({ x: 0, y: 0 });
  const videoContainerBaseRef = useRef({ x: 0, y: 0 });
  const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
  const maskGraphicsRef = useRef<Graphics | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeekingRef = useRef(false);
  const allowPlaybackRef = useRef(false);
  const lockedVideoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  const layoutVideoContentRef = useRef<(() => void) | null>(null);
  const trimRegionsRef = useRef<TrimRegion[]>([]);
  const motionBlurEnabledRef = useRef(motionBlurEnabled);
  const videoReadyRafRef = useRef<number | null>(null);
  const lastTickTimeMsRef = useRef<number | null>(null);
  const seekSnapUntilRef = useRef(0);
  const overlayDebugStateRef = useRef<Map<string, boolean>>(new Map());
  const workspacePanSessionRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const activePointerPositionsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchSessionRef = useRef<{
    pointerA: number;
    pointerB: number;
    startDistance: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);
  const [previewStageRect, setPreviewStageRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [workspaceView, setWorkspaceView] = useState({ zoom: 1, panX: 0, panY: 0, panMode: false });
  const workspaceViewRef = useRef(workspaceView);
  const [isWorkspacePanning, setIsWorkspacePanning] = useState(false);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [workspaceHovered, setWorkspaceHovered] = useState(false);
  const [workspaceFocused, setWorkspaceFocused] = useState(false);

  const CURSOR_TRAIL_MS = 500;
  const CURSOR_CLICK_MS = 280;
  const RAD_TO_DEG = 180 / Math.PI;
  const previewWorkspaceScale = showSafeFrameOverlay ? PREVIEW_WORKSPACE_SCALE : 1;
  const WORKSPACE_ZOOM_MIN = 1;
  const WORKSPACE_ZOOM_MAX = 4;
  const workspacePanEnabled = workspaceView.panMode || spacePanActive;
  const workspaceViewActive = workspaceView.zoom > 1.001 || Math.abs(workspaceView.panX) > 0.5 || Math.abs(workspaceView.panY) > 0.5;
  const workspaceInteractionLocked = workspaceViewActive || workspacePanEnabled || isWorkspacePanning;

  // DEBUG: Temporarily enabled by default for clip position debugging
  // Set window.__openscreen_debugClips = false to disable (legacy: __openscreen_debugOverlay)
  const isOverlayDebugEnabled = () => {
    if (typeof window === 'undefined') return false;
    const raw = (window as any).__openscreen_debugClips ?? (window as any).__openscreen_debugOverlay;
    // Default to enabled (true) unless explicitly set to false
    return raw !== false && raw !== 'off' && raw !== 0;
  };

  const getOverlayDebugMode = useCallback(() => {
    if (typeof window === 'undefined') return 'off';
    const raw = (window as any).__openscreen_debugClips ?? (window as any).__openscreen_debugOverlay;
    if (raw === false || raw === 'off' || raw === 0) return 'off';
    if (raw === 'verbose' || raw === 'full' || raw === 'trace') return 'verbose';
    // Default to 'basic' (enabled) for debugging
    return 'basic';
  }, []);

  const formatOverlayDebugPayload = useCallback((payload: Record<string, unknown>) => {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(payload, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }

        if (typeof DOMRect !== 'undefined' && value instanceof DOMRect) {
          return {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            left: value.left,
          };
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
  }, []);

  const logOverlayDebugExpanded = useCallback((label: string, payload: Record<string, unknown>) => {
    const formatted = formatOverlayDebugPayload(payload);
    console.log(`${label}\n${formatted}`);
  }, [formatOverlayDebugPayload]);

  const logOverlayDebug = useCallback((kind: string, payload: Record<string, unknown>, verboseOnly = false) => {
    const mode = getOverlayDebugMode();
    if (mode === 'off') return;
    if (verboseOnly && mode !== 'verbose') return;
    // Always use console.log so logs are visible (console.debug is often filtered)
    logOverlayDebugExpanded('[Clip Debug][preview]', { kind, ...payload });
  }, [getOverlayDebugMode, logOverlayDebugExpanded]);

  useEffect(() => {
    workspaceViewRef.current = workspaceView;
  }, [workspaceView]);

  const clampWorkspacePan = useCallback((panX: number, panY: number, zoom: number) => {
    const viewport = workspaceViewportRef.current;
    if (!viewport) {
      return { panX, panY };
    }

    const width = viewport.clientWidth || 0;
    const height = viewport.clientHeight || 0;
    const baseMarginRatio = showSafeFrameOverlay ? 0.32 : 0.14;
    const maxPanX = width * Math.max(baseMarginRatio, Math.max(0, zoom - 1) * 0.5);
    const maxPanY = height * Math.max(baseMarginRatio, Math.max(0, zoom - 1) * 0.5);

    return {
      panX: Math.max(-maxPanX, Math.min(maxPanX, panX)),
      panY: Math.max(-maxPanY, Math.min(maxPanY, panY)),
    };
  }, [showSafeFrameOverlay]);

  const updateWorkspaceView = useCallback((updater: (prev: typeof workspaceView) => typeof workspaceView) => {
    setWorkspaceView((prev) => {
      const next = updater(prev);
      const zoom = Math.max(WORKSPACE_ZOOM_MIN, Math.min(WORKSPACE_ZOOM_MAX, next.zoom));
      const clampedPan = clampWorkspacePan(next.panX, next.panY, zoom);
      return {
        ...next,
        zoom,
        panX: clampedPan.panX,
        panY: clampedPan.panY,
      };
    });
  }, [WORKSPACE_ZOOM_MAX, WORKSPACE_ZOOM_MIN, clampWorkspacePan]);

  const zoomWorkspaceTo = useCallback((targetZoom: number, clientX?: number, clientY?: number) => {
    const viewport = workspaceViewportRef.current;
    updateWorkspaceView((prev) => {
      const nextZoom = Math.max(WORKSPACE_ZOOM_MIN, Math.min(WORKSPACE_ZOOM_MAX, Number(targetZoom.toFixed(3))));
      if (!viewport || nextZoom === prev.zoom || clientX == null || clientY == null) {
        return {
          ...prev,
          zoom: nextZoom,
        };
      }

      const rect = viewport.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const offsetX = localX - centerX;
      const offsetY = localY - centerY;
      const nextPanX = offsetX - ((offsetX - prev.panX) / prev.zoom) * nextZoom;
      const nextPanY = offsetY - ((offsetY - prev.panY) / prev.zoom) * nextZoom;

      return {
        ...prev,
        zoom: nextZoom,
        panX: nextPanX,
        panY: nextPanY,
      };
    });
  }, [WORKSPACE_ZOOM_MAX, WORKSPACE_ZOOM_MIN, updateWorkspaceView]);

  const resetWorkspaceView = useCallback(() => {
    setWorkspaceView((prev) => ({
      ...prev,
      zoom: 1,
      panX: 0,
      panY: 0,
      panMode: false,
    }));
    setIsWorkspacePanning(false);
    workspacePanSessionRef.current = null;
  }, []);

  const zoomWorkspaceBy = useCallback((direction: 1 | -1) => {
    const currentZoom = workspaceViewRef.current.zoom;
    const nextZoom = direction > 0 ? currentZoom * 1.2 : currentZoom / 1.2;
    zoomWorkspaceTo(nextZoom);
  }, [zoomWorkspaceTo]);

  const toggleWorkspacePanMode = useCallback(() => {
    setWorkspaceView((prev) => ({ ...prev, panMode: !prev.panMode }));
    setIsWorkspacePanning(false);
    workspacePanSessionRef.current = null;
    pinchSessionRef.current = null;
  }, []);

  const handleWorkspacePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('[data-workspace-controls="true"]')) return;
    event.currentTarget.focus();

    activePointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (event.pointerType === 'touch') {
      const activePointers = Array.from(activePointerPositionsRef.current.entries());
      if (activePointers.length === 2) {
        const [[pointerA, pointA], [pointerB, pointB]] = activePointers;
        const dx = pointB.x - pointA.x;
        const dy = pointB.y - pointA.y;
        const distance = Math.hypot(dx, dy);
        pinchSessionRef.current = {
          pointerA,
          pointerB,
          startDistance: Math.max(1, distance),
          startZoom: workspaceViewRef.current.zoom,
          startPanX: workspaceViewRef.current.panX,
          startPanY: workspaceViewRef.current.panY,
          startCenterX: (pointA.x + pointB.x) / 2,
          startCenterY: (pointA.y + pointB.y) / 2,
        };
        workspacePanSessionRef.current = null;
        setIsWorkspacePanning(false);
        event.preventDefault();
        return;
      }
    }

    if (!workspacePanEnabled) return;

    workspacePanSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: workspaceViewRef.current.panX,
      startPanY: workspaceViewRef.current.panY,
    };
    setIsWorkspacePanning(true);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [workspacePanEnabled]);

  const handleWorkspacePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerPositionsRef.current.has(event.pointerId)) {
      activePointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinchSession = pinchSessionRef.current;
    if (
      pinchSession &&
      activePointerPositionsRef.current.has(pinchSession.pointerA) &&
      activePointerPositionsRef.current.has(pinchSession.pointerB)
    ) {
      const pointA = activePointerPositionsRef.current.get(pinchSession.pointerA);
      const pointB = activePointerPositionsRef.current.get(pinchSession.pointerB);
      if (pointA && pointB) {
        const dx = pointB.x - pointA.x;
        const dy = pointB.y - pointA.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const centerX = (pointA.x + pointB.x) / 2;
        const centerY = (pointA.y + pointB.y) / 2;
        const viewport = workspaceViewportRef.current;
        const rect = viewport?.getBoundingClientRect();
        if (rect) {
          const nextZoom = Math.max(
            WORKSPACE_ZOOM_MIN,
            Math.min(WORKSPACE_ZOOM_MAX, pinchSession.startZoom * (distance / pinchSession.startDistance)),
          );
          const stageCenterX = rect.width / 2;
          const stageCenterY = rect.height / 2;
          const startOffsetX = pinchSession.startCenterX - rect.left - stageCenterX;
          const startOffsetY = pinchSession.startCenterY - rect.top - stageCenterY;
          const currentOffsetX = centerX - rect.left - stageCenterX;
          const currentOffsetY = centerY - rect.top - stageCenterY;
          const worldX = (startOffsetX - pinchSession.startPanX) / pinchSession.startZoom;
          const worldY = (startOffsetY - pinchSession.startPanY) / pinchSession.startZoom;

          updateWorkspaceView((prev) => ({
            ...prev,
            zoom: nextZoom,
            panX: currentOffsetX - worldX * nextZoom,
            panY: currentOffsetY - worldY * nextZoom,
          }));
        }
        event.preventDefault();
      }
      return;
    }

    const session = workspacePanSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    updateWorkspaceView((prev) => ({
      ...prev,
      panX: session.startPanX + deltaX,
      panY: session.startPanY + deltaY,
    }));
  }, [WORKSPACE_ZOOM_MAX, WORKSPACE_ZOOM_MIN, updateWorkspaceView]);

  const endWorkspacePan = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    const session = workspacePanSessionRef.current;
    if (event && session && session.pointerId === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // ignore pointer capture cleanup failures
      }
    }
    if (event) {
      activePointerPositionsRef.current.delete(event.pointerId);
      const pinchSession = pinchSessionRef.current;
      if (pinchSession && (pinchSession.pointerA === event.pointerId || pinchSession.pointerB === event.pointerId)) {
        pinchSessionRef.current = null;
      }
    }
    workspacePanSessionRef.current = null;
    setIsWorkspacePanning(false);
  }, []);

  const handleWorkspaceWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('[data-workspace-controls="true"]')) return;

    event.preventDefault();
    event.currentTarget.focus();

    const intensity = event.ctrlKey ? 0.0035 : 0.0018;
    const zoomFactor = Math.exp(-event.deltaY * intensity);
    zoomWorkspaceTo(workspaceViewRef.current.zoom * zoomFactor, event.clientX, event.clientY);
  }, [zoomWorkspaceTo]);

  useEffect(() => {
    const hotkeysEnabled = workspaceHovered || workspaceFocused || workspacePanEnabled || isWorkspacePanning;
    if (!hotkeysEnabled) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.code === 'Space') {
        if (!spacePanActive) {
          setSpacePanActive(true);
        }
        event.preventDefault();
        return;
      }

      if (event.key === '0') {
        resetWorkspaceView();
        event.preventDefault();
        return;
      }

      if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
        zoomWorkspaceBy(1);
        event.preventDefault();
        return;
      }

      if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
        zoomWorkspaceBy(-1);
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePanActive(false);
      }
    };

    const handleWindowBlur = () => {
      setSpacePanActive(false);
      workspacePanSessionRef.current = null;
      pinchSessionRef.current = null;
      activePointerPositionsRef.current.clear();
      setIsWorkspacePanning(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    isWorkspacePanning,
    resetWorkspaceView,
    spacePanActive,
    workspaceFocused,
    workspaceHovered,
    workspacePanEnabled,
    zoomWorkspaceBy,
  ]);

  useEffect(() => {
    const viewport = workspaceViewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      setWorkspaceView((prev) => {
        const clampedPan = clampWorkspacePan(prev.panX, prev.panY, prev.zoom);
        if (Math.abs(clampedPan.panX - prev.panX) < 0.5 && Math.abs(clampedPan.panY - prev.panY) < 0.5) {
          return prev;
        }
        return {
          ...prev,
          panX: clampedPan.panX,
          panY: clampedPan.panY,
        };
      });
    });

    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, [clampWorkspacePan]);

  const cancelExtendedPlayback = useCallback(() => {
    extendedPlaybackRef.current = false;
    if (extendedPlaybackRafRef.current !== null) {
      cancelAnimationFrame(extendedPlaybackRafRef.current);
      extendedPlaybackRafRef.current = null;
    }
  }, []);

  const stopExtendedPlayback = useCallback((finalTimeMs?: number) => {
    cancelExtendedPlayback();
    if (typeof finalTimeMs === 'number') {
      currentTimeRef.current = finalTimeMs;
      onTimeUpdate(finalTimeMs / 1000);
    }
    isPlayingRef.current = false;
    onPlayStateChange(false);
  }, [cancelExtendedPlayback, onPlayStateChange, onTimeUpdate]);

  const startExtendedPlayback = useCallback((startMs: number, endMs: number) => {
    cancelExtendedPlayback();
    if (endMs <= startMs) {
      stopExtendedPlayback(endMs);
      return;
    }

    extendedPlaybackRef.current = true;
    extendedPlaybackBaseMsRef.current = startMs;
    extendedPlaybackStartRef.current = performance.now();
    isPlayingRef.current = true;
    onPlayStateChange(true);

    const tick = (now: number) => {
      if (!extendedPlaybackRef.current) return;
      const elapsed = now - extendedPlaybackStartRef.current;
      const nextMs = extendedPlaybackBaseMsRef.current + elapsed;
      const clampedMs = Math.min(nextMs, endMs);
      currentTimeRef.current = clampedMs;
      onTimeUpdate(clampedMs / 1000);

      if (clampedMs >= endMs) {
        stopExtendedPlayback(endMs);
        return;
      }
      extendedPlaybackRafRef.current = requestAnimationFrame(tick);
    };

    extendedPlaybackRafRef.current = requestAnimationFrame(tick);
  }, [cancelExtendedPlayback, onPlayStateChange, onTimeUpdate, stopExtendedPlayback]);

  const hasExtendedTimelineBeyondSource = useCallback(() => {
    const clipEndMs = clipEndMsRef.current;
    const video = videoRef.current;
    const videoDurationMs = videoDurationMsRef.current || Math.round((video?.duration ?? 0) * 1000);
    return clipEndMs > videoDurationMs;
  }, []);

  const shouldIgnoreNativePauseForExtendedPlayback = useCallback(() => {
    if (extendedPlaybackRef.current) {
      return true;
    }

    if (!allowPlaybackRef.current || !hasExtendedTimelineBeyondSource()) {
      return false;
    }

    const video = videoRef.current;
    if (!video) return false;

    const videoDurationMs = videoDurationMsRef.current || Math.round(video.duration * 1000);
    const currentSourceMs = video.currentTime * 1000;
    return currentSourceMs >= Math.max(0, videoDurationMs - 50);
  }, [hasExtendedTimelineBeyondSource]);

  const applyEffectTransform = useCallback((state: CombinedEffectState) => {
    const group = screenGroupRef.current;
    if (!group) return;

    if (!state.active) {
      group.style.transformOrigin = "";
      group.style.transform = '';
      return;
    }

    const perspective = 1200;
    const rollDeg = state.roll * RAD_TO_DEG;
    const rotXDeg = (state.tiltYDeg ?? (state.skewY * RAD_TO_DEG) / 0.55) || 0;
    const rotYDeg = -((state.tiltXDeg ?? (state.skewX * RAD_TO_DEG) / 0.55) || 0);
    const scale = state.scale ?? 1;
    const offsetX = state.offsetX ?? 0;
    const offsetY = state.offsetY ?? 0;
    const stageWidth = previewStageRect.width || stageSizeRef.current.width;
    const stageHeight = previewStageRect.height || stageSizeRef.current.height;
    const stageOffsetX = previewStageRect.x || stageOffsetRef.current.x;
    const stageOffsetY = previewStageRect.y || stageOffsetRef.current.y;
    const viewportWidth = workspaceViewportRef.current?.clientWidth || stageWidth;
    const viewportHeight = workspaceViewportRef.current?.clientHeight || stageHeight;
    const fit = stageWidth > 0 && stageHeight > 0
      ? getEffectPreviewFit(state, stageWidth, stageHeight, viewportWidth, viewportHeight, 18)
      : { fitScale: 1, translateX: 0, translateY: 0 };
    const transformOriginX = stageOffsetX + stageWidth / 2;
    const transformOriginY = stageOffsetY + stageHeight / 2;

    try {
      const m = new DOMMatrix();
      // Perspective (m34 = -1/perspectiveLength)
      m.m34 = -1 / perspective;
      m.scaleSelf(scale, scale, 1);
      m.translateSelf(offsetX, offsetY, 0);
      m.rotateSelf(rotXDeg, rotYDeg, rollDeg);

      const values = [
        m.m11, m.m12, m.m13, m.m14,
        m.m21, m.m22, m.m23, m.m24,
        m.m31, m.m32, m.m33, m.m34,
        m.m41, m.m42, m.m43, m.m44,
      ];

      group.style.transformOrigin = `${transformOriginX}px ${transformOriginY}px`;
      group.style.transform = `scale(${fit.fitScale}) translate3d(${fit.translateX}px, ${fit.translateY}px, 0) matrix3d(${values.join(',')})`;
    } catch {
      // Fallback if DOMMatrix is unavailable
      group.style.transformOrigin = `${transformOriginX}px ${transformOriginY}px`;
      group.style.transform = `scale(${fit.fitScale}) translate3d(${fit.translateX}px, ${fit.translateY}px, 0) perspective(${perspective}px) translate3d(${offsetX}px, ${offsetY}px, 0) rotateX(${rotXDeg}deg) rotateY(${rotYDeg}deg) rotate(${rollDeg}deg) scale(${scale})`;
    }
  }, [RAD_TO_DEG, previewStageRect]);

  const applyZoomToOverlays = useCallback(() => {
    const overlayLayer = clipVideoLayerRef.current;
    const annotationLayer = overlayRef.current;

    const resetTransform = (layer: HTMLDivElement | null) => {
      if (!layer) return;
      layer.style.transform = '';
      layer.style.transformOrigin = '';
    };

    resetTransform(overlayLayer);
    resetTransform(annotationLayer);
  }, []);

  // Load default cursor SVG image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      cursorImageRef.current = img;
    };
    img.onerror = () => {
      console.warn('Failed to load default cursor SVG');
    };
    img.src = '/default.svg';
  }, []);

  const resizeCursorCanvas = useCallback(() => {
    const overlayEl = overlayRef.current;
    const canvas = cursorCanvasRef.current;
    if (!overlayEl || !canvas) return;
    const width = overlayEl.clientWidth;
    const height = overlayEl.clientHeight;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(width * dpr));
    const nextHeight = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }, []);

  const findFirstIndex = (events: CursorTrack['events'], tMs: number) => {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (events[mid].tMs < tMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  };

  const findLastIndex = (events: CursorTrack['events'], tMs: number) => {
    let lo = 0;
    let hi = events.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (events[mid].tMs <= tMs) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  };

  const drawArrowCursor = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, fill: string, stroke: string) => {
    const w = size * 0.6;
    const h = size * 1.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(w * 0.55, h);
    ctx.lineTo(w * 0.9, h * 1.55);
    ctx.lineTo(w * 0.6, h * 1.65);
    ctx.lineTo(w * 0.25, h * 1.05);
    ctx.lineTo(0, h * 1.35);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.stroke();
    ctx.restore();
  };

  const drawCursor = (
    ctx: CanvasRenderingContext2D,
    preset: CursorTrack['style']['preset'],
    x: number,
    y: number,
    size: number,
    dragging: boolean,
  ) => {
    const fill = 'rgba(255,255,255,0.95)';
    const stroke = 'rgba(0,0,0,0.5)';
    const dragAccent = 'rgba(52,178,123,0.9)';

    if (dragging) {
      ctx.beginPath();
      ctx.strokeStyle = dragAccent;
      ctx.lineWidth = Math.max(2, size * 0.15);
      ctx.arc(x, y, size * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (preset === 'dot') {
      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.arc(x, y, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.stroke();
      return;
    }

    if (preset === 'circle') {
      ctx.beginPath();
      ctx.strokeStyle = fill;
      ctx.lineWidth = Math.max(2, size * 0.12);
      ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      if (dragging) {
        ctx.beginPath();
        ctx.strokeStyle = dragAccent;
        ctx.lineWidth = Math.max(1, size * 0.08);
        ctx.arc(x, y, size * 0.75, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }

    // Use SVG image for arrow preset
    const img = cursorImageRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      const scale = size / 32; // SVG is 32x32, scale to desired size
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -16, -16); // Center the image (32/2 = 16)
      ctx.restore();
    } else {
      // Fallback to drawn arrow if image not loaded yet
      drawArrowCursor(ctx, x, y, size, fill, stroke);
    }
  };

  const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
    return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
  }, []);

  const updateScreenOffsetRefs = useCallback((stageWidth?: number, stageHeight?: number) => {
    const width = stageWidth ?? stageSizeRef.current.width;
    const height = stageHeight ?? stageSizeRef.current.height;
    const offsetX = width ? ((screenOffset?.x ?? 0) / 100) * width : 0;
    const offsetY = height ? ((screenOffset?.y ?? 0) / 100) * height : 0;
    const stageOffset = stageOffsetRef.current;

    screenOffsetPxRef.current = { x: offsetX, y: offsetY };

    const baseOffset = baseOffsetRawRef.current;
    baseOffsetRef.current = {
      x: stageOffset.x + baseOffset.x + offsetX,
      y: stageOffset.y + baseOffset.y + offsetY,
    };

    const baseMask = baseMaskRawRef.current;
    baseMaskRef.current = {
      x: stageOffset.x + baseMask.x + offsetX,
      y: stageOffset.y + baseMask.y + offsetY,
      width: baseMask.width,
      height: baseMask.height,
    };
  }, [screenOffset]);

  const applyScreenOffsetToVideo = useCallback(() => {
    const renderer = clipRendererRef.current;
    if (!renderer) return;
    const zoomScale = animationStateRef.current.scale || 1;
    renderer.applyScreenOffset(zoomScale);
  }, []);

  const applyScreenOffsetToMidground = useCallback(() => {
    const midground = midgroundRef.current;
    if (!midground) return;

    midground.style.transform = '';
    midground.style.transformOrigin = '';
  }, []);

  const isRecordingClip = useCallback(
    (clip: VideoClip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID,
    [],
  );

  // Helper: compute stage pixel coords (pre-camera transform) from normalized video coords (nx, ny)
  const getStageCoordsFromNormalized = useCallback((nx: number, ny: number) => {
    const lockedDims = lockedVideoDimensionsRef.current;
    if (!lockedDims || lockedDims.width === 0 || lockedDims.height === 0) return null;

    const fullVideoWidth = lockedDims.width;
    const fullVideoHeight = lockedDims.height;

    const videoX = nx * fullVideoWidth;
    const videoY = ny * fullVideoHeight;

    const cropBounds = cropBoundsRef.current;
    if (cropBounds.endX > cropBounds.startX && cropBounds.endY > cropBounds.startY) {
      if (videoX < cropBounds.startX || videoX > cropBounds.endX ||
          videoY < cropBounds.startY || videoY > cropBounds.endY) {
        return null;
      }
    }

    const baseScale = baseScaleRef.current;
    const baseOffset = baseOffsetRef.current;
    if (!stageSizeRef.current.width || !stageSizeRef.current.height || baseScale <= 0) {
      return null;
    }

    const stageX = baseOffset.x + videoX * baseScale;
    const stageY = baseOffset.y + videoY * baseScale;
    return { stageX, stageY };
  }, []);

  const updateOverlayForRegion = useCallback((region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
    const overlayEl = overlayRef.current;
    const indicatorEl = focusIndicatorRef.current;
    
    if (!overlayEl || !indicatorEl) {
      return;
    }

    const stageWidth = stageSizeRef.current.width;
    const stageHeight = stageSizeRef.current.height;
    if (stageWidth && stageHeight) {
      stageSizeRef.current = { width: stageWidth, height: stageHeight };
    }

    updateOverlayIndicator({
      overlayEl,
      indicatorEl,
      stageRect: {
        x: stageOffsetRef.current.x,
        y: stageOffsetRef.current.y,
        width: stageWidth,
        height: stageHeight,
      },
      region,
      focusOverride,
      videoSize: videoSizeRef.current,
      baseScale: baseScaleRef.current,
      isPlaying: isPlayingRef.current,
    });
  }, []);

  const layoutVideoContent = useCallback(() => {
    const container = containerRef.current;
    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const maskGraphics = maskGraphicsRef.current;
    const videoElement = videoRef.current;
    const cameraContainer = cameraContainerRef.current;
    const workspaceContainer = workspaceContainerRef.current;

    if (!container || !app || !videoSprite || !maskGraphics || !videoElement || !cameraContainer || !workspaceContainer) {
      return;
    }

    // Lock video dimensions on first layout to prevent resize issues
    if (!lockedVideoDimensionsRef.current && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
      lockedVideoDimensionsRef.current = {
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      };
    }

    const result = layoutVideoContentUtil({
      container,
      app,
      videoSprite,
      maskGraphics,
      videoElement,
      cropRegion,
      lockedVideoDimensions: lockedVideoDimensionsRef.current,
      borderRadius,
      padding,
      workspaceScale: previewWorkspaceScale,
    });

    if (result) {
      stageSizeRef.current = result.stageSize;
      stageOffsetRef.current = result.stageOffset;
      videoSizeRef.current = result.videoSize;
      baseScaleRef.current = result.baseScale;
      baseOffsetRawRef.current = result.baseOffset;
      baseMaskRawRef.current = result.maskRect;
      cropBoundsRef.current = result.cropBounds;
      workspaceContainer.position.set(result.stageOffset.x, result.stageOffset.y);
      setPreviewStageRect((current) => {
        if (
          Math.abs(current.x - result.stageOffset.x) < 0.5 &&
          Math.abs(current.y - result.stageOffset.y) < 0.5 &&
          Math.abs(current.width - result.stageSize.width) < 0.5 &&
          Math.abs(current.height - result.stageSize.height) < 0.5
        ) {
          return current;
        }
        return {
          x: result.stageOffset.x,
          y: result.stageOffset.y,
          width: result.stageSize.width,
          height: result.stageSize.height,
        };
      });

      // Reset camera container to identity
      cameraContainer.scale.set(1);
      cameraContainer.position.set(0, 0);

      const videoStage = videoContainerRef.current;
      if (videoStage) {
        videoContainerBaseRef.current = { x: videoStage.position.x, y: videoStage.position.y };
      }

      updateScreenOffsetRefs(result.stageSize.width, result.stageSize.height);
      applyScreenOffsetToVideo();
      applyScreenOffsetToMidground();

      const selectedId = selectedZoomIdRef.current;
      const activeRegion = selectedId
        ? zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null
        : null;

      updateOverlayForRegion(activeRegion);

      const clipRenderer = clipRendererRef.current;
      if (clipRenderer) {
        clipRenderer.setStageSize(result.stageSize);
        clipRenderer.syncClips(videoClipsRef.current);
        clipRenderer.setRecordingLayout({
          cropRegion: cropRegion ?? { x: 0, y: 0, width: 1, height: 1 },
          padding: padding ?? 0,
          borderRadius: borderRadius ?? 0,
          screenOffsetPx: screenOffsetPxRef.current,
        });
      }
    }
  }, [
    updateOverlayForRegion,
    cropRegion,
    borderRadius,
    padding,
    previewWorkspaceScale,
    updateScreenOffsetRefs,
    applyScreenOffsetToVideo,
    applyScreenOffsetToMidground,
  ]);

  useEffect(() => {
    layoutVideoContentRef.current = layoutVideoContent;
  }, [layoutVideoContent]);

  const selectedZoom = useMemo(() => {
    if (!selectedZoomId) return null;
    return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
  }, [zoomRegions, selectedZoomId]);

  const recordingClips = useMemo(
    () => [...videoClips].filter(isRecordingClip).sort((a, b) => a.startMs - b.startMs),
    [videoClips, isRecordingClip],
  );

  const findRecordingClipAtTimelineMs = useCallback(
    (timelineMs: number) => (
      recordingClips.find((candidate) => timelineMs >= candidate.startMs && timelineMs <= candidate.endMs) ?? null
    ),
    [recordingClips],
  );

  const mapTimelineToRecordingSourceMs = useCallback((timelineMs: number) => {
    const activeClip = findRecordingClipAtTimelineMs(timelineMs);
    if (activeClip) {
      const sourceStartMs = activeClip.sourceStartMs ?? 0;
      const sourceDurationMs = Math.max(0, (activeClip.sourceEndMs ?? sourceStartMs + (activeClip.endMs - activeClip.startMs)) - sourceStartMs);
      if (sourceDurationMs <= 0) return sourceStartMs;

      const localTimelineMs = Math.max(0, Math.min(timelineMs - activeClip.startMs, getClipTimelineDurationMs(activeClip)));
      return sourceStartMs + getSourceOffsetForTimelineOffsetMs(activeClip, localTimelineMs);
    }

    let previousClip: VideoClip | null = null;
    let nextClip: VideoClip | null = null;

    for (const candidate of recordingClips) {
      if (candidate.endMs < timelineMs) {
        previousClip = candidate;
        continue;
      }
      if (candidate.startMs > timelineMs) {
        nextClip = candidate;
        break;
      }
    }

    if (previousClip) {
      const sourceStartMs = previousClip.sourceStartMs ?? 0;
      const sourceEndMs = previousClip.sourceEndMs ?? sourceStartMs + (previousClip.endMs - previousClip.startMs);
      return Math.max(sourceStartMs, sourceEndMs);
    }

    if (nextClip) {
      return nextClip.sourceStartMs ?? 0;
    }

    return timelineMs;
  }, [findRecordingClipAtTimelineMs, recordingClips]);

  const mapRecordingSourceToTimelineMs = useCallback((sourceMs: number) => {
    const clip = recordingClips.find((candidate) => {
      const sourceStartMs = candidate.sourceStartMs ?? 0;
      const sourceEndMs = candidate.sourceEndMs ?? sourceStartMs + (candidate.endMs - candidate.startMs);
      return sourceMs >= sourceStartMs && sourceMs <= sourceEndMs;
    }) ?? recordingClips[recordingClips.length - 1];

    if (!clip) return sourceMs;

    const sourceStartMs = clip.sourceStartMs ?? 0;
    const sourceOffsetMs = Math.max(0, sourceMs - sourceStartMs);
    return clip.startMs + getTimelineOffsetForSourceOffsetMs(clip, sourceOffsetMs);
  }, [recordingClips]);

  const getRecordingPlaybackRateForTimelineMs = useCallback((timelineMs: number) => {
    const clip = recordingClips.find((candidate) => timelineMs >= candidate.startMs && timelineMs <= candidate.endMs);
    const baseRate = clip
      ? getSpeedAtTimelineOffset(clip, Math.max(0, timelineMs - clip.startMs))
      : 1;
    return getPlaybackRateForSpeedRegions(speedRegions, timelineMs, baseRate);
  }, [recordingClips, speedRegions]);

  useImperativeHandle(ref, () => ({
    video: videoRef.current,
    app: appRef.current,
    videoSprite: videoSpriteRef.current,
    videoContainer: videoContainerRef.current,
    containerRef,
    clipContainerRef: stageFrameRef,
    play: async () => {
      const vid = videoRef.current;
      if (!vid) return;
      try {
        allowPlaybackRef.current = true;
        const clipEndMs = clipEndMsRef.current;
        const videoDurationMs = videoDurationMsRef.current || Math.round(vid.duration * 1000);
        const currentTimelineMs = currentTimeRef.current;

        if (clipEndMs > videoDurationMs && currentTimelineMs >= Math.max(0, videoDurationMs - 1)) {
          startExtendedPlayback(Math.max(currentTimelineMs, videoDurationMs), clipEndMs);
          return;
        }

        await vid.play();
      } catch (error) {
        allowPlaybackRef.current = false;
        throw error;
      }
    },
    pause: () => {
      const video = videoRef.current;
      allowPlaybackRef.current = false;
      if (extendedPlaybackRef.current) {
        stopExtendedPlayback(currentTimeRef.current);
        return;
      }
      if (!video) {
        return;
      }
      video.pause();
    },
    seekToTimelineTime: (timeSeconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const targetTimelineMs = Math.max(0, timeSeconds * 1000);
      const videoDurationMs = videoDurationMsRef.current || Math.round(video.duration * 1000);
      const targetRecordingClip = findRecordingClipAtTimelineMs(targetTimelineMs);
      const isGapSeek = recordingClips.length > 0 && targetRecordingClip === null && targetTimelineMs <= videoDurationMs;
      if (targetTimelineMs > videoDurationMs) {
        gapSeekTargetRef.current = null;
        extendedSeekTargetRef.current = targetTimelineMs;
        currentTimeRef.current = targetTimelineMs;
        onTimeUpdate(targetTimelineMs / 1000);
        if (video.currentTime * 1000 < videoDurationMs - 100) {
          video.currentTime = videoDurationMs / 1000;
        }
        return;
      }
      extendedSeekTargetRef.current = null;
      gapSeekTargetRef.current = isGapSeek ? targetTimelineMs : null;
      const targetSourceMs = mapTimelineToRecordingSourceMs(targetTimelineMs);
      video.currentTime = targetSourceMs / 1000;
      currentTimeRef.current = targetTimelineMs;
      if (isGapSeek) {
        onTimeUpdate(targetTimelineMs / 1000);
      }
    },
  }), [containerRef, findRecordingClipAtTimelineMs, mapTimelineToRecordingSourceMs, onTimeUpdate, recordingClips.length, startExtendedPlayback, stopExtendedPlayback]);

  const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;

    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;

    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;

    const rect = overlayEl.getBoundingClientRect();
    const stageWidth = stageSizeRef.current.width;
    const stageHeight = stageSizeRef.current.height;
    const stageOffset = stageOffsetRef.current;

    if (!stageWidth || !stageHeight) {
      return;
    }

    stageSizeRef.current = { width: stageWidth, height: stageHeight };

    const localX = clientX - rect.left - stageOffset.x;
    const localY = clientY - rect.top - stageOffset.y;
    if (localX < 0 || localY < 0 || localX > stageWidth || localY > stageHeight) {
      return;
    }

    const unclampedFocus: ZoomFocus = {
      cx: clamp01(localX / stageWidth),
      cy: clamp01(localY / stageHeight),
    };
    const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

    onZoomFocusChange(region.id, clampedFocus);
    updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlayingRef.current) return;
    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;
    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    onSelectZoom(region.id);
    event.preventDefault();
    isDraggingFocusRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    event.preventDefault();
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    isDraggingFocusRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* empty */ }
  };

  const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  useEffect(() => {
    zoomRegionsRef.current = zoomRegions;
  }, [zoomRegions]);

  useEffect(() => {
    selectedZoomIdRef.current = selectedZoomId;
  }, [selectedZoomId]);

  useEffect(() => {
    effectRegionsRef.current = effectRegions || [];
  }, [effectRegions]);

  useEffect(() => {
    selectedEffectIdRef.current = selectedEffectId || null;
  }, [selectedEffectId]);

  useEffect(() => {
    videoClipsRef.current = videoClips;
  }, [videoClips]);

  useEffect(() => {
    videoAssetsRef.current = videoAssets;
  }, [videoAssets]);

  useEffect(() => {
    selectedClipIdRef.current = selectedClipId ?? null;
  }, [selectedClipId]);

  useEffect(() => {
    updateScreenOffsetRefs();
    applyScreenOffsetToVideo();
    applyScreenOffsetToMidground();
    const renderer = clipRendererRef.current;
    if (renderer) {
      renderer.setRecordingLayout({
        cropRegion: cropRegion ?? { x: 0, y: 0, width: 1, height: 1 },
        padding: padding ?? 0,
        borderRadius: borderRadius ?? 0,
        screenOffsetPx: screenOffsetPxRef.current,
      });
    }
  }, [screenOffset, updateScreenOffsetRefs, applyScreenOffsetToVideo, applyScreenOffsetToMidground, cropRegion, padding, borderRadius]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const renderer = clipRendererRef.current;
    if (!renderer) return;
    renderer.setAssets(videoAssets);
    renderer.syncClips(videoClips);
    renderer.setStageSize(stageSizeRef.current);
    const video = videoRef.current;
    if (video) {
      renderer.setExternalVideo(RECORDING_ASSET_ID, video, { allowSeek: false });
    }
    renderer.setRecordingLayout({
      cropRegion: cropRegion ?? { x: 0, y: 0, width: 1, height: 1 },
      padding: padding ?? 0,
      borderRadius: borderRadius ?? 0,
      screenOffsetPx: screenOffsetPxRef.current,
    });
  }, [pixiReady, videoReady, videoAssets, videoClips, cropRegion, padding, borderRadius]);

  // Follow anchor ref and keep props in refs for synchronous access in ticker
  const followAnchorRef = useRef<ZoomFocus | null>(null);
  const zoomFollowEnabledRef = useRef<boolean>(zoomFollowEnabled);
  const zoomFollowModeRef = useRef<'center' | 'anchor'>(zoomFollowMode);
  const zoomFollowDelayMsRef = useRef<number>(zoomFollowDelayMs);
  const zoomFollowMinPaddingPxRef = useRef<number>(zoomFollowMinPaddingPx);
  // Cursor smoothing refs
  const cursorSmoothingRef = useRef<CursorSmoothing>(cursorSmoothing);
  const quadraticStrengthRef = useRef<number | undefined>(quadraticSmoothingStrength);
  const end2endParamsRefLocal = useRef<End2EndParams | undefined>(end2endParams);

  useEffect(() => { cursorSmoothingRef.current = cursorSmoothing; }, [cursorSmoothing]);
  useEffect(() => { quadraticStrengthRef.current = quadraticSmoothingStrength; }, [quadraticSmoothingStrength]);
  useEffect(() => { end2endParamsRefLocal.current = end2endParams; }, [end2endParams]);

  useEffect(() => { zoomFollowEnabledRef.current = zoomFollowEnabled; }, [zoomFollowEnabled]);
  useEffect(() => { zoomFollowModeRef.current = zoomFollowMode as 'center' | 'anchor'; }, [zoomFollowMode]);
  useEffect(() => { zoomFollowDelayMsRef.current = zoomFollowDelayMs; }, [zoomFollowDelayMs]);
  useEffect(() => { zoomFollowMinPaddingPxRef.current = zoomFollowMinPaddingPx; }, [zoomFollowMinPaddingPx]);

  // Reset anchor when selected zoom changes (start fresh anchoring)
  useEffect(() => {
    followAnchorRef.current = null;
  }, [selectedZoomId]);
  // Also watch global fallback values (in case parent didn't wire up callbacks)
  useEffect(() => {
    try {
      if ((window as any).__openscreen_zoomFollowEnabled !== undefined) {
        zoomFollowEnabledRef.current = Boolean((window as any).__openscreen_zoomFollowEnabled);
      }
      if ((window as any).__openscreen_zoomFollowMode) {
        zoomFollowModeRef.current = (window as any).__openscreen_zoomFollowMode;
      }
      if ((window as any).__openscreen_zoomFollowDelayMs !== undefined) {
        zoomFollowDelayMsRef.current = Number((window as any).__openscreen_zoomFollowDelayMs);
      }
      if ((window as any).__openscreen_zoomFollowMinPaddingPx !== undefined) {
        zoomFollowMinPaddingPxRef.current = Number((window as any).__openscreen_zoomFollowMinPaddingPx);
      }
    } catch {}
  }, []);

  // When follow is enabled or mode changes to 'center', snap the camera to the
  // smoothed cursor position immediately and clear any anchor so the ticker will
  // continue following the cursor using the configured smoothing mode.
  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    // Only run when parent props or global mode enable center-follow.
    const shouldSnap =
      Boolean(zoomFollowEnabledRef.current || (typeof window !== 'undefined' && (window as any).__openscreen_zoomFollowEnabled)) &&
      (zoomFollowModeRef.current === 'center' || (typeof window !== 'undefined' && (window as any).__openscreen_zoomFollowMode === 'center'));
    if (!shouldSnap) return;

    try {
      if (!cursorTrack || !cursorTrack.events || cursorTrack.events.length === 0) return;

      const events = cursorTrack.events;
      const offsetFromStyle = cursorTrack.style?.offsetMs ?? DEFAULT_CURSOR_STYLE.offsetMs ?? 0;
      const playheadMs = Math.round(currentTimeRef.current) + offsetFromStyle;
      const lastIdx = findLastIndex(events, playheadMs);
      if (lastIdx < 0) return;

      // Interpolate between events to get precise normalized position
      let nx = events[lastIdx].nx;
      let ny = events[lastIdx].ny;
      const nextEv = events[lastIdx + 1];
      const curEv = events[lastIdx];
      if (nextEv && nextEv.tMs > curEv.tMs) {
        const frac = Math.max(0, Math.min(1, (playheadMs - curEv.tMs) / (nextEv.tMs - curEv.tMs)));
        nx = curEv.nx + (nextEv.nx - curEv.nx) * frac;
        ny = curEv.ny + (nextEv.ny - curEv.ny) * frac;
      }

      const stagePt = getStageCoordsFromNormalized(nx, ny);
      const stageSize = stageSizeRef.current;
      if (!stagePt || !stageSize.width || !stageSize.height) return;

      const smoothingMode = cursorSmoothingRef.current || 'none';
      let targetCx = clamp01(stagePt.stageX / stageSize.width);
      let targetCy = clamp01(stagePt.stageY / stageSize.height);

      if (smoothingMode === 'end2end' && end2endParamsRefLocal.current) {
        const displayEventsForCursor: { tMs: number; x: number; y: number; kind: any; dragging: boolean }[] = [];
        for (let i = 0; i < events.length; i += 1) {
          const ev = events[i];
          const pos = getStageCoordsFromNormalized(ev.nx, ev.ny);
          if (!pos) continue;
          displayEventsForCursor.push({
            tMs: ev.tMs,
            x: pos.stageX + (cursorTrack.style?.offsetX ?? DEFAULT_CURSOR_STYLE.offsetX ?? 0),
            y: pos.stageY + (cursorTrack.style?.offsetY ?? DEFAULT_CURSOR_STYLE.offsetY ?? 0),
            kind: ev.kind,
            dragging: ev.dragging,
          });
        }
        const pausePoints = extractPausePointsFromDisplayEvents(displayEventsForCursor, end2endParamsRefLocal.current);
        const arrivalFrac = typeof end2endParamsRefLocal.current.arrivalFraction === 'number' ? end2endParamsRefLocal.current.arrivalFraction : 1.0;
        const evaluated = evaluatePositionOnCRByTime(pausePoints, playheadMs, arrivalFrac);
        if (evaluated) {
          targetCx = clamp01(evaluated.x / stageSize.width);
          targetCy = clamp01(evaluated.y / stageSize.height);
        }
      } else if (smoothingMode === 'quadratic') {
        const strength = typeof quadraticStrengthRef.current === 'number' ? quadraticStrengthRef.current : 0.5;
        const windowSize = Math.max(1, Math.round(1 + strength * 6));
        const startIdx = Math.max(0, lastIdx - windowSize + 1);
        let sumX = 0;
        let sumY = 0;
        let cnt = 0;
        for (let i = startIdx; i <= lastIdx; i += 1) {
          const ev = events[i];
          const pos = getStageCoordsFromNormalized(ev.nx, ev.ny);
          if (!pos) continue;
          const w = 1 + (i - startIdx);
          sumX += pos.stageX * w;
          sumY += pos.stageY * w;
          cnt += w;
        }
        if (cnt > 0) {
          const avgX = sumX / cnt;
          const avgY = sumY / cnt;
          targetCx = clamp01(avgX / stageSize.width);
          targetCy = clamp01(avgY / stageSize.height);
        }
      }

      // Clear any anchor and snap animation state to the smoothed cursor target so
      // ticker will continue to update from there.
      followAnchorRef.current = null;
      animationStateRef.current.focusX = targetCx;
      animationStateRef.current.focusY = targetCy;

      // Immediately apply transform so user sees the snap without waiting a tick.
      const cameraContainer = cameraContainerRef.current;
      if (cameraContainer) {
        applyZoomTransform({
          cameraContainer,
          blurFilter: blurFilterRef.current,
          stageSize: stageSizeRef.current,
          baseMask: baseMaskRef.current,
          zoomScale: animationStateRef.current.scale,
          focusX: animationStateRef.current.focusX,
          focusY: animationStateRef.current.focusY,
          motionIntensity: 0,
          isPlaying: isPlayingRef.current,
          motionBlurEnabled: motionBlurEnabledRef.current,
        });
        clipRendererRef.current?.setCameraTransform({
          scale: animationStateRef.current.scale,
          focusX: animationStateRef.current.focusX,
          focusY: animationStateRef.current.focusY,
        });
        applyScreenOffsetToVideo();
      }
    } catch (err) {
      // swallow; this is an opportunistic snap
    }
  }, [pixiReady, videoReady, applyScreenOffsetToVideo]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    trimRegionsRef.current = trimRegions;
  }, [trimRegions]);

  useEffect(() => {
    motionBlurEnabledRef.current = motionBlurEnabled;
  }, [motionBlurEnabled]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const cameraContainer = cameraContainerRef.current;
    const video = videoRef.current;

    if (!app || !cameraContainer || !video) return;

    const tickerWasStarted = app.ticker?.started || false;
    if (tickerWasStarted && app.ticker) {
      app.ticker.stop();
    }

    const wasPlaying = !video.paused;
    if (wasPlaying) {
      video.pause();
    }

    animationStateRef.current = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };

    if (blurFilterRef.current) {
      blurFilterRef.current.blur = 0;
    }

    requestAnimationFrame(() => {
      const container = cameraContainerRef.current;
      const videoStage = videoContainerRef.current;
      const sprite = videoSpriteRef.current;
      const currentApp = appRef.current;
      if (!container || !videoStage || !sprite || !currentApp) {
        return;
      }

      container.scale.set(1);
      container.position.set(0, 0);
      videoStage.scale.set(1);
      videoStage.position.set(0, 0);
      sprite.scale.set(1);
      sprite.position.set(0, 0);

      layoutVideoContent();

      applyZoomTransform({
        cameraContainer: container,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: 1,
        focusX: DEFAULT_FOCUS.cx,
        focusY: DEFAULT_FOCUS.cy,
        motionIntensity: 0,
        isPlaying: false,
        motionBlurEnabled: motionBlurEnabledRef.current,
      });
      clipRendererRef.current?.setCameraTransform({
        scale: 1,
        focusX: DEFAULT_FOCUS.cx,
        focusY: DEFAULT_FOCUS.cy,
      });
      applyScreenOffsetToVideo();

      requestAnimationFrame(() => {
        const finalApp = appRef.current;
        if (wasPlaying && video) {
          video.play().catch(() => {
          });
        }
        if (tickerWasStarted && finalApp?.ticker) {
          finalApp.ticker.start();
        }
      });
    });
  }, [pixiReady, videoReady, layoutVideoContent, cropRegion, applyScreenOffsetToVideo]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const container = containerRef.current;
    if (!container) return;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      layoutVideoContent();
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [pixiReady, videoReady, layoutVideoContent]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    updateOverlayForRegion(selectedZoom);
  }, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

  useEffect(() => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    const hasInteractiveOverlay = Boolean(selectedZoom || selectedAnnotationId);
    if (!hasInteractiveOverlay || workspaceInteractionLocked) {
      overlayEl.style.cursor = 'default';
      overlayEl.style.pointerEvents = 'none';
      return;
    }
    overlayEl.style.cursor = selectedZoom ? (isPlaying ? 'not-allowed' : 'grab') : 'default';
    overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
  }, [selectedZoom, selectedAnnotationId, isPlaying, workspaceInteractionLocked]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;

    resizeCursorCanvas();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      resizeCursorCanvas();
    });
    observer.observe(overlayEl);
    return () => {
      observer.disconnect();
    };
  }, [pixiReady, videoReady, resizeCursorCanvas]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const overlayEl = overlayRef.current;
    const canvas = cursorCanvasRef.current;
    if (!overlayEl || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    resizeCursorCanvas();

    const width = overlayEl.clientWidth;
    const height = overlayEl.clientHeight;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!cursorEnabled || !cursorTrack || cursorTrack.events.length === 0) {
      return;
    }

    // Get layout information to properly map cursor coordinates
    const maskRect = baseMaskRef.current;
    const cropBounds = cropBoundsRef.current;
    
    // Get current zoom state
    const animationState = animationStateRef.current;
    const zoomScale = animationState.scale;
    
    // When zoom is active, video is displayed full-screen, so use full overlay area
    // Otherwise, use maskRect (which represents the cropped/scaled video area)
    const displayArea = (zoomScale > 1)
      ? { x: 0, y: 0, width, height }  // Full overlay when zoomed
      : (maskRect.width > 0 && maskRect.height > 0 
          ? maskRect 
          : { x: 0, y: 0, width, height });

    const events = cursorTrack.events;
    const offsetFromStyle = cursorTrack.style?.offsetMs ?? DEFAULT_CURSOR_STYLE.offsetMs ?? 0;
    const styleOffsetX = cursorTrack.style?.offsetX ?? DEFAULT_CURSOR_STYLE.offsetX ?? 0;
    const styleOffsetY = cursorTrack.style?.offsetY ?? DEFAULT_CURSOR_STYLE.offsetY ?? 0;
    const playheadMs = Math.round(currentTime * 1000) + offsetFromStyle;
    const lastIndex = findLastIndex(events, playheadMs);
    if (lastIndex < 0) return;

    // Helper function to convert normalized video coordinates to display coordinates
    // Normalized coordinates (nx, ny) are relative to the full video dimensions (before crop)
    const normalizeToDisplay = (nx: number, ny: number) => {
      const lockedDims = lockedVideoDimensionsRef.current;
      // If we don't have locked video dimensions, fallback to simple mapping into displayArea
      if (!lockedDims || lockedDims.width === 0 || lockedDims.height === 0) {
        const displayX = displayArea.x + nx * displayArea.width;
        const displayY = displayArea.y + ny * displayArea.height;
        return { x: displayX, y: displayY };
      }

      const fullVideoWidth = lockedDims.width;
      const fullVideoHeight = lockedDims.height;

      // Convert normalized coords to full-video pixel coordinates
      const videoX = nx * fullVideoWidth;
      const videoY = ny * fullVideoHeight;

      // If there is a crop and the point is outside the cropped bounds, skip drawing
      if (cropBounds.endX > cropBounds.startX && cropBounds.endY > cropBounds.startY) {
        if (videoX < cropBounds.startX || videoX > cropBounds.endX ||
            videoY < cropBounds.startY || videoY > cropBounds.endY) {
          return null;
        }
      }

      // Map video pixel to stage coordinates using the same base sprite transform
      // stage = baseOffset + videoPixel * baseScale
      const baseScale = baseScaleRef.current;
      const baseOffset = baseOffsetRef.current;
      const stageSize = stageSizeRef.current;

      if (!stageSize.width || !stageSize.height || baseScale <= 0) {
        // Fallback to displayArea mapping if stage info not ready
        const displayX = displayArea.x + nx * displayArea.width;
        const displayY = displayArea.y + ny * displayArea.height;
        return { x: displayX, y: displayY };
      }

      const stageX = baseOffset.x + videoX * baseScale;
      const stageY = baseOffset.y + videoY * baseScale;

      // Apply camera transform used by Pixi: scale about the focus then translate so focus is centered.
      const focusX = animationState.focusX;
      const focusY = animationState.focusY;
      const zoom = zoomScale;

      const focusStagePxX = focusX * stageSize.width;
      const focusStagePxY = focusY * stageSize.height;

      const stageCenterX = stageSize.width / 2;
      const stageCenterY = stageSize.height / 2;

      const screenX = stageCenterX + (stageX - focusStagePxX) * zoom;
      const screenY = stageCenterY + (stageY - focusStagePxY) * zoom;

      return { x: screenX, y: screenY };
    };

    // Compute current cursor position. For end2end mode we derive position
    // from the detected endpoints (straight-line interpolation by time).
    const smoothing = cursorSmoothing || 'none';
    let x: number;
    let y: number;
    let dragging = false;

    if (smoothing === 'end2end' && end2endParams) {
      // Build display-space move events from the ENTIRE track (not limited to lastIndex).
      // Pause points require knowledge of subsequent motion beginnings, so we must
      // analyze the full event stream to correctly identify pause points.
      const displayEventsForCursor: { tMs: number; x: number; y: number; kind: any; dragging: boolean }[] = [];
      for (let i = 0; i < events.length; i += 1) {
        const ev = events[i];
        const pos = normalizeToDisplay(ev.nx, ev.ny);
        if (!pos) continue;
        displayEventsForCursor.push({ tMs: ev.tMs, x: pos.x + styleOffsetX, y: pos.y + styleOffsetY, kind: ev.kind, dragging: ev.dragging });
      }
      const pausePoints = extractPausePointsFromDisplayEvents(displayEventsForCursor, end2endParams);
      const arrivalFrac = typeof end2endParams.arrivalFraction === 'number' ? end2endParams.arrivalFraction : 1.0;
      const pos = evaluatePositionOnCRByTime(pausePoints, playheadMs, arrivalFrac);
      if (!pos) return;
      x = pos.x;
      y = pos.y;
      dragging = false;
    } else {
      const currentEvent = events[lastIndex];
      const displayPos = normalizeToDisplay(currentEvent.nx, currentEvent.ny);
      if (!displayPos) return; // Coordinate is outside visible area
      displayPos.x += styleOffsetX;
      displayPos.y += styleOffsetY;
      x = displayPos.x;
      y = displayPos.y;
      dragging = currentEvent.dragging;
    }
    
    const baseSize = Math.max(6, cursorTrack.style.sizePx);
    // Apply zoom scale to cursor size so it scales with the video
    const cursorSize = (dragging ? baseSize * 1.1 : baseSize) * zoomScale;

    // If playback is paused, draw the full cursor path so user can inspect smoothing
    const isPlaying = isPlayingRef.current;
    let trailStartIndex = 0;

    if (!isPlaying) {
      // Draw full path (or endpoints) when paused so user can inspect smoothing
      if (smoothing === 'end2end' && end2endParams) {
        // Build display-space move events
        const displayEvents: { tMs: number; x: number; y: number; kind: any; dragging: boolean }[] = [];
        for (let i = 0; i < events.length; i += 1) {
          const ev = events[i];
          const pos = normalizeToDisplay(ev.nx, ev.ny);
          if (!pos) continue;
          displayEvents.push({ tMs: ev.tMs, x: pos.x + styleOffsetX, y: pos.y + styleOffsetY, kind: ev.kind, dragging: ev.dragging });
        }
        const pausePoints = extractPausePointsFromDisplayEvents(displayEvents, end2endParams);
        if (pausePoints.length >= 2) {
          const sampled = sampleCRPath(pausePoints, 12);
          if (sampled.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(sampled[0].x, sampled[0].y);
            for (let k = 1; k < sampled.length; k += 1) {
              ctx.lineTo(sampled[k].x, sampled[k].y);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.22)';
            ctx.lineWidth = Math.max(1, baseSize * 0.08) * zoomScale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        }
      } else {
        // Draw full path of all events (visible ones)
        const pts: { x: number; y: number }[] = [];
          for (let i = 0; i < events.length; i += 1) {
          const ev = events[i];
          const pos = normalizeToDisplay(ev.nx, ev.ny);
          if (!pos) continue;
          pts.push({ x: pos.x + styleOffsetX, y: pos.y + styleOffsetY });
        }

        if (pts.length >= 2) {
          ctx.beginPath();
          if (smoothing === 'none') {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i += 1) {
              ctx.lineTo(pts[i].x, pts[i].y);
            }
          } else if (smoothing === 'quadratic') {
            const strength = typeof quadraticSmoothingStrength === 'number' ? quadraticSmoothingStrength : 0.5;
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i += 1) {
              const prev = pts[i - 1];
              const cur = pts[i];
              const midX = (prev.x + cur.x) / 2;
              const midY = (prev.y + cur.y) / 2;
              const ctrlX = prev.x + (cur.x - prev.x) * strength;
              const ctrlY = prev.y + (cur.y - prev.y) * strength;
              ctx.quadraticCurveTo(ctrlX, ctrlY, midX, midY);
            }
            ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          }

          ctx.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = Math.max(1, baseSize * 0.08) * zoomScale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        }
      }
    } else {
      const trailStartMs = Math.max(0, playheadMs - CURSOR_TRAIL_MS);
      trailStartIndex = Math.min(lastIndex, findFirstIndex(events, trailStartMs));

      if (lastIndex - trailStartIndex >= 1) {
        // Collect visible points for trail drawing
        if (smoothing === 'end2end' && end2endParams) {
          // Build display-space events for the trail window
        const displayEvents: { tMs: number; x: number; y: number; kind: any; dragging: boolean }[] = [];
        for (let i = trailStartIndex; i <= lastIndex; i += 1) {
          const ev = events[i];
          const pos = normalizeToDisplay(ev.nx, ev.ny);
          if (!pos) continue;
          displayEvents.push({ tMs: ev.tMs, x: pos.x + styleOffsetX, y: pos.y + styleOffsetY, kind: ev.kind, dragging: ev.dragging });
        }
        const pausePoints = extractPausePointsFromDisplayEvents(displayEvents, end2endParams);
        if (pausePoints.length >= 2) {
          const sampled = sampleCRPath(pausePoints, 10);
          if (sampled.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(sampled[0].x, sampled[0].y);
            for (let k = 1; k < sampled.length; k += 1) {
              ctx.lineTo(sampled[k].x, sampled[k].y);
            }
            ctx.strokeStyle = dragging ? 'rgba(52,178,123,0.55)' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = Math.max(1, baseSize * 0.12) * zoomScale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        }
        } else {
          // Collect visible points for trail drawing
          const pts: { x: number; y: number }[] = [];
          for (let i = trailStartIndex; i <= lastIndex; i += 1) {
            const ev = events[i];
            const pos = normalizeToDisplay(ev.nx, ev.ny);
            if (!pos) continue;
            pts.push({ x: pos.x + styleOffsetX, y: pos.y + styleOffsetY });
          }

          if (pts.length >= 2) {
            ctx.beginPath();
            if (smoothing === 'none') {
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i += 1) {
                ctx.lineTo(pts[i].x, pts[i].y);
              }
            } else if (smoothing === 'quadratic') {
              // Quadratic smoothing using midpoints with configurable strength
              const strength = typeof quadraticSmoothingStrength === 'number' ? quadraticSmoothingStrength : 0.5;
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i += 1) {
                const prev = pts[i - 1];
                const cur = pts[i];
                const midX = (prev.x + cur.x) / 2;
                const midY = (prev.y + cur.y) / 2;
                const ctrlX = prev.x + (cur.x - prev.x) * strength;
                const ctrlY = prev.y + (cur.y - prev.y) * strength;
                ctx.quadraticCurveTo(ctrlX, ctrlY, midX, midY);
              }
              // Ensure curve reaches last point
              ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
            }

            ctx.strokeStyle = dragging ? 'rgba(52,178,123,0.55)' : 'rgba(255,255,255,0.35)';
            ctx.lineWidth = Math.max(1, baseSize * 0.12) * zoomScale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        }
      }
    }

    if (CURSOR_CLICK_MS > 0) {
      const clickStartIndex = trailStartIndex;
      for (let i = clickStartIndex; i <= lastIndex; i += 1) {
        const ev = events[i];
        if (ev.kind !== 'down') continue;
        const elapsed = playheadMs - ev.tMs;
        if (elapsed < 0 || elapsed > CURSOR_CLICK_MS) continue;
        const progress = elapsed / CURSOR_CLICK_MS;
        const alpha = 1 - progress;
        const radius = baseSize * (0.5 + progress * 1.6) * zoomScale;
        const pos = normalizeToDisplay(ev.nx, ev.ny);
        if (!pos) continue; // Skip clicks outside visible area
        pos.x += styleOffsetX;
        pos.y += styleOffsetY;
        
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.7})`;
        ctx.lineWidth = Math.max(1, baseSize * 0.08) * zoomScale;
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    drawCursor(ctx, cursorTrack.style.preset, x, y, cursorSize, dragging);
    }, [pixiReady, videoReady, currentTime, cursorTrack, cursorEnabled, cursorSmoothing, quadraticSmoothingStrength, end2endParams, CURSOR_TRAIL_MS, CURSOR_CLICK_MS, resizeCursorCanvas, cropRegion, padding]);
  // Redraw cursor overlay when enabled/smoothing changes

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let app: Application | null = null;

    (async () => {
      app = new Application();
      
      await app.init({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      app.ticker.maxFPS = 60;

      if (!mounted) {
        app.destroy({ removeView: true });
        return;
      }

      appRef.current = app;
      app.stage.sortableChildren = true;
      container.appendChild(app.canvas);

      const workspaceContainer = new Container();
      workspaceContainer.sortableChildren = true;
      workspaceContainerRef.current = workspaceContainer;
      app.stage.addChild(workspaceContainer);

      // Camera container - this will be scaled/positioned for zoom
      const cameraContainer = new Container();
      cameraContainer.sortableChildren = true;
      cameraContainerRef.current = cameraContainer;
      workspaceContainer.addChild(cameraContainer);

      // Video container - holds the masked video sprite
      const videoContainer = new Container();
      videoContainer.zIndex = 0;
      videoContainerRef.current = videoContainer;
      cameraContainer.addChild(videoContainer);

      const clipRenderer = new ClipPixiRenderer(workspaceContainer);
      clipRenderer.setZIndex(1);
      clipRenderer.setAssets(videoAssetsRef.current);
      clipRenderer.syncClips(videoClipsRef.current);
      clipRenderer.setStageSize(stageSizeRef.current);
      clipRendererRef.current = clipRenderer;
      
      setPixiReady(true);
    })();

    return () => {
      mounted = false;
      setPixiReady(false);
      if (clipRendererRef.current) {
        clipRendererRef.current.destroy();
        clipRendererRef.current = null;
      }
      if (app && app.renderer) {
        app.destroy({ removeView: true });
      }
      appRef.current = null;
      workspaceContainerRef.current = null;
      cameraContainerRef.current = null;
      videoContainerRef.current = null;
      videoSpriteRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    allowPlaybackRef.current = false;
    lockedVideoDimensionsRef.current = null;
    setVideoReady(false);
    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }
  }, [videoPath]);



  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const video = videoRef.current;
    const app = appRef.current;
    const videoContainer = videoContainerRef.current;
    
    if (!video || !app || !videoContainer) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    const source = new VideoSource({ resource: video, autoPlay: false, autoLoad: false });
    source.load().catch(() => {});
    const videoTexture = Texture.from(source);
    
    const videoSprite = new Sprite(videoTexture);
    videoSpriteRef.current = videoSprite;
    
    const maskGraphics = new Graphics();
    videoContainer.addChild(videoSprite);
    videoContainer.addChild(maskGraphics);
    videoContainer.mask = maskGraphics;
    maskGraphicsRef.current = maskGraphics;
    videoContainer.visible = false;

    animationStateRef.current = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };

    const blurFilter = new BlurFilter();
    blurFilter.quality = 3;
    blurFilter.resolution = app.renderer.resolution;
    blurFilter.blur = 0;
    videoContainer.filters = [blurFilter];
    blurFilterRef.current = blurFilter;
    
    layoutVideoContent();
    video.pause();

    const {
      handlePlay,
      handlePause: handlePauseBase,
      handleSeeked: handleSeekedBase,
      handleSeeking: handleSeekingBase,
    } = createVideoEventHandlers({
      video,
      isSeekingRef,
      isPlayingRef,
      allowPlaybackRef,
      currentTimeRef,
      timeUpdateAnimationRef,
      onPlayStateChange,
      onTimeUpdate,
      trimRegionsRef,
      onSeekActivity: () => {
        seekSnapUntilRef.current = performance.now() + 200;
      },
      mapSourceToTimelineMs: mapRecordingSourceToTimelineMs,
      mapTimelineToSourceMs: mapTimelineToRecordingSourceMs,
      getPlaybackRateForTimelineMs: getRecordingPlaybackRateForTimelineMs,
    });

    const handlePause = () => {
      const pinnedTimelineMs = extendedSeekTargetRef.current ?? gapSeekTargetRef.current;
      if (shouldIgnoreNativePauseForExtendedPlayback()) {
        return;
      }
      cancelExtendedPlayback();
      handlePauseBase();
      if (pinnedTimelineMs !== null) {
        currentTimeRef.current = pinnedTimelineMs;
        onTimeUpdate(pinnedTimelineMs / 1000);
      }
    };

    const handleSeeked = () => {
      const pinnedTimelineMs = extendedSeekTargetRef.current ?? gapSeekTargetRef.current;
      if (pinnedTimelineMs !== null) {
        cancelExtendedPlayback();
        currentTimeRef.current = pinnedTimelineMs;
        onTimeUpdate(pinnedTimelineMs / 1000);
        return;
      }
      cancelExtendedPlayback();
      handleSeekedBase();
    };

    const handleSeeking = () => {
      const pinnedTimelineMs = extendedSeekTargetRef.current ?? gapSeekTargetRef.current;
      if (pinnedTimelineMs !== null) {
        cancelExtendedPlayback();
        currentTimeRef.current = pinnedTimelineMs;
        onTimeUpdate(pinnedTimelineMs / 1000);
        return;
      }
      cancelExtendedPlayback();
      handleSeekingBase();
    };

    const handleEnded = () => {
      const clipEndMs = clipEndMsRef.current;
      const videoDurationMs = videoDurationMsRef.current || Math.round(video.duration * 1000);
      const shouldExtend = clipEndMs > videoDurationMs;

      if (shouldExtend && isPlayingRef.current) {
        const startMs = currentTimeRef.current > videoDurationMs ? currentTimeRef.current : videoDurationMs;
        startExtendedPlayback(startMs, clipEndMs);
        return;
      }

      handlePause();
    };
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeking);
    
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeking);
      cancelExtendedPlayback();
      
      if (timeUpdateAnimationRef.current) {
        cancelAnimationFrame(timeUpdateAnimationRef.current);
      }
      
      if (videoSprite) {
        videoContainer.removeChild(videoSprite);
        videoSprite.destroy();
      }
      if (maskGraphics) {
        videoContainer.removeChild(maskGraphics);
        maskGraphics.destroy();
      }
      videoContainer.mask = null;
      maskGraphicsRef.current = null;
      if (blurFilterRef.current) {
        videoContainer.filters = [];
        blurFilterRef.current.destroy();
        blurFilterRef.current = null;
      }
      videoTexture.destroy(true);
      
      videoSpriteRef.current = null;
    };
  }, [pixiReady, videoReady, onTimeUpdate, onPlayStateChange, updateOverlayForRegion, cancelExtendedPlayback, startExtendedPlayback, shouldIgnoreNativePauseForExtendedPlayback]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const videoContainer = videoContainerRef.current;
    if (!app || !videoSprite || !videoContainer) return;

    const applyTransform = (motionIntensity: number) => {
      const cameraContainer = cameraContainerRef.current;
      if (!cameraContainer) return;

      const state = animationStateRef.current;

      applyZoomTransform({
        cameraContainer,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        baseMask: baseMaskRef.current,
        zoomScale: state.scale,
        focusX: state.focusX,
        focusY: state.focusY,
        motionIntensity,
        isPlaying: isPlayingRef.current,
        motionBlurEnabled: motionBlurEnabledRef.current,
      });

      const renderer = clipRendererRef.current;
      if (renderer) {
        renderer.setCameraTransform({
          scale: state.scale,
          focusX: state.focusX,
          focusY: state.focusY,
        });
        const recordingClip = videoClipsRef.current.find(isRecordingClip);
        const blurFilter = blurFilterRef.current;
        if (recordingClip && blurFilter) {
          const item = renderer.getClipItem(recordingClip.id);
          if (item && item.content.filters?.[0] !== blurFilter) {
            item.content.filters = [blurFilter];
          }
        }
      }
    };

    let tickerLogThrottle = 0;
    const TICKER_LOG_INTERVAL_MS = 50;

    const ticker = () => {
      const timeMs = currentTimeRef.current;
      clipRendererRef.current?.update(timeMs, isPlayingRef.current, selectedClipIdRef.current);
      const lastTimeMs = lastTickTimeMsRef.current;
      const hasTimeJump = lastTimeMs !== null && Math.abs(timeMs - lastTimeMs) > 200;
      const nowPerf = performance.now();
      const isScrubbing = nowPerf < seekSnapUntilRef.current;
      const shouldLogTicker = nowPerf - tickerLogThrottle > TICKER_LOG_INTERVAL_MS;

      const { region, strength } = findDominantRegion(zoomRegionsRef.current, timeMs);
      const effectState = computeEffectState(effectRegionsRef.current, timeMs);
      effectStateRef.current = effectState;
      
      const defaultFocus = DEFAULT_FOCUS;
      let targetScaleFactor = 1;
      let targetFocus = defaultFocus;

      // If a zoom is selected but video is not playing, show default unzoomed view
      // (the overlay will show where the zoom will be)
      const selectedId = selectedZoomIdRef.current;
      const hasSelectedZoom = selectedId !== null;
      const shouldShowUnzoomedView = hasSelectedZoom && !isPlayingRef.current;

      if (region && strength > 0 && !shouldShowUnzoomedView) {
        const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
        const regionFocus = clampFocusToStage(region.focus, region.depth);
        
        // Interpolate scale and focus based on region strength
        targetScaleFactor = 1 + (zoomScale - 1) * strength;
        targetFocus = {
          cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
          cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
        };
      }

      // Apply zoom-follow behavior if enabled (read from refs or global fallback)
      const followEnabled = Boolean(zoomFollowEnabledRef.current || (typeof window !== 'undefined' && (window as any).__openscreen_zoomFollowEnabled));
      // Only enable follow when parent/global follow is enabled AND there is an active
      // zoom region (strength > 0). This ensures we only follow during zoom and its
      // fade-in/fade-out period.
      if (followEnabled && region && strength > 0 && cursorTrack && cursorTrack.events && cursorTrack.events.length > 0) {
        try {
          // Debug logging when enabled
          try {
            if ((window as any).__openscreen_debugZoomFollow) {
              console.debug('[zoomFollow] enabled', { followEnabled, zoomFollowMode: zoomFollowModeRef.current, selectedId: selectedZoomIdRef.current, region, strength, targetScaleFactor });
            }
          } catch {}
          const events = cursorTrack.events;
          const offsetFromStyle = cursorTrack.style?.offsetMs ?? DEFAULT_CURSOR_STYLE.offsetMs ?? 0;
          const playheadMs = Math.round(currentTimeRef.current) + offsetFromStyle;

          // Compute a smoothed follow target even if playhead is outside immediate event bounds.
          const stageSize = stageSizeRef.current;
          if (events.length > 0 && stageSize.width && stageSize.height) {
            // Default followTarget is the current region targetFocus
            let followTarget = { cx: targetFocus.cx, cy: targetFocus.cy };
            const smoothingMode = cursorSmoothingRef.current || 'none';

            if (smoothingMode === 'end2end' && end2endParamsRefLocal.current) {
              const displayEventsForCursor: { tMs: number; x: number; y: number; kind: any; dragging: boolean }[] = [];
              for (let i = 0; i < events.length; i += 1) {
                const ev = events[i];
                const pos = getStageCoordsFromNormalized(ev.nx, ev.ny);
                if (!pos) continue;
                displayEventsForCursor.push({
                  tMs: ev.tMs,
                  x: pos.stageX + (cursorTrack.style?.offsetX ?? DEFAULT_CURSOR_STYLE.offsetX ?? 0),
                  y: pos.stageY + (cursorTrack.style?.offsetY ?? DEFAULT_CURSOR_STYLE.offsetY ?? 0),
                  kind: ev.kind,
                  dragging: ev.dragging,
                });
              }
              const pausePoints = extractPausePointsFromDisplayEvents(displayEventsForCursor, end2endParamsRefLocal.current);
              const arrivalFrac = typeof end2endParamsRefLocal.current.arrivalFraction === 'number' ? end2endParamsRefLocal.current.arrivalFraction : 1.0;
              const evaluated = evaluatePositionOnCRByTime(pausePoints, playheadMs, arrivalFrac);
              if (evaluated) {
                followTarget = { cx: clamp01(evaluated.x / stageSize.width), cy: clamp01(evaluated.y / stageSize.height) };
              } else {
                // Fallback to last-known event position
                const lastIdx = findLastIndex(events, playheadMs);
                if (lastIdx >= 0) {
                  const pos = getStageCoordsFromNormalized(events[lastIdx].nx, events[lastIdx].ny);
                  if (pos) followTarget = { cx: clamp01(pos.stageX / stageSize.width), cy: clamp01(pos.stageY / stageSize.height) };
                }
              }
            } else if (smoothingMode === 'quadratic') {
              const lastIdx = findLastIndex(events, playheadMs);
              const strength = typeof quadraticStrengthRef.current === 'number' ? quadraticStrengthRef.current : 0.5;
              const windowSize = Math.max(1, Math.round(1 + strength * 6));
              const startIdx = Math.max(0, (lastIdx >= 0 ? lastIdx : events.length - 1) - windowSize + 1);
              let sumX = 0;
              let sumY = 0;
              let cnt = 0;
              for (let i = startIdx; i < events.length && i <= startIdx + windowSize; i += 1) {
                const ev = events[i];
                const pos = getStageCoordsFromNormalized(ev.nx, ev.ny);
                if (!pos) continue;
                const w = 1 + (i - startIdx);
                sumX += pos.stageX * w;
                sumY += pos.stageY * w;
                cnt += w;
              }
              if (cnt > 0) {
                const avgX = sumX / cnt;
                const avgY = sumY / cnt;
                followTarget = { cx: clamp01(avgX / stageSize.width), cy: clamp01(avgY / stageSize.height) };
              } else {
                const lastIdx2 = findLastIndex(events, playheadMs);
                if (lastIdx2 >= 0) {
                  const pos = getStageCoordsFromNormalized(events[lastIdx2].nx, events[lastIdx2].ny);
                  if (pos) followTarget = { cx: clamp01(pos.stageX / stageSize.width), cy: clamp01(pos.stageY / stageSize.height) };
                }
              }
            } else {
              // none: use interpolated normalized position if possible
              const lastIdx = findLastIndex(events, playheadMs);
              if (lastIdx >= 0) {
                let nx = events[lastIdx].nx;
                let ny = events[lastIdx].ny;
                const nextEv = events[lastIdx + 1];
                const curEv = events[lastIdx];
                if (nextEv && nextEv.tMs > curEv.tMs) {
                  const frac = Math.max(0, Math.min(1, (playheadMs - curEv.tMs) / (nextEv.tMs - curEv.tMs)));
                  nx = curEv.nx + (nextEv.nx - curEv.nx) * frac;
                  ny = curEv.ny + (nextEv.ny - curEv.ny) * frac;
                }
                const pos = getStageCoordsFromNormalized(nx, ny);
                if (pos) followTarget = { cx: clamp01(pos.stageX / stageSize.width), cy: clamp01(pos.stageY / stageSize.height) };
              }
            }

            const followMode = zoomFollowModeRef.current || (typeof window !== 'undefined' && (window as any).__openscreen_zoomFollowMode) || 'center';
            if (followMode === 'center') {
              targetFocus = followTarget;
            } else {
              // Anchor mode: adjust anchor when cursor near edge
              if (!followAnchorRef.current) {
                followAnchorRef.current = { cx: followTarget.cx, cy: followTarget.cy };
              }
              const anchor = followAnchorRef.current;
              const anchorStageX = anchor.cx * stageSize.width;
              const anchorStageY = anchor.cy * stageSize.height;
              const zoom = targetScaleFactor;
              const viewW = Math.max(1, stageSize.width / zoom);
              const viewH = Math.max(1, stageSize.height / zoom);
              const pad = zoomFollowMinPaddingPxRef.current ?? (typeof window !== 'undefined' ? (window as any).__openscreen_zoomFollowMinPaddingPx ?? 24 : 24);

              let newAnchorStageX = anchorStageX;
              let newAnchorStageY = anchorStageY;
              const cursorStageX = followTarget.cx * stageSize.width;
              const cursorStageY = followTarget.cy * stageSize.height;

              const left = anchorStageX - viewW / 2 + pad;
              const right = anchorStageX + viewW / 2 - pad;
              if (cursorStageX < left) {
                newAnchorStageX = cursorStageX + viewW / 2 - pad;
              } else if (cursorStageX > right) {
                newAnchorStageX = cursorStageX - viewW / 2 + pad;
              }

              const top = anchorStageY - viewH / 2 + pad;
              const bottom = anchorStageY + viewH / 2 - pad;
              if (cursorStageY < top) {
                newAnchorStageY = cursorStageY + viewH / 2 - pad;
              } else if (cursorStageY > bottom) {
                newAnchorStageY = cursorStageY - viewH / 2 + pad;
              }

              const clampedX = clamp01(newAnchorStageX / stageSize.width);
              const clampedY = clamp01(newAnchorStageY / stageSize.height);
              followAnchorRef.current = { cx: clampedX, cy: clampedY };
              targetFocus = { cx: clampedX, cy: clampedY };
            }
          }
        } catch (err) {
          // swallow errors in optional follow logic
        }
      } else {
        // Not following right now: clear any existing anchor so we don't persist an
        // anchored follow once the zoom region exits.
        followAnchorRef.current = null;
      }

      const state = animationStateRef.current;

      const shouldSnap = isSeekingRef.current || !isPlayingRef.current || hasTimeJump || isScrubbing;

      // Debug logging for ticker state - only log once per timeMs when there's actual change
      const hasZoomChange = Math.abs(targetScaleFactor - state.scale) > 0.001 ||
                           Math.abs(targetFocus.cx - state.focusX) > 0.001 ||
                           Math.abs(targetFocus.cy - state.focusY) > 0.001;
      const roundedTimeMs = Math.round(timeMs);
      const lastTickerLogTime = (window as any).__lastTickerLogTime ?? -1;
      const isNewTime = roundedTimeMs !== lastTickerLogTime;
      if (shouldLogTicker && isOverlayDebugEnabled() && isNewTime && (hasZoomChange || hasTimeJump)) {
        tickerLogThrottle = nowPerf;
        (window as any).__lastTickerLogTime = roundedTimeMs;
        
        // Get overlay layer and positions
        const overlayLayer = clipVideoLayerRef.current;
        const stageW = overlayLayer?.clientWidth || 0;
        const stageH = overlayLayer?.clientHeight || 0;
        const overlayEls = overlayLayer?.querySelectorAll('[data-clip-id]') || [];
        const overlayPositions: Record<string, { cssLeft: number; cssTop: number; domLeft: number; domTop: number }> = {};
        overlayEls.forEach((el) => {
          const id = el.getAttribute('data-clip-id');
          if (id) {
            const htmlEl = el as HTMLElement;
            const rect = el.getBoundingClientRect();
            const parentRect = overlayLayer?.getBoundingClientRect();
            overlayPositions[id] = {
              cssLeft: parseFloat(htmlEl.style.left) || 0,
              cssTop: parseFloat(htmlEl.style.top) || 0,
              domLeft: Number((rect.left - (parentRect?.left || 0)).toFixed(1)),
              domTop: Number((rect.top - (parentRect?.top || 0)).toFixed(1)),
            };
          }
        });
        
        logOverlayDebugExpanded('[Clip Debug][ticker]', {
          timeMs: roundedTimeMs,
          hasTimeJump,
          hasZoomChange,
          zoomRegion: region ? { id: region.id, depth: region.depth, focus: region.focus } : null,
          strength: Number(strength.toFixed(3)),
          target: { scale: Number(targetScaleFactor.toFixed(4)), focusX: Number(targetFocus.cx.toFixed(4)), focusY: Number(targetFocus.cy.toFixed(4)) },
          current: { scale: Number(state.scale.toFixed(4)), focusX: Number(state.focusX.toFixed(4)), focusY: Number(state.focusY.toFixed(4)) },
          overlayTransform: overlayLayer?.style.transform || 'none',
          stage: { w: stageW, h: stageH },
          overlays: overlayPositions,
        });
      }

      if (shouldSnap) {
        if (hasTimeJump || isScrubbing) {
          followAnchorRef.current = null;
        }
        state.scale = targetScaleFactor;
        state.focusX = targetFocus.cx;
        state.focusY = targetFocus.cy;
        applyTransform(0);
        applyScreenOffsetToVideo();
        applyEffectTransform(effectState);
        applyZoomToOverlays();
        lastTickTimeMsRef.current = timeMs;
        return;
      }

      const prevScale = state.scale;
      const prevFocusX = state.focusX;
      const prevFocusY = state.focusY;

      const scaleDelta = targetScaleFactor - state.scale;
      const focusXDelta = targetFocus.cx - state.focusX;
      const focusYDelta = targetFocus.cy - state.focusY;

      let nextScale = prevScale;
      let nextFocusX = prevFocusX;
      let nextFocusY = prevFocusY;

      if (Math.abs(scaleDelta) > MIN_DELTA) {
        nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
      } else {
        nextScale = targetScaleFactor;
      }

      if (Math.abs(focusXDelta) > MIN_DELTA) {
        nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusX = targetFocus.cx;
      }

      if (Math.abs(focusYDelta) > MIN_DELTA) {
        nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusY = targetFocus.cy;
      }

      state.scale = nextScale;
      state.focusX = nextFocusX;
      state.focusY = nextFocusY;

      const motionIntensity = Math.max(
        Math.abs(nextScale - prevScale),
        Math.abs(nextFocusX - prevFocusX),
        Math.abs(nextFocusY - prevFocusY)
      );

      applyTransform(motionIntensity);
      applyScreenOffsetToVideo();
      applyEffectTransform(effectState);
      applyZoomToOverlays();
      lastTickTimeMsRef.current = timeMs;
    };

    app.ticker.add(ticker);
    return () => {
      if (app && app.ticker) {
        app.ticker.remove(ticker);
      }
    };
  }, [pixiReady, videoReady, clampFocusToStage, applyEffectTransform, applyZoomToOverlays, applyScreenOffsetToVideo, logOverlayDebugExpanded]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const currentMs = currentTime * 1000;
    const targetRate = getRecordingPlaybackRateForTimelineMs(currentMs);
    if (video.playbackRate !== targetRate) {
      video.playbackRate = targetRate;
    }
  }, [currentTime, getRecordingPlaybackRateForTimelineMs]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    onDurationChange(video.duration);
    videoDurationMsRef.current = Math.max(0, video.duration * 1000);
    video.currentTime = 0;
    video.pause();
    allowPlaybackRef.current = false;
    currentTimeRef.current = 0;

    if (videoReadyRafRef.current) {
      cancelAnimationFrame(videoReadyRafRef.current);
      videoReadyRafRef.current = null;
    }

    const waitForRenderableFrame = () => {
      const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
      const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (hasDimensions && hasData) {
        videoReadyRafRef.current = null;
        setVideoReady(true);
        return;
      }
      videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
    };

    videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
  };

  const timeMs = Math.round(currentTime * 1000);
  const activeBackgroundItem = useMemo(
    () => resolveActiveBackgroundItem(backgroundItems, timeMs),
    [backgroundItems, timeMs],
  );
  const activeBackgroundRawSource = useMemo(
    () => getBackgroundItemSource(activeBackgroundItem, videoAssets),
    [activeBackgroundItem, videoAssets],
  );
  const activeBackgroundSource = useMemo(
    () => activeBackgroundRawSource ?? (backgroundItems.length === 0 ? (wallpaper ?? DEFAULT_BACKGROUND_VALUE) : null),
    [activeBackgroundRawSource, backgroundItems.length, wallpaper],
  );
  const activeBackgroundAsset = useMemo(
    () => (activeBackgroundItem?.assetId ? videoAssets.find((asset) => asset.id === activeBackgroundItem.assetId) ?? null : null),
    [activeBackgroundItem, videoAssets],
  );
  const activeBackgroundDurationMs = useMemo(() => {
    if (!activeBackgroundItem) {
      return 0;
    }
    if (activeBackgroundAsset?.durationMs && activeBackgroundAsset.durationMs > 0) {
      return activeBackgroundAsset.durationMs;
    }
    return Math.max(0, activeBackgroundItem.endMs - activeBackgroundItem.startMs);
  }, [activeBackgroundAsset, activeBackgroundItem]);
  const activeBackgroundFit = activeBackgroundItem?.fit ?? 'cover';
  const activeBackgroundBlurAmount = activeBackgroundItem?.blurAmount ?? (backgroundItems.length === 0 && showBlur ? 2 : 0);
  const activeBackgroundBackdropColor = activeBackgroundItem?.backdropColor ?? DEFAULT_BACKGROUND_BACKDROP_COLOR;
  const activeBackgroundAccentColor = activeBackgroundItem?.accentColor ?? DEFAULT_BACKGROUND_ACCENT_COLOR;
  const activeRetroGridAngle = activeBackgroundItem?.retroGridAngle ?? DEFAULT_RETRO_GRID_ANGLE;
  const activeRetroGridDensity = activeBackgroundItem?.retroGridDensity ?? DEFAULT_RETRO_GRID_DENSITY;
  const activeRippleSpeed = activeBackgroundItem?.rippleSpeed ?? DEFAULT_RIPPLE_SPEED;
  const activeRippleCount = activeBackgroundItem?.rippleCount ?? DEFAULT_RIPPLE_COUNT;
  const [resolvedBackgroundSource, setResolvedBackgroundSource] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (!activeBackgroundSource) {
          if (mounted) setResolvedBackgroundSource(null)
          return
        }

        if (activeBackgroundSource === MAGICUI_RETRO_GRID_VALUE) {
          if (mounted) setResolvedBackgroundSource(activeBackgroundSource)
          return
        }

        if (activeBackgroundSource === MAGICUI_RIPPLE_VALUE) {
          if (mounted) setResolvedBackgroundSource(activeBackgroundSource)
          return
        }

        if (activeBackgroundSource.startsWith('#') || activeBackgroundSource.startsWith('linear-gradient') || activeBackgroundSource.startsWith('radial-gradient')) {
          if (mounted) setResolvedBackgroundSource(activeBackgroundSource)
          return
        }

        // If it's a data URL (custom uploaded image), use as-is
        if (activeBackgroundSource.startsWith('data:')) {
          if (mounted) setResolvedBackgroundSource(activeBackgroundSource)
          return
        }

        // If it's an absolute web/http or file path, use as-is
        if (activeBackgroundSource.startsWith('http') || activeBackgroundSource.startsWith('file://') || activeBackgroundSource.startsWith('/')) {
          // If it's an absolute server path (starts with '/'), resolve via getAssetPath as well
          if (activeBackgroundSource.startsWith('/')) {
            const rel = activeBackgroundSource.replace(/^\//, '')
            const p = await getAssetPath(rel)
            if (mounted) setResolvedBackgroundSource(p)
            return
          }
          if (mounted) setResolvedBackgroundSource(activeBackgroundSource)
          return
        }
        const p = await getAssetPath(activeBackgroundSource.replace(/^\//, ''))
        if (mounted) setResolvedBackgroundSource(p)
      } catch (err) {
        if (mounted) setResolvedBackgroundSource(activeBackgroundSource || null)
      }
    })()
    return () => { mounted = false }
  }, [activeBackgroundSource])

  useEffect(() => {
    return () => {
      if (videoReadyRafRef.current) {
        cancelAnimationFrame(videoReadyRafRef.current);
        videoReadyRafRef.current = null;
      }
    };
  }, [])

  const videoAssetMap = useMemo(
    () => new Map(videoAssets.map((asset) => [asset.id, asset])),
    [videoAssets],
  );
  const isBackgroundVideo = Boolean(activeBackgroundItem?.kind === 'video' && activeBackgroundRawSource && resolvedBackgroundSource);
  const isRetroGridBackground = activeBackgroundSource === MAGICUI_RETRO_GRID_VALUE;
  const isRippleBackground = activeBackgroundSource === MAGICUI_RIPPLE_VALUE;
  const isImageUrl = Boolean(
    !isRetroGridBackground &&
    !isRippleBackground &&
    !isBackgroundVideo &&
    resolvedBackgroundSource &&
    (
      resolvedBackgroundSource.startsWith('file://') ||
      resolvedBackgroundSource.startsWith('http') ||
      resolvedBackgroundSource.startsWith('/') ||
      resolvedBackgroundSource.startsWith('data:')
    ),
  );
  const backgroundStyle = isImageUrl
    ? {
        backgroundImage: `url(${resolvedBackgroundSource || ''})`,
        backgroundSize: activeBackgroundFit,
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#000000',
      }
    : { background: resolvedBackgroundSource || '#000000' };

  const syncBackgroundVideoElement = useCallback((video: HTMLVideoElement | null) => {
    if (!video) {
      return;
    }

    if (!isBackgroundVideo || !activeBackgroundItem || !resolvedBackgroundSource) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    const localTimelineMs = Math.max(0, timeMs - activeBackgroundItem.startMs);
    const maxPlayableMs = activeBackgroundDurationMs > 0
      ? Math.max(0, activeBackgroundDurationMs - 16)
      : localTimelineMs;
    const targetTimeSeconds = Math.max(0, Math.min(localTimelineMs, maxPlayableMs)) / 1000;
    const shouldPlay = isPlaying && (activeBackgroundDurationMs <= 0 || localTimelineMs < activeBackgroundDurationMs - 16);
    const syncThresholdSeconds = shouldPlay ? 0.15 : 0.05;

    try {
      if (Math.abs((video.currentTime || 0) - targetTimeSeconds) > syncThresholdSeconds) {
        video.currentTime = targetTimeSeconds;
      }
    } catch {
      // Ignore seek races while the source is still loading.
    }

    if (shouldPlay) {
      void video.play().catch(() => {
        // Ignore autoplay and decode failures in the editor preview.
      });
    } else if (!video.paused) {
      video.pause();
    }
  }, [activeBackgroundDurationMs, activeBackgroundItem, isBackgroundVideo, isPlaying, resolvedBackgroundSource, timeMs]);

  useEffect(() => {
    const video = backgroundVideoRef.current;
    syncBackgroundVideoElement(video);
  }, [syncBackgroundVideoElement]);
  useEffect(() => {
    currentTimeRef.current = currentTime * 1000;
  }, [currentTime]);

  useEffect(() => {
    const pinnedGapMs = gapSeekTargetRef.current;
    if (pinnedGapMs === null) {
      return;
    }

    const currentTimelineMs = Math.round(currentTime * 1000);
    if (Math.abs(currentTimelineMs - pinnedGapMs) <= 1) {
      return;
    }

    gapSeekTargetRef.current = null;
  }, [currentTime]);

  useEffect(() => {
    clipEndMsRef.current = videoClips.reduce((max, region) => Math.max(max, region.endMs), 0);
  }, [videoClips]);

  // Debug: Log overlay region enter/exit events
  useEffect(() => {
    if (!isOverlayDebugEnabled()) return;
    const next = new Map<string, boolean>();
    for (const region of videoClips) {
      const active = timeMs >= region.startMs && timeMs <= region.endMs;
      next.set(region.id, active);
      const prev = overlayDebugStateRef.current.get(region.id) ?? false;
      if (prev !== active) {
        logOverlayDebug(active ? 'region-enter' : 'region-exit', {
          regionId: region.id,
          timeMs,
          startMs: region.startMs,
          endMs: region.endMs,
          zoomScale: animationStateRef.current.scale,
          focusX: animationStateRef.current.focusX,
          focusY: animationStateRef.current.focusY,
        });
      }
    }
    overlayDebugStateRef.current = next;
  }, [logOverlayDebug, videoClips, timeMs]);

  // Debug: Log only when timeline position changes significantly
  const lastDebugTimeMsRef = useRef<number | null>(null);
  useEffect(() => {
    const debugMode = getOverlayDebugMode();
    if (debugMode === 'off') return;
    
    // Only log when timeMs changes by at least 1ms
    const lastTime = lastDebugTimeMsRef.current;
    if (lastTime !== null && Math.abs(timeMs - lastTime) < 1) return;
    lastDebugTimeMsRef.current = timeMs;

    const overlayLayer = clipVideoLayerRef.current;
    const stageWidth = overlayLayer?.clientWidth || 0;
    const stageHeight = overlayLayer?.clientHeight || 0;

    // Get actual DOM positions of overlay elements with detailed transform info
    const overlayElements = overlayLayer?.querySelectorAll('[data-clip-id]') || [];
    const domPositions: Record<string, { 
      relLeft: number; relTop: number; width: number; height: number;
      transform: string; computedTransform: string;
      layerRect: { left: number; top: number };
      elRect: { left: number; top: number };
    }> = {};
    const layerRect = overlayLayer?.getBoundingClientRect();
    overlayElements.forEach((el) => {
      const id = el.getAttribute('data-clip-id');
      if (id) {
        const htmlEl = el as HTMLElement;
        const rect = el.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(htmlEl);
        domPositions[id] = {
          relLeft: Number((rect.left - (layerRect?.left || 0)).toFixed(1)),
          relTop: Number((rect.top - (layerRect?.top || 0)).toFixed(1)),
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
          transform: htmlEl.style.transform || 'none',
          computedTransform: computedStyle.transform || 'none',
          layerRect: { left: Number((layerRect?.left || 0).toFixed(1)), top: Number((layerRect?.top || 0).toFixed(1)) },
          elRect: { left: Number(rect.left.toFixed(1)), top: Number(rect.top.toFixed(1)) },
        };
      }
    });

    const activeOverlays = videoClips
      .filter((region) => timeMs >= region.startMs && timeMs <= region.endMs)
      .map((region) => {
        const expectedX = (region.position.x / 100) * stageWidth;
        const expectedY = (region.position.y / 100) * stageHeight;
        const dom = domPositions[region.id];
        const deltaX = dom ? Number((dom.relLeft - expectedX).toFixed(1)) : null;
        const deltaY = dom ? Number((dom.relTop - expectedY).toFixed(1)) : null;
        return {
          id: region.id,
          expectedPx: { x: Number(expectedX.toFixed(1)), y: Number(expectedY.toFixed(1)) },
          dom: dom ? {
            relPos: { x: dom.relLeft, y: dom.relTop },
            delta: { x: deltaX, y: deltaY },
            transform: dom.computedTransform,
            layerRect: dom.layerRect,
            elRect: dom.elRect,
          } : null,
          timing: { start: region.startMs, end: region.endMs },
        };
      });

    const { region: dominantZoom, strength } = findDominantRegion(zoomRegions, timeMs);
    const effectState = effectStateRef.current;

    logOverlayDebugExpanded('[Clip Debug][scrub]', {
      timeMs,
      stage: { width: stageWidth, height: stageHeight },
      zoom: {
        scale: Number(animationStateRef.current.scale.toFixed(4)),
        focusX: Number(animationStateRef.current.focusX.toFixed(4)),
        focusY: Number(animationStateRef.current.focusY.toFixed(4)),
      },
      dominantZoom: dominantZoom
        ? { id: dominantZoom.id, strength: Number(strength.toFixed(3)), depth: dominantZoom.depth, focus: dominantZoom.focus }
        : null,
      effect: effectState ? {
        skewX: Number((effectState.skewX || 0).toFixed(3)),
        skewY: Number((effectState.skewY || 0).toFixed(3)),
        tiltXDeg: Number((effectState.tiltXDeg || 0).toFixed(3)),
        tiltYDeg: Number((effectState.tiltYDeg || 0).toFixed(3)),
        roll: Number((effectState.roll || 0).toFixed(3)),
        scale: Number((effectState.scale || 1).toFixed(3)),
        offsetX: Number((effectState.offsetX || 0).toFixed(1)),
        offsetY: Number((effectState.offsetY || 0).toFixed(1)),
      } : null,
      overlayTransform: overlayLayer?.style.transform || 'none',
      activeOverlays,
    });
  }, [getOverlayDebugMode, videoClips, timeMs, zoomRegions, logOverlayDebugExpanded]);

  const getActiveAnnotations = (layer?: 'foreground' | 'midground') => {
    const filtered = (annotationRegions || []).filter((annotation) => {
      if (typeof annotation.startMs !== 'number' || typeof annotation.endMs !== 'number') return false;
      const annLayer = annotation.layer || 'foreground';
      if (layer && annLayer !== layer) return false;

      if (annotation.id === selectedAnnotationId) return true;
      return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
    });

    return [...filtered].sort((a, b) => a.zIndex - b.zIndex);
  };

  const activeClipRegions = useMemo(() => {
    if (!videoClips.length) return [];
    return videoClips
      .filter((clip) => timeMs >= clip.startMs && timeMs <= clip.endMs)
      .sort((a, b) => a.zIndex - b.zIndex);
  }, [videoClips, timeMs]);

  const shadowFilter = (showShadow && shadowIntensity > 0)
    ? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
    : 'none';
  const previewWorkspaceInsetPercent = ((1 - previewWorkspaceScale) / 2) * 100;
  const stageTranslation = `translate(${previewStageRect.x}px, ${previewStageRect.y}px)`;
  const workspaceViewStyle = {
    transform: `translate(${workspaceView.panX}px, ${workspaceView.panY}px) scale(${workspaceView.zoom})`,
    transformOrigin: 'center center',
  } satisfies React.CSSProperties;
  const stageWrapperStyle = {
    transform: stageTranslation,
    transformOrigin: 'top left',
  } satisfies React.CSSProperties;
  const safeFrameStyle: React.CSSProperties = previewStageRect.width > 0 && previewStageRect.height > 0
    ? {
        left: previewStageRect.x,
        top: previewStageRect.y,
        width: previewStageRect.width,
        height: previewStageRect.height,
      }
    : {
        left: `${previewWorkspaceInsetPercent}%`,
        top: `${previewWorkspaceInsetPercent}%`,
        width: `${previewWorkspaceScale * 100}%`,
        height: `${previewWorkspaceScale * 100}%`,
      };

  return (
    <div
      ref={workspaceViewportRef}
      className="relative rounded-sm overflow-hidden"
      tabIndex={0}
      style={{
        width: '100%',
        aspectRatio: formatAspectRatioForCSS(aspectRatio),
        cursor: workspacePanEnabled ? (isWorkspacePanning ? 'grabbing' : 'grab') : 'default',
        touchAction: 'none',
      }}
      onFocus={() => setWorkspaceFocused(true)}
      onBlur={() => {
        setWorkspaceFocused(false);
        setSpacePanActive(false);
        workspacePanSessionRef.current = null;
        pinchSessionRef.current = null;
        activePointerPositionsRef.current.clear();
        setIsWorkspacePanning(false);
      }}
      onPointerEnter={() => setWorkspaceHovered(true)}
      onPointerDown={handleWorkspacePointerDown}
      onPointerMove={handleWorkspacePointerMove}
      onPointerLeave={(event) => {
        setWorkspaceHovered(false);
        endWorkspacePan(event);
      }}
      onPointerUp={endWorkspacePan}
      onPointerCancel={endWorkspacePan}
      onWheel={handleWorkspaceWheel}
    >
      <div className="absolute inset-0 will-change-transform" style={workspaceViewStyle}>
      {/* Background layer - always render as DOM element with blur */}
      {isRetroGridBackground ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: activeBackgroundBackdropColor,
            filter: activeBackgroundBlurAmount > 0 ? `blur(${activeBackgroundBlurAmount}px)` : 'none',
          }}
        >
          <RetroGrid
            angle={activeRetroGridAngle}
            cellSize={getRetroGridCellSize(activeRetroGridDensity)}
            opacity={0.72}
            lightLineColor={activeBackgroundAccentColor}
            darkLineColor={activeBackgroundAccentColor}
          />
        </div>
      ) : isRippleBackground ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: activeBackgroundBackdropColor,
            filter: activeBackgroundBlurAmount > 0 ? `blur(${activeBackgroundBlurAmount}px)` : 'none',
          }}
        >
          <Ripple
            className="[mask-image:none]"
            mainCircleSize={210}
            mainCircleOpacity={0.24}
            numCircles={activeRippleCount}
            animationDurationSeconds={getRippleAnimationDurationSeconds(activeRippleSpeed)}
            style={{ color: activeBackgroundAccentColor }}
          />
        </div>
      ) : isBackgroundVideo && resolvedBackgroundSource ? (
        <video
          key={`${activeBackgroundItem?.id ?? 'background'}:${resolvedBackgroundSource}`}
          ref={backgroundVideoRef}
          src={resolvedBackgroundSource}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            objectFit: activeBackgroundFit,
            filter: activeBackgroundBlurAmount > 0 ? `blur(${activeBackgroundBlurAmount}px)` : 'none',
            backgroundColor: '#000000',
          }}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => syncBackgroundVideoElement(backgroundVideoRef.current)}
          onCanPlay={() => syncBackgroundVideoElement(backgroundVideoRef.current)}
        />
      ) : (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            ...backgroundStyle,
            filter: activeBackgroundBlurAmount > 0 ? `blur(${activeBackgroundBlurAmount}px)` : 'none',
          }}
        />
      )}

      <div className="absolute inset-0">
        <div
          ref={screenGroupRef}
          className="absolute inset-0 will-change-transform"
          style={{ filter: shadowFilter, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
        >
          {pixiReady && videoReady && (
            <div
              ref={midgroundRef}
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 1 }}
            >
              <div className="absolute inset-0 pointer-events-none" style={stageWrapperStyle}>
                {getActiveAnnotations('midground').map((annotation) => {
                  const containerWidth = stageSizeRef.current.width || midgroundRef.current?.clientWidth || 800;
                  const containerHeight = stageSizeRef.current.height || midgroundRef.current?.clientHeight || 600;
                  const x = (annotation.position.x / 100) * containerWidth;
                  const y = (annotation.position.y / 100) * containerHeight;
                  const width = (annotation.size.width / 100) * containerWidth;
                  const height = (annotation.size.height / 100) * containerHeight;
                  const fadeInMs = annotation.fadeInMs ?? 240;
                  const fadeOutMs = annotation.fadeOutMs ?? 240;
                  const start = annotation.startMs ?? 0;
                  const end = annotation.endMs ?? 0;
                  const progressIn = Math.max(0, Math.min(1, fadeInMs > 0 ? (timeMs - start) / fadeInMs : 1));
                  const progressOut = Math.max(0, Math.min(1, fadeOutMs > 0 ? (end - timeMs) / fadeOutMs : 1));
                  const enterEffect = annotation.enterEffect || 'none';
                  const exitEffect = annotation.exitEffect || 'none';
                  const enterAlpha = enterEffect === 'fade' || enterEffect === 'pop' ? progressIn : 1;
                  const exitAlpha = exitEffect === 'fade' || exitEffect === 'pop' ? progressOut : 1;
                  const opacity = Math.max(0, Math.min(1, enterAlpha * exitAlpha));
                  let scale = 1;
                  if (enterEffect === 'pop') {
                    scale *= 0.82 + 0.18 * progressIn;
                  }
                  if (exitEffect === 'pop') {
                    scale *= 0.9 + 0.1 * progressOut;
                  }

                  return (
                    <div
                      key={annotation.id}
                      className="absolute"
                      style={{
                        left: x,
                        top: y,
                        width,
                        height,
                        zIndex: annotation.zIndex,
                        pointerEvents: 'none',
                        opacity,
                        transform: `scale(${scale})`,
                        transformOrigin: 'center',
                      }}
                    >
                      <AnnotationContentView annotation={annotation} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{ zIndex: 5 }}
          />

          {pixiReady && videoReady && (
            <div
              ref={clipVideoLayerRef}
              className="absolute inset-0 select-none"
              style={{
                zIndex: 8,
                pointerEvents: selectedClipId && !isPlaying && !workspaceInteractionLocked ? 'auto' : 'none',
                transformStyle: 'preserve-3d',
                backfaceVisibility: 'hidden',
              }}
            >
              <div className="absolute inset-0" style={stageWrapperStyle}>
                {(() => {
                  if (!activeClipRegions.length) return null;
                  // Use stageSizeRef as the authoritative source for dimensions.
                  const stageSize = stageSizeRef.current;
                  const containerWidth = stageSize.width || clipVideoLayerRef.current?.clientWidth || 800;
                  const containerHeight = stageSize.height || clipVideoLayerRef.current?.clientHeight || 600;

                  if (isOverlayDebugEnabled()) {
                    const layerEl = clipVideoLayerRef.current;
                    const screenGroup = screenGroupRef.current;
                    logOverlayDebugExpanded('[Clip Debug][render]', {
                      containerWidth,
                      containerHeight,
                      stageSizeWidth: stageSize.width,
                      stageSizeHeight: stageSize.height,
                      layerClientWidth: layerEl?.clientWidth,
                      layerTransform: layerEl?.style.transform || 'none',
                      screenGroupTransform: screenGroup?.style.transform || 'none',
                      screenGroupRect: (() => {
                        if (!screenGroup) return null;
                        const rect = screenGroup.getBoundingClientRect();
                        return {
                          x: rect.x,
                          y: rect.y,
                          width: rect.width,
                          height: rect.height,
                          top: rect.top,
                          right: rect.right,
                          bottom: rect.bottom,
                          left: rect.left,
                        };
                      })(),
                    });
                  }

                  const parentTransform = `${clipVideoLayerRef.current?.style.transform || 'none'}|${stageTranslation}`;

                  return activeClipRegions.map((region) => {
                    if (!videoAssetMap.has(region.assetId)) return null;
                    let interactionRect = clipRendererRef.current?.getClipInteractionRect(region.id) ?? null;
                    if (!interactionRect) {
                      if (isRecordingClip(region)) {
                        const video = videoRef.current;
                        if (video) {
                          interactionRect = resolveRecordingVisibleRect({
                            stageWidth: containerWidth,
                            stageHeight: containerHeight,
                            sourceWidth: video.videoWidth,
                            sourceHeight: video.videoHeight,
                            cropRegion: cropRegion ?? { x: 0, y: 0, width: 1, height: 1 },
                            padding: padding ?? 0,
                            screenOffset,
                          });
                        }
                      } else {
                        const asset = videoAssetMap.get(region.assetId);
                        const videoWidth = asset?.width ?? 0;
                        const videoHeight = asset?.height ?? 0;
                        const resolvedTransformState = resolveClipTransformStateAtTime(
                          region,
                          Math.min(Math.max(timeMs, region.startMs), region.endMs),
                        );
                        const layout = computeClipLayout({
                          region: {
                            ...region,
                            position: { x: resolvedTransformState.x, y: resolvedTransformState.y },
                            size: { width: resolvedTransformState.width, height: resolvedTransformState.height },
                          },
                          containerWidth,
                          containerHeight,
                          videoWidth,
                          videoHeight,
                        });
                        if (layout) {
                          const anchor = region.anchor ?? { x: 0, y: 0 };
                          const scale = Math.max(0.01, resolvedTransformState.scale);
                          interactionRect = {
                            x: layout.dest.x + layout.dest.width * anchor.x * (1 - scale),
                            y: layout.dest.y + layout.dest.height * anchor.y * (1 - scale),
                            width: layout.dest.width * scale,
                            height: layout.dest.height * scale,
                          };
                        }
                      }
                    }
                    return (
                      <ClipVideoItem
                        key={region.id}
                        region={region}
                        containerWidth={containerWidth}
                        containerHeight={containerHeight}
                        interactionRect={interactionRect}
                        currentTimeMs={timeMs}
                        isPlaying={isPlaying}
                        isSelected={region.id === selectedClipId}
                        parentTransform={parentTransform}
                        onSelect={(id) => onSelectClip?.(id)}
                        onPositionChange={(id, position) => onClipPositionChange?.(id, position)}
                        onSizeChange={(id, size) => onClipSizeChange?.(id, size)}
                        onRectChange={(id, rect) => onClipRectChange?.(id, rect)}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          )}

          <div ref={stageFrameRef} className="absolute pointer-events-none" style={{ ...safeFrameStyle, zIndex: 0, opacity: 0 }} />

          {showSafeFrameOverlay && (
            <div className="absolute pointer-events-none" style={{ ...safeFrameStyle, zIndex: 9 }}>
              <div className="absolute inset-[1px] rounded-[2px] border border-white/30 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.24)]" />
              <div className="absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2 bg-white/12" />
              <div className="absolute top-1/2 left-3 right-3 h-px -translate-y-1/2 bg-white/12" />
              <div className="absolute left-3 top-3 h-5 w-5 border-l border-t border-white/55" />
              <div className="absolute right-3 top-3 h-5 w-5 border-r border-t border-white/55" />
              <div className="absolute bottom-3 left-3 h-5 w-5 border-b border-l border-white/55" />
              <div className="absolute bottom-3 right-3 h-5 w-5 border-b border-r border-white/55" />
              <div className="absolute left-3 top-3 rounded bg-black/45 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/80">
                Safe Frame
              </div>
            </div>
          )}

          {/* Only render overlay after PIXI and video are fully initialized */}
          {pixiReady && videoReady && (
            <div
              ref={overlayRef}
              className="absolute inset-0 select-none"
              style={{ pointerEvents: 'none', zIndex: 10, transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
              onPointerDown={handleOverlayPointerDown}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              onPointerLeave={handleOverlayPointerLeave}
            >
              <div
                ref={focusIndicatorRef}
                className="absolute rounded-md border border-[#34B27B]/80 bg-[#34B27B]/20 shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
                style={{ display: 'none', pointerEvents: 'none' }}
              />
              {(() => {
                const sorted = getActiveAnnotations();
                
                // Handle click-through cycling: when clicking same annotation, cycle to next
                const handleAnnotationClick = (clickedId: string) => {
                  if (!onSelectAnnotation) return;
                  
                  if (clickedId === selectedAnnotationId && sorted.length > 1) {
                    const currentIndex = sorted.findIndex(a => a.id === clickedId);
                    const nextIndex = (currentIndex + 1) % sorted.length;
                    onSelectAnnotation(sorted[nextIndex].id);
                  } else {
                    onSelectAnnotation(clickedId);
                  }
                };
                
                const overlayWidth = stageSizeRef.current.width || overlayRef.current?.clientWidth || 800;
                const overlayHeight = stageSizeRef.current.height || overlayRef.current?.clientHeight || 600;

                return (
                  <div className="absolute inset-0" style={stageWrapperStyle}>
                    {sorted.map((annotation) => {
                      const annLayer = annotation.layer || 'foreground';
                      const isMidground = annLayer === 'midground';
                      return (
                        <AnnotationOverlay
                          key={annotation.id}
                          annotation={annotation}
                          isSelected={annotation.id === selectedAnnotationId}
                          containerWidth={overlayWidth}
                          containerHeight={overlayHeight}
                          onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
                          onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
                          onClick={handleAnnotationClick}
                          zIndex={annotation.zIndex}
                          isSelectedBoost={annotation.id === selectedAnnotationId}
                          renderContent={!isMidground}
                          ghostOpacity={isMidground ? 0.45 : 1}
                          currentTimeMs={timeMs}
                        />
                      );
                    })}
                  </div>
                );
              })()}
              <canvas ref={cursorCanvasRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />
            </div>
          )}
        </div>
      </div>
      </div>

      <div className="absolute right-3 top-3 z-[30] flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/55 px-2 py-1.5 backdrop-blur-md" data-workspace-controls="true">
        <button
          type="button"
          onClick={resetWorkspaceView}
          className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          title="Reset preview workspace to fit"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={() => zoomWorkspaceBy(-1)}
          className="h-7 w-7 rounded-md border border-white/10 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          title="Zoom out"
        >
          -
        </button>
        <div className="min-w-[3.5rem] text-center text-[11px] font-medium tabular-nums text-slate-200">
          {Math.round(workspaceView.zoom * 100)}%
        </div>
        <button
          type="button"
          onClick={() => zoomWorkspaceBy(1)}
          className="h-7 w-7 rounded-md border border-white/10 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={toggleWorkspacePanMode}
          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
            workspaceView.panMode
              ? 'border-[#34B27B]/40 bg-[#34B27B]/18 text-[#7ee0b2]'
              : 'border-white/10 text-slate-200 hover:border-white/20 hover:bg-white/10 hover:text-white'
          }`}
          title="Toggle preview pan mode"
        >
          Pan
        </button>
      </div>

      <video
        ref={videoRef}
        src={videoPath}
        className="hidden"
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={e => {
          onDurationChange(e.currentTarget.duration);
        }}
        onError={() => onError('Failed to load video')}
      />
    </div>
  );
}

const ForwardedVideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(VideoPlayback);

ForwardedVideoPlayback.displayName = "VideoPlayback";

export default ForwardedVideoPlayback;
