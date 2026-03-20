import type {
  AnnotationPosition,
  AnnotationSize,
  ClipTransformBezier,
  MaskCompositeMode,
  MaskItem,
  MaskPath,
  MaskPathKeyframe,
  MaskPathPoint,
  MaskShapeType,
} from "@/components/video-editor/types";

export type MaskState = {
  shape: MaskShapeType;
  position: AnnotationPosition;
  size: AnnotationSize;
  pathPoints?: MaskPathPoint[];
  mode: MaskCompositeMode;
  invert: boolean;
  feather: number;
  expand: number;
};

export type ResolvedMaskPathState = MaskState & {
  id: string;
  visible: boolean;
  solo: boolean;
};

export const MASK_KEYFRAME_SNAP_MS = 50;
const POSITION_RANGE = { min: -200, max: 200 };
const SIZE_RANGE = { min: 1, max: 200 };
const HANDLE_RANGE = { min: -300, max: 300 };
const FEATHER_RANGE = { min: 0, max: 60 };
const EXPAND_RANGE = { min: -50, max: 50 };
const LINEAR_BEZIER: ClipTransformBezier = { x1: 0, y1: 0, x2: 1, y2: 1 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampValue = (value: number, fallback: number, min: number, max: number) => (
  Number.isFinite(value) ? clamp(value, min, max) : fallback
);

const clampBezierValue = (value: number, fallback: number) => (
  Number.isFinite(value) ? clamp(value, 0, 1) : fallback
);

const normalizeBezier = (value: ClipTransformBezier | undefined): ClipTransformBezier => ({
  x1: clampBezierValue(value?.x1 as number, LINEAR_BEZIER.x1),
  y1: clampBezierValue(value?.y1 as number, LINEAR_BEZIER.y1),
  x2: clampBezierValue(value?.x2 as number, LINEAR_BEZIER.x2),
  y2: clampBezierValue(value?.y2 as number, LINEAR_BEZIER.y2),
});

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

const clonePoint = (point: MaskPathPoint): MaskPathPoint => ({ ...point });

export const cloneMaskPathPoints = (points: MaskPathPoint[] | undefined): MaskPathPoint[] | undefined => (
  Array.isArray(points) ? points.map(clonePoint) : undefined
);

const normalizePoint = (point: Partial<MaskPathPoint>, index: number): MaskPathPoint => {
  const fallbackX = clampValue(point.x as number, 50, POSITION_RANGE.min, POSITION_RANGE.max);
  const fallbackY = clampValue(point.y as number, 50, POSITION_RANGE.min, POSITION_RANGE.max);
  return {
    id: point.id || `mask-point-${index}`,
    x: fallbackX,
    y: fallbackY,
    inX: clampValue(point.inX as number, fallbackX, HANDLE_RANGE.min, HANDLE_RANGE.max),
    inY: clampValue(point.inY as number, fallbackY, HANDLE_RANGE.min, HANDLE_RANGE.max),
    outX: clampValue(point.outX as number, fallbackX, HANDLE_RANGE.min, HANDLE_RANGE.max),
    outY: clampValue(point.outY as number, fallbackY, HANDLE_RANGE.min, HANDLE_RANGE.max),
  };
};

export const normalizeMaskPathPoints = (points?: MaskPathPoint[] | null): MaskPathPoint[] | undefined => {
  if (!Array.isArray(points) || points.length === 0) {
    return undefined;
  }

  return points.map((point, index) => normalizePoint(point, index));
};

export const createDefaultMaskPathPoints = (
  position: AnnotationPosition,
  size: AnnotationSize,
): MaskPathPoint[] => {
  const left = position.x;
  const top = position.y;
  const right = position.x + size.width;
  const bottom = position.y + size.height;
  return [
    { id: "mask-point-0", x: left, y: top, inX: left, inY: top, outX: left, outY: top },
    { id: "mask-point-1", x: right, y: top, inX: right, inY: top, outX: right, outY: top },
    { id: "mask-point-2", x: right, y: bottom, inX: right, inY: bottom, outX: right, outY: bottom },
    { id: "mask-point-3", x: left, y: bottom, inX: left, inY: bottom, outX: left, outY: bottom },
  ];
};

export const getMaskPathBounds = (points: MaskPathPoint[] | undefined): { position: AnnotationPosition; size: AnnotationSize } | null => {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const xs = points.flatMap((point) => [point.x, point.inX, point.outX]);
  const ys = points.flatMap((point) => [point.y, point.inY, point.outY]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    position: { x: minX, y: minY },
    size: { width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
  };
};

type MaskGeometryLike = Pick<MaskPath, "shape" | "position" | "size" | "pathPoints">;
type MaskPathLike = Pick<MaskPath, "shape" | "position" | "size" | "pathPoints" | "mode" | "invert" | "feather" | "expand">;

export function getBaseMaskState(mask: MaskPathLike): MaskState {
  const shape = mask.shape ?? "rect";
  const position = {
    x: clampValue(mask.position?.x as number, 0, POSITION_RANGE.min, POSITION_RANGE.max),
    y: clampValue(mask.position?.y as number, 0, POSITION_RANGE.min, POSITION_RANGE.max),
  };
  const size = {
    width: clampValue(mask.size?.width as number, 30, SIZE_RANGE.min, SIZE_RANGE.max),
    height: clampValue(mask.size?.height as number, 30, SIZE_RANGE.min, SIZE_RANGE.max),
  };

  return {
    shape,
    position,
    size,
    pathPoints: shape === "path"
      ? normalizeMaskPathPoints(mask.pathPoints) ?? createDefaultMaskPathPoints(position, size)
      : undefined,
    mode: mask.mode ?? "add",
    invert: Boolean(mask.invert),
    feather: clampValue(mask.feather as number, 0, FEATHER_RANGE.min, FEATHER_RANGE.max),
    expand: clampValue(mask.expand as number, 0, EXPAND_RANGE.min, EXPAND_RANGE.max),
  };
}

export function normalizeMaskPathKeyframes(
  keyframes?: MaskPathKeyframe[] | null,
  baseState?: MaskState,
): MaskPathKeyframe[] | undefined {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return undefined;
  }

  const fallback = baseState ?? {
    shape: "rect",
    position: { x: 0, y: 0 },
    size: { width: 30, height: 30 },
    mode: "add",
    invert: false,
    feather: 0,
    expand: 0,
  };

  const normalized = keyframes
    .map((keyframe, index) => {
      const shape = keyframe.shape ?? fallback.shape;
      const position = {
        x: clampValue(keyframe.position?.x as number, fallback.position.x, POSITION_RANGE.min, POSITION_RANGE.max),
        y: clampValue(keyframe.position?.y as number, fallback.position.y, POSITION_RANGE.min, POSITION_RANGE.max),
      };
      const size = {
        width: clampValue(keyframe.size?.width as number, fallback.size.width, SIZE_RANGE.min, SIZE_RANGE.max),
        height: clampValue(keyframe.size?.height as number, fallback.size.height, SIZE_RANGE.min, SIZE_RANGE.max),
      };
      const pathPoints = shape === "path"
        ? normalizeMaskPathPoints(keyframe.pathPoints) ?? createDefaultMaskPathPoints(position, size)
        : undefined;

      return {
        id: keyframe.id || `mask-keyframe-${index}`,
        timeMs: Math.max(0, Math.round(keyframe.timeMs)),
        shape,
        position,
        size,
        pathPoints,
        curveToNext: normalizeBezier(keyframe.curveToNext),
      };
    })
    .sort((a, b) => a.timeMs - b.timeMs);

  const deduped: MaskPathKeyframe[] = [];
  normalized.forEach((keyframe) => {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.timeMs - keyframe.timeMs) <= MASK_KEYFRAME_SNAP_MS) {
      deduped[deduped.length - 1] = keyframe;
      return;
    }
    deduped.push(keyframe);
  });

  return deduped.length ? deduped : undefined;
}

