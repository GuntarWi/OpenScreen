import type { EffectRegion } from "../types";
import { TRANSITION_WINDOW_MS } from "./constants";
import { smoothStep } from "./mathUtils";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const EFFECT_PERSPECTIVE = 1200;
const SKEW_TO_TILT_RATIO = 0.55;

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

interface ProjectedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface EffectPreviewFit {
  fitScale: number;
  translateX: number;
  translateY: number;
  bounds: ProjectedBounds;
}

function createFallbackProjectionFunction(
  effectState: CombinedEffectState,
  width: number,
  height: number
): (x: number, y: number) => { x: number; y: number } {
  const scale = effectState.scale ?? 1;
  const offsetX = effectState.offsetX ?? 0;
  const offsetY = effectState.offsetY ?? 0;
  const rollRad = effectState.roll ?? 0;
  const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
  const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);
  const skewX = (rotXDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
  const skewY = (rotYDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
  const centerX = width / 2;
  const centerY = height / 2;

  return (x: number, y: number) => {
    let px = x - centerX;
    let py = y - centerY;

    px *= scale;
    py *= scale;
    px += offsetX;
    py += offsetY;

    if (rollRad !== 0) {
      const cosR = Math.cos(rollRad);
      const sinR = Math.sin(rollRad);
      const rx = px * cosR - py * sinR;
      const ry = px * sinR + py * cosR;
      px = rx;
      py = ry;
    }

    const sx = px + skewX * py;
    const sy = py + skewY * px;

    return {
      x: sx + centerX,
      y: sy + centerY,
    };
  };
}

export function createEffectProjectionFunction(
  effectState: CombinedEffectState,
  width: number,
  height: number
): ((x: number, y: number) => { x: number; y: number }) | null {
  if (typeof DOMMatrix === "undefined" || typeof DOMPoint === "undefined") {
    return createFallbackProjectionFunction(effectState, width, height);
  }

  const scale = effectState.scale ?? 1;
  const offsetX = effectState.offsetX ?? 0;
  const offsetY = effectState.offsetY ?? 0;
  const rollDeg = (effectState.roll ?? 0) * RAD_TO_DEG;
  const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
  const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);
  const centerX = width / 2;
  const centerY = height / 2;

  const matrix = new DOMMatrix();
  matrix.m34 = -1 / EFFECT_PERSPECTIVE;
  matrix.scaleSelf(scale, scale, 1);
  matrix.translateSelf(offsetX, offsetY, 0);
  matrix.rotateSelf(rotXDeg, rotYDeg, rollDeg);

  return (x: number, y: number) => {
    const pt = new DOMPoint(x - centerX, y - centerY, 0, 1).matrixTransform(matrix);
    const wComp = pt.w || 1;
    return {
      x: pt.x / wComp + centerX,
      y: pt.y / wComp + centerY,
    };
  };
}

export function getEffectProjectedBounds(
  effectState: CombinedEffectState,
  width: number,
  height: number
): ProjectedBounds {
  const project = createEffectProjectionFunction(effectState, width, height);
  const corners = project
    ? [project(0, 0), project(width, 0), project(0, height), project(width, height)]
    : [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: 0, y: height },
        { x: width, y: height },
      ];

  let minX = corners[0].x;
  let minY = corners[0].y;
  let maxX = corners[0].x;
  let maxY = corners[0].y;

  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function getEffectPreviewFit(
  effectState: CombinedEffectState,
  sourceWidth: number,
  sourceHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  paddingPx = 16
): EffectPreviewFit {
  const bounds = getEffectProjectedBounds(effectState, sourceWidth, sourceHeight);
  const boundsCenterX = (bounds.minX + bounds.maxX) / 2;
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2;
  const sourceCenterX = sourceWidth / 2;
  const sourceCenterY = sourceHeight / 2;
  const availableWidth = Math.max(1, viewportWidth - paddingPx * 2);
  const availableHeight = Math.max(1, viewportHeight - paddingPx * 2);
  const fitScale = Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height);

  return {
    fitScale: Number.isFinite(fitScale) ? Math.max(0.1, fitScale) : 1,
    translateX: sourceCenterX - boundsCenterX,
    translateY: sourceCenterY - boundsCenterY,
    bounds,
  };
}

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

      // Animate: IN (0→target) in first 30%, HOLD in middle 40%, OUT (target→0) in last 30%
      const inEnd = 0.3;
      const outStart = 0.7;
      let effectStrength: number;
      
      if (progress < inEnd) {
        // Animate IN: 0 → 1 over first 30%
        effectStrength = smoothStep(progress / inEnd);
      } else if (progress > outStart) {
        // Animate OUT: 1 → 0 over last 30%
        effectStrength = smoothStep((1 - progress) / (1 - outStart));
      } else {
        // HOLD at full strength in middle
        effectStrength = 1;
      }

      const animatedTiltX = targetTiltX * effectStrength;
      const animatedTiltY = targetTiltY * effectStrength;
      const animatedRoll = targetRoll * effectStrength;
      const animatedScaleDelta = (targetScale - 1) * effectStrength;

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
  const skewX = (avgTiltY * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
  const skewY = (avgTiltX * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
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
