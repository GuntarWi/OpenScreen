import { Application, Container, Sprite, Graphics, BlurFilter, Texture } from 'pixi.js';
import type { ZoomRegion, CropRegion, AnnotationRegion, EffectRegion, ScreenOffset, OverlayVideoAsset, OverlayVideoRegion, PaddingKeyframe } from '@/components/video-editor/types';
import { interpolatePadding } from '@/utils/paddingKeyframes';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import { applyZoomTransform } from '@/components/video-editor/videoPlayback/zoomTransform';
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from '@/components/video-editor/videoPlayback/constants';
import { clampFocusToStage as clampFocusToStageUtil } from '@/components/video-editor/videoPlayback/focusUtils';
import { renderAnnotations } from './annotationRenderer';
import { applyChromaKeyToImageData, parseHexColor } from '@/utils/chromaKey';
import { computeEffectState, type CombinedEffectState } from '@/components/video-editor/videoPlayback/effectUtils';
import { computeOverlayLayout } from '@/utils/overlayLayout';

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
  overlayAssets?: OverlayVideoAsset[];
  overlayRegions?: OverlayVideoRegion[];
  effectRegions?: EffectRegion[];
  previewWidth?: number;
  previewHeight?: number;
}

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

// Renders video frames with all effects (background, zoom, crop, blur, shadow) to an offscreen canvas for export.

export class FrameRenderer {
  private app: Application | null = null;
  private cameraContainer: Container | null = null;
  private videoContainer: Container | null = null;
  private videoSprite: Sprite | null = null;
  private backgroundSprite: Sprite | null = null;
  private maskGraphics: Graphics | null = null;
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
  private overlayAssetMap: Map<string, OverlayVideoAsset> = new Map();
  private overlayVideos = new Map<string, HTMLVideoElement>();
  private overlayVideoReady = new Map<string, Promise<void>>();
  private overlayVideoTimes = new Map<string, number>();
  private overlayChromaCanvases = new Map<string, HTMLCanvasElement>();

