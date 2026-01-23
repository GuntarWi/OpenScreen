import type { OverlayVideoRegion } from '@/components/video-editor/types';

export type OverlayLayoutRect = { x: number; y: number; width: number; height: number };

export type OverlayLayoutResult = {
  box: OverlayLayoutRect;
  dest: OverlayLayoutRect;
  src: OverlayLayoutRect;
};

type OverlayLayoutParams = {
  region: OverlayVideoRegion;
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
};

export function computeOverlayLayout(params: OverlayLayoutParams): OverlayLayoutResult | null {
  const { region, containerWidth, containerHeight, videoWidth, videoHeight } = params;

  if (containerWidth <= 0 || containerHeight <= 0) return null;

  const boxWidth = (region.size.width / 100) * containerWidth;
  const boxHeight = (region.size.height / 100) * containerHeight;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const boxX = (region.position.x / 100) * containerWidth;
  const boxY = (region.position.y / 100) * containerHeight;

  const safeVideoWidth = Math.max(1, videoWidth);
  const safeVideoHeight = Math.max(1, videoHeight);
  const videoAspect = safeVideoWidth / safeVideoHeight;
  const boxAspect = boxWidth / boxHeight;

  const crop = region.crop;
  const hasCrop = Boolean(
    crop && (crop.x !== 0 || crop.y !== 0 || crop.width !== 100 || crop.height !== 100)
  );

  const fit = region.fit ?? 'contain';

  let destX = boxX;
  let destY = boxY;
  let destW = boxWidth;
  let destH = boxHeight;
  let srcX = 0;
  let srcY = 0;
  let srcW = safeVideoWidth;
  let srcH = safeVideoHeight;

  if (hasCrop && crop) {
    let visibleX: number;
    let visibleY: number;
    let visibleW: number;
    let visibleH: number;

    if (videoAspect > boxAspect) {
      visibleH = safeVideoHeight;
      visibleW = safeVideoHeight * boxAspect;
      visibleX = (safeVideoWidth - visibleW) / 2;
      visibleY = 0;
    } else {
      visibleW = safeVideoWidth;
      visibleH = safeVideoWidth / boxAspect;
      visibleX = 0;
      visibleY = (safeVideoHeight - visibleH) / 2;
    }

    const cropWidth = Math.max(0.0001, crop.width);
    const cropHeight = Math.max(0.0001, crop.height);

    srcX = visibleX + (crop.x / cropWidth) * visibleW;
    srcY = visibleY + (crop.y / cropHeight) * visibleH;
    srcW = (crop.width / 100) * visibleW;
    srcH = (crop.height / 100) * visibleH;

    const epsilon = 0.01;
    srcX = Math.max(0, srcX + epsilon);
    srcY = Math.max(0, srcY + epsilon);
    srcW = Math.max(0, Math.min(safeVideoWidth - srcX, srcW - epsilon * 2));
    srcH = Math.max(0, Math.min(safeVideoHeight - srcY, srcH - epsilon * 2));
  } else if (fit === 'cover') {
    if (videoAspect > boxAspect) {
      srcH = safeVideoHeight;
      srcW = safeVideoHeight * boxAspect;
      srcX = (safeVideoWidth - srcW) / 2;
      srcY = 0;
    } else {
      srcW = safeVideoWidth;
      srcH = safeVideoWidth / boxAspect;
      srcX = 0;
      srcY = (safeVideoHeight - srcH) / 2;
    }
  } else {
    if (videoAspect > boxAspect) {
      destW = boxWidth;
      destH = boxWidth / videoAspect;
      destX = boxX;
      destY = boxY + (boxHeight - destH) / 2;
    } else {
      destH = boxHeight;
      destW = boxHeight * videoAspect;
      destX = boxX + (boxWidth - destW) / 2;
      destY = boxY;
    }
  }

  return {
    box: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
    dest: { x: destX, y: destY, width: destW, height: destH },
    src: { x: srcX, y: srcY, width: srcW, height: srcH },
  };
}
