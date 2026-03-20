import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { RetroGrid } from "@/components/ui/retro-grid";
import { Ripple } from "@/components/ui/ripple";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Block from '@uiw/react-color-block';
import { Trash2, Download, Crop, X, Bug, Upload, Star } from "lucide-react";
import { toast } from "sonner";
import { BezierCurveEditor } from "./BezierCurveEditor";
import { RECORDING_ASSET_ID } from "./types";
import type { ZoomDepth, CropRegion, AnnotationRegion, AnnotationType, CursorTrack, CursorStyle, CursorSmoothing, End2EndParams, ZoomFollowMode, EffectRegion, SpeedRegion, ScreenOffset, VideoAsset, VideoClip, AudioClip, VideoClipFit, VideoClipEffect, PaddingKeyframe, TimelineTrack, ZoomRegion, TrimRegion, BackgroundItem, BackgroundFit, ClipTransformBezier, MaskItem } from "./types";
import { CropControl } from "./CropControl";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { EmojiPickerPanel } from "./EmojiPickerPanel";
import { EffectSettingsPanel } from "./EffectSettingsPanel";
import { MaskSettingsPanel } from "./MaskSettingsPanel";
import { SpeedSettingsPanel } from "./SpeedSettingsPanel";
import { getAspectRatioValue, type AspectRatio } from "@/utils/aspectRatioUtils";
import type { ExportQuality } from "@/lib/exporter";
import { resolveRecordingVisibleRect, type InteractionRect } from "@/utils/recordingInteractionLayout";
import {
  CLIP_TRANSFORM_POSITION_RANGE,
  CLIP_TRANSFORM_SIZE_RANGE,
  findClipTransformKeyframeAtTime,
  getBaseClipTransformState,
  LINEAR_BEZIER,
  resolveClipTransformStateAtTime,
  resolveClipTransformStateFromBase,
} from "@/utils/clipTransformKeyframes";
import {
  DEFAULT_BACKGROUND_ACCENT_COLOR,
  DEFAULT_BACKGROUND_BACKDROP_COLOR,
  DEFAULT_RETRO_GRID_ANGLE,
  DEFAULT_RETRO_GRID_DENSITY,
  DEFAULT_RIPPLE_COUNT,
  DEFAULT_RIPPLE_SPEED,
  getRetroGridCellSize,
  getRippleAnimationDurationSeconds,
  MAGICUI_RETRO_GRID_VALUE,
  MAGICUI_RIPPLE_VALUE,
  resolveActiveBackgroundItem,
} from "./backgroundUtils";

const WALLPAPER_COUNT = 18;
const WALLPAPER_RELATIVE = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `wallpapers/wallpaper${i + 1}.jpg`);
const GRADIENTS = [
  "linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
  "linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
  "linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
  "linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
  "radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
  "linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
  "linear-gradient(135deg, #FBC8B4, #2447B1)",
  "linear-gradient(109.6deg, #F635A6, #36D860)",
  "linear-gradient(90deg, #FF0101, #4DFF01)",
  "linear-gradient(315deg, #EC0101, #5044A9)",
  "linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
  "linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
  "linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
  "linear-gradient(to right, #fa709a 0%, #fee140 100%)",
  "linear-gradient(to top, #30cfd0 0%, #330867 100%)",
  "linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
  "linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
  "linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
  "linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

interface SettingsPanelProps {
  selected: string;
  onWallpaperChange: (path: string) => void;
  selectedZoomDepth?: ZoomDepth | null;
  onZoomDepthChange?: (depth: ZoomDepth) => void;
  selectedZoomId?: string | null;
  onZoomDelete?: (id: string) => void;
  selectedTrimId?: string | null;
  onTrimDelete?: (id: string) => void;
  shadowIntensity?: number;
  onShadowChange?: (intensity: number) => void;
  showBlur?: boolean;
  onBlurChange?: (showBlur: boolean) => void;
  showSafeFrameOverlay?: boolean;
  onShowSafeFrameOverlayChange?: (show: boolean) => void;
  motionBlurEnabled?: boolean;
  onMotionBlurChange?: (enabled: boolean) => void;
  borderRadius?: number;
  onBorderRadiusChange?: (radius: number) => void;
  padding?: number;
  onPaddingChange?: (padding: number) => void;
  paddingKeyframes?: PaddingKeyframe[];
  onPaddingKeyframesChange?: (keyframes: PaddingKeyframe[]) => void;
  currentTime?: number;
  screenOffset?: ScreenOffset;
  onScreenOffsetChange?: (patch: Partial<ScreenOffset>) => void;
  videoAssets?: VideoAsset[];
  selectedTrack?: TimelineTrack | null;
  onTrackNameChange?: (trackId: string, name: string) => void;
  onTrackHeightChange?: (trackId: string, height: number) => void;
  onTrackHiddenChange?: (trackId: string, hidden: boolean) => void;
  onTrackMuteChange?: (trackId: string, muted: boolean) => void;
  onTrackDelete?: (trackId: string) => void;
  onAddItemToTrack?: (trackId: string) => void;
  videoClips?: VideoClip[];
  maskItems?: MaskItem[];
  audioClips?: AudioClip[];
  backgroundItems?: BackgroundItem[];
  zoomRegions?: ZoomRegion[];
  trimRegions?: TrimRegion[];
  selectedBackgroundId?: string | null;
  onSelectBackground?: (id: string | null) => void;
  selectedMaskId?: string | null;
  selectedClipId?: string | null;
  onVideoAssetAdd?: () => void;
  onVideoAssetRemove?: (id: string) => void;
  onBackgroundChange?: (id: string, patch: Partial<BackgroundItem>) => void;
  onBackgroundDelete?: (id: string) => void;
  onBackgroundAssetAdd?: (assetId: string) => void;
  onClipAddToTimeline?: (assetId: string) => void;
  onAudioAddToTimeline?: (assetId: string) => void;
  defaultImageClipDurationMs?: number;
  onDefaultImageClipDurationMsChange?: (durationMs: number) => void;
  onClipChange?: (id: string, patch: Partial<VideoClip>) => void;
  onClipTransformKeyframeAddOrUpdate?: (id: string) => void;
  onClipTransformKeyframeDelete?: (id: string, keyframeId: string) => void;
  onClipTransformKeyframeCurveChange?: (id: string, keyframeId: string, curveToNext: ClipTransformBezier) => void;
  onClipTransformKeyframesClear?: (id: string) => void;
  onClipRectChange?: (id: string, rect: InteractionRect) => void;
  onMaskChange?: (id: string, patch: Partial<MaskItem>) => void;
  onMaskDelete?: (id: string) => void;
  onMaskAdd?: (targetClipId?: string, shape?: MaskItem['shape']) => void;
  onMaskPathKeyframeAddOrUpdate?: (id: string) => void;
  onMaskPathKeyframeDelete?: (id: string, keyframeId: string) => void;
  onMaskPathKeyframeCurveChange?: (id: string, keyframeId: string, curveToNext: ClipTransformBezier) => void;
  onMaskPathKeyframesClear?: (id: string) => void;
  cropRegion?: CropRegion;
  onCropChange?: (region: CropRegion) => void;
  aspectRatio: AspectRatio;
  videoElement?: HTMLVideoElement | null;
  exportQuality?: ExportQuality;
  onExportQualityChange?: (quality: ExportQuality) => void;
  onExport?: () => void;
  selectedAnnotationId?: string | null;
  annotationRegions?: AnnotationRegion[];
  onAnnotationContentChange?: (id: string, content: string) => void;
  onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
  onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion['style']>) => void;
  onAnnotationTimingChange?: (id: string, startMs: number, endMs: number) => void;
  onAnnotationEffectChange?: (id: string, patch: Partial<AnnotationRegion>) => void;
  onAnnotationEmojiChange?: (id: string, emoji: { src: string; alt?: string; category?: string }) => void;
  onAnnotationEmojiAdd?: (emoji: { src: string; alt?: string; category?: string }) => void;
  onAnnotationLayerChange?: (id: string, layer: AnnotationRegion['layer']) => void;
  onAnnotationFigureDataChange?: (id: string, figureData: any) => void;
  onAnnotationDelete?: (id: string) => void;
  effectRegions?: EffectRegion[];
  selectedEffectId?: string | null;
  onEffectChange?: (id: string, patch: Partial<EffectRegion>) => void;
  onEffectDelete?: (id: string) => void;
  speedRegions?: SpeedRegion[];
  selectedSpeedId?: string | null;
  onSpeedChange?: (id: string, patch: Partial<SpeedRegion>) => void;
  onSpeedDelete?: (id: string) => void;
  cursorTrack?: CursorTrack | null;
  selectedCursorId?: string | null;
  onCursorStyleChange?: (style: Partial<CursorStyle>) => void;
  cursorSmoothing?: CursorSmoothing;
  onCursorSmoothingChange?: (s: CursorSmoothing) => void;
  quadraticSmoothingStrength?: number;
  onQuadraticSmoothingStrengthChange?: (v: number) => void;
  end2endParams?: End2EndParams;
  onEnd2endParamsChange?: (p: Partial<End2EndParams>) => void;
  // Zoom follow settings
  zoomFollowEnabled?: boolean;
  onZoomFollowEnabledChange?: (enabled: boolean) => void;
  zoomFollowMode?: ZoomFollowMode;
  onZoomFollowModeChange?: (mode: ZoomFollowMode) => void;
  zoomFollowDelayMs?: number;
  onZoomFollowDelayMsChange?: (ms: number) => void;
  zoomFollowMinPaddingPx?: number;
  onZoomFollowMinPaddingPxChange?: (px: number) => void;
}

export default SettingsPanel;

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
  { depth: 1, label: "1.25×" },
  { depth: 2, label: "1.5×" },
  { depth: 3, label: "1.8×" },
  { depth: 4, label: "2.2×" },
  { depth: 5, label: "3.5×" },
  { depth: 6, label: "5×" },
];

