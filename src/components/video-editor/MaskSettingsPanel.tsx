import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, CopyPlus, Eye, EyeOff, Plus, Star, Trash2 } from "lucide-react";
import { BezierCurveEditor } from "./BezierCurveEditor";
import type { ClipTransformBezier, MaskItem, MaskPath, VideoAsset, VideoClip } from "./types";
import { LINEAR_BEZIER } from "@/utils/clipTransformKeyframes";
import {
  createDefaultMaskPath,
  findMaskPathKeyframeAtTime,
  getActiveMaskPath,
  getBaseMaskState,
  getMaskPaths,
  resolveMaskStateAtTime,
} from "@/utils/maskPathKeyframes";

interface MaskSettingsPanelProps {
  mask: MaskItem;
  videoClips: VideoClip[];
  videoAssets: VideoAsset[];
  currentTimeMs: number;
  onChange: (patch: Partial<MaskItem>) => void;
  onDelete: () => void;
  onKeyframeAddOrUpdate?: () => void;
  onKeyframeDelete?: (keyframeId: string) => void;
  onKeyframeCurveChange?: (keyframeId: string, curveToNext: ClipTransformBezier) => void;
  onKeyframesClear?: () => void;
}

function getClipLabel(clip: VideoClip, assets: VideoAsset[]) {
  const asset = assets.find((item) => item.id === clip.assetId);
  const name = asset?.name || "Clip";
  return `${name} · ${(clip.startMs / 1000).toFixed(2)}s`;
}

