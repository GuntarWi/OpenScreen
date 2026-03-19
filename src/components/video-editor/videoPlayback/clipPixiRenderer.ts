import { Container, Graphics, Sprite, Texture, VideoSource } from 'pixi.js';
import type { VideoAsset, VideoClip } from '../types';
import { applyChromaKeyToImageData, parseHexColor } from '@/utils/chromaKey';
import { computeClipLayout } from '@/utils/clipLayout';
import { resolveClipTransformStateAtTime, resolveClipTransformStateFromBase } from '@/utils/clipTransformKeyframes';
import { getSourceOffsetForTimelineOffsetMs } from '../clipSpeedUtils';
import { smoothStep } from './mathUtils';

type StageSize = { width: number; height: number };
type ExternalVideoSource = { video: HTMLVideoElement; allowSeek: boolean };
type CameraTransform = { scale: number; focusX: number; focusY: number };
type RecordingLayoutConfig = {
  cropRegion: { x: number; y: number; width: number; height: number };
  padding: number;
  borderRadius: number;
  screenOffsetPx: { x: number; y: number };
};
type PixelPiece = {
  row: number;
  col: number;
  delay: number;
  graphics: Graphics;
};

export type ClipInteractionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ClipEffectState = {
  opacity: number;
  pixelProgress: number;
  isEntering: boolean;
  isExiting: boolean;
  revealProgress: number;
};

type ClipItem = {
  clip: VideoClip;
  asset: VideoAsset;
  container: Container;
  content: Container;
  sprite: Sprite;
  mask: Graphics;
  pixelContainer: Container;
  pixelPieces: PixelPiece[];
  video: HTMLVideoElement | null;
  image: HTMLImageElement | null;
  videoSource: VideoSource | null;
  videoTexture: Texture | null;
  isExternal: boolean;
  allowSeek: boolean;
  needsFrame: boolean;
  onLoadedData?: () => void;
  onSeeked?: () => void;
  chromaCanvas?: HTMLCanvasElement;
  chromaCtx?: CanvasRenderingContext2D | null;
  chromaTexture?: Texture;
  useChroma: boolean;
  clipKey: string;
  layoutKey: string;
  transformKey: string;
  videoSizeKey: string;
  recordingLayoutKey: string;
  readyPromise?: Promise<void>;
  lastTime?: number;
  baseOffset?: { x: number; y: number };
  boxRect?: { x: number; y: number; width: number; height: number };
  visibleRect?: ClipInteractionRect;
  recordingScale?: number;
  recordingVideoSize?: { width: number; height: number };
  recordingSpriteOffset?: { x: number; y: number };
  recordingCropBounds?: { startX: number; endX: number; startY: number; endY: number };
  recordingBaseRect?: ClipInteractionRect;
  interactionRect?: ClipInteractionRect;
};

const PIXEL_GRID_ROWS = 4;
const PIXEL_GRID_COLS = 5;
const DEG_TO_RAD = Math.PI / 180;

const seededRandom = (seed: number) => {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
};

const generatePixelPieces = (rows: number, cols: number, seed: number) => {
  const pieces: { row: number; col: number; delay: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const pieceSeed = seed + row * 100 + col * 7;
      const delay = seededRandom(pieceSeed);
      pieces.push({ row, col, delay });
    }
  }
  return pieces;
};

const getClipEffectState = (region: VideoClip, timeMs: number): ClipEffectState => {
  const isActive = timeMs >= region.startMs && timeMs <= region.endMs;
  if (!isActive) {
    return { opacity: 1, pixelProgress: 1, isEntering: false, isExiting: false, revealProgress: 1 };
  }

  const enterEffect = region.enterEffect ?? 'none';
  const exitEffect = region.exitEffect ?? 'none';
  const fadeInMs = region.fadeInMs ?? 300;
  const fadeOutMs = region.fadeOutMs ?? 300;

  const timeSinceStart = timeMs - region.startMs;
  const timeUntilEnd = region.endMs - timeMs;

  let opacity = 1;
  let pixelProgress = 1;
  let isEntering = false;
  let isExiting = false;
  let revealProgress = 1;

  if (timeSinceStart < fadeInMs && enterEffect !== 'none') {
    isEntering = true;
    const progress = fadeInMs > 0 ? Math.min(1, timeSinceStart / fadeInMs) : 1;
    revealProgress = smoothStep(progress);
    if (enterEffect === 'fade') {
      opacity = progress;
    } else if (enterEffect === 'pixel') {
      pixelProgress = progress;
      opacity = 1;
    }
  }

  if (!isEntering && timeUntilEnd < fadeOutMs && exitEffect !== 'none') {
    isExiting = true;
    const progress = fadeOutMs > 0 ? Math.min(1, timeUntilEnd / fadeOutMs) : 1;
    revealProgress = smoothStep(progress);
    if (exitEffect === 'fade') {
      opacity = progress;
    } else if (exitEffect === 'pixel') {
      pixelProgress = progress;
      opacity = 1;
    }
  }

  return { opacity, pixelProgress, isEntering, isExiting, revealProgress };
};

const isSlideEffect = (effect: string) =>
  effect === 'slide-left' || effect === 'slide-right' || effect === 'slide-up' || effect === 'slide-down';

