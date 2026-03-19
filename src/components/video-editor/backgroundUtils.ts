import type { BackgroundFillKind, BackgroundFit, BackgroundItem, VideoAsset } from "./types";

export const BACKGROUND_TRACK_ID = "track-background";
export const DEFAULT_BACKGROUND_VALUE = "/wallpapers/wallpaper1.jpg";
export const DEFAULT_BACKGROUND_FIT: BackgroundFit = "cover";
export const DEFAULT_BACKGROUND_BLUR_AMOUNT = 0;
export const DEFAULT_BACKGROUND_BACKDROP_COLOR = "#000000";
export const DEFAULT_BACKGROUND_ACCENT_COLOR = "#38bdf8";
export const DEFAULT_RETRO_GRID_ANGLE = 65;
export const DEFAULT_RETRO_GRID_DENSITY = 1;
export const DEFAULT_RIPPLE_SPEED = 1;
export const DEFAULT_RIPPLE_COUNT = 8;
export const MAGICUI_RETRO_GRID_VALUE = "magicui:retro-grid";
export const MAGICUI_RIPPLE_VALUE = "magicui:ripple";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getRetroGridCellSize(density: number): number {
  const safeDensity = clamp(Number.isFinite(density) ? density : DEFAULT_RETRO_GRID_DENSITY, 0.5, 2.5);
  return Math.max(20, Math.round(60 / safeDensity));
}

export function getRippleAnimationDurationSeconds(speed: number): number {
  const safeSpeed = clamp(Number.isFinite(speed) ? speed : DEFAULT_RIPPLE_SPEED, 0.25, 3);
  return 2 / safeSpeed;
}

export function isMagicBackgroundValue(value: string): boolean {
  return value === MAGICUI_RETRO_GRID_VALUE || value === MAGICUI_RIPPLE_VALUE;
}

export function isBackgroundImageValue(value: string): boolean {
  if (isMagicBackgroundValue(value)) {
    return false;
  }
  return (
    value.startsWith("data:") ||
    value.startsWith("file://") ||
    value.startsWith("http") ||
    value.startsWith("/")
  );
}

export function inferBackgroundKindFromValue(value: string): Exclude<BackgroundFillKind, "video"> {
  if (isMagicBackgroundValue(value)) {
    return "preset";
  }

  if (value.startsWith("linear-gradient") || value.startsWith("radial-gradient")) {
    return "gradient";
  }

  if (value.startsWith("#")) {
    return "color";
  }

  return "image";
}

export function resolveActiveBackgroundItem(
  items: BackgroundItem[],
  timeMs: number,
): BackgroundItem | null {
  let active: BackgroundItem | null = null;

  for (const item of items) {
    if (timeMs < item.startMs || timeMs > item.endMs) {
      continue;
    }

    if (
      !active ||
      item.startMs > active.startMs ||
      (item.startMs === active.startMs && item.endMs >= active.endMs)
    ) {
      active = item;
    }
  }

  return active;
}

export function getBackgroundItemSource(
  item: BackgroundItem | null | undefined,
  assets: VideoAsset[],
): string | null {
  if (!item) {
    return null;
  }

  if (item.assetId) {
    return assets.find((asset) => asset.id === item.assetId)?.src ?? null;
  }

  return item.value ?? null;
}

export function getBackgroundItemLabel(
  item: BackgroundItem,
  assets: VideoAsset[],
  index: number,
): string {
  if (item.assetId) {
    const asset = assets.find((candidate) => candidate.id === item.assetId);
    if (asset?.name) {
      return asset.name;
    }
  }

  if (item.kind === "color") {
    return item.value || `Color ${index + 1}`;
  }

  if (item.kind === "gradient") {
    return `Gradient ${index + 1}`;
  }

  if (item.kind === "preset" && item.value === MAGICUI_RETRO_GRID_VALUE) {
    return "Retro Grid";
  }

  if (item.kind === "preset" && item.value === MAGICUI_RIPPLE_VALUE) {
    return "Ripple";
  }

  if (item.kind === "video") {
    return `Background Video ${index + 1}`;
  }

  return `Background ${index + 1}`;
}

export function normalizeBackgroundItem(
  item: BackgroundItem,
  options?: {
    defaultFit?: BackgroundFit;
    defaultBlurAmount?: number;
  },
): BackgroundItem {
  const defaultFit = options?.defaultFit ?? DEFAULT_BACKGROUND_FIT;
  const defaultBlurAmount = options?.defaultBlurAmount ?? DEFAULT_BACKGROUND_BLUR_AMOUNT;

  return {
    ...item,
    fit: item.fit ?? defaultFit,
    blurAmount: Math.max(0, item.blurAmount ?? defaultBlurAmount),
    backdropColor: item.backdropColor ?? DEFAULT_BACKGROUND_BACKDROP_COLOR,
    accentColor: item.accentColor ?? DEFAULT_BACKGROUND_ACCENT_COLOR,
    retroGridAngle: clamp(item.retroGridAngle ?? DEFAULT_RETRO_GRID_ANGLE, 25, 85),
    retroGridDensity: clamp(item.retroGridDensity ?? DEFAULT_RETRO_GRID_DENSITY, 0.5, 2.5),
    rippleSpeed: clamp(item.rippleSpeed ?? DEFAULT_RIPPLE_SPEED, 0.25, 3),
    rippleCount: Math.round(clamp(item.rippleCount ?? DEFAULT_RIPPLE_COUNT, 3, 16)),
  };
}