export function findMaskPathKeyframeAtTime(
  keyframes: MaskPathKeyframe[] | undefined,
  timeMs: number,
  thresholdMs = MASK_KEYFRAME_SNAP_MS,
): MaskPathKeyframe | null {
  if (!Array.isArray(keyframes) || !keyframes.length || !Number.isFinite(timeMs)) {
    return null;
  }

  return keyframes.find((keyframe) => Math.abs(keyframe.timeMs - timeMs) <= thresholdMs) ?? null;
}

export function normalizeMaskPath(path: Partial<MaskPath>, index = 0): MaskPath {
  const baseState = getBaseMaskState({
    shape: path.shape ?? "rect",
    position: path.position ?? { x: 0, y: 0 },
    size: path.size ?? { width: 30, height: 30 },
    pathPoints: path.pathPoints,
    mode: path.mode,
    invert: path.invert,
    feather: path.feather,
    expand: path.expand,
  });

  return {
    id: path.id || `mask-path-${index}`,
    shape: baseState.shape,
    mode: baseState.mode,
    invert: baseState.invert,
    visible: path.visible ?? true,
    solo: Boolean(path.solo),
    position: { ...baseState.position },
    size: { ...baseState.size },
    pathPoints: cloneMaskPathPoints(baseState.pathPoints),
    pathKeyframes: normalizeMaskPathKeyframes(path.pathKeyframes, baseState),
    feather: baseState.feather,
    expand: baseState.expand,
  };
}

