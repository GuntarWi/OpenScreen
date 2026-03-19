import type { ClipSpeedPoint, VideoClip } from "./types";

const MIN_SPEED = 0.05;
const MAX_SPEED = 16;
const EPSILON = 1e-6;

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, value));
}

export function getClipPlaybackRate(clip: Pick<VideoClip, "playbackRate">): number {
  return clampSpeed(clip.playbackRate ?? 1);
}

export function normalizeClipSpeedPoints(
  clip: Pick<VideoClip, "playbackRate" | "speedPoints">,
): ClipSpeedPoint[] {
  const baseRate = getClipPlaybackRate(clip);
  const points = Array.isArray(clip.speedPoints) ? clip.speedPoints : [];
  const normalized = points
    .map((point, index) => ({
      id: point.id || `speed-${index}`,
      position: Math.max(0, Math.min(1, point.position)),
      speed: clampSpeed(point.speed),
    }))
    .sort((a, b) => a.position - b.position);

  if (!normalized.length) {
    return [
      { id: "speed-start", position: 0, speed: baseRate },
      { id: "speed-end", position: 1, speed: baseRate },
    ];
  }

  const deduped: ClipSpeedPoint[] = [];
  normalized.forEach((point) => {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.position - point.position) < EPSILON) {
      deduped[deduped.length - 1] = point;
      return;
    }
    deduped.push(point);
  });

  if (deduped[0].position > 0) {
    deduped.unshift({
      id: "speed-start",
      position: 0,
      speed: deduped[0].speed,
    });
  }
  if (deduped[deduped.length - 1].position < 1) {
    deduped.push({
      id: "speed-end",
      position: 1,
      speed: deduped[deduped.length - 1].speed,
    });
  }

  deduped[0] = { ...deduped[0], position: 0 };
  deduped[deduped.length - 1] = { ...deduped[deduped.length - 1], position: 1 };
  return deduped;
}

export function getClipSourceDurationMs(clip: Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs">): number {
  const timelineDuration = Math.max(0, clip.endMs - clip.startMs);
  const sourceStartMs = clip.sourceStartMs ?? 0;
  const sourceEndMs = typeof clip.sourceEndMs === "number" ? clip.sourceEndMs : sourceStartMs + timelineDuration;
  return Math.max(0, sourceEndMs - sourceStartMs);
}

function integrateSegmentDurationMs(sourceDurationMs: number, u0: number, u1: number, speed0: number, speed1: number): number {
  const safeSpeed0 = clampSpeed(speed0);
  const safeSpeed1 = clampSpeed(speed1);
  const du = u1 - u0;
  if (du <= EPSILON || sourceDurationMs <= 0) return 0;

  const a = (safeSpeed1 - safeSpeed0) / du;
  const b = safeSpeed0 - a * u0;

  if (Math.abs(a) < EPSILON) {
    return sourceDurationMs * du / safeSpeed0;
  }

  const startValue = Math.max(EPSILON, a * u0 + b);
  const endValue = Math.max(EPSILON, a * u1 + b);
  return sourceDurationMs * (Math.log(endValue) - Math.log(startValue)) / a;
}

function solveSegmentPositionForDuration(
  sourceDurationMs: number,
  u0: number,
  speed0: number,
  speed1: number,
  segmentDurationMs: number,
  maxU: number,
): number {
  const du = maxU - u0;
  if (du <= EPSILON || sourceDurationMs <= 0) return u0;

  const safeSpeed0 = clampSpeed(speed0);
  const safeSpeed1 = clampSpeed(speed1);
  const a = (safeSpeed1 - safeSpeed0) / du;
  const b = safeSpeed0 - a * u0;

  if (Math.abs(a) < EPSILON) {
    const deltaU = (segmentDurationMs * safeSpeed0) / sourceDurationMs;
    return Math.min(maxU, Math.max(u0, u0 + deltaU));
  }

  const startValue = Math.max(EPSILON, a * u0 + b);
  const exponent = (a * segmentDurationMs) / sourceDurationMs;
  const solvedValue = startValue * Math.exp(exponent);
  const solvedU = (solvedValue - b) / a;
  return Math.min(maxU, Math.max(u0, solvedU));
}

