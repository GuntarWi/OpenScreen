import type { ClipTransformBezier, ClipTransformEasing, ClipTransformKeyframe, VideoClip } from "@/components/video-editor/types";

export type ClipTransformRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ClipTransformState = ClipTransformRect & {
  rotationDeg: number;
  scale: number;
  opacity: number;
};

export const CLIP_TRANSFORM_KEYFRAME_SNAP_MS = 50;
export const CLIP_TRANSFORM_POSITION_RANGE = { min: -200, max: 200 };
export const CLIP_TRANSFORM_SIZE_RANGE = { min: 1, max: 200 };
export const CLIP_TRANSFORM_EASING_OPTIONS: ClipTransformEasing[] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
];
export const LINEAR_BEZIER: ClipTransformBezier = { x1: 0, y1: 0, x2: 1, y2: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeRectValue = (value: number, fallback: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
};

const normalizeTransformValue = (
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value as number, min, max);
};

const normalizeEasing = (value: ClipTransformEasing | undefined): ClipTransformEasing => (
  value && CLIP_TRANSFORM_EASING_OPTIONS.includes(value)
    ? value
    : "linear"
);

const clampBezierValue = (value: number, fallback: number) => (
  Number.isFinite(value) ? clamp(value, 0, 1) : fallback
);

const bezierFromPreset = (easing: ClipTransformEasing): ClipTransformBezier => {
  switch (easing) {
    case "ease-in":
      return { x1: 0.42, y1: 0, x2: 1, y2: 1 };
    case "ease-out":
      return { x1: 0, y1: 0, x2: 0.58, y2: 1 };
    case "ease-in-out":
      return { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    case "linear":
    default:
      return LINEAR_BEZIER;
  }
};

const normalizeBezier = (
  value: ClipTransformBezier | undefined,
  easing: ClipTransformEasing,
): ClipTransformBezier => {
  const fallback = bezierFromPreset(easing);
  return {
    x1: clampBezierValue(value?.x1 as number, fallback.x1),
    y1: clampBezierValue(value?.y1 as number, fallback.y1),
    x2: clampBezierValue(value?.x2 as number, fallback.x2),
    y2: clampBezierValue(value?.y2 as number, fallback.y2),
  };
};

const cubicBezier = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const oneMinusT = 1 - t;
  return (
    oneMinusT * oneMinusT * oneMinusT * p0 +
    3 * oneMinusT * oneMinusT * t * p1 +
    3 * oneMinusT * t * t * p2 +
    t * t * t * p3
  );
};

const getBezierProgress = (curve: ClipTransformBezier, progress: number) => {
  const targetX = clamp(progress, 0, 1);
  let lower = 0;
  let upper = 1;
  let t = targetX;

  for (let index = 0; index < 12; index += 1) {
    t = (lower + upper) / 2;
    const x = cubicBezier(0, curve.x1, curve.x2, 1, t);
    if (Math.abs(x - targetX) < 0.0005) {
      break;
    }
    if (x < targetX) {
      lower = t;
    } else {
      upper = t;
    }
  }

  return cubicBezier(0, curve.y1, curve.y2, 1, t);
};

export function getBaseClipTransformState(
  clip: Pick<VideoClip, "position" | "size" | "rotationDeg" | "scale" | "opacity">,
): ClipTransformState {
  return {
    x: clip.position.x,
    y: clip.position.y,
    width: clip.size.width,
    height: clip.size.height,
    rotationDeg: clip.rotationDeg ?? 0,
    scale: clip.scale ?? 1,
    opacity: clip.opacity ?? 1,
  };
}

export function getBaseClipTransformRect(
  clip: Pick<VideoClip, "position" | "size" | "rotationDeg" | "scale" | "opacity">,
): ClipTransformRect {
  const state = getBaseClipTransformState(clip);
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
}

export function normalizeClipTransformKeyframes(
  keyframes?: ClipTransformKeyframe[] | null,
  baseState?: ClipTransformState,
): ClipTransformKeyframe[] | undefined {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return undefined;
  }

  const fallback = baseState ?? {
    x: 0,
    y: 0,
    width: 30,
    height: 30,
    rotationDeg: 0,
    scale: 1,
    opacity: 1,
  };

  const normalized = keyframes
    .map((keyframe, index) => ({
      id: keyframe.id || `clip-transform-${index}`,
      timeMs: Math.max(0, Math.round(keyframe.timeMs)),
      x: normalizeRectValue(keyframe.x, fallback.x, CLIP_TRANSFORM_POSITION_RANGE.min, CLIP_TRANSFORM_POSITION_RANGE.max),
      y: normalizeRectValue(keyframe.y, fallback.y, CLIP_TRANSFORM_POSITION_RANGE.min, CLIP_TRANSFORM_POSITION_RANGE.max),
      width: normalizeRectValue(keyframe.width, fallback.width, CLIP_TRANSFORM_SIZE_RANGE.min, CLIP_TRANSFORM_SIZE_RANGE.max),
      height: normalizeRectValue(keyframe.height, fallback.height, CLIP_TRANSFORM_SIZE_RANGE.min, CLIP_TRANSFORM_SIZE_RANGE.max),
      rotationDeg: normalizeTransformValue(keyframe.rotationDeg, fallback.rotationDeg, -360, 360),
      scale: normalizeTransformValue(keyframe.scale, fallback.scale, 0.05, 8),
      opacity: normalizeTransformValue(keyframe.opacity, fallback.opacity, 0, 1),
      easingToNext: normalizeEasing(keyframe.easingToNext),
      curveToNext: normalizeBezier(keyframe.curveToNext, normalizeEasing(keyframe.easingToNext)),
    }))
    .sort((a, b) => a.timeMs - b.timeMs);

  const deduped: ClipTransformKeyframe[] = [];
  normalized.forEach((keyframe) => {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.timeMs - keyframe.timeMs) <= CLIP_TRANSFORM_KEYFRAME_SNAP_MS) {
      deduped[deduped.length - 1] = keyframe;
      return;
    }
    deduped.push(keyframe);
  });

  return deduped.length ? deduped : undefined;
}