export const cloneMaskPath = (path: MaskPath): MaskPath => ({
  ...path,
  position: { ...path.position },
  size: { ...path.size },
  pathPoints: cloneMaskPathPoints(path.pathPoints),
  pathKeyframes: normalizeMaskPathKeyframes(path.pathKeyframes, getBaseMaskState(path)),
});

export const cloneMaskPaths = (paths: MaskPath[] | undefined): MaskPath[] | undefined => (
  Array.isArray(paths) ? paths.map(cloneMaskPath) : undefined
);

const buildLegacyMaskPath = (mask: MaskItem): MaskPath => normalizeMaskPath({
  id: mask.activePathId || "mask-path-0",
  shape: mask.shape,
  mode: mask.mode,
  invert: mask.invert,
  position: mask.position,
  size: mask.size,
  pathPoints: mask.pathPoints,
  pathKeyframes: mask.pathKeyframes,
  feather: mask.feather,
  expand: mask.expand,
});

export function getMaskPaths(mask: MaskItem): MaskPath[] {
  if (Array.isArray(mask.paths) && mask.paths.length > 0) {
    return mask.paths.map((path, index) => normalizeMaskPath(path, index));
  }

  return [buildLegacyMaskPath(mask)];
}

export function getActiveMaskPathId(mask: MaskItem): string {
  const paths = getMaskPaths(mask);
  if (!paths.length) {
    return mask.activePathId || "mask-path-0";
  }

  return paths.some((path) => path.id === mask.activePathId)
    ? (mask.activePathId as string)
    : paths[0].id;
}

export function getActiveMaskPath(mask: MaskItem): MaskPath {
  const paths = getMaskPaths(mask);
  const activePathId = getActiveMaskPathId(mask);
  return paths.find((path) => path.id === activePathId) ?? paths[0];
}

export function normalizeMaskItem(mask: MaskItem): MaskItem {
  const paths = getMaskPaths(mask);
  const activePathId = paths.some((path) => path.id === mask.activePathId)
    ? (mask.activePathId as string)
    : paths[0]?.id;
  const activePath = paths.find((path) => path.id === activePathId) ?? paths[0];

  return {
    ...mask,
    matteMode: mask.matteMode ?? "shape",
    activePathId,
    paths: cloneMaskPaths(paths),
    shape: activePath?.shape ?? mask.shape,
    mode: activePath?.mode ?? mask.mode ?? "add",
    invert: activePath?.invert ?? mask.invert ?? false,
    position: activePath ? { ...activePath.position } : { ...mask.position },
    size: activePath ? { ...activePath.size } : { ...mask.size },
    pathPoints: activePath ? cloneMaskPathPoints(activePath.pathPoints) : cloneMaskPathPoints(mask.pathPoints),
    pathKeyframes: activePath
      ? normalizeMaskPathKeyframes(activePath.pathKeyframes, getBaseMaskState(activePath))
      : normalizeMaskPathKeyframes(mask.pathKeyframes, getBaseMaskState(buildLegacyMaskPath(mask))),
    feather: activePath?.feather ?? mask.feather ?? 0,
    expand: activePath?.expand ?? mask.expand ?? 0,
  };
}

const interpolatePoint = (current: MaskPathPoint, next: MaskPathPoint, progress: number): MaskPathPoint => ({
  id: current.id,
  x: current.x + (next.x - current.x) * progress,
  y: current.y + (next.y - current.y) * progress,
  inX: current.inX + (next.inX - current.inX) * progress,
  inY: current.inY + (next.inY - current.inY) * progress,
  outX: current.outX + (next.outX - current.outX) * progress,
  outY: current.outY + (next.outY - current.outY) * progress,
});

const resolveInterpolatedPathPoints = (
  current: MaskPathKeyframe,
  next: MaskPathKeyframe,
  progress: number,
) => {
  if (current.shape !== "path" || next.shape !== "path") {
    return current.shape === "path" ? cloneMaskPathPoints(current.pathPoints) : undefined;
  }

  const currentPoints = current.pathPoints ?? [];
  const nextPoints = next.pathPoints ?? [];
  if (currentPoints.length !== nextPoints.length || currentPoints.length === 0) {
    return progress < 0.5 ? cloneMaskPathPoints(currentPoints) : cloneMaskPathPoints(nextPoints);
  }

  return currentPoints.map((point, index) => interpolatePoint(point, nextPoints[index], progress));
};