  constructor(config: FrameRenderConfig) {
    this.config = config;
    this.overlayAssetMap = new Map((config.overlayAssets || []).map((asset) => [asset.id, asset]));
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
    });

    // Setup containers
    this.cameraContainer = new Container();
    this.videoContainer = new Container();
    this.app.stage.addChild(this.cameraContainer);
    this.cameraContainer.addChild(this.videoContainer);

    // Setup background (render separately, not in PixiJS)
    await this.setupBackground();

    // Setup blur filter for video container
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 3;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;
    this.videoContainer.filters = [this.blurFilter];

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

    // Setup mask
    this.maskGraphics = new Graphics();
    this.videoContainer.addChild(this.maskGraphics);
    this.videoContainer.mask = this.maskGraphics;

    await this.initializeOverlayVideos();
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
    this.backgroundSprite = bgCanvas as any;
  }

  private async initializeOverlayVideos(): Promise<void> {
    const assets = this.config.overlayAssets || [];
    if (!assets.length) return;

    await Promise.all(assets.map((asset) => this.loadOverlayVideo(asset)));
  }

  private async loadOverlayVideo(asset: OverlayVideoAsset): Promise<void> {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    if (asset.src.startsWith('http')) {
      video.crossOrigin = 'anonymous';
    }

    const readyPromise = new Promise<void>((resolve, reject) => {
      const handleLoaded = () => resolve();
      const handleError = () => reject(new Error(`Failed to load overlay video: ${asset.src}`));
      video.addEventListener('loadeddata', handleLoaded, { once: true });
      video.addEventListener('error', handleError, { once: true });
    });

    video.src = asset.src;

    this.overlayVideos.set(asset.id, video);
    this.overlayVideoReady.set(asset.id, readyPromise);

    try {
      await readyPromise;
      video.currentTime = 0;
      video.pause();
    } catch (error) {
      console.warn('[FrameRenderer] Failed to load overlay video:', error);
      this.overlayVideos.delete(asset.id);
      this.overlayVideoReady.delete(asset.id);
    }
  }

  private async seekOverlayVideo(
    asset: OverlayVideoAsset,
    localTimeMs: number
  ): Promise<HTMLVideoElement | null> {
    const video = this.overlayVideos.get(asset.id);
    if (!video) return null;

    const readyPromise = this.overlayVideoReady.get(asset.id);
    if (readyPromise) {
      try {
        await readyPromise;
      } catch {
        return null;
      }
    }

    const durationMs = asset.durationMs > 0 ? asset.durationMs : Math.max(0, (video.duration || 0) * 1000);
    const maxMs = durationMs > 0 ? Math.max(0, durationMs - 1) : 0;
    const clampedMs = durationMs > 0 ? Math.min(Math.max(localTimeMs, 0), maxMs) : Math.max(localTimeMs, 0);
    const targetSeconds = clampedMs / 1000;

    if (!Number.isFinite(targetSeconds)) return video;

    const lastTime = this.overlayVideoTimes.get(asset.id);
    if (typeof lastTime === 'number' && Math.abs(lastTime - targetSeconds) < 0.002 && video.readyState >= 2) {
      return video;
    }

    await new Promise<void>((resolve) => {
      const handleSeeked = () => resolve();
      const handleError = () => resolve();
      video.addEventListener('seeked', handleSeeked, { once: true });
      video.addEventListener('error', handleError, { once: true });
      try {
        video.currentTime = targetSeconds;
      } catch {
        resolve();
      }
    });

    this.overlayVideoTimes.set(asset.id, targetSeconds);
    return video;
  }

  private async drawOverlayVideos(
    ctx: CanvasRenderingContext2D,
    timeMs: number,
    canvasWidth: number,
    canvasHeight: number,
    zoomState?: { scale: number; focusX: number; focusY: number },
    screenOffsetPx?: { x: number; y: number }
  ): Promise<void> {
    const overlayRegions = this.config.overlayRegions || [];
    if (!overlayRegions.length) return;
    const debugOverlay = typeof window !== 'undefined' && Boolean((window as any).__openscreen_debugOverlay);

    const previewWidth = this.config.previewWidth || canvasWidth;
    const previewHeight = this.config.previewHeight || canvasHeight;
    const scaleX = canvasWidth / previewWidth;
    const scaleY = canvasHeight / previewHeight;
    const scaleFactor = (scaleX + scaleY) / 2;

    // Apply screenOffset only when overlays are drawn directly on the composite canvas.
    // When overlays are drawn on the screen canvas, the screenOffset is applied later
    // to the whole screen, so keep this at zero.
    const offsetX = screenOffsetPx?.x ?? 0;
    const offsetY = screenOffsetPx?.y ?? 0;

    // Apply zoom transform if active
    const zoomScale = zoomState?.scale ?? 1;
    const zoomFocusX = zoomState?.focusX ?? 0.5;
    const zoomFocusY = zoomState?.focusY ?? 0.5;
    const hasZoom = zoomScale !== 1 || zoomFocusX !== 0.5 || zoomFocusY !== 0.5;

    const activeRegions = overlayRegions
      .filter((region) => timeMs >= region.startMs && timeMs <= region.endMs)
      .sort((a, b) => a.zIndex - b.zIndex);

    const addRoundedRectPath = (
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number
    ) => {
      const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
      if (clampedRadius <= 0) {
        context.rect(x, y, width, height);
        return;
      }
      if ('roundRect' in context) {
        (context as any).roundRect(x, y, width, height, clampedRadius);
        return;
      }
      const r = clampedRadius;
      context.moveTo(x + r, y);
      context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r);
      context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
      context.closePath();
    };

    for (const region of activeRegions) {
      const asset = this.overlayAssetMap.get(region.assetId);
      if (!asset) continue;

      const localMs = Math.max(0, timeMs - region.startMs);
      const video = await this.seekOverlayVideo(asset, localMs);
      if (!video || video.readyState < 2) continue;

      const videoWidth = video.videoWidth || asset.width || 1;
      const videoHeight = video.videoHeight || asset.height || 1;

      const layout = computeOverlayLayout({
        region,
        containerWidth: previewWidth,
        containerHeight: previewHeight,
        videoWidth,
        videoHeight,
      });

      if (!layout) continue;

      const boxX = layout.box.x * scaleX + offsetX;
      const boxY = layout.box.y * scaleY + offsetY;
      const boxWidth = layout.box.width * scaleX;
      const boxHeight = layout.box.height * scaleY;

      const destX = layout.dest.x * scaleX + offsetX;
      const destY = layout.dest.y * scaleY + offsetY;
      const destW = layout.dest.width * scaleX;
      const destH = layout.dest.height * scaleY;

      if (boxWidth <= 0 || boxHeight <= 0) continue;

      if (debugOverlay) {
        console.debug('[Overlay Debug][export]', JSON.stringify({
          timeMs,
          regionId: region.id,
          regionPosition: region.position,
          previewWidth,
          previewHeight,
          canvasWidth,
          canvasHeight,
          scaleX: scaleX.toFixed(4),
          scaleY: scaleY.toFixed(4),
          screenOffsetX: offsetX.toFixed(1),
          screenOffsetY: offsetY.toFixed(1),
          zoomScale: zoomScale.toFixed(4),
          zoomFocusX: zoomFocusX.toFixed(4),
          zoomFocusY: zoomFocusY.toFixed(4),
          boxX: boxX.toFixed(1),
          boxY: boxY.toFixed(1),
          boxWidth: boxWidth.toFixed(1),
          boxHeight: boxHeight.toFixed(1),
        }));
      }

      const radiusPx = Math.max(0, (region.borderRadius ?? 0) * scaleFactor);
      const chromaKey = region.chromaKey;
      const chromaEnabled = Boolean(chromaKey?.enabled);

      ctx.save();

      // Apply zoom transform if active
      if (hasZoom) {
        const focusX = zoomFocusX * canvasWidth;
        const focusY = zoomFocusY * canvasHeight;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;
        ctx.translate(centerX, centerY);
        ctx.scale(zoomScale, zoomScale);
        ctx.translate(-focusX, -focusY);
      }

      // Always clip to the box for border radius and overflow
      ctx.beginPath();
      addRoundedRectPath(ctx, boxX, boxY, boxWidth, boxHeight, radiusPx);
      ctx.clip();

      const drawOverlaySource = (
        srcX: number,
        srcY: number,
        srcW: number,
        srcH: number,
        drawX: number,
        drawY: number,
        drawW: number,
        drawH: number
      ) => {
        if (!chromaEnabled) {
          ctx.drawImage(video, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
          return;
        }

        const canvasKey = region.id;
        let chromaCanvas = this.overlayChromaCanvases.get(canvasKey);
        if (!chromaCanvas) {
          chromaCanvas = document.createElement('canvas');
          this.overlayChromaCanvases.set(canvasKey, chromaCanvas);
        }

        const tempW = Math.max(1, Math.ceil(srcW));
        const tempH = Math.max(1, Math.ceil(srcH));
        if (chromaCanvas.width !== tempW || chromaCanvas.height !== tempH) {
          chromaCanvas.width = tempW;
          chromaCanvas.height = tempH;
        }

        const chromaCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });
        if (!chromaCtx) {
          ctx.drawImage(video, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
          return;
        }

        chromaCtx.clearRect(0, 0, tempW, tempH);
        chromaCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, tempW, tempH);
        const imageData = chromaCtx.getImageData(0, 0, tempW, tempH);
        applyChromaKeyToImageData(
          imageData.data,
          parseHexColor(chromaKey?.color ?? '#00ff00'),
          chromaKey?.threshold ?? 0.35,
          chromaKey?.softness ?? 0.15
        );
        chromaCtx.putImageData(imageData, 0, 0);
        ctx.drawImage(chromaCanvas, 0, 0, tempW, tempH, drawX, drawY, drawW, drawH);
      };

      drawOverlaySource(
        layout.src.x,
        layout.src.y,
        layout.src.width,
        layout.src.height,
        destX,
        destY,
        destW,
        destH
      );
      ctx.restore();
    }
  }

  async renderFrame(videoFrame: VideoFrame, timestamp: number): Promise<void> {
    if (!this.app || !this.videoContainer || !this.cameraContainer) {
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1000000;

    // Create or update video sprite from VideoFrame
    if (!this.videoSprite) {
      const texture = Texture.from(videoFrame as any);
      this.videoSprite = new Sprite(texture);
      this.videoContainer.addChild(this.videoSprite);
    } else {
      // Destroy old texture to avoid memory leaks, then create new one
      const oldTexture = this.videoSprite.texture;
      const newTexture = Texture.from(videoFrame as any);
      this.videoSprite.texture = newTexture;
      oldTexture.destroy(true);
    }

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
    applyZoomTransform({
      cameraContainer: this.cameraContainer,
      blurFilter: this.blurFilter,
      stageSize: this.layoutCache.stageSize,
      baseMask: this.layoutCache.maskRect,
      zoomScale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
      motionIntensity: maxMotionIntensity,
      isPlaying: true,
      motionBlurEnabled: this.config.motionBlurEnabled ?? true,
    });

    // Render the PixiJS stage to its canvas (video only, transparent background)
    this.app.renderer.render(this.app.stage);

    // Composite with shadows to final output canvas
    await this.compositeWithShadows(effectState, timeMs);
  }

  private updateLayout(timeMs?: number): void {
    if (!this.app || !this.videoSprite || !this.maskGraphics || !this.videoContainer) return;

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

    // Position video sprite
    this.videoSprite.width = videoWidth * scale;
    this.videoSprite.height = videoHeight * scale;

    const cropPixelX = cropStartX * videoWidth * scale;
    const cropPixelY = cropStartY * videoHeight * scale;
    this.videoSprite.x = -cropPixelX;
    this.videoSprite.y = -cropPixelY;

    // Position video container
    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;
    this.videoContainer.x = centerOffsetX;
    this.videoContainer.y = centerOffsetY;

    // scale border radius by export/preview canvas ratio
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
    const scaledBorderRadius = borderRadius * canvasScaleFactor;
    
    this.maskGraphics.clear();
    this.maskGraphics.roundRect(0, 0, croppedDisplayWidth, croppedDisplayHeight, scaledBorderRadius);
    this.maskGraphics.fill({ color: 0xffffff });

    // Cache layout info
    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
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
    if (!this.cameraContainer || !this.layoutCache) return 0;

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
    const screenOffset = this.config.screenOffset || { x: 0, y: 0 };
    const screenOffsetX = (screenOffset.x / 100) * w;
    const screenOffsetY = (screenOffset.y / 100) * h;

    // Clear composite canvas
    ctx.clearRect(0, 0, w, h);
    
    // Enable high-quality smoothing for final composite
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw background layer (without effect transforms)
    if (this.backgroundSprite) {
      const bgCanvas = this.backgroundSprite as any as HTMLCanvasElement;
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

    // Draw overlays on the screen canvas so they receive zoom and effect transforms.
    if (this.config.overlayRegions && this.config.overlayRegions.length > 0) {
      await this.drawOverlayVideos(screenCtx, timeMs, w, h, this.animationState);
    }

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

    const drawX = screenOffsetX + finalScreenOffsetX;
    const drawY = screenOffsetY + finalScreenOffsetY;

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
    if (this.videoSprite) {
      this.videoSprite.destroy();
      this.videoSprite = null;
    }
    this.overlayVideos.forEach((video) => {
      try {
        video.pause();
        video.src = '';
      } catch {
        // ignore cleanup errors
      }
    });
    this.overlayVideos.clear();
    this.overlayVideoReady.clear();
    this.overlayVideoTimes.clear();
    this.overlayAssetMap.clear();
    this.backgroundSprite = null;
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
    this.cameraContainer = null;
    this.videoContainer = null;
    this.maskGraphics = null;
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
