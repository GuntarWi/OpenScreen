import type { AnnotationLayer, AnnotationRegion, ArrowDirection } from '@/components/video-editor/types';

// SVG path data for each arrow direction
const ARROW_PATHS: Record<ArrowDirection, string[]> = {
  'up': [
    'M 50 20 L 50 80',
    'M 50 20 L 35 35',
    'M 50 20 L 65 35',
  ],
  'down': [
    'M 50 20 L 50 80',
    'M 50 80 L 35 65',
    'M 50 80 L 65 65',
  ],
  'left': [
    'M 80 50 L 20 50',
    'M 20 50 L 35 35',
    'M 20 50 L 35 65',
  ],
  'right': [
    'M 20 50 L 80 50',
    'M 80 50 L 65 35',
    'M 80 50 L 65 65',
  ],
  'up-right': [
    'M 25 75 L 75 25',
    'M 75 25 L 60 30',
    'M 75 25 L 70 40',
  ],
  'up-left': [
    'M 75 75 L 25 25',
    'M 25 25 L 40 30',
    'M 25 25 L 30 40',
  ],
  'down-right': [
    'M 25 25 L 75 75',
    'M 75 75 L 70 60',
    'M 75 75 L 60 70',
  ],
  'down-left': [
    'M 75 25 L 25 75',
    'M 25 75 L 30 60',
    'M 25 75 L 40 70',
  ],
};

const IMAGE_CACHE = new Map<string, HTMLImageElement>();
const IMAGE_PROMISES = new Map<string, Promise<HTMLImageElement>>();

// Cache for animated image decoders
const ANIMATED_DECODER_CACHE = new Map<string, {
  decoder: ImageDecoder;
  frameCount: number;
  totalDuration: number;
  frameDurations: number[];
}>();
const ANIMATED_DECODER_PROMISES = new Map<string, Promise<{
  decoder: ImageDecoder;
  frameCount: number;
  totalDuration: number;
  frameDurations: number[];
} | null>>();

function getImageTypeFallback(src: string): string {
  const lower = src.toLowerCase();
  if (lower.startsWith('data:')) {
    const dataType = lower.slice(5).split(';')[0];
    if (dataType.startsWith('image/')) {
      return dataType;
    }
  }
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/webp';
}

function resolveDecoderType(src: string, headerType: string | null): string {
  if (headerType && headerType.startsWith('image/')) {
    return headerType;
  }
  return getImageTypeFallback(src);
}

async function getAnimatedDecoder(src: string): Promise<{
  decoder: ImageDecoder;
  frameCount: number;
  totalDuration: number;
  frameDurations: number[];
} | null> {
  // Check if ImageDecoder is supported
  if (typeof ImageDecoder === 'undefined') {
    return null;
  }

  const cached = ANIMATED_DECODER_CACHE.get(src);
  if (cached) return cached;

  const inflight = ANIMATED_DECODER_PROMISES.get(src);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) return null;

      const contentType = resolveDecoderType(src, response.headers.get('content-type'));
      const data = await response.arrayBuffer();

      const decoder = new ImageDecoder({
        data,
        type: contentType,
      });

      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || track.frameCount <= 1) {
        decoder.close();
        return null;
      }

      // Collect frame durations
      const frameDurations: number[] = [];
      let totalDuration = 0;

      for (let i = 0; i < track.frameCount; i++) {
        const result = await decoder.decode({ frameIndex: i });
        const duration = result.image.duration ? Number(result.image.duration) / 1000 : 100;
        frameDurations.push(duration);
        totalDuration += duration;
        result.image.close();
      }

      const info = {
        decoder,
        frameCount: track.frameCount,
        totalDuration,
        frameDurations,
      };

      ANIMATED_DECODER_CACHE.set(src, info);
      ANIMATED_DECODER_PROMISES.delete(src);
      return info;
    } catch (error) {
      console.warn('[AnnotationRenderer] Failed to create animated decoder:', error);
      ANIMATED_DECODER_PROMISES.delete(src);
      return null;
    }
  })();

  ANIMATED_DECODER_PROMISES.set(src, promise);
  return promise;
}