export function findClipTransformKeyframeAtTime(
  keyframes: ClipTransformKeyframe[] | undefined,
  timeMs: number,
  thresholdMs = CLIP_TRANSFORM_KEYFRAME_SNAP_MS,
): ClipTransformKeyframe | null {
  if (!Array.isArray(keyframes) || keyframes.length === 0 || !Number.isFinite(timeMs)) {
    return null;
  }

  return keyframes.find((keyframe) => Math.abs(keyframe.timeMs - timeMs) <= thresholdMs) ?? null;
}

export function resolveClipTransformStateFromBase(
  baseState: ClipTransformState,
  keyframes: ClipTransformKeyframe[] | undefined,
  timeMs: number,
): ClipTransformState {
  const normalizedKeyframes = normalizeClipTransformKeyframes(keyframes, baseState);
  if (!normalizedKeyframes?.length || !Number.isFinite(timeMs)) {
    return baseState;
  }

  if (timeMs <= normalizedKeyframes[0].timeMs) {
    const first = normalizedKeyframes[0];
    return {
      x: first.x,
      y: first.y,
      width: first.width,
      height: first.height,
      rotationDeg: first.rotationDeg ?? baseState.rotationDeg,
      scale: first.scale ?? baseState.scale,
      opacity: first.opacity ?? baseState.opacity,
    };
  }

  const last = normalizedKeyframes[normalizedKeyframes.length - 1];
  if (timeMs >= last.timeMs) {
    return {
      x: last.x,
      y: last.y,
      width: last.width,
      height: last.height,
      rotationDeg: last.rotationDeg ?? baseState.rotationDeg,
      scale: last.scale ?? baseState.scale,
      opacity: last.opacity ?? baseState.opacity,
    };
  }

  for (let index = 0; index < normalizedKeyframes.length - 1; index += 1) {
    const current = normalizedKeyframes[index];
    const next = normalizedKeyframes[index + 1];
    if (timeMs < current.timeMs || timeMs > next.timeMs) {
      continue;
    }

    const span = Math.max(1, next.timeMs - current.timeMs);
    const linearProgress = clamp((timeMs - current.timeMs) / span, 0, 1);
    const progress = getBezierProgress(
      normalizeBezier(current.curveToNext, current.easingToNext ?? "linear"),
      linearProgress,
    );

    return {
      x: current.x + (next.x - current.x) * progress,
      y: current.y + (next.y - current.y) * progress,
      width: current.width + (next.width - current.width) * progress,
      height: current.height + (next.height - current.height) * progress,
      rotationDeg: (current.rotationDeg ?? baseState.rotationDeg) + ((next.rotationDeg ?? baseState.rotationDeg) - (current.rotationDeg ?? baseState.rotationDeg)) * progress,
      scale: (current.scale ?? baseState.scale) + ((next.scale ?? baseState.scale) - (current.scale ?? baseState.scale)) * progress,
      opacity: (current.opacity ?? baseState.opacity) + ((next.opacity ?? baseState.opacity) - (current.opacity ?? baseState.opacity)) * progress,
    };
  }

  return baseState;
}

export function resolveClipTransformStateAtTime(
  clip: Pick<VideoClip, "position" | "size" | "rotationDeg" | "scale" | "opacity" | "transformKeyframes">,
  timeMs: number,
): ClipTransformState {
  const fallback = getBaseClipTransformState(clip);
  return resolveClipTransformStateFromBase(fallback, clip.transformKeyframes, timeMs);
}

export function resolveClipTransformRectAtTime(
  clip: Pick<VideoClip, "position" | "size" | "rotationDeg" | "scale" | "opacity" | "transformKeyframes">,
  timeMs: number,
): ClipTransformRect {
  const state = resolveClipTransformStateAtTime(clip, timeMs);
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
}

export function upsertClipTransformKeyframe(
  clip: Pick<VideoClip, "position" | "size" | "rotationDeg" | "scale" | "opacity" | "transformKeyframes">,
  timeMs: number,
  state: ClipTransformState,
  thresholdMs = CLIP_TRANSFORM_KEYFRAME_SNAP_MS,
): ClipTransformKeyframe[] {
  const fallback = getBaseClipTransformState(clip);
  const nextKeyframe: ClipTransformKeyframe = {
    id: `clip-transform-${Math.round(timeMs)}-${Math.random().toString(36).slice(2, 8)}`,
    timeMs: Math.max(0, Math.round(timeMs)),
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    rotationDeg: state.rotationDeg,
    scale: state.scale,
    opacity: state.opacity,
    easingToNext: "linear",
    curveToNext: LINEAR_BEZIER,
  };

  const existing = normalizeClipTransformKeyframes(clip.transformKeyframes, fallback) ?? [];
  const current = findClipTransformKeyframeAtTime(existing, timeMs, thresholdMs);

  const updated = current
    ? existing.map((keyframe) => (
        keyframe.id === current.id
          ? { ...keyframe, ...nextKeyframe, id: current.id, easingToNext: keyframe.easingToNext ?? "linear" }
          : keyframe
      ))
    : [...existing, nextKeyframe];

  return normalizeClipTransformKeyframes(updated, fallback) ?? [];
}