export function SettingsPanel({
  selected,
  onWallpaperChange,
  selectedZoomDepth,
  onZoomDepthChange,
  selectedZoomId,
  onZoomDelete,
  selectedTrimId,
  onTrimDelete,
  shadowIntensity = 0,
  onShadowChange,
  showBlur,
  onBlurChange,
  showSafeFrameOverlay = false,
  onShowSafeFrameOverlayChange,
  motionBlurEnabled = true,
  onMotionBlurChange,
  borderRadius = 0,
  onBorderRadiusChange,
  padding = 50,
  onPaddingChange,
  paddingKeyframes = [],
  onPaddingKeyframesChange,
  currentTime = 0,
  screenOffset = { x: 0, y: 0 },
  videoAssets = [],
  selectedTrack,
  onTrackNameChange,
  onTrackHeightChange,
  onTrackHiddenChange,
  onTrackMuteChange,
  onTrackDelete,
  onAddItemToTrack,
  videoClips = [],
  maskItems = [],
  audioClips = [],
  backgroundItems = [],
  zoomRegions = [],
  trimRegions = [],
  selectedBackgroundId,
  onSelectBackground,
  selectedMaskId,
  selectedClipId,
  onVideoAssetAdd,
  onVideoAssetRemove,
  onBackgroundChange,
  onBackgroundDelete,
  onBackgroundAssetAdd,
  onClipAddToTimeline,
  onAudioAddToTimeline,
  defaultImageClipDurationMs = 3000,
  onDefaultImageClipDurationMsChange,
  onClipChange,
  onClipTransformKeyframeAddOrUpdate,
  onClipTransformKeyframeDelete,
  onClipTransformKeyframeCurveChange,
  onClipTransformKeyframesClear,
  onClipRectChange,
  onMaskChange,
  onMaskDelete,
  onMaskAdd,
  onMaskPathKeyframeAddOrUpdate,
  onMaskPathKeyframeDelete,
  onMaskPathKeyframeCurveChange,
  onMaskPathKeyframesClear,
  cropRegion,
  onCropChange,
  aspectRatio,
  videoElement,
  exportQuality = 'good',
  onExportQualityChange,
  onExport,
  selectedAnnotationId,
  annotationRegions = [],
  onAnnotationContentChange,
  onAnnotationTypeChange,
  onAnnotationStyleChange,
  onAnnotationTimingChange,
  onAnnotationEffectChange,
  onAnnotationEmojiChange,
  onAnnotationEmojiAdd,
  onAnnotationLayerChange,
  onAnnotationFigureDataChange,
  onAnnotationDelete,
  effectRegions = [],
  selectedEffectId,
  onEffectChange,
  onEffectDelete,
  speedRegions = [],
  selectedSpeedId,
  onSpeedChange,
  onSpeedDelete,
  cursorTrack,
  selectedCursorId,
  onCursorStyleChange,
  cursorSmoothing,
  onCursorSmoothingChange,
  quadraticSmoothingStrength,
  onQuadraticSmoothingStrengthChange,
  end2endParams,
  onEnd2endParamsChange,
  // Zoom follow defaults
  zoomFollowEnabled = false,
  onZoomFollowEnabledChange,
  zoomFollowMode = 'center',
  onZoomFollowModeChange,
  zoomFollowDelayMs = 120,
  onZoomFollowDelayMsChange,
  zoomFollowMinPaddingPx = 24,
  onZoomFollowMinPaddingPxChange,
}: SettingsPanelProps) {
  const [wallpaperPaths, setWallpaperPaths] = useState<string[]>([]);
  const [customImages, setCustomImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const resolved = await Promise.all(WALLPAPER_RELATIVE.map(p => getAssetPath(p)))
        if (mounted) setWallpaperPaths(resolved)
      } catch (err) {
        if (mounted) setWallpaperPaths(WALLPAPER_RELATIVE.map(p => `/${p}`))
      }
    })()
    return () => { mounted = false }
  }, [])
  const colorPalette = [
    '#FF0000', '#FFD700', '#00FF00', '#FFFFFF', '#0000FF', '#FF6B00',
    '#9B59B6', '#E91E63', '#00BCD4', '#FF5722', '#8BC34A', '#FFC107',
    '#34B27B', '#000000', '#607D8B', '#795548',
  ];

  const [selectedColor, setSelectedColor] = useState('#ADADAD');
  const [gradient, setGradient] = useState<string>(GRADIENTS[0]);
  const [activeTab, setActiveTab] = useState<'screen' | 'background' | 'media' | 'emoji' | 'clips' | 'export'>('screen');
  const topLevelTabClassName = "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-1.5 py-1 text-[10px] leading-none tracking-tight data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 rounded-lg transition-all";

  const mediaAssets = useMemo(
    () => videoAssets.filter((asset) => asset.id !== RECORDING_ASSET_ID),
    [videoAssets],
  );
  const videoMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => asset.kind !== 'audio'),
    [mediaAssets],
  );
  const audioMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => asset.kind === 'audio'),
    [mediaAssets],
  );
  const getVisualAssetDurationMs = useCallback((asset: VideoAsset) => (
    asset.kind === 'image' ? defaultImageClipDurationMs : asset.durationMs
  ), [defaultImageClipDurationMs]);
  const getVisualAssetKindLabel = useCallback((asset: VideoAsset) => {
    if (asset.kind === 'image') return 'Image';
    if (asset.kind === 'recording') return 'Recording';
    return 'Video';
  }, []);
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const clipCount = videoClips.filter(
    (clip) => !(clip.applyCamera || clip.assetId === RECORDING_ASSET_ID),
  ).length;
  const audioClipCount = audioClips.length;
  const selectedBackground = selectedBackgroundId
    ? backgroundItems.find((item) => item.id === selectedBackgroundId) ?? null
    : null;
  const selectedMask = selectedMaskId
    ? maskItems.find((item) => item.id === selectedMaskId) ?? null
    : null;
  const sortedBackgroundItems = useMemo(
    () => [...backgroundItems].sort((a, b) => a.startMs - b.startMs),
    [backgroundItems],
  );
  const activeBackgroundAtPlayhead = useMemo(
    () => resolveActiveBackgroundItem(backgroundItems, Math.round((currentTime ?? 0) * 1000)),
    [backgroundItems, currentTime],
  );
  const inspectedBackground = selectedBackground ?? activeBackgroundAtPlayhead;
  const selectedMagicBackdropColor = inspectedBackground?.kind === 'preset'
    ? inspectedBackground.backdropColor ?? DEFAULT_BACKGROUND_BACKDROP_COLOR
    : DEFAULT_BACKGROUND_BACKDROP_COLOR;
  const selectedMagicAccentColor = inspectedBackground?.kind === 'preset'
    ? inspectedBackground.accentColor ?? DEFAULT_BACKGROUND_ACCENT_COLOR
    : DEFAULT_BACKGROUND_ACCENT_COLOR;
  const inspectedPresetValue = inspectedBackground?.kind === 'preset' ? (inspectedBackground.value ?? null) : null;
  const inspectedIsRetroGrid = inspectedPresetValue === MAGICUI_RETRO_GRID_VALUE;
  const inspectedIsRipple = inspectedPresetValue === MAGICUI_RIPPLE_VALUE;
  const selectedRetroGridAngle = inspectedBackground?.retroGridAngle ?? DEFAULT_RETRO_GRID_ANGLE;
  const selectedRetroGridDensity = inspectedBackground?.retroGridDensity ?? DEFAULT_RETRO_GRID_DENSITY;
  const selectedRippleSpeed = inspectedBackground?.rippleSpeed ?? DEFAULT_RIPPLE_SPEED;
  const selectedRippleCount = inspectedBackground?.rippleCount ?? DEFAULT_RIPPLE_COUNT;
  const selectedClip = selectedClipId
    ? videoClips.find((clip) => clip.id === selectedClipId) ?? null
    : null;
  const selectedClipAsset = selectedClip
    ? videoAssets.find((asset) => asset.id === selectedClip.assetId) ?? null
    : null;
  const selectedClipIsRecording = Boolean(
    selectedClip && (selectedClip.applyCamera || selectedClip.assetId === RECORDING_ASSET_ID),
  );
  const selectedClipUsesScreenRoundness = Boolean(
    selectedClip && (selectedClipIsRecording || selectedClipAsset?.kind === 'recording'),
  );
  const currentTimeMs = Math.round((currentTime ?? 0) * 1000);
  const selectedClipTransformKeyframe = selectedClip
    ? findClipTransformKeyframeAtTime(selectedClip.transformKeyframes, currentTimeMs)
    : null;
  const canEditSelectedClipTransformKeyframes = Boolean(
    selectedClip &&
    currentTimeMs >= selectedClip.startMs &&
    currentTimeMs <= selectedClip.endMs,
  );
  const selectedClipTransformState = useMemo(() => {
    if (!selectedClip) {
      return null;
    }

    if (!selectedClipIsRecording) {
      return canEditSelectedClipTransformKeyframes
        ? resolveClipTransformStateAtTime(selectedClip, currentTimeMs)
        : getBaseClipTransformState(selectedClip);
    }

    const sourceWidth = videoElement?.videoWidth || 0;
    const sourceHeight = videoElement?.videoHeight || 0;
    const stageWidth = getAspectRatioValue(aspectRatio);
    const stageHeight = 1;
    if (!cropRegion || sourceWidth <= 0 || sourceHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
      return null;
    }

    const rect = resolveRecordingVisibleRect({
      stageWidth,
      stageHeight,
      sourceWidth,
      sourceHeight,
      cropRegion,
      padding,
      screenOffset,
    });
    if (!rect) return null;

    const baseState = {
      x: (rect.x / stageWidth) * 100,
      y: (rect.y / stageHeight) * 100,
      width: (rect.width / stageWidth) * 100,
      height: (rect.height / stageHeight) * 100,
      rotationDeg: selectedClip.rotationDeg ?? 0,
      scale: selectedClip.scale ?? 1,
      opacity: selectedClip.opacity ?? 1,
    };

    return canEditSelectedClipTransformKeyframes && selectedClip.transformKeyframes?.length
      ? resolveClipTransformStateFromBase(baseState, selectedClip.transformKeyframes, currentTimeMs)
      : baseState;
  }, [selectedClip, selectedClipIsRecording, canEditSelectedClipTransformKeyframes, currentTimeMs, videoElement, aspectRatio, cropRegion, padding, screenOffset]);
  const selectedClipPlacement = useMemo(() => {
    if (selectedClipTransformState) {
      return {
        x: selectedClipTransformState.x,
        y: selectedClipTransformState.y,
        width: selectedClipTransformState.width,
        height: selectedClipTransformState.height,
      };
    }
    return null;
  }, [selectedClipTransformState]);

  const updateSelectedClipPlacement = useCallback((patch: Partial<InteractionRect>) => {
    if (!selectedClip || !selectedClipPlacement) return;

    const nextRect = {
      ...selectedClipPlacement,
      ...patch,
    };

    if (onClipRectChange) {
      onClipRectChange(selectedClip.id, nextRect);
      return;
    }

    if (onClipChange && !selectedClipIsRecording) {
      onClipChange(selectedClip.id, {
        position: {
          x: nextRect.x,
          y: nextRect.y,
        },
        size: {
          width: nextRect.width,
          height: nextRect.height,
        },
      });
    }
  }, [selectedClip, selectedClipPlacement, onClipRectChange, onClipChange, selectedClipIsRecording]);

  const updateSelectedClipTransform = useCallback((patch: Partial<Pick<VideoClip, "rotationDeg" | "scale" | "opacity">>) => {
    if (!selectedClip || !onClipChange) return;
    onClipChange(selectedClip.id, patch);
  }, [selectedClip, onClipChange]);

  useEffect(() => {
    if (selectedClip) {
      setActiveTab('clips');
    }
  }, [selectedClip]);

  useEffect(() => {
    if (selectedBackground) {
      setActiveTab('background');
    }
  }, [selectedBackground]);
  // Local follow state to allow toggling even if parent doesn't pass handler
  const [zoomFollowEnabledLocal, setZoomFollowEnabledLocal] = useState<boolean>(Boolean((zoomFollowEnabled as boolean) || false));
  useEffect(() => {
    setZoomFollowEnabledLocal(Boolean(zoomFollowEnabled));
  }, [zoomFollowEnabled]);
  // Mirror to global fallback so VideoPlayback can read when parent doesn't wire props
  useEffect(() => {
    try {
      (window as any).__openscreen_zoomFollowEnabled = Boolean(zoomFollowEnabledLocal);
    } catch {}
  }, [zoomFollowEnabledLocal]);

  const zoomEnabled = Boolean(selectedZoomDepth);
  const trimEnabled = Boolean(selectedTrimId);
  const cursorEnabled = Boolean(selectedCursorId && cursorTrack && cursorTrack.events.length > 0);

  const handleDeleteClick = () => {
    if (selectedZoomId && onZoomDelete) {
      onZoomDelete(selectedZoomId);
    }
  };

  const handleTrimDeleteClick = () => {
    if (selectedTrimId && onTrimDelete) {
      onTrimDelete(selectedTrimId);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file type - only allow JPG/JPEG
    const validTypes = ['image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type', {
        description: 'Please upload a JPG or JPEG image file.',
      });
      event.target.value = '';
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setCustomImages(prev => [...prev, dataUrl]);
        onWallpaperChange(dataUrl);
        toast.success('Custom image uploaded successfully!');
      }
    };

    reader.onerror = () => {
      toast.error('Failed to upload image', {
        description: 'There was an error reading the file.',
      });
    };

    reader.readAsDataURL(file);
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setCustomImages(prev => prev.filter(img => img !== imageUrl));
    // If the removed image was selected, clear selection
    if (selected === imageUrl) {
      onWallpaperChange(wallpaperPaths[0] || WALLPAPER_RELATIVE[0]);
    }
  };

  const renderBackgroundSegmentInspector = () => (
    <>
      {inspectedBackground ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-[11px] text-emerald-100/90 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-emerald-100">Editing Background Segment</div>
              <div className="text-emerald-100/70">
                {Math.max(0, inspectedBackground.startMs / 1000).toFixed(1)}s to {Math.max(0, inspectedBackground.endMs / 1000).toFixed(1)}s
              </div>
            </div>
            {selectedBackground && onBackgroundDelete ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 gap-2 text-emerald-50 hover:bg-emerald-500/10 hover:text-white"
                onClick={() => onBackgroundDelete(selectedBackground.id)}
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
            ) : null}
          </div>
          <div>
            Changes below apply to the selected background segment. If none is selected, they apply to the segment under the playhead.
          </div>
        </div>
      ) : null}
      {inspectedBackground && onBackgroundChange ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-200">Background Segment</div>
            <div className="text-[10px] text-slate-500">
              {inspectedBackground.kind === 'video'
                ? 'Video'
                : inspectedBackground.kind === 'image'
                  ? 'Image'
                  : inspectedBackground.kind === 'gradient'
                    ? 'Gradient'
                    : inspectedBackground.kind === 'preset'
                      ? 'Preset'
                      : 'Color'}
            </div>
          </div>
          {(inspectedBackground.kind === 'image' || inspectedBackground.kind === 'video') ? (
            <div>
              <div className="text-[11px] text-slate-400 mb-1">Fit</div>
              <Select
                value={inspectedBackground.fit ?? 'cover'}
                onValueChange={(value) => onBackgroundChange(inspectedBackground.id, { fit: value as BackgroundFit })}
              >
                <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
                  <SelectValue placeholder="Select fit" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                  <SelectItem value="cover">Fill canvas</SelectItem>
                  <SelectItem value="contain">Fit inside</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-400">
              Fit applies to image and video background segments.
            </div>
          )}
          {inspectedBackground.kind === 'preset' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] text-slate-400">Backdrop Color</div>
                <div className="text-[10px] text-slate-500 font-mono uppercase">
                  {selectedMagicBackdropColor}
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <input
                  type="color"
                  value={selectedMagicBackdropColor}
                  onChange={(event) => onBackgroundChange(inspectedBackground.id, { backdropColor: event.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0"
                />
                <div className="text-[11px] text-slate-400">
                  Changes the canvas color behind Magic backgrounds like Retro Grid and Ripple.
                </div>
              </div>
            </div>
          ) : null}
          {inspectedBackground.kind === 'preset' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] text-slate-400">Accent Color</div>
                <div className="text-[10px] text-slate-500 font-mono uppercase">
                  {selectedMagicAccentColor}
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <input
                  type="color"
                  value={selectedMagicAccentColor}
                  onChange={(event) => onBackgroundChange(inspectedBackground.id, { accentColor: event.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent p-0"
                />
                <div className="text-[11px] text-slate-400">
                  Changes the line and ripple color for Magic backgrounds.
                </div>
              </div>
            </div>
          ) : null}
          {inspectedIsRetroGrid ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-slate-400">Grid Angle</div>
                  <div className="text-[10px] text-slate-500 font-mono">{Math.round(selectedRetroGridAngle)}deg</div>
                </div>
                <Slider
                  value={[selectedRetroGridAngle]}
                  onValueChange={(values) => onBackgroundChange(inspectedBackground.id, { retroGridAngle: values[0] })}
                  min={25}
                  max={85}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-slate-400">Grid Density</div>
                  <div className="text-[10px] text-slate-500 font-mono">{selectedRetroGridDensity.toFixed(1)}x</div>
                </div>
                <Slider
                  value={[selectedRetroGridDensity]}
                  onValueChange={(values) => onBackgroundChange(inspectedBackground.id, { retroGridDensity: values[0] })}
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                />
              </div>
            </>
          ) : null}
          {inspectedIsRipple ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-slate-400">Ripple Speed</div>
                  <div className="text-[10px] text-slate-500 font-mono">{selectedRippleSpeed.toFixed(2)}x</div>
                </div>
                <Slider
                  value={[selectedRippleSpeed]}
                  onValueChange={(values) => onBackgroundChange(inspectedBackground.id, { rippleSpeed: values[0] })}
                  min={0.25}
                  max={3}
                  step={0.05}
                  className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-slate-400">Ripple Count</div>
                  <div className="text-[10px] text-slate-500 font-mono">{Math.round(selectedRippleCount)}</div>
                </div>
                <Slider
                  value={[selectedRippleCount]}
                  onValueChange={(values) => onBackgroundChange(inspectedBackground.id, { rippleCount: Math.round(values[0]) })}
                  min={3}
                  max={16}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                />
              </div>
            </>
          ) : null}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] text-slate-400">Blur</div>
              <div className="text-[10px] text-slate-500 font-mono">{Math.round(inspectedBackground.blurAmount ?? 0)}px</div>
            </div>
            <Slider
              value={[inspectedBackground.blurAmount ?? 0]}
              onValueChange={(values) => onBackgroundChange(inspectedBackground.id, { blurAmount: values[0] })}
              min={0}
              max={24}
              step={1}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>
        </div>
      ) : null}
    </>
  );

  const renderBackgroundSourcePicker = () => (
    <Tabs defaultValue="image" className="flex-1 flex flex-col min-h-0">
      <TabsList className="mb-4 bg-white/5 border border-white/5 p-1 w-full grid grid-cols-4 h-auto rounded-xl">
        <TabsTrigger value="image" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Image</TabsTrigger>
        <TabsTrigger value="color" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Color</TabsTrigger>
        <TabsTrigger value="gradient" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Gradient</TabsTrigger>
        <TabsTrigger value="magic" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Magic</TabsTrigger>
      </TabsList>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
        <TabsContent value="image" className="mt-0 space-y-3 px-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept=".jpg,.jpeg,image/jpeg"
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all"
          >
            <Upload className="w-4 h-4" />
            Upload Custom Image
          </Button>

          <div className="grid grid-cols-6 gap-2.5">
            {customImages.map((imageUrl, idx) => {
              const isSelected = selected === imageUrl;
              return (
                <div
                  key={`custom-${idx}`}
                  className={cn(
                    "aspect-square w-12 h-12 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 relative group shadow-sm",
                    isSelected
                      ? "border-[#34B27B] ring-2 ring-[#34B27B]/30 scale-105 shadow-lg shadow-[#34B27B]/10"
                      : "border-white/10 hover:border-[#34B27B]/40 hover:scale-105 opacity-80 hover:opacity-100 bg-white/5"
                  )}
                  style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
                  aria-label={`Custom Image ${idx + 1}`}
                  onClick={() => onWallpaperChange(imageUrl)}
                  role="button"
                >
                  <button
                    onClick={(e) => handleRemoveCustomImage(imageUrl, e)}
                    className="absolute top-1 right-1 w-4 h-4 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    aria-label="Remove custom image"
                  >
                    <X className="w-2.5 h-2.5 text-white" />
                  </button>
                </div>
              );
            })}

            {(wallpaperPaths.length > 0 ? wallpaperPaths : WALLPAPER_RELATIVE.map(p => `/${p}`)).map((path, idx) => {
              const isSelected = (() => {
                if (!selected) return false;
                if (selected === path) return true;
                try {
                  const clean = (s: string) => s.replace(/^file:\/\//, '').replace(/^\//, '');
                  if (clean(selected).endsWith(clean(path))) return true;
                  if (clean(path).endsWith(clean(selected))) return true;
                } catch {}
                return false;
              })();
              return (
                <div
                  key={path}
                  className={cn(
                    "aspect-square w-12 h-12 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
                    isSelected
                      ? "border-[#34B27B] ring-2 ring-[#34B27B]/30 scale-105 shadow-lg shadow-[#34B27B]/10"
                      : "border-white/10 hover:border-[#34B27B]/40 hover:scale-105 opacity-80 hover:opacity-100 bg-white/5"
                  )}
                  style={{ backgroundImage: `url(${path})`, backgroundSize: "cover", backgroundPosition: "center" }}
                  aria-label={`Wallpaper ${idx + 1}`}
                  onClick={() => onWallpaperChange(path)}
                  role="button"
                />
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="color" className="mt-0 px-2">
          <div className="p-1">
            <Block
              color={selectedColor}
              colors={colorPalette}
              onChange={(color) => {
                setSelectedColor(color.hex);
                onWallpaperChange(color.hex);
              }}
              style={{
                width: '100%',
                borderRadius: '12px',
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="gradient" className="mt-0 px-2">
          <div className="grid grid-cols-6 gap-2.5">
            {GRADIENTS.map((g, idx) => (
              <div
                key={g}
                className={cn(
                  "aspect-square w-12 h-12 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
                  gradient === g
                    ? "border-[#34B27B] ring-2 ring-[#34B27B]/30 scale-105 shadow-lg shadow-[#34B27B]/10"
                    : "border-white/10 hover:border-[#34B27B]/40 hover:scale-105 opacity-80 hover:opacity-100 bg-white/5"
                )}
                style={{ background: g }}
                aria-label={`Gradient ${idx + 1}`}
                onClick={() => { setGradient(g); onWallpaperChange(g); }}
                role="button"
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="magic" className="mt-0 px-2">
          <div className="grid gap-3">
            <button
              type="button"
              className={cn(
                "relative h-28 overflow-hidden rounded-xl border-2 text-left transition-all",
                selected === MAGICUI_RETRO_GRID_VALUE
                  ? "border-[#34B27B] ring-2 ring-[#34B27B]/30 shadow-lg shadow-[#34B27B]/10"
                  : "border-white/10 hover:border-[#34B27B]/40 bg-white/5"
              )}
              onClick={() => onWallpaperChange(MAGICUI_RETRO_GRID_VALUE)}
            >
              <div
                className="absolute inset-0"
                style={{ backgroundColor: selectedMagicBackdropColor }}
              />
              <RetroGrid
                className="opacity-80"
                angle={selectedRetroGridAngle}
                cellSize={Math.max(18, getRetroGridCellSize(selectedRetroGridDensity) - 4)}
                opacity={0.7}
                lightLineColor={selectedMagicAccentColor}
                darkLineColor={selectedMagicAccentColor}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-3 py-2">
                <div className="text-xs font-medium text-slate-100">Retro Grid</div>
                <div className="text-[10px] text-slate-400">MagicUI preset background</div>
              </div>
            </button>
            <button
              type="button"
              className={cn(
                "relative h-28 overflow-hidden rounded-xl border-2 text-left transition-all",
                selected === MAGICUI_RIPPLE_VALUE
                  ? "border-[#34B27B] ring-2 ring-[#34B27B]/30 shadow-lg shadow-[#34B27B]/10"
                  : "border-white/10 hover:border-[#34B27B]/40 bg-white/5"
              )}
              onClick={() => onWallpaperChange(MAGICUI_RIPPLE_VALUE)}
            >
              <div
                className="absolute inset-0"
                style={{ backgroundColor: selectedMagicBackdropColor }}
              />
              <Ripple
                className="opacity-80 [mask-image:none]"
                mainCircleSize={120}
                mainCircleOpacity={0.22}
                numCircles={selectedRippleCount}
                animationDurationSeconds={getRippleAnimationDurationSeconds(selectedRippleSpeed)}
                style={{ color: selectedMagicAccentColor }}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-3 py-2">
                <div className="text-xs font-medium text-slate-100">Ripple</div>
                <div className="text-[10px] text-slate-400">MagicUI preset background</div>
              </div>
            </button>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );

  const renderBackgroundTimelineList = () => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-200">Timeline Backgrounds</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-mono">{sortedBackgroundItems.length} segments</span>
          {selectedBackgroundId && onSelectBackground ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white"
              onClick={() => onSelectBackground(null)}
            >
              New Segment
            </Button>
          ) : null}
        </div>
      </div>
      {sortedBackgroundItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-[11px] text-slate-500">
          No background segments yet. Pick a background below to create one at the playhead.
        </div>
      ) : (
        <div className="space-y-2">
          {sortedBackgroundItems.map((item, index) => {
            const isSelected = item.id === selectedBackgroundId;
            const isActive = item.id === activeBackgroundAtPlayhead?.id;
            const kindLabel = item.kind === 'video'
              ? 'Video'
              : item.kind === 'image'
                ? 'Image'
                : item.kind === 'gradient'
                  ? 'Gradient'
                  : item.kind === 'preset'
                    ? 'Preset'
                    : 'Color';

            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition-all",
                  isSelected
                    ? "border-[#34B27B] bg-[#34B27B]/10"
                    : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]"
                )}
                onClick={() => onSelectBackground?.(item.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200">
                      Background {index + 1}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {kindLabel} • {Math.max(0, item.startMs / 1000).toFixed(1)}s to {Math.max(0, item.endMs / 1000).toFixed(1)}s
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isActive ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-200">
                        Active
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="rounded-full bg-[#34B27B]/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-[#7ce2b8]">
                        Selected
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // Find selected annotation
  const selectedAnnotation = selectedAnnotationId
    ? annotationRegions.find(a => a.id === selectedAnnotationId)
    : null;
  const selectedEffect = selectedEffectId
    ? effectRegions.find(effect => effect.id === selectedEffectId)
    : null;
  // If an annotation is selected, show annotation settings instead
  if (selectedAnnotation && onAnnotationContentChange && onAnnotationTypeChange && onAnnotationStyleChange && onAnnotationDelete) {
    return (
      <AnnotationSettingsPanel
        annotation={selectedAnnotation}
        onContentChange={(content) => onAnnotationContentChange(selectedAnnotation.id, content)}
        onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
        onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
        onTimingChange={
          onAnnotationTimingChange
            ? (startMs, endMs) => onAnnotationTimingChange(selectedAnnotation.id, startMs, endMs)
            : undefined
        }
        onEffectChange={
          onAnnotationEffectChange
            ? (patch) => onAnnotationEffectChange(selectedAnnotation.id, patch)
            : undefined
        }
        onEmojiChange={onAnnotationEmojiChange ? (emoji) => onAnnotationEmojiChange(selectedAnnotation.id, emoji) : undefined}
        onLayerChange={onAnnotationLayerChange ? (layer) => onAnnotationLayerChange(selectedAnnotation.id, layer) : undefined}
        onFigureDataChange={onAnnotationFigureDataChange ? (figureData) => onAnnotationFigureDataChange(selectedAnnotation.id, figureData) : undefined}
        onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
      />
    );
  }

  if (selectedEffect && onEffectChange && onEffectDelete) {
    return (
      <EffectSettingsPanel
        effect={selectedEffect}
        onChange={(patch) => onEffectChange(selectedEffect.id, patch)}
        onDelete={() => onEffectDelete(selectedEffect.id)}
      />
    );
  }

  if (selectedMask && onMaskChange && onMaskDelete) {
    return (
      <MaskSettingsPanel
        mask={selectedMask}
        videoClips={videoClips}
        videoAssets={videoAssets}
        currentTimeMs={Math.round(currentTime * 1000)}
        onChange={(patch) => onMaskChange(selectedMask.id, patch)}
        onDelete={() => onMaskDelete(selectedMask.id)}
        onKeyframeAddOrUpdate={onMaskPathKeyframeAddOrUpdate ? () => onMaskPathKeyframeAddOrUpdate(selectedMask.id) : undefined}
        onKeyframeDelete={onMaskPathKeyframeDelete ? (keyframeId) => onMaskPathKeyframeDelete(selectedMask.id, keyframeId) : undefined}
        onKeyframeCurveChange={onMaskPathKeyframeCurveChange ? (keyframeId, curve) => onMaskPathKeyframeCurveChange(selectedMask.id, keyframeId, curve) : undefined}
        onKeyframesClear={onMaskPathKeyframesClear ? () => onMaskPathKeyframesClear(selectedMask.id) : undefined}
      />
    );
  }

  const selectedSpeedRegion = selectedSpeedId
    ? speedRegions.find((r) => r.id === selectedSpeedId)
    : null;

  if (selectedSpeedRegion && onSpeedChange && onSpeedDelete) {
    return (
      <SpeedSettingsPanel
        region={selectedSpeedRegion}
        onChange={(patch) => onSpeedChange(selectedSpeedRegion.id, patch)}
        onDelete={() => onSpeedDelete(selectedSpeedRegion.id)}
      />
    );
  }

  if (selectedTrack) {
    const trackItemCount =
      videoClips.filter((clip) => clip.trackId === selectedTrack.id).length +
      maskItems.filter((item) => item.trackId === selectedTrack.id).length +
      audioClips.filter((clip) => clip.trackId === selectedTrack.id).length +
      backgroundItems.filter((item) => item.trackId === selectedTrack.id).length +
      zoomRegions.filter((region) => region.trackId === selectedTrack.id).length +
      trimRegions.filter((region) => region.trackId === selectedTrack.id).length +
      annotationRegions.filter((annotation) => annotation.trackId === selectedTrack.id).length +
      effectRegions.filter((effect) => effect.trackId === selectedTrack.id).length +
      speedRegions.filter((region) => region.trackId === selectedTrack.id).length +
      (cursorTrack?.trackId === selectedTrack.id ? 1 : 0);
    const canAddItem = ['zoom', 'trim', 'effect', 'annotation', 'speed', 'mask'].includes(selectedTrack.itemType);
    const canMuteTrack = selectedTrack.type !== 'recording' && selectedTrack.type !== 'background' && selectedTrack.type !== 'mask';
    const trackTypeLabel = selectedTrack.type === 'generic'
      ? 'Universal'
      : selectedTrack.type.charAt(0).toUpperCase() + selectedTrack.type.slice(1);
    const addLabel = (() => {
      switch (selectedTrack.itemType) {
        case 'zoom':
          return 'Add Zoom';
        case 'trim':
          return 'Add Trim';
        case 'effect':
          return 'Add Effect';
        case 'annotation':
          return 'Add Annotation';
        case 'mask':
          return 'Add Mask';
        case 'speed':
          return 'Add Speed Region';
        default:
          return 'Add Item';
      }
    })();

    return (
      <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
        <div className="mb-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Track Settings</div>
              <div className="text-xs text-slate-500 mt-1 uppercase tracking-[0.18em]">{trackTypeLabel}</div>
            </div>
            <div className="text-[10px] font-medium px-2 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
              {trackItemCount} items
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
            <div className="text-xs font-medium text-slate-200">Track Name</div>
            <input
              type="text"
              value={selectedTrack.name}
              onChange={(event) => onTrackNameChange?.(selectedTrack.id, event.target.value)}
              className="w-full p-2 rounded bg-black/20 text-slate-200 border border-white/10"
              placeholder="Track name"
            />
          </div>

          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Track Height</div>
              <span className="text-[10px] text-slate-400 font-mono">{Math.round(selectedTrack.height)}px</span>
            </div>
            <Slider
              value={[selectedTrack.height]}
              onValueChange={(values) => onTrackHeightChange?.(selectedTrack.id, values[0])}
              min={36}
              max={160}
              step={1}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>

          <div className={cn("grid gap-3", canMuteTrack ? "grid-cols-2" : "grid-cols-1")}>
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
              <div className="text-xs font-medium text-slate-200">Hide Track</div>
              <Switch
                checked={Boolean(selectedTrack.hidden)}
                onCheckedChange={(value) => onTrackHiddenChange?.(selectedTrack.id, Boolean(value))}
                className="data-[state=checked]:bg-[#34B27B]"
              />
            </div>
            {canMuteTrack ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                <div className="text-xs font-medium text-slate-200">Mute Track Audio</div>
                <Switch
                  checked={Boolean(selectedTrack.muted)}
                  onCheckedChange={(value) => onTrackMuteChange?.(selectedTrack.id, Boolean(value))}
                  className="data-[state=checked]:bg-[#34B27B]"
                />
              </div>
            ) : null}
          </div>

          {selectedTrack.type === 'generic' ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/90">
              Universal tracks accept clips, masks, audio, effects, speed, trim, zoom, annotation, and cursor items on the same row.
            </div>
          ) : null}

          {canAddItem ? (
            <Button
              onClick={() => onAddItemToTrack?.(selectedTrack.id)}
              className="w-full gap-2 bg-[#34B27B] text-white hover:bg-[#2da06d]"
            >
              <Star className="w-4 h-4" />
              {addLabel}
            </Button>
          ) : null}

          <Button
            onClick={() => onTrackDelete?.(selectedTrack.id)}
            variant="destructive"
            disabled={selectedTrack.type === 'recording' || selectedTrack.type === 'background'}
            className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" />
            Delete Track
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'screen' | 'background' | 'media' | 'emoji' | 'clips' | 'export')} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mb-4 w-full h-auto rounded-xl border border-white/5 bg-white/5 p-0.5 grid grid-cols-6 gap-0.5">
          <TabsTrigger value="screen" className={topLevelTabClassName}>
            Screen
          </TabsTrigger>
          <TabsTrigger value="background" className={topLevelTabClassName} title="Background">
            BG
          </TabsTrigger>
          <TabsTrigger value="media" className={topLevelTabClassName}>
            Media
          </TabsTrigger>
          <TabsTrigger value="emoji" className={topLevelTabClassName}>
            Emoji
          </TabsTrigger>
          <TabsTrigger value="clips" className={topLevelTabClassName}>
            Clips
          </TabsTrigger>
          <TabsTrigger value="export" className={topLevelTabClassName}>
            Export
          </TabsTrigger>
        </TabsList>
        <TabsContent value="screen" className="mt-0 space-y-4">
      {backgroundItems.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-slate-400">
          Background source selection and segment editing moved to the <span className="font-medium text-slate-200">Background</span> tab.
        </div>
      ) : null}
      {cursorEnabled && cursorTrack && onCursorStyleChange && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-200">Cursor</span>
            <span className="text-[10px] uppercase tracking-wider font-medium text-[#4C8BF5] bg-[#4C8BF5]/10 px-2 py-1 rounded-full">
              Active
            </span>
          </div>
          <div className="grid gap-3">
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Size</div>
                <span className="text-[10px] text-slate-400 font-mono">{Math.round(cursorTrack.style.sizePx)}px</span>
              </div>
              <Slider
                value={[cursorTrack.style.sizePx]}
                onValueChange={(values) => onCursorStyleChange({ sizePx: values[0] })}
                min={8}
                max={48}
                step={1}
                className="w-full [&_[role=slider]]:bg-[#4C8BF5] [&_[role=slider]]:border-[#4C8BF5]"
              />
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
              <div className="text-xs font-medium text-slate-200">Style</div>
              <Select
                value={cursorTrack.style.preset}
                onValueChange={(value) => onCursorStyleChange({ preset: value as CursorStyle['preset'] })}
              >
                <SelectTrigger className="h-8 text-xs bg-black/30 border-white/10 text-slate-200">
                  <SelectValue placeholder="Select cursor style" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                  <SelectItem value="arrow">Arrow</SelectItem>
                  <SelectItem value="dot">Dot</SelectItem>
                  <SelectItem value="circle">Circle</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Cursor Offset</div>
                <span className="text-[10px] text-slate-400 font-mono">{cursorTrack?.style?.offsetMs ?? 0}ms · {(cursorTrack?.style?.offsetX ?? 0)}px,{(cursorTrack?.style?.offsetY ?? 0)}px</span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Time (ms)</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={cursorTrack?.style?.offsetMs ?? 0}
                      onChange={(e) => onCursorStyleChange?.({ offsetMs: Number(e.target.value) })}
                      className="w-full p-2 rounded bg-black/20 text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => onCursorStyleChange?.({ offsetMs: (cursorTrack?.style?.offsetMs ?? 0) - 10 })}
                      className="px-2 py-1 rounded bg-white/5 text-slate-200"
                    >
                      -10
                    </button>
                    <button
                      type="button"
                      onClick={() => onCursorStyleChange?.({ offsetMs: (cursorTrack?.style?.offsetMs ?? 0) + 10 })}
                      className="px-2 py-1 rounded bg-white/5 text-slate-200"
                    >
                      +10
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">X (px)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cursorTrack?.style?.offsetX ?? 0}
                        onChange={(e) => onCursorStyleChange?.({ offsetX: Number(e.target.value) })}
                        className="w-full p-2 rounded bg-black/20 text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => onCursorStyleChange?.({ offsetX: (cursorTrack?.style?.offsetX ?? 0) - 1 })}
                        className="px-2 py-1 rounded bg-white/5 text-slate-200"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => onCursorStyleChange?.({ offsetX: (cursorTrack?.style?.offsetX ?? 0) + 1 })}
                        className="px-2 py-1 rounded bg-white/5 text-slate-200"
                      >
                        +1
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Y (px)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={cursorTrack?.style?.offsetY ?? 0}
                        onChange={(e) => onCursorStyleChange?.({ offsetY: Number(e.target.value) })}
                        className="w-full p-2 rounded bg-black/20 text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() => onCursorStyleChange?.({ offsetY: (cursorTrack?.style?.offsetY ?? 0) - 1 })}
                        className="px-2 py-1 rounded bg-white/5 text-slate-200"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => onCursorStyleChange?.({ offsetY: (cursorTrack?.style?.offsetY ?? 0) + 1 })}
                        className="px-2 py-1 rounded bg-white/5 text-slate-200"
                      >
                        +1
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
              <div className="text-xs font-medium text-slate-200">Path Smoothing</div>
              <Select
                value={cursorSmoothing || 'none'}
                onValueChange={(value) => onCursorSmoothingChange?.(value as CursorSmoothing)}
              >
                <SelectTrigger className="h-8 text-xs bg-black/30 border-white/10 text-slate-200">
                  <SelectValue placeholder="Smoothing" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="quadratic">Quadratic</SelectItem>
                  <SelectItem value="end2end">super end2end (smooth endpoints)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cursorSmoothing === 'quadratic' && (
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-3">
                <div className="text-xs font-medium text-slate-200">Quadratic smoothing strength</div>
                <div className="text-xs text-slate-400">Adjust how strongly quadratic smoothing curves the path</div>
                <Slider
                  value={[typeof quadraticSmoothingStrength === 'number' ? quadraticSmoothingStrength * 100 : 50]}
                  onValueChange={(vals) => onQuadraticSmoothingStrengthChange?.(Math.max(0, Math.min(1, vals[0] / 100)))}
                  min={0}
                  max={100}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#4C8BF5] [&_[role=slider]]:border-[#4C8BF5]"
                />
                <div className="text-xs text-slate-400 text-right">{Math.round((quadraticSmoothingStrength ?? 0.5) * 100)}%</div>
              </div>
            )}
            {cursorSmoothing === 'end2end' && end2endParams && (
              <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-3">
                <div className="text-xs font-medium text-slate-200">Dwell detection time</div>
                <div className="text-xs text-slate-400">How long the mouse must remain approximately still to count as a drop point</div>
                <Slider
                  value={[end2endParams.dwellTimeMs]}
                  onValueChange={(vals) => onEnd2endParamsChange?.({ dwellTimeMs: vals[0] })}
                  min={200}
                  max={600}
                  step={10}
                  className="w-full [&_[role=slider]]:bg-[#4C8BF5] [&_[role=slider]]:border-[#4C8BF5]"
                />

                <div className="text-xs font-medium text-slate-200">Dwell sensitivity</div>
                <div className="text-xs text-slate-400">Allowed small movement while considered 'still'</div>
                <Select
                  value={(() => {
                    const v = end2endParams.stillEpsilonPx;
                    if (v <= 2) return 'low';
                    if (v >= 5) return 'high';
                    return 'medium';
                  })()}
                  onValueChange={(val) => {
                    const mapping: Record<string, number> = { low: 2, medium: 3, high: 5 };
                    onEnd2endParamsChange?.({ stillEpsilonPx: mapping[val] ?? 3 });
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-black/30 border-white/10 text-slate-200">
                    <SelectValue placeholder="Sensitivity" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                    <SelectItem value="low">Low (stricter)</SelectItem>
                    <SelectItem value="medium">Medium (default)</SelectItem>
                    <SelectItem value="high">High (looser)</SelectItem>
                  </SelectContent>
                </Select>

                <div className="text-xs font-medium text-slate-200">Min move distance for new drop</div>
                <div className="text-xs text-slate-400">Prevent generating multiple drop points at the same location</div>
                <Slider
                  value={[end2endParams.minJumpDistancePx]}
                  onValueChange={(vals) => onEnd2endParamsChange?.({ minJumpDistancePx: vals[0] })}
                  min={10}
                  max={40}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#4C8BF5] [&_[role=slider]]:border-[#4C8BF5]"
                />

                <div className="text-xs font-medium text-slate-200">Minimum interval between drop points</div>
                <div className="text-xs text-slate-400">Minimum time between two generated drop points (ms)</div>
                <input
                  type="number"
                  value={end2endParams.minTimeBetweenEndpointsMs}
                  onChange={(e) => onEnd2endParamsChange?.({ minTimeBetweenEndpointsMs: Number(e.target.value) })}
                  min={100}
                  max={500}
                  step={10}
                  className="w-full p-2 rounded bg-black/20 text-slate-200"
                />

                <div className="text-xs font-medium text-slate-200">Arrival fraction</div>
                <div className="text-xs text-slate-400">Fraction of the segment duration used to move between drop points; smaller values make the cursor arrive and pause</div>
                <div className="flex items-center gap-3">
                  <Slider
                    value={[Math.round((end2endParams.arrivalFraction ?? 1) * 100)]}
                    onValueChange={(vals) => onEnd2endParamsChange?.({ arrivalFraction: Math.max(0.2, Math.min(1, vals[0] / 100)) })}
                    min={20}
                    max={100}
                    step={5}
                    className="w-full [&_[role=slider]]:bg-[#4C8BF5] [&_[role=slider]]:border-[#4C8BF5]"
                  />
                  <div className="text-xs text-slate-400 w-12 text-right">{Math.round((end2endParams.arrivalFraction ?? 1) * 100)}%</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-slate-200">Zoom Level</span>
          <div className="flex items-center gap-3">
            {zoomEnabled && selectedZoomDepth && (
              <span className="text-[10px] uppercase tracking-wider font-medium text-[#34B27B] bg-[#34B27B]/10 px-2 py-1 rounded-full">
                {ZOOM_DEPTH_OPTIONS.find(o => o.depth === selectedZoomDepth)?.label} Active
              </span>
            )}
            {/* Compact Zoom Follow toggle placed in header for visibility (only when a zoom region is selected) */}
            {selectedZoomId && (
              <div className="flex items-center gap-2">
                <div className="text-[11px] text-slate-400">Follow</div>
                <Switch
                  checked={zoomFollowEnabledLocal}
                  onCheckedChange={(v) => {
                    const next = typeof v === 'boolean' ? v : !zoomFollowEnabledLocal;
                    setZoomFollowEnabledLocal(next);
                    onZoomFollowEnabledChange?.(next);
                    try { (window as any).__openscreen_zoomFollowEnabled = Boolean(next); } catch {}
                  }}
                  className="data-[state=checked]:bg-[#34B27B] h-6 w-10"
                />
              </div>
            )}
            <KeyboardShortcutsHelp />
          </div>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {ZOOM_DEPTH_OPTIONS.map((option) => {
            const isActive = selectedZoomDepth === option.depth;
            return (
              <Button
                key={option.depth}
                type="button"
                disabled={!zoomEnabled}
                onClick={() => onZoomDepthChange?.(option.depth)}
                className={cn(
                  "h-auto w-full rounded-xl border px-1 py-3 text-center shadow-sm transition-all flex flex-col items-center justify-center gap-1.5",
                  "duration-200 ease-out",
                  zoomEnabled ? "opacity-100 cursor-pointer" : "opacity-40 cursor-not-allowed",
                  isActive
                    ? "border-[#34B27B] bg-[#34B27B] text-white shadow-[#34B27B]/20 scale-105 ring-2 ring-[#34B27B]/20"
                    : "border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:border-white/10 hover:text-slate-200"
                )}
              >
                <span className={cn("text-sm font-semibold tracking-tight")}>{option.label}</span>
              </Button>
            );
          })}
        </div>
        {!zoomEnabled && (
          <p className="text-xs text-slate-500 mt-3 text-center">Select a zoom region in the timeline to adjust depth.</p>
        )}
        {zoomEnabled && (
          <Button
            onClick={handleDeleteClick}
            variant="destructive"
            size="sm"
            className="mt-4 w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete Zoom Region
          </Button>
        )}
        {/* Zoom Follow Controls: only visible when a zoom region is selected */}
        {selectedZoomId && (
          <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-slate-200">Zoom Follow</div>
              {/* Mirror local state in main control */}
              <Switch
                checked={zoomFollowEnabledLocal}
                onCheckedChange={(v) => {
                  const next = typeof v === 'boolean' ? v : !zoomFollowEnabledLocal;
                  setZoomFollowEnabledLocal(next);
                  onZoomFollowEnabledChange?.(next);
                }}
                className="data-[state=checked]:bg-[#34B27B]"
              />
            </div>
            {zoomFollowEnabledLocal && (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Mode</div>
                  <Select
                    value={zoomFollowMode || 'center'}
                    onValueChange={(v) => onZoomFollowModeChange?.(v as ZoomFollowMode)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-black/30 border-white/10 text-slate-200">
                      <SelectValue placeholder="Mode" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                      <SelectItem value="center">Center on cursor</SelectItem>
                      <SelectItem value="anchor">Comming soon...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {zoomFollowMode === 'center' && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Delay (ms)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={zoomFollowDelayMs}
                        onChange={(e) => onZoomFollowDelayMsChange?.(Number(e.target.value))}
                        className="w-full p-2 rounded bg-black/20 text-slate-200"
                        min={0}
                      />
                      <div className="text-xs text-slate-400">ms</div>
                    </div>
                  </div>
                )}

                {zoomFollowMode === 'anchor' && (
                  <div>
                    <div className="text-xs text-slate-400 mb-1">Min padding (px)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={zoomFollowMinPaddingPx}
                        onChange={(e) => onZoomFollowMinPaddingPxChange?.(Number(e.target.value))}
                        className="w-full p-2 rounded bg-black/20 text-slate-200"
                        min={0}
                      />
                      <div className="text-xs text-slate-400">px</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Trim Delete Section */}
      <div className="mb-6">
        {trimEnabled && (
          <Button
            onClick={handleTrimDeleteClick}
            variant="destructive"
            size="sm"
            className="w-full gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Delete Trim Region
          </Button>
        )}
      </div>

      <div className="mb-6">
        <div className="grid gap-3">
          {/* Motion Blur Switch */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-xs font-medium text-slate-200">Motion Blur</div>
            <Switch
              checked={motionBlurEnabled}
              onCheckedChange={onMotionBlurChange}
              className="data-[state=checked]:bg-[#34B27B]"
            />
          </div>
          {backgroundItems.length === 0 ? (
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
              <div className="text-xs font-medium text-slate-200">Blur</div>
              <Switch
                checked={showBlur}
                onCheckedChange={onBlurChange}
                className="data-[state=checked]:bg-[#34B27B]"
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <div>
              <div className="text-xs font-medium text-slate-200">Safe Frame</div>
              <div className="text-[11px] text-slate-500">Preview-only frame guides for staging off-canvas animation.</div>
            </div>
            <Switch
              checked={showSafeFrameOverlay}
              onCheckedChange={onShowSafeFrameOverlayChange}
              className="data-[state=checked]:bg-[#34B27B]"
            />
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="grid grid-cols-2 gap-2.5">
          {/* Drop Shadow Slider */}
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Shadow</div>
              <span className="text-[10px] text-slate-400 font-mono">{Math.round(shadowIntensity * 100)}%</span>
            </div>
            <Slider
              value={[shadowIntensity]}
              onValueChange={(values) => onShadowChange?.(values[0])}
              min={0}
              max={1}
              step={0.01}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>
          {/* Corner Roundness Slider */}
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Roundness</div>
              <span className="text-[10px] text-slate-400 font-mono">{borderRadius}px</span>
            </div>
            <Slider
              value={[borderRadius]}
              onValueChange={(values) => onBorderRadiusChange?.(values[0])}
              min={0}
              max={16}
              step={0.5}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>
          {/* Padding Slider with Keyframes */}
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                Padding
                {paddingKeyframes.length > 0 && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                    {paddingKeyframes.length} keyframes
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const timeMs = Math.round(currentTime * 1000);
                    const existingIdx = paddingKeyframes.findIndex(kf => Math.abs(kf.timeMs - timeMs) < 50);
                    if (existingIdx >= 0) {
                      // Update existing keyframe
                      const updated = [...paddingKeyframes];
                      updated[existingIdx] = { ...updated[existingIdx], value: padding };
                      onPaddingKeyframesChange?.(updated);
                      toast.success('Keyframe updated');
                    } else {
                      // Add new keyframe
                      const newKf: PaddingKeyframe = {
                        id: `kf-${Date.now()}`,
                        timeMs,
                        value: padding,
                      };
                      onPaddingKeyframesChange?.([...paddingKeyframes, newKf]);
                      toast.success('Keyframe added');
                    }
                  }}
                  className="p-1 rounded hover:bg-white/10 text-yellow-400 transition-colors"
                  title="Add/Update keyframe at current time"
                >
                  <Star className="w-3 h-3" fill={paddingKeyframes.some(kf => Math.abs(kf.timeMs - currentTime * 1000) < 50) ? 'currentColor' : 'none'} />
                </button>
                {paddingKeyframes.length > 0 && (
                  <button
                    onClick={() => {
                      onPaddingKeyframesChange?.([]);
                      toast.info('All keyframes cleared');
                    }}
                    className="p-1 rounded hover:bg-white/10 text-red-400 transition-colors"
                    title="Clear all keyframes"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <span className="text-[10px] text-slate-400 font-mono ml-1">{padding}%</span>
              </div>
            </div>
            <Slider
              value={[padding]}
              onValueChange={(values) => onPaddingChange?.(values[0])}
              min={0}
              max={100}
              step={1}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
            {paddingKeyframes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {[...paddingKeyframes].sort((a, b) => a.timeMs - b.timeMs).map(kf => (
                  <button
                    key={kf.id}
                    onClick={() => {
                      const updated = paddingKeyframes.filter(k => k.id !== kf.id);
                      onPaddingKeyframesChange?.(updated);
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    title={`${(kf.timeMs / 1000).toFixed(1)}s: ${kf.value}% - Click to remove`}
                  >
                    {(kf.timeMs / 1000).toFixed(1)}s
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-[11px] text-slate-400">
          Move and resize the recording from the clip selection. Screen settings here only control crop, roundness, and the base size/keyframes.
        </div>
      </div>

      <div className="mb-4">
        <Button
          onClick={() => setShowCropDropdown(!showCropDropdown)}
          variant="outline"
          className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white h-9 transition-all"
        >
          <Crop className="w-4 h-4" />
          Crop Video
        </Button>
      </div>

      {showCropDropdown && cropRegion && onCropChange && (
        <>
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
            onClick={() => setShowCropDropdown(false)}
          />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-8 w-[90vw] max-w-5xl max-h-[90vh] overflow-auto animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-xl font-bold text-slate-200">Crop Video</span>
                <p className="text-sm text-slate-400 mt-2">Drag on each side to adjust the crop area</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCropDropdown(false)}
                className="hover:bg-white/10 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CropControl
              videoElement={videoElement || null}
              cropRegion={cropRegion}
              onCropChange={onCropChange}
              aspectRatio={aspectRatio}
            />
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowCropDropdown(false)}
                size="lg"
                className="bg-[#34B27B] hover:bg-[#34B27B]/90 text-white"
              >
                Done
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 text-[11px] text-slate-500">
        Background source picking lives in the <span className="font-medium text-slate-300">Background</span> tab so screen controls stay focused on the canvas and recording.
      </div>

        </TabsContent>
        <TabsContent value="background" className="mt-0 space-y-4">
          {renderBackgroundTimelineList()}
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-slate-400">
            Select a background segment from the timeline list to edit it. Use <span className="font-medium text-slate-200">New Segment</span> to clear selection, then pick a source below to add another background at the playhead.
          </div>
          {renderBackgroundSegmentInspector()}
          {renderBackgroundSourcePicker()}
        </TabsContent>
        <TabsContent value="media" className="mt-0 space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Imported Media</div>
              <span className="text-[10px] text-slate-400 font-mono">
                {mediaAssets.length} assets - {clipCount} visual - {audioClipCount} audio
              </span>
            </div>
            <Button
              type="button"
              onClick={onVideoAssetAdd}
              className="w-full gap-2 bg-white/5 text-slate-200 border border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all"
              variant="outline"
            >
              <Upload className="w-4 h-4" />
              Upload Media
            </Button>
            <p className="text-[11px] text-slate-500">
              Upload video, image, or audio, then drag it to the timeline or add it at the playhead.
            </p>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Default Image Duration</div>
                <div className="text-[10px] text-slate-400 font-mono">
                  {(defaultImageClipDurationMs / 1000).toFixed(1)}s
                </div>
              </div>
              <Slider
                value={[defaultImageClipDurationMs / 1000]}
                onValueChange={(values) => onDefaultImageClipDurationMsChange?.(Math.max(500, Math.round(values[0] * 1000)))}
                min={1}
                max={30}
                step={0.5}
                className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
              />
              <div className="text-[10px] text-slate-500">
                New image clips use this duration when you add them to the timeline.
              </div>
            </div>
            <div className="pt-3 border-t border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Visual Library</div>
                <span className="text-[10px] text-slate-500">Video and image assets</span>
              </div>
              <div className="grid gap-2">
                {videoMediaAssets.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-white/10 rounded-xl">
                    No visual assets yet
                  </div>
                ) : (
                  videoMediaAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-clip-asset', asset.id);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/20">
                          {asset.kind === 'image' ? (
                            <img
                              src={asset.src}
                              alt={asset.name}
                              className="h-full w-full object-cover"
                              draggable={false}
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              {getVisualAssetKindLabel(asset)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-slate-200 truncate">{asset.name}</div>
                          <div className="text-[10px] text-slate-500">
                            {getVisualAssetKindLabel(asset)} - {(getVisualAssetDurationMs(asset) / 1000).toFixed(1)}s
                            {asset.width > 0 && asset.height > 0 ? ` - ${asset.width}x${asset.height}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-slate-200 hover:text-white hover:bg-white/10"
                          onClick={() => onClipAddToTimeline?.(asset.id)}
                        >
                          Add
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-emerald-200 hover:text-white hover:bg-emerald-500/10"
                          onClick={() => onBackgroundAssetAdd?.(asset.id)}
                        >
                          Background
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => onVideoAssetRemove?.(asset.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="pt-3 border-t border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Audio Library</div>
                <span className="text-[10px] text-slate-500">Timeline audio track</span>
              </div>
              <div className="grid gap-2">
                {audioMediaAssets.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-white/10 rounded-xl">
                    No audio assets yet
                  </div>
                ) : (
                  audioMediaAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-audio-asset', asset.id);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-slate-200 truncate">{asset.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {(asset.durationMs / 1000).toFixed(1)}s
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-slate-200 hover:text-white hover:bg-white/10"
                          onClick={() => onAudioAddToTimeline?.(asset.id)}
                        >
                          Add
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => onVideoAssetRemove?.(asset.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="emoji" className="mt-0 space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Emoji Library</div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Annotation</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Click any emoji to add a new emoji annotation at the playhead. After insertion, select it on the canvas or timeline to edit timing, placement, layer, and transitions.
            </p>
            <EmojiPickerPanel
              onSelect={(emoji) => onAnnotationEmojiAdd?.({
                src: emoji.src,
                alt: emoji.name,
                category: emoji.category,
              })}
              searchPlaceholder="Search emoji to add..."
            />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-[11px] text-slate-400">
            Emoji annotations are added on the annotation track. They can be moved, resized, and keyed just like other overlay elements after creation.
          </div>
        </TabsContent>
        <TabsContent value="clips" className="mt-0 space-y-4">
          {!selectedClip || !onClipChange ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
              <div className="text-sm font-medium text-slate-200">No clip selected</div>
              <p className="mt-2 text-xs text-slate-500">
                Select a visual clip on the timeline to edit placement, crop, transitions, chroma key, and corner radius here.
              </p>
            </div>
          ) : null}
          {selectedClip && onClipChange && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              {selectedClipIsRecording && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
                  Recording transform is edited here now. Crop and roundness still live in the Screen tab.
                </div>
              )}
              {onMaskAdd && (
                <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 px-3 py-3 space-y-2">
                  <div className="text-[11px] text-teal-100/90">
                    Add a timeline mask targeted at this clip. Rectangle and ellipse masks render in preview and export and can be moved or resized on the canvas.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#14b8a6] text-white hover:bg-[#0f9f90]"
                      onClick={() => onMaskAdd(selectedClip.id, 'rect')}
                    >
                      Add Rectangle Mask
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:text-white"
                      onClick={() => onMaskAdd(selectedClip.id, 'ellipse')}
                    >
                      Add Ellipse Mask
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:text-white"
                      onClick={() => onMaskAdd(selectedClip.id, 'path')}
                    >
                      Add Path Mask
                    </Button>
                  </div>
                </div>
              )}
              {selectedClipPlacement && (
                <div className="contents">
                <div className="pt-1">
                  <div className="text-[11px] text-slate-400 mb-2">Placement</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">X: {Math.round(selectedClipPlacement.x)}%</div>
                      <Slider
                        value={[selectedClipPlacement.x]}
                        onValueChange={(values) => updateSelectedClipPlacement({ x: values[0] })}
                        min={CLIP_TRANSFORM_POSITION_RANGE.min}
                        max={CLIP_TRANSFORM_POSITION_RANGE.max}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Y: {Math.round(selectedClipPlacement.y)}%</div>
                      <Slider
                        value={[selectedClipPlacement.y]}
                        onValueChange={(values) => updateSelectedClipPlacement({ y: values[0] })}
                        min={CLIP_TRANSFORM_POSITION_RANGE.min}
                        max={CLIP_TRANSFORM_POSITION_RANGE.max}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Width: {Math.round(selectedClipPlacement.width)}%</div>
                      <Slider
                        value={[selectedClipPlacement.width]}
                        onValueChange={(values) => updateSelectedClipPlacement({ width: values[0] })}
                        min={CLIP_TRANSFORM_SIZE_RANGE.min}
                        max={CLIP_TRANSFORM_SIZE_RANGE.max}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Height: {Math.round(selectedClipPlacement.height)}%</div>
                      <Slider
                        value={[selectedClipPlacement.height]}
                        onValueChange={(values) => updateSelectedClipPlacement({ height: values[0] })}
                        min={CLIP_TRANSFORM_SIZE_RANGE.min}
                        max={CLIP_TRANSFORM_SIZE_RANGE.max}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                      />
                    </div>
                  </div>
                </div>
                {selectedClipTransformState && (
                  <div className="pt-1">
                    <div className="text-[11px] text-slate-400 mb-2">Transform</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1">Rotation: {Math.round(selectedClipTransformState.rotationDeg)}°</div>
                        <Slider
                          value={[selectedClipTransformState.rotationDeg]}
                          onValueChange={(values) => updateSelectedClipTransform({ rotationDeg: values[0] })}
                          min={-180}
                          max={180}
                          step={1}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1">Scale: {Math.round(selectedClipTransformState.scale * 100)}%</div>
                        <Slider
                          value={[selectedClipTransformState.scale * 100]}
                          onValueChange={(values) => updateSelectedClipTransform({ scale: values[0] / 100 })}
                          min={10}
                          max={300}
                          step={1}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                        />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500 mb-1">Opacity: {Math.round(selectedClipTransformState.opacity * 100)}%</div>
                        <Slider
                          value={[selectedClipTransformState.opacity * 100]}
                          onValueChange={(values) => updateSelectedClipTransform({ opacity: values[0] / 100 })}
                          min={0}
                          max={100}
                          step={1}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[11px] text-slate-300">Transform Keyframes</div>
                        <div className="text-[10px] text-slate-500">
                          Add a keyframe at the playhead, then move, resize, rotate, scale, or fade the clip later to animate it.
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {selectedClip.transformKeyframes?.length ?? 0} keyframes
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!canEditSelectedClipTransformKeyframes}
                        className="gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white disabled:opacity-40"
                        onClick={() => onClipTransformKeyframeAddOrUpdate?.(selectedClip.id)}
                      >
                        <Star className="w-3 h-3" fill={selectedClipTransformKeyframe ? 'currentColor' : 'none'} />
                        {selectedClipTransformKeyframe ? 'Update Keyframe' : 'Add Keyframe'}
                      </Button>
                      {(selectedClip.transformKeyframes?.length ?? 0) > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-slate-400 hover:text-white hover:bg-white/10"
                          onClick={() => {
                            onClipTransformKeyframesClear?.(selectedClip.id);
                            toast.info('Transform keyframes cleared');
                          }}
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    {!canEditSelectedClipTransformKeyframes && (
                      <div className="text-[10px] text-slate-500">
                        Move the playhead onto the clip to add or update transform keyframes.
                      </div>
                    )}
                    {(selectedClip.transformKeyframes?.length ?? 0) > 0 && (
                      <div className="space-y-1.5">
                        {[...(selectedClip.transformKeyframes ?? [])]
                          .sort((a, b) => a.timeMs - b.timeMs)
                          .map((keyframe, index, keyframes) => {
                            const isCurrent = Math.abs(keyframe.timeMs - currentTimeMs) <= 50;
                            const hasNextSegment = index < keyframes.length - 1;
                            return (
                              <div
                                key={keyframe.id}
                                className={cn(
                                  "rounded-lg border px-3 py-2 text-[11px]",
                                  isCurrent
                                    ? "border-[#34B27B]/30 bg-[#34B27B]/10 text-slate-100"
                                    : "border-white/10 bg-white/5 text-slate-300"
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="font-mono">
                                    {(keyframe.timeMs / 1000).toFixed(2)}s
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                                    onClick={() => onClipTransformKeyframeDelete?.(selectedClip.id, keyframe.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                                <div className="mt-2">
                                  {hasNextSegment ? (
                                    <div className="space-y-1">
                                      <div className="text-[10px] text-slate-500">To next: curve</div>
                                      <BezierCurveEditor
                                        value={keyframe.curveToNext ?? LINEAR_BEZIER}
                                        onChange={(curve) => onClipTransformKeyframeCurveChange?.(
                                          selectedClip.id,
                                          keyframe.id,
                                          curve,
                                        )}
                                      />
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-slate-500">
                                      Final keyframe
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                {selectedClipAsset?.kind === 'recording' && !selectedClipIsRecording && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/90">
                    This continued recording inherits roundness from the Screen tab.
                  </div>
                )}
                {!selectedClipUsesScreenRoundness && (
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">Corner Radius</div>
                    <Slider
                      value={[selectedClip.borderRadius ?? 0]}
                      onValueChange={(values) => onClipChange(selectedClip.id, { borderRadius: values[0] })}
                      min={0}
                      max={32}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                    />
                  </div>
                )}
                </div>
              )}
                {!selectedClipIsRecording && (
                  <>
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Fit</div>
                      <Select
                        value={selectedClip.fit ?? 'contain'}
                        onValueChange={(value) => onClipChange(selectedClip.id, { fit: value as VideoClipFit })}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
                          <SelectValue placeholder="Select fit" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                          <SelectItem value="contain">Fit (no crop)</SelectItem>
                          <SelectItem value="cover">Fill (crop)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="pt-2 border-t border-white/5">
                      <div className="text-[11px] text-slate-400 mb-2">Source Crop</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">X: {selectedClip.crop?.x ?? 0}%</div>
                          <Slider
                            value={[selectedClip.crop?.x ?? 0]}
                            onValueChange={(values) => onClipChange(selectedClip.id, {
                              crop: {
                                x: values[0],
                                y: selectedClip.crop?.y ?? 0,
                                width: Math.min(selectedClip.crop?.width ?? 100, 100 - values[0]),
                                height: selectedClip.crop?.height ?? 100
                              }
                            })}
                            min={0}
                            max={90}
                            step={1}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Y: {selectedClip.crop?.y ?? 0}%</div>
                          <Slider
                            value={[selectedClip.crop?.y ?? 0]}
                            onValueChange={(values) => onClipChange(selectedClip.id, {
                              crop: {
                                x: selectedClip.crop?.x ?? 0,
                                y: values[0],
                                width: selectedClip.crop?.width ?? 100,
                                height: Math.min(selectedClip.crop?.height ?? 100, 100 - values[0])
                              }
                            })}
                            min={0}
                            max={90}
                            step={1}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Width: {selectedClip.crop?.width ?? 100}%</div>
                          <Slider
                            value={[selectedClip.crop?.width ?? 100]}
                            onValueChange={(values) => onClipChange(selectedClip.id, {
                              crop: {
                                x: selectedClip.crop?.x ?? 0,
                                y: selectedClip.crop?.y ?? 0,
                                width: values[0],
                                height: selectedClip.crop?.height ?? 100
                              }
                            })}
                            min={10}
                            max={100 - (selectedClip.crop?.x ?? 0)}
                            step={1}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Height: {selectedClip.crop?.height ?? 100}%</div>
                          <Slider
                            value={[selectedClip.crop?.height ?? 100]}
                            onValueChange={(values) => onClipChange(selectedClip.id, {
                              crop: {
                                x: selectedClip.crop?.x ?? 0,
                                y: selectedClip.crop?.y ?? 0,
                                width: selectedClip.crop?.width ?? 100,
                                height: values[0]
                              }
                            })}
                            min={10}
                            max={100 - (selectedClip.crop?.y ?? 0)}
                            step={1}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                      </div>
                      {(selectedClip.crop && (selectedClip.crop.x !== 0 || selectedClip.crop.y !== 0 || selectedClip.crop.width !== 100 || selectedClip.crop.height !== 100)) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="w-full mt-2 text-xs text-slate-400 hover:text-white"
                          onClick={() => onClipChange(selectedClip.id, { crop: { x: 0, y: 0, width: 100, height: 100 } })}
                        >
                          Reset Crop
                        </Button>
                      )}
                    </div>
                  </>
                )}
                <div className="pt-2 border-t border-white/5">
                  <div className="text-[11px] text-slate-400 mb-2">
                    {selectedClipAsset?.kind === 'image'
                      ? 'Chroma Key (Green Screen / Image Background Removal)'
                      : 'Chroma Key (Green Screen)'}
                  </div>
                  <div className="grid gap-2">
                    {selectedClipAsset?.kind === 'image' && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/90">
                        Image clips use the same chroma-key controls and renderer path as video clips.
                      </div>
                    )}
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                      <div className="text-xs text-slate-200">Enable</div>
                      <Switch
                        checked={Boolean(selectedClip.chromaKey?.enabled)}
                        onCheckedChange={(value) => onClipChange(selectedClip.id, {
                          chromaKey: {
                            enabled: Boolean(value),
                            color: selectedClip.chromaKey?.color ?? '#00ff00',
                            threshold: selectedClip.chromaKey?.threshold ?? 0.35,
                            softness: selectedClip.chromaKey?.softness ?? 0.15,
                          },
                        })}
                        className="data-[state=checked]:bg-[#34B27B]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-[10px] text-slate-400 mb-1">Key Color</div>
                        <input
                          type="color"
                          value={selectedClip.chromaKey?.color ?? '#00ff00'}
                          onChange={(e) => onClipChange(selectedClip.id, {
                            chromaKey: {
                              enabled: selectedClip.chromaKey?.enabled ?? false,
                              color: e.target.value,
                              threshold: selectedClip.chromaKey?.threshold ?? 0.35,
                              softness: selectedClip.chromaKey?.softness ?? 0.15,
                            },
                          })}
                          className="w-full h-8 rounded bg-transparent border border-white/10"
                        />
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-[10px] text-slate-400 mb-1">Threshold: {Math.round((selectedClip.chromaKey?.threshold ?? 0.35) * 100)}%</div>
                        <Slider
                          value={[selectedClip.chromaKey?.threshold ?? 0.35]}
                          onValueChange={(values) => onClipChange(selectedClip.id, {
                            chromaKey: {
                              enabled: selectedClip.chromaKey?.enabled ?? false,
                              color: selectedClip.chromaKey?.color ?? '#00ff00',
                              threshold: values[0],
                              softness: selectedClip.chromaKey?.softness ?? 0.15,
                            },
                          })}
                          min={0}
                          max={1}
                          step={0.01}
                          className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                        />
                      </div>
                    </div>
                      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-[10px] text-slate-400 mb-1">Softness: {Math.round((selectedClip.chromaKey?.softness ?? 0.15) * 100)}%</div>
                        <Slider
                          value={[selectedClip.chromaKey?.softness ?? 0.15]}
                          onValueChange={(values) => onClipChange(selectedClip.id, {
                            chromaKey: {
                              enabled: selectedClip.chromaKey?.enabled ?? false,
                              color: selectedClip.chromaKey?.color ?? '#00ff00',
                              threshold: selectedClip.chromaKey?.threshold ?? 0.35,
                              softness: values[0],
                            },
                          })}
                          min={0}
                        max={1}
                        step={0.01}
                        className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                      />
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/5">
                  <div className="text-[11px] text-slate-400 mb-2">Transition Effects</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Enter Effect</div>
                      <Select
                        value={selectedClip.enterEffect ?? 'none'}
                        onValueChange={(value) => onClipChange(selectedClip.id, { enterEffect: value as VideoClipEffect })}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-8 text-xs">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="fade">Fade</SelectItem>
                          <SelectItem value="pixel">Pixel</SelectItem>
                          <SelectItem value="slide-left">Slide From Left</SelectItem>
                          <SelectItem value="slide-right">Slide From Right</SelectItem>
                          <SelectItem value="slide-up">Slide From Top</SelectItem>
                          <SelectItem value="slide-down">Slide From Bottom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Exit Effect</div>
                      <Select
                        value={selectedClip.exitEffect ?? 'none'}
                        onValueChange={(value) => onClipChange(selectedClip.id, { exitEffect: value as VideoClipEffect })}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-8 text-xs">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="fade">Fade</SelectItem>
                          <SelectItem value="pixel">Pixel</SelectItem>
                          <SelectItem value="slide-left">Slide To Left</SelectItem>
                          <SelectItem value="slide-right">Slide To Right</SelectItem>
                          <SelectItem value="slide-up">Slide To Top</SelectItem>
                          <SelectItem value="slide-down">Slide To Bottom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {(selectedClip.enterEffect !== 'none' || selectedClip.exitEffect !== 'none') && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {selectedClip.enterEffect && selectedClip.enterEffect !== 'none' && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Enter Duration: {selectedClip.fadeInMs ?? 300}ms</div>
                          <Slider
                            value={[selectedClip.fadeInMs ?? 300]}
                            onValueChange={(values) => onClipChange(selectedClip.id, { fadeInMs: values[0] })}
                            min={100}
                            max={1500}
                            step={50}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                      )}
                      {selectedClip.exitEffect && selectedClip.exitEffect !== 'none' && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Exit Duration: {selectedClip.fadeOutMs ?? 300}ms</div>
                          <Slider
                            value={[selectedClip.fadeOutMs ?? 300]}
                            onValueChange={(values) => onClipChange(selectedClip.id, { fadeOutMs: values[0] })}
                            min={100}
                            max={1500}
                            step={50}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              <p className="text-[11px] text-slate-500">
                Adjust crop to show only a portion of the source video.
              </p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="export" className="mt-0 space-y-4">
          <div className="pt-1">
            <div className="mb-2 text-xs font-medium text-slate-400">Export Quality</div>
            <div className="mb-2.5 bg-white/5 border border-white/5 p-1 w-full grid grid-cols-3 h-auto rounded-xl">
              <button
                onClick={() => onExportQualityChange?.('medium')}
                className={cn(
                  "py-2 rounded-lg transition-all text-xs font-medium",
                  exportQuality === 'medium'
                    ? "bg-white text-black"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Low
              </button>
              <button
                onClick={() => onExportQualityChange?.('good')}
                className={cn(
                  "py-2 rounded-lg transition-all text-xs font-medium",
                  exportQuality === 'good'
                    ? "bg-white text-black"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                Medium
              </button>
              <button
                onClick={() => onExportQualityChange?.('source')}
                className={cn(
                  "py-2 rounded-lg transition-all text-xs font-medium",
                  exportQuality === 'source'
                    ? "bg-white text-black"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                High
              </button>
            </div>

            <Button
              type="button"
              size="lg"
              onClick={onExport}
              className="w-full py-6 text-lg font-semibold flex items-center justify-center gap-3 bg-[#34B27B] text-white rounded-xl shadow-lg shadow-[#34B27B]/20 hover:bg-[#34B27B]/90 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
            >
              <Download className="w-5 h-5" />
              <span>Export Video</span>
            </Button>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  window.electronAPI?.openExternalUrl('https://github.com/siddharthvaddem/openscreen/issues/new/choose');
                }}
                className="flex-1 flex items-center justify-center gap-2 text-xs py-2"
              >
                <Bug className="w-3 h-3 text-[#34B27B]" />
                <span>Report a Bug</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  window.electronAPI?.openExternalUrl('https://github.com/siddharthvaddem/openscreen');
                }}
                className="flex-1 flex items-center justify-center gap-2 text-xs"
              >
                <Star className="w-3 h-3 text-yellow-400" />
                <span>Star on GitHub</span>
              </button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