function loadImageCached(src: string): Promise<HTMLImageElement> {
  const cached = IMAGE_CACHE.get(src);
  if (cached) return Promise.resolve(cached);

  const inflight = IMAGE_PROMISES.get(src);
  if (inflight) return inflight;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (src.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      IMAGE_CACHE.set(src, img);
      IMAGE_PROMISES.delete(src);
      resolve(img);
    };
    img.onerror = (err) => {
      IMAGE_PROMISES.delete(src);
      reject(err instanceof Error ? err : new Error('Failed to load image'));
    };
    img.src = src;
  });

  IMAGE_PROMISES.set(src, promise);
  return promise;
}

function parseSvgPath(pathString: string, scaleX: number, scaleY: number): Array<{ cmd: string; args: number[] }> {
  const commands: Array<{ cmd: string; args: number[] }> = [];
  const parts = pathString.trim().split(/\s+/);
  
  let i = 0;
  while (i < parts.length) {
    const cmd = parts[i];
    if (cmd === 'M' || cmd === 'L') {
      const x = parseFloat(parts[i + 1]) * scaleX;
      const y = parseFloat(parts[i + 2]) * scaleY;
      commands.push({ cmd, args: [x, y] });
      i += 3;
    } else {
      i++;
    }
  }
  
  return commands;
}

function computeAnnotationEffectState(
  annotation: AnnotationRegion,
  currentTimeMs: number
): { alpha: number; scale: number } {
  const startMs = annotation.startMs ?? 0;
  const endMs = annotation.endMs ?? startMs;
  if (currentTimeMs < startMs || currentTimeMs > endMs) {
    return { alpha: 0, scale: 1 };
  }

  const fadeInMs = annotation.fadeInMs ?? 240;
  const fadeOutMs = annotation.fadeOutMs ?? 240;
  const enterEffect = annotation.enterEffect || 'none';
  const exitEffect = annotation.exitEffect || 'none';

  const progressIn = Math.max(0, Math.min(1, fadeInMs > 0 ? (currentTimeMs - startMs) / fadeInMs : 1));
  const progressOut = Math.max(0, Math.min(1, fadeOutMs > 0 ? (endMs - currentTimeMs) / fadeOutMs : 1));
  const enterAlpha = enterEffect === 'fade' || enterEffect === 'pop' ? progressIn : 1;
  const exitAlpha = exitEffect === 'fade' || exitEffect === 'pop' ? progressOut : 1;
  const alpha = Math.max(0, Math.min(1, enterAlpha * exitAlpha));

  let scale = 1;
  if (enterEffect === 'pop') {
    scale *= 0.82 + 0.18 * progressIn;
  }
  if (exitEffect === 'pop') {
    scale *= 0.9 + 0.1 * progressOut;
  }

  return { alpha, scale };
}

function renderArrow(
  ctx: CanvasRenderingContext2D,
  direction: ArrowDirection,
  color: string,
  strokeWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
  _scaleFactor: number,
  alpha: number = 1
) {
  const paths = ARROW_PATHS[direction];
  if (!paths) return;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  
  const padding = 8 * _scaleFactor;
  const availableWidth = Math.max(0, width - padding * 2);
  const availableHeight = Math.max(0, height - padding * 2);

  const scale = Math.min(availableWidth / 100, availableHeight / 100);
  
  const offsetX = padding + (availableWidth - 100 * scale) / 2;
  const offsetY = padding + (availableHeight - 100 * scale) / 2;
  
  // Apply centering offset
  ctx.translate(offsetX, offsetY);
  
  // Apply shadow filter
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 8 * scale; 
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4 * scale; 
  
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw all paths as a single shape to avoid overlapping shadows/strokes
  ctx.beginPath();
  
  for (const pathString of paths) {
    const commands = parseSvgPath(pathString, scale, scale);
    

    for (const { cmd, args } of commands) {
      if (cmd === 'M') {
        ctx.moveTo(args[0], args[1]);
      } else if (cmd === 'L') {
        ctx.lineTo(args[0], args[1]);
      }
    }
  }
  
  ctx.stroke();
  
  ctx.restore();
}

