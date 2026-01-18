import type { EffectRegion } from "../types";
import { TRANSITION_WINDOW_MS } from "./constants";
import { smoothStep } from "./mathUtils";

const DEG_TO_RAD = Math.PI / 180;

export interface CombinedEffectState {
  skewX: number;
  skewY: number;
  roll: number;
  scale: number;
  active: boolean;
  tiltXDeg?: number;
  tiltYDeg?: number;
  offsetX?: number;
  offsetY?: number;
}

export const DEFAULT_EFFECT_STATE: CombinedEffectState = {
  skewX: 0,
  skewY: 0,
  roll: 0,
  scale: 1,
  active: false,
  tiltXDeg: 0,
  tiltYDeg: 0,
  offsetX: 0,
  offsetY: 0,
};

function computeEffectStrength(region: EffectRegion, timeMs: number) {
  const leadInStart = region.startMs - TRANSITION_WINDOW_MS;
  const leadOutEnd = region.endMs + TRANSITION_WINDOW_MS;

  if (timeMs < leadInStart || timeMs > leadOutEnd) {
    return 0;
  }

  const fadeIn = smoothStep((timeMs - leadInStart) / TRANSITION_WINDOW_MS);
  const fadeOut = smoothStep((leadOutEnd - timeMs) / TRANSITION_WINDOW_MS);
  return Math.min(fadeIn, fadeOut);
}

export function computeEffectState(effectRegions: EffectRegion[] = [], timeMs: number): CombinedEffectState {
  if (!effectRegions.length) return DEFAULT_EFFECT_STATE;

  let totalWeight = 0;
  let sumTiltX = 0;
  let sumTiltY = 0;
  let sumRoll = 0;
  let sumScaleDelta = 0;
  let sumOffsetX = 0;
  let sumOffsetY = 0;

  for (const region of effectRegions) {
    const weight = computeEffectStrength(region, timeMs);
    if (weight <= 0) continue;
    // Progress across the region for in-flight animation (0->1)
    const duration = Math.max(1, region.endMs - region.startMs);
    const progress = Math.min(Math.max((timeMs - region.startMs) / duration, 0), 1);
    const eased = smoothStep(progress);

    if (region.type === 'shake') {
      const amp = region.amplitudePx ?? 12;
      const freq = region.frequencyHz ?? 7;
      // Simple deterministic phase from id hash
      const hash = Math.abs(region.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 360;
      const phase = (hash / 180) * Math.PI;
      const tSeconds = timeMs / 1000;
      const angle = 2 * Math.PI * freq * tSeconds + phase;
      const offsetX = amp * Math.sin(angle) * eased;
      const offsetY = amp * Math.cos(angle * 0.8) * eased;

      totalWeight += weight;
      sumOffsetX += offsetX * weight;
      sumOffsetY += offsetY * weight;
      // Shake does not contribute to tilt/roll/scale
    } else {
      const targetTiltX = region.tiltXDeg ?? 0;
      const targetTiltY = region.tiltYDeg ?? 0;
      const targetRoll = region.rollDeg ?? 0;
      const targetScale = region.scale ?? 1;

      // Animate from neutral (0deg / 1x) into the configured values across the region
      const animatedTiltX = targetTiltX * eased;
      const animatedTiltY = targetTiltY * eased;
      const animatedRoll = targetRoll * eased;
      const animatedScaleDelta = (targetScale - 1) * eased;

      totalWeight += weight;
      sumTiltX += animatedTiltX * weight;
      sumTiltY += animatedTiltY * weight;
      sumRoll += animatedRoll * weight;
      sumScaleDelta += animatedScaleDelta * weight;
    }
  }

  if (totalWeight <= 0) return DEFAULT_EFFECT_STATE;

  const avgTiltX = sumTiltX / Math.max(totalWeight, 0.0001);
  const avgTiltY = sumTiltY / Math.max(totalWeight, 0.0001);
  const avgRoll = sumRoll / Math.max(totalWeight, 0.0001);
  const avgScale = 1 + sumScaleDelta / Math.max(totalWeight, 0.0001);
  const avgOffsetX = sumOffsetX / Math.max(totalWeight, 0.0001);
  const avgOffsetY = sumOffsetY / Math.max(totalWeight, 0.0001);

  // Map tilt to a subtle skew that mimics a perspective lean without requiring 3D transforms
  const skewX = (avgTiltY * DEG_TO_RAD) * 0.55;
  const skewY = (avgTiltX * DEG_TO_RAD) * 0.55;
  const roll = (avgRoll || 0) * DEG_TO_RAD;

  return {
    skewX,
    skewY,
    roll,
    scale: avgScale,
    active: true,
    tiltXDeg: avgTiltX,
    tiltYDeg: avgTiltY,
    offsetX: avgOffsetX,
    offsetY: avgOffsetY,
  };
}