const getClipLayoutKey = (region: VideoClip) => {
  const crop = region.crop;
  const transformKeyframes = region.transformKeyframes ?? [];
  return [
    region.position.x,
    region.position.y,
    region.size.width,
    region.size.height,
    region.borderRadius ?? 0,
    region.fit ?? 'contain',
    crop?.x ?? 0,
    crop?.y ?? 0,
    crop?.width ?? 100,
    crop?.height ?? 100,
    ...transformKeyframes.flatMap((keyframe) => [
      keyframe.timeMs,
      keyframe.x,
      keyframe.y,
      keyframe.width,
      keyframe.height,
      keyframe.rotationDeg ?? 0,
      keyframe.scale ?? 1,
      keyframe.opacity ?? 1,
      keyframe.easingToNext ?? 'linear',
    ]),
  ].join('|');
};

const clampRadius = (radius: number, width: number, height: number) => {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
};

const getTransformedBounds = ({
  box,
  anchor,
  scaleX,
  scaleY,
  rotationDeg,
  parentScale,
  parentPosition,
}: {
  box: ClipInteractionRect;
  anchor: { x: number; y: number };
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  parentScale: { x: number; y: number };
  parentPosition: { x: number; y: number };
}): ClipInteractionRect => {
  const pivotX = box.width * anchor.x;
  const pivotY = box.height * anchor.y;
  const positionX = box.x + box.width * anchor.x;
  const positionY = box.y + box.height * anchor.y;
  const rotation = rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const corners = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: box.width, y: box.height },
    { x: 0, y: box.height },
  ];

  const worldPoints = corners.map((corner) => {
    const localX = (corner.x - pivotX) * scaleX;
    const localY = (corner.y - pivotY) * scaleY;
    const rotatedX = localX * cos - localY * sin;
    const rotatedY = localX * sin + localY * cos;
    return {
      x: parentPosition.x + (positionX + rotatedX) * parentScale.x,
      y: parentPosition.y + (positionY + rotatedY) * parentScale.y,
    };
  });

  const xs = worldPoints.map((point) => point.x);
  const ys = worldPoints.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const buildVideoElement = (src: string) => {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  if (src.startsWith('http')) {
    video.crossOrigin = 'anonymous';
  }
  try {
    video.load();
  } catch {
    // Ignore load errors for environments that auto-load on src assignment.
  }
  return video;
};

const buildImageElement = (src: string) => {
  const image = new Image();
  image.decoding = 'async';
  if (src.startsWith('http')) {
    image.crossOrigin = 'anonymous';
  }
  image.src = src;
  return image;
};

const ensureVideoMetadata = (video: HTMLVideoElement) =>
  new Promise<void>((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', handleLoaded);
      video.removeEventListener('error', handleError);
    };
    video.addEventListener('loadedmetadata', handleLoaded, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

const ensureVideoReady = (video: HTMLVideoElement) =>
  new Promise<void>((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', handleLoaded);
      video.removeEventListener('error', handleError);
    };
    video.addEventListener('loadeddata', handleLoaded, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });

const ensureImageReady = (image: HTMLImageElement) =>
  new Promise<void>((resolve) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve();
      return;
    }
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };
    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });

const getVideoSize = (video: HTMLVideoElement, asset: VideoAsset) => {
  const width = video.videoWidth || asset.width || 0;
  const height = video.videoHeight || asset.height || 0;
  return { width, height };
};

const getImageSize = (image: HTMLImageElement, asset: VideoAsset) => {
  const width = image.naturalWidth || asset.width || 0;
  const height = image.naturalHeight || asset.height || 0;
  return { width, height };
};

const updatePixelPiecesLayout = (pieces: PixelPiece[], width: number, height: number) => {
  if (!pieces.length) return;
  const pieceW = width / PIXEL_GRID_COLS;
  const pieceH = height / PIXEL_GRID_ROWS;
  pieces.forEach((piece) => {
    const x = piece.col * pieceW;
    const y = piece.row * pieceH;
    piece.graphics.clear();
    piece.graphics.rect(x, y, pieceW, pieceH);
    piece.graphics.fill({ color: 0x000000 });
  });
};

const updatePixelPiecesAlpha = (
  pieces: PixelPiece[],
  effectState: ClipEffectState,
  enterEffect: string,
  exitEffect: string,
  fadeInMs: number,
  fadeOutMs: number
) => {
  if (!pieces.length) return;

  const showPixelMask = enterEffect === 'pixel' || exitEffect === 'pixel';
  if (!showPixelMask) {
    pieces.forEach((piece) => {
      piece.graphics.alpha = 0;
    });
    return;
  }

  const isEntering = effectState.isEntering && enterEffect === 'pixel';
  const isExiting = effectState.isExiting && exitEffect === 'pixel';

  if (!isEntering && !isExiting) {
    pieces.forEach((piece) => {
      piece.graphics.alpha = 0;
    });
    return;
  }

  const duration = isEntering ? fadeInMs : fadeOutMs;
  if (duration <= 0) {
    pieces.forEach((piece) => {
      piece.graphics.alpha = isEntering ? 0 : 1;
    });
    return;
  }

  const elapsed = isEntering
    ? effectState.pixelProgress * duration
    : (1 - effectState.pixelProgress) * duration;

  pieces.forEach((piece) => {
    const delayMs = piece.delay * duration * 0.8;
    const transitionMs = duration * 0.5;
    const local = Math.max(0, Math.min(1, transitionMs > 0 ? (elapsed - delayMs) / transitionMs : 1));
    const alpha = isEntering ? 1 - local : local;
    piece.graphics.alpha = Math.max(0, Math.min(1, alpha));
  });
};

