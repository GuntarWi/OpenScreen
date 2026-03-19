import { Application, BlurFilter } from 'pixi.js';
import { RECORDING_ASSET_ID, type ZoomRegion, CropRegion, AnnotationRegion, EffectRegion, ScreenOffset, VideoAsset, VideoClip, PaddingKeyframe } from '@/components/video-editor/types';
import { interpolatePadding } from '@/utils/paddingKeyframes';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from '@/components/video-editor/videoPlayback/constants';
import { clampFocusToStage as clampFocusToStageUtil } from '@/components/video-editor/videoPlayback/focusUtils';
import { renderAnnotations } from './annotationRenderer';
import { computeEffectState, type CombinedEffectState } from '@/components/video-editor/videoPlayback/effectUtils';
import { ClipPixiRenderer } from '@/components/video-editor/videoPlayback/clipPixiRenderer';

const EFFECT_PERSPECTIVE = 1200;
const SKEW_TO_TILT_RATIO = 0.55;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

interface FrameRenderConfig {
  width: number;
  height: number;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  paddingKeyframes?: PaddingKeyframe[];
  cropRegion: CropRegion;
  screenOffset?: ScreenOffset;
  videoWidth: number;
  videoHeight: number;
  annotationRegions?: AnnotationRegion[];
  videoAssets?: VideoAsset[];
  videoClips?: VideoClip[];
  effectRegions?: EffectRegion[];
  previewWidth?: number;
  previewHeight?: number;
}

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

// Renders video frames with all effects (background, zoom, crop, blur, shadow, clips) to an offscreen canvas for export.

export class FrameRenderer {
  private app: Application | null = null;
  private backgroundSprite: HTMLCanvasElement | null = null;
  private blurFilter: BlurFilter | null = null;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;
  private effectCanvas: HTMLCanvasElement | null = null;
  private effectCtx: CanvasRenderingContext2D | null = null;
  private config: FrameRenderConfig;
  private animationState: AnimationState;
  private layoutCache: any = null;
  private currentVideoTime = 0;
  private clipRenderer: ClipPixiRenderer | null = null;
  private screenOffsetPx = { x: 0, y: 0 };
  private recordingClipIds: string[] = [];
  private recordingVideo: HTMLVideoElement | null = null;

