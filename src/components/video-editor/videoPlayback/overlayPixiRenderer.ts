import { Container, Graphics, Sprite, Texture, VideoSource, Rectangle } from 'pixi.js';
import type { OverlayVideoAsset, OverlayVideoRegion } from '../types';
import { applyChromaKeyToImageData, parseHexColor } from '@/utils/chromaKey';
import { computeOverlayLayout } from '@/utils/overlayLayout';

type StageSize = { width: number; height: number };
type PixelPiece = {
  row: number;
  col: number;
  delay: number;
  graphics: Graphics;
};

type OverlayEffectState = {
  opacity: number;
  pixelProgress: number;
  isEntering: boolean;
  isExiting: boolean;
};

type OverlayItem = {
  region: OverlayVideoRegion;
  asset: OverlayVideoAsset;
  container: Container;
  sprite: Sprite;
  mask: Graphics;
  pixelContainer: Container;
  pixelPieces: PixelPiece[];
  video: HTMLVideoElement;
  videoSource: VideoSource;
  videoTexture: Texture;
  needsFrame: boolean;
  onLoadedData?: () => void;
  onSeeked?: () => void;
  chromaCanvas?: HTMLCanvasElement;
  chromaCtx?: CanvasRenderingContext2D | null;
  chromaTexture?: Texture;
  useChroma: boolean;
  regionKey: string;
  layoutKey: string;
  videoSizeKey: string;
};

const PIXEL_GRID_ROWS = 4;
const PIXEL_GRID_COLS = 5;

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

const getOverlayEffectState = (region: OverlayVideoRegion, timeMs: number): OverlayEffectState => {
  const isActive = timeMs >= region.startMs && timeMs <= region.endMs;
  if (!isActive) {
    return { opacity: 1, pixelProgress: 1, isEntering: false, isExiting: false };
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

  if (timeSinceStart < fadeInMs && enterEffect !== 'none') {
    isEntering = true;
    const progress = fadeInMs > 0 ? Math.min(1, timeSinceStart / fadeInMs) : 1;
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
    if (exitEffect === 'fade') {
      opacity = progress;
    } else if (exitEffect === 'pixel') {
      pixelProgress = progress;
      opacity = 1;
    }
  }

  return { opacity, pixelProgress, isEntering, isExiting };
};

const getRegionLayoutKey = (region: OverlayVideoRegion) => {
  const crop = region.crop;
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
  ].join('|');
};