export class ClipPixiRenderer {
  private root: Container;
  private items = new Map<string, ClipItem>();
  private assetMap = new Map<string, VideoAsset>();
  private clips: VideoClip[] = [];
  private externalVideos = new Map<string, ExternalVideoSource>();
  private stageSize: StageSize = { width: 0, height: 0 };
  private recordingLayout: RecordingLayoutConfig | null = null;
  private cameraTransform: CameraTransform = { scale: 1, focusX: 0.5, focusY: 0.5 };
  private destroyed = false;

  constructor(parent: Container) {
    this.root = new Container();
    this.root.sortableChildren = true;
    this.root.zIndex = 1;
    parent.addChild(this.root);
  }

  setZIndex(value: number) {
    this.root.zIndex = value;
  }

  setAssets(assets: VideoAsset[]) {
    this.assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  }

  setExternalVideo(assetId: string, video: HTMLVideoElement, options?: { allowSeek?: boolean }) {
    const allowSeek = options?.allowSeek ?? false;
    const existing = this.externalVideos.get(assetId);
    if (existing && existing.video === video && existing.allowSeek === allowSeek) return;
    this.externalVideos.set(assetId, { video, allowSeek });
    if (this.clips.length) {
      this.syncClips(this.clips);
    }
  }

  clearExternalVideo(assetId: string) {
    if (!this.externalVideos.has(assetId)) return;
    this.externalVideos.delete(assetId);
    if (this.clips.length) {
      this.syncClips(this.clips);
    }
  }

  setRecordingLayout(config: RecordingLayoutConfig | null) {
    this.recordingLayout = config;
    this.items.forEach((item) => {
      if (item.clip.applyCamera) {
        item.recordingLayoutKey = '';
        item.layoutKey = '';
      }
    });
  }

  getClipItem(id: string): ClipItem | null {
    return this.items.get(id) ?? null;
  }