  constructor(config: FrameRenderConfig) {
    this.config = config;
    const screenOffset = config.screenOffset || { x: 0, y: 0 };
    this.screenOffsetPx = {
      x: (screenOffset.x / 100) * config.width,
      y: (screenOffset.y / 100) * config.height,
    };
    this.animationState = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };
  }

  async initialize(): Promise<void> {
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    
    // Try to set colorSpace if supported (may not be available on all platforms)
    try {
      if (canvas && 'colorSpace' in canvas) {
        // @ts-ignore
        canvas.colorSpace = 'srgb';
      }
    } catch (error) {
      // Silently ignore colorSpace errors on platforms that don't support it
      console.warn('[FrameRenderer] colorSpace not supported on this platform:', error);
    }

    // Initialize PixiJS with optimized settings for export performance
    this.app = new Application();
    await this.app.init({
      canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });

    // Setup renderer for all clips
    this.app.stage.sortableChildren = true;
    this.clipRenderer = new ClipPixiRenderer(this.app.stage);
    this.clipRenderer.setZIndex(1);
    this.clipRenderer.setAssets(this.config.videoAssets || []);
    this.clipRenderer.syncClips(this.config.videoClips || []);
    this.clipRenderer.setStageSize({ width: this.config.width, height: this.config.height });
    this.recordingClipIds = this.getRecordingClipIds();
    if (this.recordingVideo) {
      this.clipRenderer.setExternalVideo(RECORDING_ASSET_ID, this.recordingVideo, { allowSeek: false });
    }

    // Setup background (render separately, not in PixiJS)
    await this.setupBackground();

    // Setup blur filter for recording clip(s)
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 3;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;

    // Setup composite canvas for final output with shadows
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.config.width;
    this.compositeCanvas.height = this.config.height;
    this.compositeCtx = this.compositeCanvas.getContext('2d', { willReadFrequently: false });
    
    if (!this.compositeCtx) {
      throw new Error('Failed to get 2D context for composite canvas');
    }

    // Setup screen canvas for effect transforms
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = this.config.width;
    this.screenCanvas.height = this.config.height;
    this.screenCtx = this.screenCanvas.getContext('2d', { willReadFrequently: false });

    if (!this.screenCtx) {
      throw new Error('Failed to get 2D context for screen canvas');
    }

    // Setup effect canvas for post-perspective shadow compositing
    this.effectCanvas = document.createElement('canvas');
    this.effectCanvas.width = this.config.width;
    this.effectCanvas.height = this.config.height;
    this.effectCtx = this.effectCanvas.getContext('2d', { willReadFrequently: false });

    if (!this.effectCtx) {
      throw new Error('Failed to get 2D context for effect canvas');
    }

    // Setup shadow canvas if needed
    if (this.config.showShadow) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.config.width;
      this.shadowCanvas.height = this.config.height;
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: false });
      
      if (!this.shadowCtx) {
        throw new Error('Failed to get 2D context for shadow canvas');
      }
    }

    this.updateLayout(0);

  }

  private async setupBackground(): Promise<void> {
    const wallpaper = this.config.wallpaper;

    // Create background canvas for separate rendering (not affected by zoom)
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = this.config.width;
    bgCanvas.height = this.config.height;
    const bgCtx = bgCanvas.getContext('2d')!;

    try {
      // Render background based on type
      if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:') || wallpaper.startsWith('/') || wallpaper.startsWith('http')) {
        // Image background
        const img = new Image();
        // Don't set crossOrigin for same-origin images to avoid CORS taint
        // Only set it for cross-origin URLs
        let imageUrl: string;
        if (wallpaper.startsWith('http')) {
          imageUrl = wallpaper;
          if (!imageUrl.startsWith(window.location.origin)) {
            img.crossOrigin = 'anonymous';
          }
        } else if (wallpaper.startsWith('file://') || wallpaper.startsWith('data:')) {
          imageUrl = wallpaper;
        } else {
          imageUrl = window.location.origin + wallpaper;
        }
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = (err) => {
            console.error('[FrameRenderer] Failed to load background image:', imageUrl, err);
            reject(new Error(`Failed to load background image: ${imageUrl}`));
          };
          img.src = imageUrl;
        });
        
        // Draw the image using cover and center positioning
        const imgAspect = img.width / img.height;
        const canvasAspect = this.config.width / this.config.height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgAspect > canvasAspect) {
          drawHeight = this.config.height;
          drawWidth = drawHeight * imgAspect;
          drawX = (this.config.width - drawWidth) / 2;
          drawY = 0;
        } else {
          drawWidth = this.config.width;
          drawHeight = drawWidth / imgAspect;
          drawX = 0;
          drawY = (this.config.height - drawHeight) / 2;
        }
        
        bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      } else if (wallpaper.startsWith('#')) {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      } else if (wallpaper.startsWith('linear-gradient') || wallpaper.startsWith('radial-gradient')) {
        
        const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
        if (gradientMatch) {
          const [, type, params] = gradientMatch;
          const parts = params.split(',').map(s => s.trim());
          
          let gradient: CanvasGradient;
          
          if (type === 'linear') {
            gradient = bgCtx.createLinearGradient(0, 0, 0, this.config.height);
            parts.forEach((part, index) => {
              if (part.startsWith('to ') || part.includes('deg')) return;
              
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          } else {
            const cx = this.config.width / 2;
            const cy = this.config.height / 2;
            const radius = Math.max(this.config.width, this.config.height) / 2;
            gradient = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            
            parts.forEach((part, index) => {
              const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
              if (colorMatch) {
                const color = colorMatch[1];
                const position = index / (parts.length - 1);
                gradient.addColorStop(position, color);
              }
            });
          }
          
          bgCtx.fillStyle = gradient;
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        } else {
          console.warn('[FrameRenderer] Could not parse gradient, using black fallback');
          bgCtx.fillStyle = '#000000';
          bgCtx.fillRect(0, 0, this.config.width, this.config.height);
        }
      } else {
        bgCtx.fillStyle = wallpaper;
        bgCtx.fillRect(0, 0, this.config.width, this.config.height);
      }
    } catch (error) {
      console.error('[FrameRenderer] Error setting up background, using fallback:', error);
      bgCtx.fillStyle = '#000000';
      bgCtx.fillRect(0, 0, this.config.width, this.config.height);
    }

    // Store the background canvas for compositing
    this.backgroundSprite = bgCanvas;
  }

  async renderFrame(timestamp: number): Promise<void> {
    if (!this.app || !this.clipRenderer) {
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1000000;

    const timeMs = this.currentVideoTime * 1000;

    // Apply layout with current time for keyframe interpolation
    this.updateLayout(timeMs);
    const effectState = computeEffectState(this.config.effectRegions || [], timeMs);
    const TICKS_PER_FRAME = 1;
    
    let maxMotionIntensity = 0;
    for (let i = 0; i < TICKS_PER_FRAME; i++) {
      const motionIntensity = this.updateAnimationState(timeMs);
      maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);
    }
    
    // Apply transform once with maximum motion intensity from all ticks
    this.clipRenderer.setCameraTransform({
      scale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
    });
    this.applyRecordingBlur(maxMotionIntensity);
    this.applyScreenOffsetToRecording(this.animationState.scale);

    await this.clipRenderer.prepareFrame(timeMs);

    // Render the PixiJS stage to its canvas (video clips, transparent background)
    this.app.renderer.render(this.app.stage);

    // Composite with shadows to final output canvas
    await this.compositeWithShadows(effectState, timeMs);
  }

  private updateLayout(timeMs?: number): void {
    if (!this.app) return;

    const { width, height } = this.config;
    const { cropRegion, borderRadius = 0, padding: basePadding = 0, paddingKeyframes = [] } = this.config;
    // Interpolate padding from keyframes if available
    const padding = timeMs !== undefined && paddingKeyframes.length > 0
      ? interpolatePadding(paddingKeyframes, timeMs, basePadding)
      : basePadding;
    const videoWidth = this.config.videoWidth;
    const videoHeight = this.config.videoHeight;

    // Calculate cropped video dimensions
    const cropStartX = cropRegion.x;
    const cropStartY = cropRegion.y;
    const cropEndX = cropRegion.x + cropRegion.width;
    const cropEndY = cropRegion.y + cropRegion.height;

    const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);

    // Calculate scale to fit in viewport
    // Padding is a percentage (0-100), where 50% ~ 0.8 scale
    const paddingScale = 1.0 - (padding / 100) * 0.4;
    const viewportWidth = width * paddingScale;
    const viewportHeight = height * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;

    // scale border radius by export/preview canvas ratio
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
    const scaledBorderRadius = borderRadius * canvasScaleFactor;

    if (this.clipRenderer) {
      this.clipRenderer.setStageSize({ width, height });
      this.clipRenderer.setRecordingLayout({
        cropRegion,
        padding,
        borderRadius: scaledBorderRadius,
        screenOffsetPx: this.screenOffsetPx,
      });
    }

    // Cache layout info
    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
  }

  private applyScreenOffsetToRecording(zoomScale: number): void {
    if (!this.clipRenderer) return;
    this.clipRenderer.applyScreenOffset(zoomScale);
  }

  setRecordingVideo(video: HTMLVideoElement): void {
    this.recordingVideo = video;
    this.recordingClipIds = this.getRecordingClipIds();
    if (!this.clipRenderer) return;
    this.clipRenderer.setExternalVideo(RECORDING_ASSET_ID, video, { allowSeek: false });
  }

  private getRecordingClipIds(): string[] {
    return (this.config.videoClips || [])
      .filter((clip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID)
      .map((clip) => clip.id);
  }

  private applyRecordingBlur(motionIntensity: number): void {
    if (!this.blurFilter || !this.clipRenderer) return;
    const shouldBlur = (this.config.motionBlurEnabled ?? true) && motionIntensity > 0.0005;
    const motionBlur = shouldBlur ? Math.min(6, motionIntensity * 120) : 0;
    this.blurFilter.blur = motionBlur;

    const filters = motionBlur > 0 ? [this.blurFilter] : null;
    this.recordingClipIds.forEach((id) => {
      const item = this.clipRenderer?.getClipItem(id);
      if (item) {
        item.container.filters = filters;
      }
    });
  }

  private clampFocusToStage(focus: { cx: number; cy: number }, depth: number): { cx: number; cy: number } {
    if (!this.layoutCache) return focus;
    return clampFocusToStageUtil(focus, depth as any, this.layoutCache);
  }

  private computeEffectTransform(
    effectState: CombinedEffectState,
    w: number,
    h: number
  ): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const scale = effectState.scale ?? 1;
    const offsetX = effectState.offsetX ?? 0;
    const offsetY = effectState.offsetY ?? 0;
    const rollDeg = (effectState.roll ?? 0) * RAD_TO_DEG;
    const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
    const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);

    // Use DOMMatrix to mirror the preview transform as closely as possible
    if (typeof DOMMatrix !== 'undefined' && typeof DOMPoint !== 'undefined') {
      const matrix = new DOMMatrix();
      matrix.m34 = -1 / EFFECT_PERSPECTIVE;
      matrix.scaleSelf(scale, scale, 1);
      matrix.translateSelf(offsetX, offsetY, 0);
      // Match on-screen CSS transform order and orientation
      matrix.rotateSelf(rotXDeg, rotYDeg, rollDeg);

      const centerX = w / 2;
      const centerY = h / 2;

      const project = (x: number, y: number) => {
        const pt = new DOMPoint(x - centerX, y - centerY, 0, 1).matrixTransform(matrix);
        const wComp = pt.w || 1;
        return {
          x: pt.x / wComp + centerX,
          y: pt.y / wComp + centerY,
        };
      };

      const p0 = project(0, 0);
      const p1 = project(w, 0);
      const p2 = project(0, h);

      return {
        a: (p1.x - p0.x) / w,
        b: (p1.y - p0.y) / w,
        c: (p2.x - p0.x) / h,
        d: (p2.y - p0.y) / h,
        e: p0.x,
        f: p0.y,
      };
    }

    // Fallback affine approximation when DOMMatrix is unavailable
    const rollRad = effectState.roll ?? 0;
    const skewX = (rotXDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
    const skewY = (rotYDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;

    const centerX = w / 2;
    const centerY = h / 2;

    const applyFallback = (x: number, y: number) => {
      // Translate to center
      let px = x - centerX;
      let py = y - centerY;

      // Apply scale then offset
      px *= scale;
      py *= scale;
      px += offsetX;
      py += offsetY;

      // Roll around Z axis
      if (rollRad !== 0) {
        const cosR = Math.cos(rollRad);
        const sinR = Math.sin(rollRad);
        const rx = px * cosR - py * sinR;
        const ry = px * sinR + py * cosR;
        px = rx;
        py = ry;
      }

      // Approximate perspective lean using skew (with corrected sign to match preview)
      const sx = px + skewX * py;
      const sy = py + skewY * px;

      return { x: sx + centerX, y: sy + centerY };
    };

    const f0 = applyFallback(0, 0);
    const f1 = applyFallback(w, 0);
    const f2 = applyFallback(0, h);

    return {
      a: (f1.x - f0.x) / w,
      b: (f1.y - f0.y) / w,
      c: (f2.x - f0.x) / h,
      d: (f2.y - f0.y) / h,
      e: f0.x,
      f: f0.y,
    };
  }

  private createProjectionFunction(
    effectState: CombinedEffectState,
    w: number,
    h: number
  ): ((x: number, y: number) => { x: number; y: number }) | null {
    if (typeof DOMMatrix === 'undefined' || typeof DOMPoint === 'undefined') {
      return null;
    }

    const scale = effectState.scale ?? 1;
    const offsetX = effectState.offsetX ?? 0;
    const offsetY = effectState.offsetY ?? 0;
    const rollDeg = (effectState.roll ?? 0) * RAD_TO_DEG;
    const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
    const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);

    const matrix = new DOMMatrix();
    matrix.m34 = -1 / EFFECT_PERSPECTIVE;
    matrix.scaleSelf(scale, scale, 1);
    matrix.translateSelf(offsetX, offsetY, 0);
    matrix.rotateSelf(rotXDeg, rotYDeg, rollDeg);

    const centerX = w / 2;
    const centerY = h / 2;

    return (x: number, y: number) => {
      const pt = new DOMPoint(x - centerX, y - centerY, 0, 1).matrixTransform(matrix);
      const wComp = pt.w || 1;
      return {
        x: pt.x / wComp + centerX,
        y: pt.y / wComp + centerY,
      };
    };
  }

  private computeAffineFromTriangles(
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    sx2: number,
    sy2: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number
  ): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
    const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(det) < 1e-8) return null;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / det;
    const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / det;
    const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / det;
    const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / det;
    const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / det;
    const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / det;

    return { a, b, c, d, e, f };
  }

  private drawScreenWithPerspective(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    effectState: CombinedEffectState
  ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } {
    const w = source.width;
    const h = source.height;
    const project = this.createProjectionFunction(effectState, w, h);

    if (!project) {
      const affine = this.computeEffectTransform(effectState, w, h);
      ctx.save();
      ctx.setTransform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
      return { canvas: ctx.canvas as HTMLCanvasElement, offsetX: 0, offsetY: 0 };
    }

    // Use a 2D grid of patches for proper perspective in both X and Y directions
    // Each grid point is projected using the full 3D matrix for accurate perspective
    // Minimal subdivisions to eliminate visible seam lines (8x6 grid = only 48 patches)
    const subdivisionsX = Math.max(8, Math.round(w / 160));
    const subdivisionsY = Math.max(6, Math.round(h / 160));
    const xCoords = new Array(subdivisionsX + 1);
    const yCoords = new Array(subdivisionsY + 1);
    for (let i = 0; i <= subdivisionsX; i++) {
      xCoords[i] = Math.round((i / subdivisionsX) * w);
    }
    for (let j = 0; j <= subdivisionsY; j++) {
      yCoords[j] = Math.round((j / subdivisionsY) * h);
    }
    xCoords[subdivisionsX] = w;
    yCoords[subdivisionsY] = h;
    const bleed = Math.min(3, Math.max(1, Math.round(Math.max(w, h) / 800)));
    const clipPad = Math.max(0.35, Math.min(1.25, bleed * 0.6));
    const pad = Math.ceil(Math.max(2, clipPad + bleed + 1));

    const projectedCorners = [project(0, 0), project(w, 0), project(0, h), project(w, h)];
    let minX = projectedCorners[0].x;
    let maxX = projectedCorners[0].x;
    let minY = projectedCorners[0].y;
    let maxY = projectedCorners[0].y;
    for (const pt of projectedCorners) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }

    const offsetX = -minX + pad;
    const offsetY = -minY + pad;
    const outWidth = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const outHeight = Math.max(1, Math.ceil(maxY - minY + pad * 2));

    const expandTriangle = (
      p0: { x: number; y: number },
      p1: { x: number; y: number },
      p2: { x: number; y: number }
    ) => {
      const cx = (p0.x + p1.x + p2.x) / 3;
      const cy = (p0.y + p1.y + p2.y) / 3;

      const expand = (p: { x: number; y: number }) => {
        const vx = p.x - cx;
        const vy = p.y - cy;
        const len = Math.hypot(vx, vy);
        if (len <= 0) return p;
        const scale = (len + clipPad) / len;
        return { x: cx + vx * scale, y: cy + vy * scale };
      };

      return [expand(p0), expand(p1), expand(p2)];
    };

    // Create an intermediate canvas to render perspective without transparency issues
    // This prevents grid seams from showing through when there's transparency on top
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = outWidth;
    tempCanvas.height = outHeight;
    const tempCtx = tempCanvas.getContext('2d')!;

    // Enable high-quality smoothing during patch rendering to maintain quality with zoom+perspective
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';

    for (let j = 0; j < subdivisionsY; j++) {
      for (let i = 0; i < subdivisionsX; i++) {
        const sx = xCoords[i];
        const sy = yCoords[j];
        const sx1 = xCoords[i + 1];
        const sy1 = yCoords[j + 1];
        const sw = sx1 - sx;
        const sh = sy1 - sy;
        if (sw <= 0 || sh <= 0) continue;

        // Project corners
        const tlRaw = project(sx, sy);
        const trRaw = project(sx1, sy);
        const blRaw = project(sx, sy1);
        const brRaw = project(sx1, sy1);
        const tl = { x: tlRaw.x + offsetX, y: tlRaw.y + offsetY };
        const tr = { x: trRaw.x + offsetX, y: trRaw.y + offsetY };
        const bl = { x: blRaw.x + offsetX, y: blRaw.y + offsetY };
        const br = { x: brRaw.x + offsetX, y: brRaw.y + offsetY };

        // Bleed source pixels to avoid seams while clipping to the projected patch.
        const padLeft = Math.min(bleed, sx);
        const padTop = Math.min(bleed, sy);
        const padRight = Math.min(bleed, w - sx1);
        const padBottom = Math.min(bleed, h - sy1);
        const sxPad = sx - padLeft;
        const syPad = sy - padTop;
        const swPad = sw + padLeft + padRight;
        const shPad = sh + padTop + padBottom;

        const drawTriangle = (
          sx0: number,
          sy0: number,
          sx1t: number,
          sy1t: number,
          sx2: number,
          sy2: number,
          d0: { x: number; y: number },
          d1: { x: number; y: number },
          d2: { x: number; y: number }
        ) => {
          const matrix = this.computeAffineFromTriangles(
            sx0,
            sy0,
            sx1t,
            sy1t,
            sx2,
            sy2,
            d0.x,
            d0.y,
            d1.x,
            d1.y,
            d2.x,
            d2.y
          );
          if (!matrix) return;

          const [p0, p1, p2] = expandTriangle(d0, d1, d2);
          tempCtx.save();
          tempCtx.setTransform(1, 0, 0, 1, 0, 0);
          tempCtx.beginPath();
          tempCtx.moveTo(p0.x, p0.y);
          tempCtx.lineTo(p1.x, p1.y);
          tempCtx.lineTo(p2.x, p2.y);
          tempCtx.closePath();
          tempCtx.clip();

          tempCtx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          tempCtx.drawImage(source, sxPad, syPad, swPad, shPad, -padLeft, -padTop, swPad, shPad);
          tempCtx.restore();
        };

        drawTriangle(0, 0, sw, 0, 0, sh, tl, tr, bl);
        drawTriangle(sw, sh, sw, 0, 0, sh, br, tr, bl);
      }
    }

    return {
      canvas: tempCanvas,
      offsetX: minX - pad,
      offsetY: minY - pad,
    };
  }

  private updateAnimationState(timeMs: number): number {
    if (!this.layoutCache) return 0;

    const { region, strength } = findDominantRegion(this.config.zoomRegions, timeMs);
    
    const defaultFocus = DEFAULT_FOCUS;
    let targetScaleFactor = 1;
    let targetFocus = { ...defaultFocus };

    if (region && strength > 0) {
      const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
      const regionFocus = this.clampFocusToStage(region.focus, region.depth);
      
      targetScaleFactor = 1 + (zoomScale - 1) * strength;
      targetFocus = {
        cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
        cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
      };
    }

    const state = this.animationState;

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

    return Math.max(
      Math.abs(nextScale - prevScale),
      Math.abs(nextFocusX - prevFocusX),
      Math.abs(nextFocusY - prevFocusY)
    );
  }

  private async compositeWithShadows(effectState: CombinedEffectState, timeMs: number): Promise<void> {
    if (!this.compositeCanvas || !this.compositeCtx || !this.app || !this.screenCanvas || !this.screenCtx || !this.effectCanvas || !this.effectCtx) return;

    const videoCanvas = this.app.canvas as HTMLCanvasElement;
    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;

    // Calculate scale factor based on export vs preview dimensions for annotations
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const scaleX = this.config.width / previewWidth;
    const scaleY = this.config.height / previewHeight;
    const scaleFactor = (scaleX + scaleY) / 2;

    // Clear composite canvas
    ctx.clearRect(0, 0, w, h);
    
    // Enable high-quality smoothing for final composite
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw background layer (without effect transforms)
    if (this.backgroundSprite) {
      const bgCanvas = this.backgroundSprite;
      if (this.config.showBlur) {
        ctx.save();
        ctx.filter = 'blur(6px)';
        ctx.drawImage(bgCanvas, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(bgCanvas, 0, 0, w, h);
      }
    } else {
      console.warn('[FrameRenderer] No background sprite found during compositing!');
    }

    const screenCtx = this.screenCtx;
    screenCtx.clearRect(0, 0, w, h);
    
    // Enable high-quality smoothing for border radius and shadow rendering
    screenCtx.imageSmoothingEnabled = true;
    screenCtx.imageSmoothingQuality = 'high';

    // Midground annotations (between wallpaper and screen)
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0) {
      await renderAnnotations(
        screenCtx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor,
        'midground'
      );
    }

    // Draw video with optional shadow
    screenCtx.filter = 'none';
    screenCtx.drawImage(videoCanvas, 0, 0, w, h);
    screenCtx.filter = 'none';

    let finalScreen = this.screenCanvas;
    let finalScreenOffsetX = 0;
    let finalScreenOffsetY = 0;
    if (effectState.active) {
      const effectCtx = this.effectCtx;
      effectCtx.setTransform(1, 0, 0, 1, 0, 0);
      effectCtx.clearRect(0, 0, w, h);
      const effectResult = this.drawScreenWithPerspective(effectCtx, this.screenCanvas, effectState);
      finalScreen = effectResult.canvas;
      finalScreenOffsetX = effectResult.offsetX;
      finalScreenOffsetY = effectResult.offsetY;
    }

    const drawX = finalScreenOffsetX;
    const drawY = finalScreenOffsetY;

    if (this.config.showShadow && this.config.shadowIntensity > 0) {
      const intensity = this.config.shadowIntensity;
      const baseBlur1 = 48 * intensity;
      const baseBlur2 = 16 * intensity;
      const baseBlur3 = 8 * intensity;
      const baseAlpha1 = 0.7 * intensity;
      const baseAlpha2 = 0.5 * intensity;
      const baseAlpha3 = 0.3 * intensity;
      const baseOffset = 12 * intensity;
      ctx.save();
      ctx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset/3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset/6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
      ctx.drawImage(finalScreen, drawX, drawY);
      ctx.restore();
    } else {
      ctx.drawImage(finalScreen, drawX, drawY);
    }

    // Draw foreground annotations on composite canvas
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0) {
      await renderAnnotations(
        ctx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor,
        'foreground'
      );
    }
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.compositeCanvas) {
      throw new Error('Renderer not initialized');
    }
    return this.compositeCanvas;
  }


  destroy(): void {
    if (this.clipRenderer) {
      this.clipRenderer.destroy();
      this.clipRenderer = null;
    }
    this.backgroundSprite = null;
    if (this.app) {
      if (this.app.ticker) {
        this.app.ticker.stop();
      }
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
    this.blurFilter = null;
    this.shadowCanvas = null;
    this.shadowCtx = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.screenCanvas = null;
    this.screenCtx = null;
    this.effectCanvas = null;
    this.effectCtx = null;
  }
}
