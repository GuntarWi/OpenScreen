import type { SpeedRegion } from "./types";
import { clamp01, smoothStep } from "./videoPlayback/mathUtils";

export function clampSpeedRegionTarget(value: number) {
  return Math.max(0.1, Math.min(8, Number.isFinite(value) ? value : 1));
}

export function findActiveSpeedRegion(speedRegions: SpeedRegion[], timelineMs: number): SpeedRegion | null {
  let active: SpeedRegion | null = null;
  for (const region of speedRegions) {
    if (timelineMs >= region.startMs && timelineMs < region.endMs) {
      if (!active || region.startMs >= active.startMs) {
        active = region;
      }
    }
  }
  return active;
}

export function getSpeedRegionEnvelopeAtTime(region: SpeedRegion, timelineMs: number) {
  const durationMs = Math.max(1, region.endMs - region.startMs);
  const progress = clamp01((timelineMs - region.startMs) / durationMs);
  const mirroredProgress = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
  return smoothStep(mirroredProgress);
}

export function getPlaybackRateForSpeedRegions(
  speedRegions: SpeedRegion[],
  timelineMs: number,
  baseRate = 1,
) {
  const activeRegion = findActiveSpeedRegion(speedRegions, timelineMs);
  if (!activeRegion) {
    return baseRate;
  }

  const targetRate = clampSpeedRegionTarget(activeRegion.speed);
  const envelope = getSpeedRegionEnvelopeAtTime(activeRegion, timelineMs);
  return baseRate + (targetRate - baseRate) * envelope;
}