export function MaskSettingsPanel({
  mask,
  videoClips,
  videoAssets,
  currentTimeMs,
  onChange,
  onDelete,
  onKeyframeAddOrUpdate,
  onKeyframeDelete,
  onKeyframeCurveChange,
  onKeyframesClear,
}: MaskSettingsPanelProps) {
  const targetClip = videoClips.find((clip) => clip.id === mask.targetClipId) ?? null;
  const maskPaths = getMaskPaths(mask);
  const activePath = getActiveMaskPath(mask);
  const matteMode = mask.matteMode ?? "shape";
  const canEditKeyframes = matteMode === "shape" && currentTimeMs >= mask.startMs && currentTimeMs <= mask.endMs;
  const currentKeyframe = findMaskPathKeyframeAtTime(activePath.pathKeyframes, currentTimeMs);
  const resolvedState = canEditKeyframes ? resolveMaskStateAtTime(mask, currentTimeMs) : getBaseMaskState(mask);
  const displayedShape = matteMode === "shape" ? resolvedState.shape : mask.shape;
  const displayedPosition = matteMode === "shape" ? resolvedState.position : mask.position;
  const displayedSize = matteMode === "shape" ? resolvedState.size : mask.size;
  const activeCompositeMode = activePath.mode ?? "add";
  const activeInvert = Boolean(activePath.invert);
  const activeFeather = activePath.feather ?? 0;
  const activeExpand = activePath.expand ?? 0;

  const updatePaths = (nextPaths: MaskPath[], nextActivePathId = activePath.id) => {
    onChange({ paths: nextPaths, activePathId: nextActivePathId });
  };

  const handleAddPath = (shape: MaskItem["shape"]) => {
    const width = Math.max(8, activePath.size.width * 0.7);
    const height = Math.max(8, activePath.size.height * 0.7);
    const position = {
      x: activePath.position.x + (activePath.size.width - width) / 2,
      y: activePath.position.y + (activePath.size.height - height) / 2,
    };
    const newPath = createDefaultMaskPath(
      shape,
      position,
      { width, height },
      `mask-path-${Math.random().toString(36).slice(2, 8)}`,
    );
    updatePaths([...maskPaths, newPath], newPath.id);
  };

  const handleDuplicatePath = () => {
    const duplicated = createDefaultMaskPath(
      activePath.shape,
      {
        x: activePath.position.x + 3,
        y: activePath.position.y + 3,
      },
      { ...activePath.size },
      `mask-path-${Math.random().toString(36).slice(2, 8)}`,
    );
    duplicated.mode = activePath.mode;
    duplicated.invert = activePath.invert;
    duplicated.pathPoints = activePath.pathPoints?.map((point) => ({
      ...point,
      id: `mask-point-${Math.random().toString(36).slice(2, 8)}`,
      x: point.x + 3,
      y: point.y + 3,
      inX: point.inX + 3,
      inY: point.inY + 3,
      outX: point.outX + 3,
      outY: point.outY + 3,
    }));
    duplicated.pathKeyframes = activePath.pathKeyframes?.map((keyframe) => ({
      ...keyframe,
      id: `mask-keyframe-${Math.random().toString(36).slice(2, 8)}`,
      position: { x: keyframe.position.x + 3, y: keyframe.position.y + 3 },
      pathPoints: keyframe.pathPoints?.map((point) => ({
        ...point,
        id: `mask-point-${Math.random().toString(36).slice(2, 8)}`,
        x: point.x + 3,
        y: point.y + 3,
        inX: point.inX + 3,
        inY: point.inY + 3,
        outX: point.outX + 3,
        outY: point.outY + 3,
      })),
    }));
    duplicated.feather = activePath.feather;
    duplicated.expand = activePath.expand;
    duplicated.visible = activePath.visible;
    duplicated.solo = false;
    updatePaths([...maskPaths, duplicated], duplicated.id);
  };

  const handleDeletePath = () => {
    if (maskPaths.length <= 1) {
      return;
    }
    const nextPaths = maskPaths.filter((path) => path.id !== activePath.id);
    updatePaths(nextPaths, nextPaths[0]?.id);
  };

  const handleMovePath = (pathId: string, direction: -1 | 1) => {
    const currentIndex = maskPaths.findIndex((path) => path.id === pathId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= maskPaths.length) {
      return;
    }
    const nextPaths = [...maskPaths];
    const [moved] = nextPaths.splice(currentIndex, 1);
    nextPaths.splice(nextIndex, 0, moved);
    updatePaths(nextPaths, pathId);
  };

  const handleToggleVisibility = (pathId: string) => {
    updatePaths(maskPaths.map((path) => (
      path.id === pathId
        ? {
            ...path,
            visible: !(path.visible ?? true),
            solo: !(path.visible ?? true) ? Boolean(path.solo) : false,
          }
        : path
    )), pathId);
  };

  const handleToggleSolo = (pathId: string) => {
    updatePaths(maskPaths.map((path) => (
      path.id === pathId
        ? {
            ...path,
            visible: true,
            solo: !path.solo,
          }
        : path
    )), pathId);
  };

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
      <div className="mb-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Mask Settings</div>
            <div className="text-xs text-slate-500 mt-1 uppercase tracking-[0.18em]">
              {matteMode === "track-above" ? "Track Matte Above" : matteMode === "track-below" ? "Track Matte Below" : displayedShape === "path" ? "Path" : displayedShape === "ellipse" ? "Ellipse" : "Rectangle"}
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            className="gap-2 bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100/90">
          Shape masks render from their own geometry. Track mattes use the nearest visible clip above or below the target clip as the alpha source.
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
          <div className="text-xs font-medium text-slate-200">Target Clip</div>
          <Select value={mask.targetClipId} onValueChange={(value) => onChange({ targetClipId: value })}>
            <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
              <SelectValue placeholder="Select target clip" />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
              {videoClips.map((clip) => (
                <SelectItem key={clip.id} value={clip.id}>
                  {getClipLabel(clip, videoAssets)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetClip ? (
            <div className="text-[10px] text-slate-500">
              Active from {(mask.startMs / 1000).toFixed(2)}s to {(mask.endMs / 1000).toFixed(2)}s
            </div>
          ) : (
            <div className="text-[10px] text-amber-400">
              This mask lost its target clip. Reassign it or delete it.
            </div>
          )}
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
          <div className="text-xs font-medium text-slate-200">Mask Source</div>
          <Select value={matteMode} onValueChange={(value) => onChange({ matteMode: value as MaskItem["matteMode"] })}>
            <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
              <SelectValue placeholder="Select mask source" />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
              <SelectItem value="shape">Custom Shape</SelectItem>
              <SelectItem value="track-above">Track Matte Above</SelectItem>
              <SelectItem value="track-below">Track Matte Below</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {matteMode === "shape" ? (
          <>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-300">Mask Paths</div>
                  <div className="text-[10px] text-slate-500">
                    One mask item can now hold multiple paths. The selected path is the one you edit and keyframe.
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{maskPaths.length} paths</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button type="button" size="sm" variant="outline" className="gap-2 bg-white/5 border-white/10 text-slate-200 hover:bg-white/10" onClick={() => handleAddPath("rect")}>
                  <Plus className="w-3 h-3" />
                  Rect
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-2 bg-white/5 border-white/10 text-slate-200 hover:bg-white/10" onClick={() => handleAddPath("ellipse")}>
                  <Plus className="w-3 h-3" />
                  Ellipse
                </Button>
                <Button type="button" size="sm" variant="outline" className="gap-2 bg-white/5 border-white/10 text-slate-200 hover:bg-white/10" onClick={() => handleAddPath("path")}>
                  <Plus className="w-3 h-3" />
                  Path
                </Button>
              </div>
              <div className="space-y-2">
                {maskPaths.map((path, index) => {
                  const isActive = path.id === activePath.id;
                  const isVisible = path.visible ?? true;
                  const isSolo = Boolean(path.solo);
                  return (
                    <div
                      key={path.id}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                        isActive
                          ? "border-[#14b8a6]/30 bg-[#14b8a6]/10 text-slate-100"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onChange({ activePathId: path.id })}
                        >
                          <div className="text-[11px] font-medium">
                            Path {index + 1} · {path.shape === "ellipse" ? "Ellipse" : path.shape === "path" ? "Bezier" : "Rectangle"}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                            <span>{path.pathKeyframes?.length ?? 0} kf</span>
                            {!isVisible ? <span>Hidden</span> : null}
                            {isSolo ? <span>Solo</span> : null}
                          </div>
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className={cn(
                              "rounded-md border p-1.5 transition-colors",
                              isVisible
                                ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15",
                            )}
                            onClick={() => handleToggleVisibility(path.id)}
                            title={isVisible ? "Hide path" : "Show path"}
                          >
                            {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "rounded-md border p-1.5 transition-colors",
                              isSolo
                                ? "border-[#14b8a6]/30 bg-[#14b8a6]/15 text-[#7dd3c7]"
                                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
                            )}
                            onClick={() => handleToggleSolo(path.id)}
                            title={isSolo ? "Disable solo" : "Solo path"}
                          >
                            <Star className={cn("w-3.5 h-3.5", isSolo ? "fill-current" : "")} />
                          </button>
                          <button
                            type="button"
                            disabled={index === 0}
                            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-30"
                            onClick={() => handleMovePath(path.id, -1)}
                            title="Move path up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === maskPaths.length - 1}
                            className="rounded-md border border-white/10 bg-white/5 p-1.5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-30"
                            onClick={() => handleMovePath(path.id, 1)}
                            title="Move path down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="ghost" className="gap-2 text-slate-300 hover:text-white hover:bg-white/10" onClick={handleDuplicatePath}>
                  <CopyPlus className="w-3.5 h-3.5" />
                  Duplicate Path
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={maskPaths.length <= 1}
                  className="gap-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                  onClick={handleDeletePath}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Path
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                <div className="text-xs font-medium text-slate-200">Shape</div>
                <Select value={displayedShape} onValueChange={(value) => onChange({ shape: value as MaskItem["shape"] })}>
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
                    <SelectValue placeholder="Select shape" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                    <SelectItem value="rect">Rectangle</SelectItem>
                    <SelectItem value="ellipse">Ellipse</SelectItem>
                    <SelectItem value="path">Path</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                <div className="text-xs font-medium text-slate-200">Composite</div>
                <Select value={activeCompositeMode} onValueChange={(value) => onChange({ mode: value as MaskItem["mode"] })}>
                  <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
                    <SelectValue placeholder="Select composite mode" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
                    <SelectItem value="add">Add</SelectItem>
                    <SelectItem value="subtract">Subtract</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
              <div>
                <div className="text-xs font-medium text-slate-200">Invert</div>
                <div className="text-[10px] text-slate-500">Cuts the shape out of the full frame instead of keeping only the inside.</div>
              </div>
              <Switch
                checked={activeInvert}
                onCheckedChange={(value) => onChange({ invert: Boolean(value) })}
                className="data-[state=checked]:bg-[#34B27B]"
              />
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="text-xs font-medium text-slate-200">Edge</div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Feather: {Math.round(activeFeather)}%</div>
                <Slider
                  value={[activeFeather]}
                  onValueChange={(values) => onChange({ feather: values[0] })}
                  min={0}
                  max={60}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                />
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">Expand: {Math.round(activeExpand)}%</div>
                <Slider
                  value={[activeExpand]}
                  onValueChange={(values) => onChange({ expand: values[0] })}
                  min={-50}
                  max={50}
                  step={1}
                  className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                />
              </div>
            </div>

            {displayedShape === "path" ? (
              <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 px-3 py-3 text-[11px] text-teal-100/90 space-y-1.5">
                <div>Path Editing</div>
                <div className="text-teal-100/75">Drag anchor points to reshape.</div>
                <div className="text-teal-100/75">Drag bezier handles on the selected point to curve the path.</div>
                <div className="text-teal-100/75">Double-click the path to add a point.</div>
                <div className="text-teal-100/75">Double-click an anchor point to remove it.</div>
                <div className="text-teal-100/75">Shift/Cmd click points to multi-select and drag them together.</div>
                <div className="text-teal-100/75">Drag an empty area to marquee-select multiple vertices.</div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
                <div className="text-xs font-medium text-slate-200">Placement</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">X: {Math.round(displayedPosition.x)}%</div>
                    <Slider
                      value={[displayedPosition.x]}
                      onValueChange={(values) => onChange({ position: { x: values[0], y: displayedPosition.y } })}
                      min={-200}
                      max={200}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Y: {Math.round(displayedPosition.y)}%</div>
                    <Slider
                      value={[displayedPosition.y]}
                      onValueChange={(values) => onChange({ position: { x: displayedPosition.x, y: values[0] } })}
                      min={-200}
                      max={200}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Width: {Math.round(displayedSize.width)}%</div>
                    <Slider
                      value={[displayedSize.width]}
                      onValueChange={(values) => onChange({ size: { width: values[0], height: displayedSize.height } })}
                      min={1}
                      max={200}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 mb-1">Height: {Math.round(displayedSize.height)}%</div>
                    <Slider
                      value={[displayedSize.height]}
                      onValueChange={(values) => onChange({ size: { width: displayedSize.width, height: values[0] } })}
                      min={1}
                      max={200}
                      step={1}
                      className="w-full [&_[role=slider]]:bg-[#14b8a6] [&_[role=slider]]:border-[#14b8a6]"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-300">Mask Keyframes</div>
                  <div className="text-[10px] text-slate-500">
                    Add a keyframe at the playhead, then move points or change mask geometry later to animate the mask.
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  {activePath.pathKeyframes?.length ?? 0} keyframes
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEditKeyframes}
                  className="gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white disabled:opacity-40"
                  onClick={onKeyframeAddOrUpdate}
                >
                  <Star className="w-3 h-3" fill={currentKeyframe ? "currentColor" : "none"} />
                  {currentKeyframe ? "Update Keyframe" : "Add Keyframe"}
                </Button>
                {(activePath.pathKeyframes?.length ?? 0) > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-slate-400 hover:text-white hover:bg-white/10"
                    onClick={onKeyframesClear}
                  >
                    Clear All
                  </Button>
                ) : null}
              </div>
              {!canEditKeyframes ? (
                <div className="text-[10px] text-slate-500">
                  Move the playhead onto the mask segment to add or update mask keyframes.
                </div>
              ) : null}
              {(activePath.pathKeyframes?.length ?? 0) > 0 ? (
                <div className="space-y-1.5">
                  {[...(activePath.pathKeyframes ?? [])]
                    .sort((a, b) => a.timeMs - b.timeMs)
                    .map((keyframe, index, keyframes) => {
                      const isCurrent = Math.abs(keyframe.timeMs - currentTimeMs) <= 50;
                      const hasNextSegment = index < keyframes.length - 1;
                      return (
                        <div
                          key={keyframe.id}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-[11px]",
                            isCurrent
                              ? "border-[#14b8a6]/30 bg-[#14b8a6]/10 text-slate-100"
                              : "border-white/10 bg-white/5 text-slate-300",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-mono">{(keyframe.timeMs / 1000).toFixed(2)}s</div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => onKeyframeDelete?.(keyframe.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="mt-2">
                            {hasNextSegment ? (
                              <div className="space-y-1">
                                <div className="text-[10px] text-slate-500">To next: curve</div>
                                <BezierCurveEditor
                                  value={keyframe.curveToNext ?? LINEAR_BEZIER}
                                  onChange={(curve) => onKeyframeCurveChange?.(keyframe.id, curve)}
                                />
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-500">Final keyframe</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-3 text-[11px] text-sky-100/90 space-y-1.5">
            <div>Track Matte</div>
            <div className="text-sky-100/75">
              This mask segment now uses the nearest active clip {matteMode === "track-above" ? "above" : "below"} the target clip as the matte source.
            </div>
            <div className="text-sky-100/75">
              Shape controls and path keyframes are ignored while track matte mode is active.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