export function getClipTimelineDurationMs(clip: Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs" | "playbackRate" | "speedPoints">): number {
  const sourceDurationMs = getClipSourceDurationMs(clip);
  if (sourceDurationMs <= 0) return 0;
  const points = normalizeClipSpeedPoints(clip);
  let totalMs = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    totalMs += integrateSegmentDurationMs(sourceDurationMs, current.position, next.position, current.speed, next.speed);
  }
  return Math.max(1, Math.round(totalMs));
}

export function getSourceOffsetForTimelineOffsetMs(
  clip: Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs" | "playbackRate" | "speedPoints">,
  timelineOffsetMs: number,
): number {
  const sourceDurationMs = getClipSourceDurationMs(clip);
  if (sourceDurationMs <= 0) return 0;

  const points = normalizeClipSpeedPoints(clip);
  let remainingMs = Math.max(0, timelineOffsetMs);

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const segmentDurationMs = integrateSegmentDurationMs(
      sourceDurationMs,
      current.position,
      next.position,
      current.speed,
      next.speed,
    );

    if (remainingMs <= segmentDurationMs + EPSILON) {
      const solvedPosition = solveSegmentPositionForDuration(
        sourceDurationMs,
        current.position,
        current.speed,
        next.speed,
        remainingMs,
        next.position,
      );
      return Math.max(0, Math.min(sourceDurationMs, solvedPosition * sourceDurationMs));
    }

    remainingMs -= segmentDurationMs;
  }

  return sourceDurationMs;
}

export function getTimelineOffsetForSourceOffsetMs(
  clip: Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs" | "playbackRate" | "speedPoints">,
  sourceOffsetMs: number,
): number {
  const sourceDurationMs = getClipSourceDurationMs(clip);
  if (sourceDurationMs <= 0) return 0;

  const clampedSourceOffsetMs = Math.max(0, Math.min(sourceDurationMs, sourceOffsetMs));
  const targetPosition = clampedSourceOffsetMs / sourceDurationMs;
  const points = normalizeClipSpeedPoints(clip);
  let totalMs = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const segmentEnd = Math.min(next.position, targetPosition);
    totalMs += integrateSegmentDurationMs(
      sourceDurationMs,
      current.position,
      segmentEnd,
      current.speed,
      next.speed,
    );
    if (targetPosition <= next.position + EPSILON) {
      break;
    }
  }

  return Math.max(0, Math.round(totalMs));
}

export function getSpeedAtTimelineOffset(
  clip: Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs" | "playbackRate" | "speedPoints">,
  timelineOffsetMs: number,
): number {
  const sourceDurationMs = getClipSourceDurationMs(clip);
  if (sourceDurationMs <= 0) return getClipPlaybackRate(clip);
  const sourceOffsetMs = getSourceOffsetForTimelineOffsetMs(clip, timelineOffsetMs);
  const position = sourceDurationMs <= 0 ? 0 : sourceOffsetMs / sourceDurationMs;
  const points = normalizeClipSpeedPoints(clip);

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (position >= current.position - EPSILON && position <= next.position + EPSILON) {
      const span = next.position - current.position;
      if (span <= EPSILON) return next.speed;
      const progress = (position - current.position) / span;
      return clampSpeed(current.speed + (next.speed - current.speed) * progress);
    }
  }

  return points[points.length - 1]?.speed ?? getClipPlaybackRate(clip);
}

export function withUpdatedClipDuration<T extends Pick<VideoClip, "startMs" | "endMs" | "sourceStartMs" | "sourceEndMs" | "playbackRate" | "speedPoints">>(
  clip: T,
): T {
  const nextDurationMs = getClipTimelineDurationMs(clip);
  return {
    ...clip,
    endMs: clip.startMs + nextDurationMs,
  };
}

export function hasSpeedRamp(clip: Pick<VideoClip, "playbackRate" | "speedPoints">): boolean {
  const points = Array.isArray(clip.speedPoints) ? clip.speedPoints : [];
  if (points.length > 0) return true;
  return Math.abs(getClipPlaybackRate(clip) - 1) > EPSILON;
}