const clampRadius = (radius: number, width: number, height: number) => {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
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

const getVideoSize = (video: HTMLVideoElement, asset: OverlayVideoAsset) => {
  const width = video.videoWidth || asset.width || 0;
  const height = video.videoHeight || asset.height || 0;
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
  effectState: OverlayEffectState,
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

export class OverlayPixiRenderer {
  private root: Container;
  private items = new Map<string, OverlayItem>();
  private assetMap = new Map<string, OverlayVideoAsset>();
  private stageSize: StageSize = { width: 0, height: 0 };

  constructor(parent: Container) {
    this.root = new Container();
    this.root.sortableChildren = true;
    this.root.zIndex = 1;
    parent.addChild(this.root);
  }

  setZIndex(value: number) {
    this.root.zIndex = value;
  }

  setAssets(assets: OverlayVideoAsset[]) {
    this.assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  }

  setStageSize(size: StageSize) {
    this.stageSize = { ...size };
    this.items.forEach((item) => {
      item.layoutKey = '';
    });
  }

  syncRegions(regions: OverlayVideoRegion[]) {
    const nextIds = new Set(regions.map((region) => region.id));

    for (const [id, item] of this.items) {
      if (!nextIds.has(id)) {
        this.destroyItem(item);
        this.items.delete(id);
      }
    }

    regions.forEach((region) => {
      const asset = this.assetMap.get(region.assetId);
      if (!asset) {
        const existing = this.items.get(region.id);
        if (existing) {
          this.destroyItem(existing);
          this.items.delete(region.id);
        }
        return;
      }

      const regionKey = getRegionLayoutKey(region);
      const existing = this.items.get(region.id);

      if (!existing || existing.asset.id !== asset.id || existing.asset.src !== asset.src) {
        if (existing) {
          this.destroyItem(existing);
          this.items.delete(region.id);
        }
        const item = this.createItem(region, asset);
        item.regionKey = regionKey;
        this.items.set(region.id, item);
        return;
      }

      existing.region = region;
      existing.asset = asset;
      existing.container.zIndex = region.zIndex;
      this.syncChromaState(existing, region.chromaKey);

      if (existing.regionKey !== regionKey) {
        existing.regionKey = regionKey;
        existing.layoutKey = '';
      }
    });
  }

  update(timeMs: number, isPlaying: boolean, selectedOverlayId: string | null) {
    this.items.forEach((item) => {
      const region = item.region;
      const isActive = timeMs >= region.startMs && timeMs <= region.endMs;
      const isVisible = isActive || region.id === selectedOverlayId;

      item.container.visible = isVisible;
      if (!isVisible) {
        if (!item.video.paused) {
          item.video.pause();
        }
        return;
      }

      this.syncVideoTime(item, timeMs, isActive, isPlaying && isActive);

      this.updateChromaFrame(item);

      const sourceWidth = item.sprite.texture.source.width;
      const sourceHeight = item.sprite.texture.source.height;
      const currentVideoSize = sourceWidth > 1 && sourceHeight > 1
        ? { width: sourceWidth, height: sourceHeight }
        : getVideoSize(item.video, item.asset);
      const videoSizeKey = `${currentVideoSize.width}x${currentVideoSize.height}`;
      if (item.videoSizeKey !== videoSizeKey) {
        item.videoSizeKey = videoSizeKey;
        item.layoutKey = '';
      }

      this.updateLayoutForItem(item);

      const effectState = getOverlayEffectState(region, timeMs);
      item.container.alpha = effectState.opacity;

      const enterEffect = region.enterEffect ?? 'none';
      const exitEffect = region.exitEffect ?? 'none';
      const fadeInMs = region.fadeInMs ?? 300;
      const fadeOutMs = region.fadeOutMs ?? 300;
      updatePixelPiecesAlpha(item.pixelPieces, effectState, enterEffect, exitEffect, fadeInMs, fadeOutMs);
    });
  }

  destroy() {
    this.items.forEach((item) => this.destroyItem(item));
    this.items.clear();
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    this.root.destroy({ children: true });
  }

  private createItem(region: OverlayVideoRegion, asset: OverlayVideoAsset): OverlayItem {
    const container = new Container();
    container.zIndex = region.zIndex;
    this.root.addChild(container);

    const mask = new Graphics();
    container.addChild(mask);
    // Don't set container.mask here - an empty mask blocks all visibility
    // The mask will be set in updateLayoutForItem after it has content

    const video = buildVideoElement(asset.src);
    const videoSource = VideoSource.from(video);
    if ('autoPlay' in videoSource) {
      (videoSource as { autoPlay?: boolean }).autoPlay = false;
    }
    if ('autoUpdate' in videoSource) {
      (videoSource as { autoUpdate?: boolean }).autoUpdate = true;
    }
    const videoTexture = Texture.from(videoSource);

    const chromaCanvas = document.createElement('canvas');
    const chromaCtx = chromaCanvas.getContext('2d', { willReadFrequently: true });
    const chromaTexture = Texture.from(chromaCanvas);

    const sprite = new Sprite(chromaTexture);
    container.addChild(sprite);

    const pixelContainer = new Container();
    container.addChild(pixelContainer);

    const seed = region.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pixelPieces = generatePixelPieces(PIXEL_GRID_ROWS, PIXEL_GRID_COLS, seed).map((piece) => {
      const graphics = new Graphics();
      pixelContainer.addChild(graphics);
      return { ...piece, graphics };
    });

    const item: OverlayItem = {
      region,
      asset,
      container,
      sprite,
      mask,
      pixelContainer,
      pixelPieces,
      video,
      videoSource,
      videoTexture,
      needsFrame: true,
      useChroma: false,
      regionKey: getRegionLayoutKey(region),
      layoutKey: '',
      videoSizeKey: '',
      chromaCanvas,
      chromaCtx,
      chromaTexture,
    };

    const updateFrame = () => {
      item.needsFrame = false;
      this.updateChromaFrame(item);
    };

    const handleSeeked = () => updateFrame();
    const handleLoadedData = () => updateFrame();

    item.onSeeked = handleSeeked;
    item.onLoadedData = handleLoadedData;

    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadeddata', handleLoadedData);

    ensureVideoMetadata(video).then(() => {
      item.layoutKey = '';
      try {
        const maxSafe = Math.max(0, (video.duration || 0) - 0.001);
        video.currentTime = Math.min(0.001, maxSafe);
      } catch {
        // ignore initial seek errors
      }
      updateFrame();
    });

    this.syncChromaState(item, region.chromaKey);

    return item;
  }

  private updateLayoutForItem(item: OverlayItem) {
    if (!this.stageSize.width || !this.stageSize.height) return;

    const sourceWidth = item.sprite.texture.source.width;
    const sourceHeight = item.sprite.texture.source.height;
    if (sourceWidth <= 1 || sourceHeight <= 1) {
      item.layoutKey = '';
      return;
    }

    const layout = computeOverlayLayout({
      region: item.region,
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
    const src = layout.src;

    item.container.position.set(box.x, box.y);

    const radius = clampRadius(item.region.borderRadius ?? 0, box.width, box.height);
    item.mask.clear();
    item.mask.roundRect(0, 0, box.width, box.height, radius);
    item.mask.fill({ color: 0xffffff });
    item.container.mask = item.mask;

    // Apply the mask now that it has content
    if (!item.container.mask) {
      item.container.mask = item.mask;
    }

    const localX = dest.x - box.x;
    const localY = dest.y - box.y;
    item.sprite.position.set(localX, localY);
    item.sprite.width = dest.width;
    item.sprite.height = dest.height;

    item.sprite.texture.frame = new Rectangle(srcX, srcY, srcW, srcH);
    item.sprite.texture.updateUvs();

    updatePixelPiecesLayout(item.pixelPieces, box.width, box.height);
  }

  private syncVideoTime(item: OverlayItem, timeMs: number, isActive: boolean, shouldPlay: boolean) {
    const region = item.region;
    const video = item.video;

    const durationMs = item.asset.durationMs > 0 ? item.asset.durationMs : 0;
    const rawLocalMs = isActive ? Math.max(0, timeMs - region.startMs) : 0;
    const maxMs = durationMs > 0 ? Math.max(0, durationMs - 1) : 0;
    const clampedMs = durationMs > 0 ? Math.min(rawLocalMs, maxMs) : rawLocalMs;
    const targetSeconds = clampedMs / 1000;

    if (Number.isFinite(targetSeconds)) {
      const drift = Math.abs(video.currentTime - targetSeconds);
      const threshold = shouldPlay ? 0.15 : 0.02;
      const shouldSeek = item.needsFrame || drift > threshold;
      if (shouldSeek) {
        try {
          video.currentTime = targetSeconds;
          if (!shouldPlay && video.readyState >= 2) {
            item.videoTexture.source.update();
          }
        } catch {
          // ignore seek errors
        }
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

  private syncChromaState(item: OverlayItem, chromaKey?: OverlayVideoRegion['chromaKey']) {
    const enabled = Boolean((chromaKey as any)?.enabled);
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
  }

  private updateChromaFrame(item: OverlayItem) {
    const video = item.video;
    const canvas = item.chromaCanvas;
    const ctx = item.chromaCtx;
    if (!canvas || !ctx) return;

    const width = video.videoWidth || canvas.width;
    const height = video.videoHeight || canvas.height;
    if (!width || !height) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (video.readyState < 2) {
      if (item.chromaTexture) {
        item.chromaTexture.source.update();
      }
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    if (item.useChroma) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const chromaKey = item.region.chromaKey;
      applyChromaKeyToImageData(
        imageData.data,
        parseHexColor(chromaKey?.color ?? '#00ff00'),
        chromaKey?.threshold ?? 0.35,
        chromaKey?.softness ?? 0.15
      );
      ctx.putImageData(imageData, 0, 0);
    }

    if (item.chromaTexture) {
      item.chromaTexture.source.update();
    }
  }

  private destroyItem(item: OverlayItem) {
    item.container.removeFromParent();
    item.sprite.destroy({ texture: false, baseTexture: false });
    item.mask.destroy();
    item.pixelContainer.destroy({ children: true });
    item.container.destroy({ children: false });
    item.videoTexture.destroy(true);
    item.chromaTexture?.destroy(true);
    if (item.onSeeked) {
      item.video.removeEventListener('seeked', item.onSeeked);
    }
    if (item.onLoadedData) {
      item.video.removeEventListener('loadeddata', item.onLoadedData);
    }
    try {
      item.video.pause();
      item.video.src = '';
    } catch {
      // ignore cleanup errors
    }
  }
}
