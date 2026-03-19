import type { CropRegion, ScreenOffset } from "@/components/video-editor/types";

export type InteractionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisibleRectInput = {
  stageWidth: number;
  stageHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  cropRegion: CropRegion;
  padding: number;
  screenOffset?: ScreenOffset;
  screenOffsetPx?: { x: number; y: number };
};

type LayoutFromRectInput = {
  rect: InteractionRect;
  stageWidth: number;
  stageHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  cropRegion: CropRegion;
};

const MIN_PADDING_SCALE = 0.6;
const PADDING_SCALE_RANGE = 0.4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getCroppedSourceAspect = (
  sourceWidth: number,
  sourceHeight: number,
  cropRegion: CropRegion,
) => {
  const cropWidth = Math.max(0.0001, sourceWidth * clamp(cropRegion.width, 0.0001, 1));
  const cropHeight = Math.max(0.0001, sourceHeight * clamp(cropRegion.height, 0.0001, 1));
  return cropWidth / cropHeight;
};

const getBaseDisplaySize = (
  stageWidth: number,
  stageHeight: number,
  croppedAspect: number,
) => {
  if (stageWidth <= 0 || stageHeight <= 0 || croppedAspect <= 0) {
    return { width: 0, height: 0 };
  }

  const stageAspect = stageWidth / stageHeight;
  if (croppedAspect >= stageAspect) {
    return {
      width: stageWidth,
      height: stageWidth / croppedAspect,
    };
  }

  return {
    width: stageHeight * croppedAspect,
    height: stageHeight,
  };
};

const getScreenOffsetPx = (
  stageWidth: number,
  stageHeight: number,
  screenOffset?: ScreenOffset,
  screenOffsetPx?: { x: number; y: number },
) => {
  if (screenOffsetPx) {
    return screenOffsetPx;
  }

  return {
    x: ((screenOffset?.x ?? 0) / 100) * stageWidth,
    y: ((screenOffset?.y ?? 0) / 100) * stageHeight,
  };
};

export const resolveRecordingVisibleRect = ({
  stageWidth,
  stageHeight,
  sourceWidth,
  sourceHeight,
  cropRegion,
  padding,
  screenOffset,
  screenOffsetPx,
}: VisibleRectInput): InteractionRect | null => {
  if (stageWidth <= 0 || stageHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const croppedAspect = getCroppedSourceAspect(sourceWidth, sourceHeight, cropRegion);
  const baseDisplay = getBaseDisplaySize(stageWidth, stageHeight, croppedAspect);
  if (baseDisplay.width <= 0 || baseDisplay.height <= 0) {
    return null;
  }

  const paddingScale = clamp(1 - (padding / 100) * PADDING_SCALE_RANGE, MIN_PADDING_SCALE, 1);
  const width = baseDisplay.width * paddingScale;
  const height = baseDisplay.height * paddingScale;
  const centeredX = (stageWidth - width) / 2;
  const centeredY = (stageHeight - height) / 2;
  const offset = getScreenOffsetPx(stageWidth, stageHeight, screenOffset, screenOffsetPx);

  return {
    x: centeredX + offset.x,
    y: centeredY + offset.y,
    width,
    height,
  };
};

export const resolveRecordingLayoutFromVisibleRect = ({
  rect,
  stageWidth,
  stageHeight,
  sourceWidth,
  sourceHeight,
  cropRegion,
}: LayoutFromRectInput): { padding: number; screenOffsetPx: { x: number; y: number } } | null => {
  if (stageWidth <= 0 || stageHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const croppedAspect = getCroppedSourceAspect(sourceWidth, sourceHeight, cropRegion);
  const baseDisplay = getBaseDisplaySize(stageWidth, stageHeight, croppedAspect);
  if (baseDisplay.width <= 0 || baseDisplay.height <= 0) {
    return null;
  }

  const requestedWidth = clamp(rect.width, 0, stageWidth);
  const requestedHeight = clamp(rect.height, 0, stageHeight);
  const widthScale = baseDisplay.width > 0 ? requestedWidth / baseDisplay.width : 1;
  const heightScale = baseDisplay.height > 0 ? requestedHeight / baseDisplay.height : 1;
  const paddingScale = clamp(Math.min(widthScale, heightScale), MIN_PADDING_SCALE, 1);
  const padding = clamp(((1 - paddingScale) / PADDING_SCALE_RANGE) * 100, 0, 100);

  const centeredWidth = baseDisplay.width * paddingScale;
  const centeredHeight = baseDisplay.height * paddingScale;
  const centeredX = (stageWidth - centeredWidth) / 2;
  const centeredY = (stageHeight - centeredHeight) / 2;

  return {
    padding,
    screenOffsetPx: {
      x: rect.x - centeredX,
      y: rect.y - centeredY,
    },
  };
};
