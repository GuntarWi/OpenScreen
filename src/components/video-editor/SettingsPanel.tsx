import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { getAssetPath } from "@/lib/assetPath";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import Block from '@uiw/react-color-block';
import { Trash2, Download, Crop, X, Bug, Upload, Star } from "lucide-react";
import { toast } from "sonner";
import type { ZoomDepth, CropRegion, AnnotationRegion, AnnotationType, CursorTrack, CursorStyle, CursorSmoothing, End2EndParams, ZoomFollowMode, EffectRegion, ScreenOffset, OverlayVideoAsset, OverlayVideoRegion, OverlayVideoFit, OverlayEffect, PaddingKeyframe } from "./types";
import { CropControl } from "./CropControl";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { EffectSettingsPanel } from "./EffectSettingsPanel";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import type { ExportQuality } from "@/lib/exporter";

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
  overlayAssets?: OverlayVideoAsset[];
  overlayRegions?: OverlayVideoRegion[];
  selectedOverlayId?: string | null;
  onOverlayAssetAdd?: () => void;
  onOverlayAssetRemove?: (id: string) => void;
  onOverlayAddToTimeline?: (assetId: string) => void;
  onOverlayRegionChange?: (id: string, patch: Partial<OverlayVideoRegion>) => void;
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
  onAnnotationLayerChange?: (id: string, layer: AnnotationRegion['layer']) => void;
  onAnnotationFigureDataChange?: (id: string, figureData: any) => void;
  onAnnotationDelete?: (id: string) => void;
  effectRegions?: EffectRegion[];
  selectedEffectId?: string | null;
  onEffectChange?: (id: string, patch: Partial<EffectRegion>) => void;
  onEffectDelete?: (id: string) => void;
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
  onScreenOffsetChange,
  overlayAssets = [],
  overlayRegions = [],
  selectedOverlayId,
  onOverlayAssetAdd,
  onOverlayAssetRemove,
  onOverlayAddToTimeline,
  onOverlayRegionChange,
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
  onAnnotationLayerChange,
  onAnnotationFigureDataChange,
  onAnnotationDelete,
  effectRegions = [],
  selectedEffectId,
  onEffectChange,
  onEffectDelete,
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
  const [showCropDropdown, setShowCropDropdown] = useState(false);
  const screenOffsetX = screenOffset?.x ?? 0;
  const screenOffsetY = screenOffset?.y ?? 0;
  const overlayCount = overlayRegions.length;
  const selectedOverlay = selectedOverlayId
    ? overlayRegions.find((region) => region.id === selectedOverlayId) ?? null
    : null;
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

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
      <Tabs defaultValue="screen" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mb-4 bg-white/5 border border-white/5 p-1 w-full grid grid-cols-2 h-auto rounded-xl">
          <TabsTrigger value="screen" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">
            Screen
          </TabsTrigger>
          <TabsTrigger value="overlays" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">
            Overlays
          </TabsTrigger>
        </TabsList>
        <TabsContent value="screen" className="mt-0 space-y-4">
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
        <div className="grid grid-cols-2 gap-3">
          {/* Motion Blur Switch */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-xs font-medium text-slate-200">Motion Blur</div>
            <Switch
              checked={motionBlurEnabled}
              onCheckedChange={onMotionBlurChange}
              className="data-[state=checked]:bg-[#34B27B]"
            />
          </div>
          {/* Blur Background Switch */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
            <div className="text-xs font-medium text-slate-200">Blur</div>
            <Switch
              checked={showBlur}
              onCheckedChange={onBlurChange}
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
        <div className="grid grid-cols-2 gap-2.5 mt-2">
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Position X</div>
              <span className="text-[10px] text-slate-400 font-mono">{Math.round(screenOffsetX)}%</span>
            </div>
            <Slider
              value={[screenOffsetX]}
              onValueChange={(values) => onScreenOffsetChange?.({ x: values[0] })}
              min={-50}
              max={50}
              step={1}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>
          <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Position Y</div>
              <span className="text-[10px] text-slate-400 font-mono">{Math.round(screenOffsetY)}%</span>
            </div>
            <Slider
              value={[screenOffsetY]}
              onValueChange={(values) => onScreenOffsetChange?.({ y: values[0] })}
              min={-50}
              max={50}
              step={1}
              className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
            />
          </div>
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

      <Tabs defaultValue="image" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mb-4 bg-white/5 border border-white/5 p-1 w-full grid grid-cols-3 h-auto rounded-xl">
          <TabsTrigger value="image" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Image</TabsTrigger>
          <TabsTrigger value="color" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Color</TabsTrigger>
          <TabsTrigger value="gradient" className="data-[state=active]:bg-[#34B27B] data-[state=active]:text-white text-slate-400 py-2 rounded-lg transition-all">Gradient</TabsTrigger>
        </TabsList>
        
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
          <TabsContent value="image" className="mt-0 space-y-3 px-2">
            {/* Upload Button */}
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
              {/* Custom Images */}
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

              {/* Preset Wallpapers */}
              {(wallpaperPaths.length > 0 ? wallpaperPaths : WALLPAPER_RELATIVE.map(p => `/${p}`)).map((path, idx) => {
                const isSelected = (() => {
                  if (!selected) return false;
                  if (selected === path) return true;
                  try {
                    const clean = (s: string) => s.replace(/^file:\/\//, '').replace(/^\//, '')
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
                )
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
        </div>
      </Tabs>

      <div className="mt-4 pt-4 border-t border-white/5">
        <div className="mb-2 text-xs font-medium text-slate-400">Export Quality</div>
        {/* Export Quality Button Group */}
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
        <TabsContent value="overlays" className="mt-0 space-y-4">
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Overlay Videos</div>
              <span className="text-[10px] text-slate-400 font-mono">
                {overlayAssets.length} assets - {overlayCount} on timeline
              </span>
            </div>
            <Button
              type="button"
              onClick={onOverlayAssetAdd}
              className="w-full gap-2 bg-white/5 text-slate-200 border border-white/10 hover:bg-[#34B27B] hover:text-white hover:border-[#34B27B] transition-all"
              variant="outline"
            >
              <Upload className="w-4 h-4" />
              Upload Video
            </Button>
            <p className="text-[11px] text-slate-500">
              Drag a video to the timeline overlay row, or tap Add to place at the playhead.
            </p>
          </div>
          {selectedOverlay && onOverlayRegionChange && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Selected Overlay</div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {Math.round(selectedOverlay.borderRadius ?? 0)}px
                </span>
              </div>
              <div className="grid gap-3">
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Corner Radius</div>
                  <Slider
                    value={[selectedOverlay.borderRadius ?? 0]}
                    onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { borderRadius: values[0] })}
                    min={0}
                    max={32}
                    step={1}
                    className="w-full [&_[role=slider]]:bg-[#34B27B] [&_[role=slider]]:border-[#34B27B]"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Fit</div>
                  <Select
                    value={selectedOverlay.fit ?? 'contain'}
                    onValueChange={(value) => onOverlayRegionChange(selectedOverlay.id, { fit: value as OverlayVideoFit })}
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
                      <div className="text-[10px] text-slate-500 mb-1">X: {selectedOverlay.crop?.x ?? 0}%</div>
                      <Slider
                        value={[selectedOverlay.crop?.x ?? 0]}
                        onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { 
                          crop: { 
                            x: values[0], 
                            y: selectedOverlay.crop?.y ?? 0, 
                            width: Math.min(selectedOverlay.crop?.width ?? 100, 100 - values[0]), 
                            height: selectedOverlay.crop?.height ?? 100 
                          } 
                        })}
                        min={0}
                        max={90}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Y: {selectedOverlay.crop?.y ?? 0}%</div>
                      <Slider
                        value={[selectedOverlay.crop?.y ?? 0]}
                        onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { 
                          crop: { 
                            x: selectedOverlay.crop?.x ?? 0, 
                            y: values[0], 
                            width: selectedOverlay.crop?.width ?? 100, 
                            height: Math.min(selectedOverlay.crop?.height ?? 100, 100 - values[0]) 
                          } 
                        })}
                        min={0}
                        max={90}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Width: {selectedOverlay.crop?.width ?? 100}%</div>
                      <Slider
                        value={[selectedOverlay.crop?.width ?? 100]}
                        onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { 
                          crop: { 
                            x: selectedOverlay.crop?.x ?? 0, 
                            y: selectedOverlay.crop?.y ?? 0, 
                            width: values[0], 
                            height: selectedOverlay.crop?.height ?? 100 
                          } 
                        })}
                        min={10}
                        max={100 - (selectedOverlay.crop?.x ?? 0)}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                      />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Height: {selectedOverlay.crop?.height ?? 100}%</div>
                      <Slider
                        value={[selectedOverlay.crop?.height ?? 100]}
                        onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { 
                          crop: { 
                            x: selectedOverlay.crop?.x ?? 0, 
                            y: selectedOverlay.crop?.y ?? 0, 
                            width: selectedOverlay.crop?.width ?? 100, 
                            height: values[0] 
                          } 
                        })}
                        min={10}
                        max={100 - (selectedOverlay.crop?.y ?? 0)}
                        step={1}
                        className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                      />
                    </div>
                  </div>
                  {(selectedOverlay.crop && (selectedOverlay.crop.x !== 0 || selectedOverlay.crop.y !== 0 || selectedOverlay.crop.width !== 100 || selectedOverlay.crop.height !== 100)) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="w-full mt-2 text-xs text-slate-400 hover:text-white"
                      onClick={() => onOverlayRegionChange(selectedOverlay.id, { crop: { x: 0, y: 0, width: 100, height: 100 } })}
                    >
                      Reset Crop
                    </Button>
                  )}
                </div>
                <div className="pt-2 border-t border-white/5">
                  <div className="text-[11px] text-slate-400 mb-2">Chroma Key (Green Screen)</div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                      <div className="text-xs text-slate-200">Enable</div>
                      <Switch
                        checked={Boolean(selectedOverlay.chromaKey?.enabled)}
                        onCheckedChange={(value) => onOverlayRegionChange(selectedOverlay.id, {
                          chromaKey: {
                            enabled: Boolean(value),
                            color: selectedOverlay.chromaKey?.color ?? '#00ff00',
                            threshold: selectedOverlay.chromaKey?.threshold ?? 0.35,
                            softness: selectedOverlay.chromaKey?.softness ?? 0.15,
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
                          value={selectedOverlay.chromaKey?.color ?? '#00ff00'}
                          onChange={(e) => onOverlayRegionChange(selectedOverlay.id, {
                            chromaKey: {
                              enabled: selectedOverlay.chromaKey?.enabled ?? false,
                              color: e.target.value,
                              threshold: selectedOverlay.chromaKey?.threshold ?? 0.35,
                              softness: selectedOverlay.chromaKey?.softness ?? 0.15,
                            },
                          })}
                          className="w-full h-8 rounded bg-transparent border border-white/10"
                        />
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-[10px] text-slate-400 mb-1">Threshold: {Math.round((selectedOverlay.chromaKey?.threshold ?? 0.35) * 100)}%</div>
                        <Slider
                          value={[selectedOverlay.chromaKey?.threshold ?? 0.35]}
                          onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, {
                            chromaKey: {
                              enabled: selectedOverlay.chromaKey?.enabled ?? false,
                              color: selectedOverlay.chromaKey?.color ?? '#00ff00',
                              threshold: values[0],
                              softness: selectedOverlay.chromaKey?.softness ?? 0.15,
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
                      <div className="text-[10px] text-slate-400 mb-1">Softness: {Math.round((selectedOverlay.chromaKey?.softness ?? 0.15) * 100)}%</div>
                      <Slider
                        value={[selectedOverlay.chromaKey?.softness ?? 0.15]}
                        onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, {
                          chromaKey: {
                            enabled: selectedOverlay.chromaKey?.enabled ?? false,
                            color: selectedOverlay.chromaKey?.color ?? '#00ff00',
                            threshold: selectedOverlay.chromaKey?.threshold ?? 0.35,
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
                        value={selectedOverlay.enterEffect ?? 'none'}
                        onValueChange={(value) => onOverlayRegionChange(selectedOverlay.id, { enterEffect: value as OverlayEffect })}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-8 text-xs">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="fade">Fade</SelectItem>
                          <SelectItem value="pixel">Pixel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1">Exit Effect</div>
                      <Select
                        value={selectedOverlay.exitEffect ?? 'none'}
                        onValueChange={(value) => onOverlayRegionChange(selectedOverlay.id, { exitEffect: value as OverlayEffect })}
                      >
                        <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-8 text-xs">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="fade">Fade</SelectItem>
                          <SelectItem value="pixel">Pixel</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {(selectedOverlay.enterEffect !== 'none' || selectedOverlay.exitEffect !== 'none') && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {selectedOverlay.enterEffect && selectedOverlay.enterEffect !== 'none' && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Fade In: {selectedOverlay.fadeInMs ?? 300}ms</div>
                          <Slider
                            value={[selectedOverlay.fadeInMs ?? 300]}
                            onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { fadeInMs: values[0] })}
                            min={100}
                            max={1500}
                            step={50}
                            className="w-full [&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-violet-500"
                          />
                        </div>
                      )}
                      {selectedOverlay.exitEffect && selectedOverlay.exitEffect !== 'none' && (
                        <div>
                          <div className="text-[10px] text-slate-500 mb-1">Fade Out: {selectedOverlay.fadeOutMs ?? 300}ms</div>
                          <Slider
                            value={[selectedOverlay.fadeOutMs ?? 300]}
                            onValueChange={(values) => onOverlayRegionChange(selectedOverlay.id, { fadeOutMs: values[0] })}
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
              </div>
              <p className="text-[11px] text-slate-500">
                Adjust crop to show only a portion of the source video.
              </p>
            </div>
          )}
          <div className="grid gap-2">
            {overlayAssets.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-white/10 rounded-xl">
                No overlay videos yet
              </div>
            ) : (
              overlayAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-3"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-overlay-asset', asset.id);
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
                      onClick={() => onOverlayAddToTimeline?.(asset.id)}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => onOverlayAssetRemove?.(asset.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