export function resolveMaskPathStateFromBase(
  baseState: MaskState,
  keyframes: MaskPathKeyframe[] | undefined,
  timeMs: number,
): MaskState {
  const normalizedKeyframes = normalizeMaskPathKeyframes(keyframes, baseState);
  if (!normalizedKeyframes?.length || !Number.isFinite(timeMs)) {
    return baseState;
  }

  if (timeMs <= normalizedKeyframes[0].timeMs) {
    const first = normalizedKeyframes[0];
    return {
      ...baseState,
      shape: first.shape,
      position: { ...first.position },
      size: { ...first.size },
      pathPoints: cloneMaskPathPoints(first.pathPoints),
    };
  }

  const last = normalizedKeyframes[normalizedKeyframes.length - 1];
  if (timeMs >= last.timeMs) {
    return {
      ...baseState,
      shape: last.shape,
      position: { ...last.position },
      size: { ...last.size },
      pathPoints: cloneMaskPathPoints(last.pathPoints),
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
    const progress = getBezierProgress(normalizeBezier(current.curveToNext), linearProgress);

    return {
      ...baseState,
      shape: progress < 0.5 ? current.shape : next.shape,
      position: {
        x: current.position.x + (next.position.x - current.position.x) * progress,
        y: current.position.y + (next.position.y - current.position.y) * progress,
      },
      size: {
        width: current.size.width + (next.size.width - current.size.width) * progress,
        height: current.size.height + (next.size.height - current.size.height) * progress,
      },
      pathPoints: resolveInterpolatedPathPoints(current, next, progress),
    };
  }

  return baseState;
}

export function resolveMaskPathStateAtTime(path: MaskPath, timeMs: number): ResolvedMaskPathState {
  const baseState = getBaseMaskState(path);
  return {
    id: path.id,
    visible: path.visible ?? true,
    solo: Boolean(path.solo),
    ...resolveMaskPathStateFromBase(baseState, path.pathKeyframes, timeMs),
  };
}

export function resolveMaskPathsAtTime(mask: MaskItem, timeMs: number): ResolvedMaskPathState[] {
  return getMaskPaths(mask).map((path) => resolveMaskPathStateAtTime(path, timeMs));
}

export function getRenderableMaskPathsAtTime(mask: MaskItem, timeMs: number): ResolvedMaskPathState[] {
  const resolvedPaths = resolveMaskPathsAtTime(mask, timeMs);
  const visiblePaths = resolvedPaths.filter((path) => path.visible);
  const soloPaths = visiblePaths.filter((path) => path.solo);
  return soloPaths.length ? soloPaths : visiblePaths;
}

export function resolveMaskStateAtTime(mask: MaskItem, timeMs: number): MaskState {
  const activePath = getActiveMaskPath(mask);
  return resolveMaskPathStateAtTime(activePath, timeMs);
}

export function upsertMaskPathKeyframe(
  path: Pick<MaskPath, "shape" | "position" | "size" | "pathPoints" | "pathKeyframes" | "mode" | "invert" | "feather" | "expand">,
  timeMs: number,
  state: MaskState,
  thresholdMs = MASK_KEYFRAME_SNAP_MS,
): MaskPathKeyframe[] {
  const fallback = getBaseMaskState(path);
  const nextKeyframe: MaskPathKeyframe = {
    id: `mask-keyframe-${Math.round(timeMs)}-${Math.random().toString(36).slice(2, 8)}`,
    timeMs: Math.max(0, Math.round(timeMs)),
    shape: state.shape,
    position: { ...state.position },
    size: { ...state.size },
    pathPoints: cloneMaskPathPoints(state.pathPoints),
    curveToNext: LINEAR_BEZIER,
  };

  const existing = normalizeMaskPathKeyframes(path.pathKeyframes, fallback) ?? [];
  const current = findMaskPathKeyframeAtTime(existing, timeMs, thresholdMs);

  const updated = current
    ? existing.map((keyframe) => (
        keyframe.id === current.id
          ? { ...keyframe, ...nextKeyframe, id: current.id, curveToNext: keyframe.curveToNext ?? LINEAR_BEZIER }
          : keyframe
      ))
    : [...existing, nextKeyframe];

  return normalizeMaskPathKeyframes(updated, fallback) ?? [];
}

export function createDefaultMaskPath(shape: MaskShapeType, position: AnnotationPosition, size: AnnotationSize, id?: string): MaskPath {
  const normalizedShape = shape ?? "rect";
  const pathPoints = normalizedShape === "path" ? createDefaultMaskPathPoints(position, size) : undefined;
  return normalizeMaskPath({
    id,
    shape: normalizedShape,
    mode: "add",
    invert: false,
    position,
    size,
    pathPoints,
    feather: 0,
    expand: 0,
  });
}

export function getMaskGeometryBounds(mask: MaskGeometryLike): { position: AnnotationPosition; size: AnnotationSize } {
  if (mask.shape === "path") {
    return getMaskPathBounds(mask.pathPoints) ?? { position: { ...mask.position }, size: { ...mask.size } };
  }

  return {
    position: { ...mask.position },
    size: { ...mask.size },
  };
}