  getClipInteractionRect(id: string): ClipInteractionRect | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.interactionRect) {
      return { ...item.interactionRect };
    }
    const rect = item.visibleRect ?? item.boxRect ?? null;
    if (!rect) return null;

    const anchor = item.clip.anchor ?? { x: 0, y: 0 };
    const scale = Math.max(0.01, item.container.scale.x || 1);
    return {
      x: rect.x + rect.width * anchor.x * (1 - scale),
      y: rect.y + rect.height * anchor.y * (1 - scale),
      width: rect.width * scale,
      height: rect.height * scale,
    };
  }

  applyScreenOffset(zoomScale: number) {
    void zoomScale;
  }

  setStageSize(size: StageSize) {
    this.stageSize = { ...size };
    this.items.forEach((item) => {
      item.layoutKey = '';
    });
  }

  setCameraTransform(transform: CameraTransform) {
    this.cameraTransform = { ...transform };
    this.items.forEach((item) => {
      if (item.clip.applyCamera) {
        item.transformKey = '';
      }
    });
  }

  syncClips(clips: VideoClip[]) {
    if (this.destroyed) return;
    this.clips = clips;
    const nextIds = new Set(clips.map((clip) => clip.id));

    for (const [id, item] of this.items) {
      if (!nextIds.has(id)) {
        this.destroyItem(item);
        this.items.delete(id);
      }
    }

    clips.forEach((clip) => {
      const asset = this.assetMap.get(clip.assetId);
      if (!asset) {
        const existing = this.items.get(clip.id);
        if (existing) {
          this.destroyItem(existing);
          this.items.delete(clip.id);
        }
        return;
      }

      const clipKey = getClipLayoutKey(clip);
      const existing = this.items.get(clip.id);
      const external = this.externalVideos.get(clip.assetId);
      const wantsExternal = Boolean(external);

      if (
        !existing ||
        existing.asset.id !== asset.id ||
        existing.asset.src !== asset.src ||
        existing.isExternal !== wantsExternal
      ) {
        if (existing) {
          this.destroyItem(existing);
          this.items.delete(clip.id);
        }
        const item = this.createItem(clip, asset);
        item.clipKey = clipKey;
        this.items.set(clip.id, item);
        return;
      }

      existing.clip = clip;
      existing.asset = asset;
      existing.container.zIndex = clip.zIndex;
      this.syncChromaState(existing, clip.chromaKey);

      if (existing.clipKey !== clipKey) {
        existing.clipKey = clipKey;
        existing.layoutKey = '';
      }
    });
  }

  update(timeMs: number, isPlaying: boolean, selectedClipId: string | null) {
    if (this.destroyed) return;
    this.items.forEach((item) => {
      const clip = item.clip;
      const isActive = timeMs >= clip.startMs && timeMs <= clip.endMs;
      const isSelected = clip.id === selectedClipId;
      const shouldUpdate = isActive || isSelected;

      item.container.visible = isActive;
      if (!shouldUpdate) {
        if (item.video && !item.video.paused) {
          item.video.pause();
        }
        return;
      }

      this.syncVideoTime(item, timeMs, isActive, isPlaying && isActive);

      this.updateItemVisuals(item, timeMs);
    });
  }

  async prepareFrame(timeMs: number) {
    if (this.destroyed) return;
    const pendingSeeks: Promise<void>[] = [];

    this.items.forEach((item) => {
      const region = item.clip;
      const isActive = timeMs >= region.startMs && timeMs <= region.endMs;
      const isVisible = isActive;

      item.container.visible = isVisible;
      if (!isVisible) {
        if (item.video && !item.video.paused) {
          item.video.pause();
        }
        return;
      }

      pendingSeeks.push(this.seekVideoForExport(item, timeMs, isActive));
    });

    if (pendingSeeks.length) {
      await Promise.all(pendingSeeks);
    }

    this.items.forEach((item) => {
      if (!item.container.visible) return;
      this.updateItemVisuals(item, timeMs);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.items.forEach((item) => this.destroyItem(item));
    this.items.clear();
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    this.root.destroy({ children: true });
  }

  private createItem(clip: VideoClip, asset: VideoAsset): ClipItem {
    const container = new Container();
    container.zIndex = clip.zIndex;
    this.root.addChild(container);

    const content = new Container();
    container.addChild(content);

    const mask = new Graphics();
    content.addChild(mask);
    // Don't set content.mask here - an empty mask blocks all visibility.
    // The mask will be set in updateLayoutForItem after it has content.

    const isImageAsset = asset.kind === 'image';
    const external = isImageAsset ? null : this.externalVideos.get(clip.assetId);
    const isExternal = Boolean(external);
    const video = isImageAsset ? null : (external?.video ?? buildVideoElement(asset.src));
    const image = isImageAsset ? buildImageElement(asset.src) : null;
    const allowSeek = isImageAsset ? false : (external?.allowSeek ?? true);

    const videoSource = video
      ? new VideoSource({ resource: video, autoPlay: false, autoLoad: false })
      : null;
    videoSource?.load().catch(() => {});
    const videoTexture = videoSource ? Texture.from(videoSource) : null;

    const chromaCanvas = document.createElement('canvas');
    const chromaCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });
    const chromaTexture = Texture.from(chromaCanvas);

    const sprite = new Sprite(chromaTexture);
    content.addChild(sprite);

    const pixelContainer = new Container();
    content.addChild(pixelContainer);

    const seed = clip.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pixelPieces = generatePixelPieces(PIXEL_GRID_ROWS, PIXEL_GRID_COLS, seed).map((piece) => {
      const graphics = new Graphics();
      pixelContainer.addChild(graphics);
      return { ...piece, graphics };
    });

    const item: ClipItem = {
      clip,
      asset,
      container,
      content,
      sprite,
      mask,
      pixelContainer,
      pixelPieces,
      video,
      image,
      videoSource,
      videoTexture,
      isExternal,
      allowSeek,
      needsFrame: true,
      useChroma: false,
      clipKey: getClipLayoutKey(clip),
      layoutKey: '',
      transformKey: '',
      videoSizeKey: '',
      recordingLayoutKey: '',
      chromaCanvas,
      chromaCtx,
      chromaTexture,
      readyPromise: video ? ensureVideoReady(video) : image ? ensureImageReady(image) : undefined,
    };

    const updateFrame = () => {
      if (this.destroyed || !this.items.has(clip.id)) return;
      this.updateChromaFrame(item);
    };

    const handleSeeked = () => updateFrame();
    const handleLoadedData = () => updateFrame();

    item.onSeeked = handleSeeked;
    item.onLoadedData = handleLoadedData;

    if (video) {
      video.addEventListener('seeked', handleSeeked);
      video.addEventListener('loadeddata', handleLoadedData);

      ensureVideoMetadata(video).then(() => {
        if (this.destroyed || !this.items.has(clip.id)) return;
        item.layoutKey = '';
        if (!item.isExternal || item.allowSeek) {
          try {
            const maxSafe = Math.max(0, (video.duration || 0) - 0.001);
            video.currentTime = Math.min(0.001, maxSafe);
          } catch {
            // ignore initial seek errors
          }
        }
        updateFrame();
      });
    } else if (image) {
      ensureImageReady(image).then(() => {
        if (this.destroyed || !this.items.has(clip.id)) return;
        item.layoutKey = '';
        item.needsFrame = true;
        updateFrame();
      });
    }

    this.syncChromaState(item, clip.chromaKey);

    return item;
  }

  private updateLayoutForItem(item: ClipItem, clip: VideoClip) {
    if (!this.stageSize.width || !this.stageSize.height) return;

    const sourceWidth = item.sprite.texture.source.width;
    const sourceHeight = item.sprite.texture.source.height;
    if (sourceWidth <= 1 || sourceHeight <= 1) {
      item.layoutKey = '';
      return;
    }

    if (clip.applyCamera && this.recordingLayout) {
      this.applyRecordingLayout(item, sourceWidth, sourceHeight);
      return;
    }

    const layout = computeClipLayout({
      region: clip,
      containerWidth: this.stageSize.width,
      containerHeight: this.stageSize.height,
      videoWidth: sourceWidth,
      videoHeight: sourceHeight,
    });
    if (!layout) return;

    const srcX = Math.max(0, Math.min(layout.src.x, sourceWidth - 1));
    const srcY = Math.max(0, Math.min(layout.src.y, sourceHeight - 1));
    const srcW = Math.max(1, Math.min(layout.src.width, sourceWidth - srcX));
    const srcH = Math.max(1, Math.min(layout.src.height, sourceHeight - srcY));
    if (srcW <= 0 || srcH <= 0) return;

    const layoutKey = [
      layout.box.x,
      layout.box.y,
      layout.box.width,
      layout.box.height,
      layout.dest.x,
      layout.dest.y,
      layout.dest.width,
      layout.dest.height,
      srcX,
      srcY,
      srcW,
      srcH,
    ].map((value) => value.toFixed(3)).join('|');

    if (layoutKey === item.layoutKey) {
      return;
    }

    item.layoutKey = layoutKey;

    const box = layout.box;
    const dest = layout.dest;

    item.boxRect = { ...box };
    item.visibleRect = { ...dest };
    item.content.position.set(0, 0);

    const radius = clampRadius(clip.borderRadius ?? 0, box.width, box.height);
    item.mask.clear();
    item.mask.roundRect(0, 0, box.width, box.height, radius);
    item.mask.fill({ color: 0xffffff });
    item.content.mask = item.mask;

    const localX = dest.x - box.x;
    const localY = dest.y - box.y;
    item.sprite.position.set(localX, localY);
    item.sprite.width = dest.width;
    item.sprite.height = dest.height;

    const textureFrame = item.sprite.texture.frame;
    textureFrame.x = srcX;
    textureFrame.y = srcY;
    textureFrame.width = srcW;
    textureFrame.height = srcH;
    item.sprite.texture.updateUvs();

    updatePixelPiecesLayout(item.pixelPieces, box.width, box.height);
  }

  private getTargetSeconds(
    item: ClipItem,
    timeMs: number,
    isActive: boolean,
    durationMs: number
  ): number | null {
    const clip = item.clip;
    const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
    const sourceStartMs = clip.sourceStartMs ?? 0;
    const defaultEndMs = sourceStartMs + clipDurationMs;
    const sourceEndMs = typeof clip.sourceEndMs === 'number' ? clip.sourceEndMs : defaultEndMs;
    const maxMs = durationMs > 0 ? Math.min(durationMs, sourceEndMs) : sourceEndMs;

    const rawLocalMs = isActive ? Math.max(0, timeMs - clip.startMs) : 0;
    const rawTargetMs = sourceStartMs + getSourceOffsetForTimelineOffsetMs(clip, rawLocalMs);
    const clampedMs = durationMs > 0
      ? Math.min(Math.max(rawTargetMs, 0), Math.max(0, maxMs - 1))
      : Math.max(0, rawTargetMs);

    if (!Number.isFinite(clampedMs)) return null;
    return clampedMs / 1000;
  }

  private applyRecordingLayout(item: ClipItem, sourceWidth: number, sourceHeight: number) {
    const layout = this.recordingLayout;
    if (!layout) return;

    const stageWidth = this.stageSize.width;
    const stageHeight = this.stageSize.height;
    if (!stageWidth || !stageHeight) return;

    const crop = layout.cropRegion;
    const cropStartX = crop.x;
    const cropStartY = crop.y;
    const cropEndX = crop.x + crop.width;
    const cropEndY = crop.y + crop.height;

    const croppedVideoWidth = sourceWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = sourceHeight * (cropEndY - cropStartY);

    const paddingScale = 1.0 - (layout.padding / 100) * 0.4;
    const viewportWidth = stageWidth * paddingScale;
    const viewportHeight = stageHeight * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    const spriteWidth = sourceWidth * scale;
    const spriteHeight = sourceHeight * scale;

    const cropPixelX = cropStartX * sourceWidth * scale;
    const cropPixelY = cropStartY * sourceHeight * scale;

    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (stageWidth - croppedDisplayWidth) / 2;
    const centerOffsetY = (stageHeight - croppedDisplayHeight) / 2;
    const spriteOffsetX = centerOffsetX - cropPixelX;
    const spriteOffsetY = centerOffsetY - cropPixelY;

    const layoutKey = [
      stageWidth,
      stageHeight,
      sourceWidth,
      sourceHeight,
      cropStartX,
      cropStartY,
      cropEndX,
      cropEndY,
      layout.padding,
      layout.borderRadius,
      layout.screenOffsetPx.x,
      layout.screenOffsetPx.y,
    ].map((value) => value.toFixed(4)).join('|');

    const cropBounds = {
      startX: cropStartX * sourceWidth,
      endX: cropEndX * sourceWidth,
      startY: cropStartY * sourceHeight,
      endY: cropEndY * sourceHeight,
    };

    const baseRect = {
      x: centerOffsetX + layout.screenOffsetPx.x,
      y: centerOffsetY + layout.screenOffsetPx.y,
      width: croppedDisplayWidth,
      height: croppedDisplayHeight,
    };

    if (layoutKey === item.recordingLayoutKey) {
      item.boxRect = { ...baseRect };
      item.visibleRect = { ...baseRect };
      item.recordingBaseRect = { ...baseRect };
      item.baseOffset = { x: baseRect.x, y: baseRect.y };
      item.recordingSpriteOffset = { x: spriteOffsetX, y: spriteOffsetY };
      item.recordingScale = scale;
      item.recordingVideoSize = { width: croppedVideoWidth, height: croppedVideoHeight };
      item.recordingCropBounds = cropBounds;
      return;
    }

    item.recordingLayoutKey = layoutKey;
    item.layoutKey = layoutKey;
    item.boxRect = { ...baseRect };
    item.visibleRect = { ...baseRect };
    item.recordingBaseRect = { ...baseRect };
    item.baseOffset = { x: baseRect.x, y: baseRect.y };
    item.recordingSpriteOffset = { x: spriteOffsetX, y: spriteOffsetY };
    item.recordingScale = scale;
    item.recordingVideoSize = { width: croppedVideoWidth, height: croppedVideoHeight };
    item.recordingCropBounds = cropBounds;

    item.content.position.set(baseRect.x, baseRect.y);
    item.content.pivot.set(0, 0);
    item.content.scale.set(1, 1);
    item.content.rotation = 0;
    item.content.alpha = 1;
    item.sprite.position.set(-cropPixelX, -cropPixelY);
    item.sprite.width = spriteWidth;
    item.sprite.height = spriteHeight;

    const radius = clampRadius(layout.borderRadius, croppedDisplayWidth, croppedDisplayHeight);
    item.mask.clear();
    item.mask.roundRect(0, 0, croppedDisplayWidth, croppedDisplayHeight, radius);
    item.mask.fill({ color: 0xffffff });
    item.content.mask = item.mask;

    updatePixelPiecesLayout(item.pixelPieces, croppedDisplayWidth, croppedDisplayHeight);
  }

  private updateItemTransform(item: ClipItem, clip: VideoClip, effectState: ClipEffectState, timeMs: number) {
    const box = item.boxRect;
    if (!box) return;

    const effectOpacity = effectState.opacity;
    const opacity = Math.max(0, Math.min(1, (clip.opacity ?? 1) * effectOpacity));
    const stageWidth = this.stageSize.width;
    const stageHeight = this.stageSize.height;
    let slideOffsetX = 0;
    let slideOffsetY = 0;
    const slideEffect = effectState.isEntering ? (clip.enterEffect ?? 'none') : effectState.isExiting ? (clip.exitEffect ?? 'none') : 'none';

    if (isSlideEffect(slideEffect) && stageWidth > 0 && stageHeight > 0) {
      switch (slideEffect) {
        case 'slide-left':
          slideOffsetX = -(box.x + box.width);
          break;
        case 'slide-right':
          slideOffsetX = stageWidth - box.x;
          break;
        case 'slide-up':
          slideOffsetY = -(box.y + box.height);
          break;
        case 'slide-down':
          slideOffsetY = stageHeight - box.y;
          break;
      }

      const hiddenFactor = 1 - effectState.revealProgress;
      slideOffsetX *= hiddenFactor;
      slideOffsetY *= hiddenFactor;
    }

    if (clip.applyCamera) {
      if (!stageWidth || !stageHeight) return;
      const baseRect = item.recordingBaseRect ?? item.boxRect;
      if (!baseRect) return;
      const baseState = {
        x: (baseRect.x / stageWidth) * 100,
        y: (baseRect.y / stageHeight) * 100,
        width: (baseRect.width / stageWidth) * 100,
        height: (baseRect.height / stageHeight) * 100,
        rotationDeg: clip.rotationDeg ?? 0,
        scale: clip.scale ?? 1,
        opacity: clip.opacity ?? 1,
      };
      const resolvedState = resolveClipTransformStateFromBase(baseState, clip.transformKeyframes, timeMs);
      const resolvedBox = {
        x: (resolvedState.x / 100) * stageWidth,
        y: (resolvedState.y / 100) * stageHeight,
        width: (resolvedState.width / 100) * stageWidth,
        height: (resolvedState.height / 100) * stageHeight,
      };
      const anchor = clip.anchor ?? { x: 0, y: 0 };
      const sizeScaleX = baseRect.width > 0 ? resolvedBox.width / baseRect.width : 1;
      const sizeScaleY = baseRect.height > 0 ? resolvedBox.height / baseRect.height : 1;
      const uniformScale = Math.max(0.01, resolvedState.scale ?? 1);
      const totalScaleX = sizeScaleX * uniformScale;
      const totalScaleY = sizeScaleY * uniformScale;
      const focusStagePxX = this.cameraTransform.focusX * stageWidth;
      const focusStagePxY = this.cameraTransform.focusY * stageHeight;
      const stageCenterX = stageWidth / 2;
      const stageCenterY = stageHeight / 2;
      const scale = this.cameraTransform.scale;
      const cameraX = stageCenterX - focusStagePxX * scale;
      const cameraY = stageCenterY - focusStagePxY * scale;
      const transformKey = [
        'recording',
        scale.toFixed(4),
        resolvedBox.x.toFixed(2),
        resolvedBox.y.toFixed(2),
        resolvedBox.width.toFixed(2),
        resolvedBox.height.toFixed(2),
        totalScaleX.toFixed(4),
        totalScaleY.toFixed(4),
        (resolvedState.rotationDeg ?? 0).toFixed(4),
        (cameraX + slideOffsetX).toFixed(2),
        (cameraY + slideOffsetY).toFixed(2),
        effectOpacity.toFixed(3),
        (resolvedState.opacity ?? 1).toFixed(3),
      ].join('|');
      if (transformKey !== item.transformKey) {
        item.transformKey = transformKey;
        item.container.alpha = effectOpacity;
        item.container.pivot.set(0, 0);
        item.container.rotation = 0;
        item.container.scale.set(scale, scale);
        item.container.position.set(cameraX + slideOffsetX, cameraY + slideOffsetY);
        item.content.pivot.set(baseRect.width * anchor.x, baseRect.height * anchor.y);
        item.content.position.set(
          resolvedBox.x + resolvedBox.width * anchor.x,
          resolvedBox.y + resolvedBox.height * anchor.y,
        );
        item.content.rotation = (resolvedState.rotationDeg ?? 0) * DEG_TO_RAD;
        item.content.scale.set(totalScaleX, totalScaleY);
        item.content.alpha = Math.max(0, Math.min(1, resolvedState.opacity ?? 1));
        item.boxRect = { ...resolvedBox };
        item.visibleRect = { ...resolvedBox };
        item.interactionRect = getTransformedBounds({
          box: baseRect,
          anchor,
          scaleX: totalScaleX,
          scaleY: totalScaleY,
          rotationDeg: resolvedState.rotationDeg ?? 0,
          parentScale: { x: scale, y: scale },
          parentPosition: { x: cameraX + slideOffsetX, y: cameraY + slideOffsetY },
        });
      }
      return;
    }

    const anchor = clip.anchor ?? { x: 0, y: 0 };
    const rotation = clip.rotationDeg ?? 0;
    const scale = clip.scale ?? 1;
    const transformKey = [
      box.x,
      box.y,
      box.width,
      box.height,
      slideOffsetX,
      slideOffsetY,
      anchor.x,
      anchor.y,
      rotation,
      scale,
      opacity,
    ].map((value) => (typeof value === 'number' ? value.toFixed(4) : value)).join('|');

    if (transformKey === item.transformKey) return;

    item.transformKey = transformKey;

    const pivotX = box.width * anchor.x;
    const pivotY = box.height * anchor.y;

    item.container.pivot.set(pivotX, pivotY);
    item.container.position.set(box.x + pivotX + slideOffsetX, box.y + pivotY + slideOffsetY);
    item.content.position.set(-pivotX, -pivotY);
    item.container.rotation = rotation * DEG_TO_RAD;
    item.container.scale.set(scale, scale);
    item.container.alpha = opacity;
    item.content.alpha = 1;
    item.interactionRect = undefined;
  }

  private syncVideoTime(item: ClipItem, timeMs: number, isActive: boolean, shouldPlay: boolean) {
    if (this.destroyed || !this.items.has(item.clip.id)) return;
    const video = item.video;
    if (!video) return;

    if (item.isExternal && !item.allowSeek) {
      return;
    }

    const durationMs = item.asset.durationMs > 0
      ? item.asset.durationMs
      : Math.max(0, (video.duration || 0) * 1000);
    const targetSeconds = this.getTargetSeconds(item, timeMs, isActive, durationMs);
    if (targetSeconds === null) return;

    const drift = Math.abs(video.currentTime - targetSeconds);
    const threshold = shouldPlay ? 0.15 : 0.02;
    const shouldSeek = item.needsFrame || drift > threshold;
    if (shouldSeek) {
      try {
        video.currentTime = targetSeconds;
        if (!shouldPlay && video.readyState >= 2) {
          const textureSource = item.videoTexture?.source;
          if (textureSource) {
            textureSource.update();
          }
        }
      } catch {
        // ignore seek errors
      }
    }

    if (shouldPlay) {
      if (video.paused) {
        video.play().catch(() => {});
      }
    } else if (!video.paused) {
      video.pause();
    }
  }

  private async seekVideoForExport(item: ClipItem, timeMs: number, isActive: boolean) {
    if (this.destroyed || !this.items.has(item.clip.id)) return;
    const video = item.video;
    if (!video) return;

    if (item.readyPromise) {
      await item.readyPromise;
    }
    if (this.destroyed || !this.items.has(item.clip.id)) return;

    if (!item.allowSeek) return;
    if (video.error) return;

    const durationMs = item.asset.durationMs > 0
      ? item.asset.durationMs
      : Math.max(0, (video.duration || 0) * 1000);
    const targetSeconds = this.getTargetSeconds(item, timeMs, isActive, durationMs);
    if (targetSeconds === null) return;

    const lastTime = item.lastTime;
    if (typeof lastTime === 'number' && Math.abs(lastTime - targetSeconds) < 0.002 && video.readyState >= 2) {
      return;
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

    item.lastTime = targetSeconds;
    if (!video.paused) {
      video.pause();
    }
  }

  private updateItemVisuals(item: ClipItem, timeMs: number) {
    if (this.destroyed || !this.items.has(item.clip.id)) return;
    const clip = item.clip;
    const keyframeTimeMs = Math.min(Math.max(timeMs, clip.startMs), clip.endMs);
    const resolvedClip = clip.applyCamera
      ? clip
      : (() => {
          const resolvedState = resolveClipTransformStateAtTime(clip, keyframeTimeMs);
          return (
            resolvedState.x === clip.position.x &&
            resolvedState.y === clip.position.y &&
            resolvedState.width === clip.size.width &&
            resolvedState.height === clip.size.height &&
            resolvedState.rotationDeg === (clip.rotationDeg ?? 0) &&
            resolvedState.scale === (clip.scale ?? 1) &&
            resolvedState.opacity === (clip.opacity ?? 1)
          )
            ? clip
            : {
                ...clip,
                position: { x: resolvedState.x, y: resolvedState.y },
                size: { width: resolvedState.width, height: resolvedState.height },
                rotationDeg: resolvedState.rotationDeg,
                scale: resolvedState.scale,
                opacity: resolvedState.opacity,
              };
        })();

    this.updateChromaFrame(item);

    const sourceWidth = item.sprite.texture.source.width;
    const sourceHeight = item.sprite.texture.source.height;
    const currentVideoSize = sourceWidth > 1 && sourceHeight > 1
      ? { width: sourceWidth, height: sourceHeight }
      : item.image
        ? getImageSize(item.image, item.asset)
        : item.video
          ? getVideoSize(item.video, item.asset)
          : { width: item.asset.width || 0, height: item.asset.height || 0 };
    const videoSizeKey = `${currentVideoSize.width}x${currentVideoSize.height}`;
    if (item.videoSizeKey !== videoSizeKey) {
      item.videoSizeKey = videoSizeKey;
      item.layoutKey = '';
    }

    this.updateLayoutForItem(item, resolvedClip);

    const effectState = getClipEffectState(clip, timeMs);
    this.updateItemTransform(item, resolvedClip, effectState, keyframeTimeMs);

    const enterEffect = clip.enterEffect ?? 'none';
    const exitEffect = clip.exitEffect ?? 'none';
    const fadeInMs = clip.fadeInMs ?? 300;
    const fadeOutMs = clip.fadeOutMs ?? 300;
    updatePixelPiecesAlpha(item.pixelPieces, effectState, enterEffect, exitEffect, fadeInMs, fadeOutMs);
  }

  private syncChromaState(item: ClipItem, chromaKey?: VideoClip['chromaKey']) {
    const enabled = Boolean(chromaKey?.enabled);
    if (!item.chromaCanvas) {
      item.chromaCanvas = document.createElement('canvas');
      item.chromaCtx = item.chromaCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!item.chromaTexture) {
      item.chromaTexture = Texture.from(item.chromaCanvas);
    }
    if (item.sprite.texture !== item.chromaTexture) {
      item.sprite.texture = item.chromaTexture;
      item.layoutKey = '';
    }
    item.useChroma = enabled;
    item.needsFrame = true;
  }

  private updateChromaFrame(item: ClipItem) {
    if (this.destroyed || !this.items.has(item.clip.id)) return;
    const video = item.video;
    const image = item.image;
    const canvas = item.chromaCanvas;
    const ctx = item.chromaCtx;
    if (!canvas || !ctx) return;

    const width = image
      ? image.naturalWidth || canvas.width
      : video?.videoWidth || canvas.width;
    const height = image
      ? image.naturalHeight || canvas.height
      : video?.videoHeight || canvas.height;
    if (!width || !height) return;

    if (image && !item.needsFrame && canvas.width === width && canvas.height === height) {
      return;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (!image && (!video || video.readyState < 2)) {
      const chromaSource = item.chromaTexture?.source;
      if (chromaSource) {
        chromaSource.update();
      }
      return;
    }

    ctx.clearRect(0, 0, width, height);
    if (image) {
      ctx.drawImage(image, 0, 0, width, height);
    } else if (video) {
      ctx.drawImage(video, 0, 0, width, height);
    }
    if (item.useChroma) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const chromaKey = item.clip.chromaKey;
      applyChromaKeyToImageData(
        imageData.data,
        parseHexColor(chromaKey?.color ?? '#00ff00'),
        chromaKey?.threshold ?? 0.35,
        chromaKey?.softness ?? 0.15
      );
      ctx.putImageData(imageData, 0, 0);
    }

    const chromaSource = item.chromaTexture?.source;
    if (chromaSource) {
      chromaSource.update();
    }
    item.needsFrame = false;
  }

  private destroyItem(item: ClipItem) {
    if (item.video && item.onSeeked) {
      item.video.removeEventListener('seeked', item.onSeeked);
    }
    if (item.video && item.onLoadedData) {
      item.video.removeEventListener('loadeddata', item.onLoadedData);
    }
    item.content.mask = null;
    item.container.removeFromParent();
    item.sprite.destroy({ texture: false });
    item.mask.destroy();
    item.pixelContainer.destroy({ children: true });
    item.container.destroy({ children: false });
    item.videoTexture?.destroy(true);
    item.chromaTexture?.destroy(true);
    if (item.image) {
      item.image.src = '';
    } else if (item.video && !item.isExternal) {
      try {
        item.video.pause();
        item.video.src = '';
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