function renderText(
  ctx: CanvasRenderingContext2D,
  annotation: AnnotationRegion,
  x: number,
  y: number,
  width: number,
  height: number,
  scaleFactor: number,
  alpha: number = 1
) {
  const style = annotation.style;
  const textContent = annotation.textContent ?? annotation.content ?? '';
  
  ctx.save();
  ctx.globalAlpha *= alpha;

  if (!textContent) {
    ctx.restore();
    return;
  }
  
  const fontWeight = style.fontWeight === 'bold' ? 'bold' : 'normal';
  const fontStyle = style.fontStyle === 'italic' ? 'italic' : 'normal';
  const scaledFontSize = style.fontSize * scaleFactor;
  ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${style.fontFamily}`;
  ctx.textBaseline = 'middle';
  
  const containerPadding = 8 * scaleFactor;
  
  let textX = x;
  const textY = y + height / 2;
  
  if (style.textAlign === 'center') {
    textX = x + width / 2;
    ctx.textAlign = 'center';
  } else if (style.textAlign === 'right') {
    textX = x + width - containerPadding;
    ctx.textAlign = 'right';
  } else {
    textX = x + containerPadding;
    ctx.textAlign = 'left';
  }
  
  const lines = textContent.split('\n');
  const lineHeight = scaledFontSize * 1.4;

  const startY = textY - ((lines.length - 1) * lineHeight) / 2;
  
  lines.forEach((line, index) => {
    const currentY = startY + index * lineHeight;
    
    if (style.backgroundColor && style.backgroundColor !== 'transparent') {
      const metrics = ctx.measureText(line);
      const verticalPadding = scaledFontSize * 0.1;
      const horizontalPadding = scaledFontSize * 0.2;
      const borderRadius = 4 * scaleFactor;
      
      let bgX = textX - horizontalPadding;
      const bgWidth = metrics.width + horizontalPadding * 2;
      
      const contentHeight = scaledFontSize * 1.4;
      const bgHeight = contentHeight + verticalPadding * 2;
      const bgY = currentY - bgHeight / 2;
      
      if (style.textAlign === 'center') {
        bgX = textX - bgWidth / 2;
      } else if (style.textAlign === 'right') {
        bgX = textX - bgWidth;
      }
      
      ctx.fillStyle = style.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
      ctx.fill();
    }
    
    ctx.fillStyle = style.color;
    ctx.fillText(line, textX, currentY);
    
    if (style.textDecoration === 'underline') {
      const metrics = ctx.measureText(line);
      let underlineX = textX;
      const underlineY = currentY + scaledFontSize * 0.15;
      
      if (style.textAlign === 'center') {
        underlineX = textX - metrics.width / 2;
      } else if (style.textAlign === 'right') {
        underlineX = textX - metrics.width;
      }
      
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(1, scaledFontSize / 16);
      ctx.beginPath();
      ctx.moveTo(underlineX, underlineY);
      ctx.lineTo(underlineX + metrics.width, underlineY);
      ctx.stroke();
    }
  });
  
  ctx.restore();
}

async function renderImage(
  ctx: CanvasRenderingContext2D,
  annotation: AnnotationRegion,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha: number = 1
): Promise<void> {
  const src = annotation.imageContent || annotation.content;
  if (!src) {
    return;
  }
  
  try {
    const img = await loadImageCached(src);
    ctx.save();
    // Preserve aspect ratio - contain the image within the bounds
    const imgAspect = img.width / img.height;
    const boxAspect = width / height;
    
    let drawWidth = width;
    let drawHeight = height;
    let drawX = x;
    let drawY = y;
    
    if (imgAspect > boxAspect) {
      drawHeight = width / imgAspect;
      drawY = y + (height - drawHeight) / 2;
    } else {
      drawWidth = height * imgAspect;
      drawX = x + (width - drawWidth) / 2;
    }
    
    ctx.globalAlpha *= alpha;
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
  } catch (error) {
    console.error('[AnnotationRenderer] Failed to load image annotation', error);
  }
}

async function renderAnimatedEmoji(
  ctx: CanvasRenderingContext2D,
  annotation: AnnotationRegion,
  x: number,
  y: number,
  width: number,
  height: number,
  currentTimeMs: number,
  alpha: number = 1
): Promise<void> {
  const src = annotation.content;
  if (!src) return;

  // Calculate time within the annotation's visible range for animation
  const annotationStartMs = annotation.startMs ?? 0;
  const localTimeMs = currentTimeMs - annotationStartMs;

  // Try to get animated decoder first
  const animInfo = await getAnimatedDecoder(src);
  
  if (animInfo && animInfo.frameCount > 1) {
    try {
      // Calculate which frame to show based on local time (loop the animation)
      const loopedTime = localTimeMs % animInfo.totalDuration;
      
      // Find the frame index for this time
      let accumulatedTime = 0;
      let frameIndex = 0;
      for (let i = 0; i < animInfo.frameDurations.length; i++) {
        accumulatedTime += animInfo.frameDurations[i];
        if (loopedTime < accumulatedTime) {
          frameIndex = i;
          break;
        }
        frameIndex = i;
      }

      // Decode the specific frame
      const result = await animInfo.decoder.decode({ frameIndex });
      const videoFrame = result.image;

      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Calculate aspect ratio and position
      const imgAspect = videoFrame.displayWidth / videoFrame.displayHeight;
      const boxAspect = width / height;
      
      let drawWidth = width;
      let drawHeight = height;
      let drawX = x;
      let drawY = y;
      
      if (imgAspect > boxAspect) {
        drawHeight = width / imgAspect;
        drawY = y + (height - drawHeight) / 2;
      } else {
        drawWidth = height * imgAspect;
        drawX = x + (width - drawWidth) / 2;
      }

      // Draw to a temporary canvas first for better quality scaling
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = videoFrame.displayWidth;
      tempCanvas.height = videoFrame.displayHeight;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(videoFrame as any, 0, 0);
      videoFrame.close();

      // Draw the temporary canvas with high-quality scaling
      ctx.drawImage(tempCanvas, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
      return;
    } catch (error) {
      console.warn('[AnnotationRenderer] Failed to decode animated frame, falling back to static:', error);
    }
  }

  // Fallback to static image if animated decoding fails or not supported
  await renderImage(ctx, annotation, x, y, width, height, alpha);
}

export async function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: AnnotationRegion[],
  canvasWidth: number,
  canvasHeight: number,
  currentTimeMs: number,
  scaleFactor: number = 1.0,
  layer?: AnnotationLayer
): Promise<void> {
  // Filter active annotations at current time
  const activeAnnotations = annotations.filter(
    (ann) => {
      const annLayer = ann.layer || 'foreground';
      if (layer && annLayer !== layer) return false;
      const startMs = ann.startMs ?? 0;
      const endMs = ann.endMs ?? startMs;
      return currentTimeMs >= startMs && currentTimeMs <= endMs;
    }
  );
  
  // Sort by z-index (lower first, so higher z-index draws on top)
  const sortedAnnotations = [...activeAnnotations].sort((a, b) => a.zIndex - b.zIndex);
  
  for (const annotation of sortedAnnotations) {
    const x = (annotation.position.x / 100) * canvasWidth;
    const y = (annotation.position.y / 100) * canvasHeight;
    const width = (annotation.size.width / 100) * canvasWidth;
    const height = (annotation.size.height / 100) * canvasHeight;

    const { alpha, scale } = computeAnnotationEffectState(annotation, currentTimeMs);
    if (alpha <= 0) continue;

    const centerX = x + width / 2;
    const centerY = y + height / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);
    ctx.translate(-centerX, -centerY);
    
    switch (annotation.type) {
      case 'text':
        renderText(ctx, annotation, x, y, width, height, scaleFactor, alpha);
        break;
        
      case 'image':
        await renderImage(ctx, annotation, x, y, width, height, alpha);
        break;

      case 'emoji':
        await renderAnimatedEmoji(ctx, annotation, x, y, width, height, currentTimeMs, alpha);
        break;
        
      case 'figure':
        if (annotation.figureData) {
          renderArrow(
            ctx,
            annotation.figureData.arrowDirection,
            annotation.figureData.color,
            annotation.figureData.strokeWidth,
            x,
            y,
            width,
            height,
            scaleFactor,
            alpha
          );
        }
        break;
    }
    ctx.restore();
  }
}
