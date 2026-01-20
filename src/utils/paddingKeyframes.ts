import type { PaddingKeyframe } from '@/components/video-editor/types';

/**
 * Interpolate padding value at a given time from keyframes.
 * Uses linear interpolation between keyframes.
 * If no keyframes exist, returns the base padding value.
 */
export function interpolatePadding(
  keyframes: PaddingKeyframe[],
  timeMs: number,
  basePadding: number
): number {
  if (!keyframes.length) return basePadding;

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.timeMs - b.timeMs);

  // Before first keyframe: use first keyframe value
  if (timeMs <= sorted[0].timeMs) {
    return sorted[0].value;
  }

  // After last keyframe: use last keyframe value
  if (timeMs >= sorted[sorted.length - 1].timeMs) {
    return sorted[sorted.length - 1].value;
  }

  // Find surrounding keyframes and interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];

    if (timeMs >= curr.timeMs && timeMs <= next.timeMs) {
      const duration = next.timeMs - curr.timeMs;
      const progress = (timeMs - curr.timeMs) / duration;
      // Smooth easing
      const eased = smoothStep(progress);
      return curr.value + (next.value - curr.value) * eased;
    }
  }

  return basePadding;
}

function smoothStep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
