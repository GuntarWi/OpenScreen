import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RotateCcw, Sparkles, Trash2, Activity } from "lucide-react";
import type { EffectRegion } from "./types";
import { DEFAULT_EFFECT_REGION } from "./types";

interface EffectSettingsPanelProps {
  effect: EffectRegion;
  onChange: (patch: Partial<EffectRegion>) => void;
  onDelete: () => void;
}

export function EffectSettingsPanel({ effect, onChange, onDelete }: EffectSettingsPanelProps) {
  const tiltX = effect.tiltXDeg ?? DEFAULT_EFFECT_REGION.tiltXDeg;
  const tiltY = effect.tiltYDeg ?? DEFAULT_EFFECT_REGION.tiltYDeg;
  const roll = effect.rollDeg ?? DEFAULT_EFFECT_REGION.rollDeg;
  const scale = effect.scale ?? DEFAULT_EFFECT_REGION.scale;
  const amplitude = effect.amplitudePx ?? DEFAULT_EFFECT_REGION.amplitudePx!;
  const frequency = effect.frequencyHz ?? DEFAULT_EFFECT_REGION.frequencyHz!;

  const handleReset = () => {
    onChange({
      tiltXDeg: DEFAULT_EFFECT_REGION.tiltXDeg,
      tiltYDeg: DEFAULT_EFFECT_REGION.tiltYDeg,
      rollDeg: DEFAULT_EFFECT_REGION.rollDeg,
      scale: DEFAULT_EFFECT_REGION.scale,
      amplitudePx: DEFAULT_EFFECT_REGION.amplitudePx,
      frequencyHz: DEFAULT_EFFECT_REGION.frequencyHz,
      type: DEFAULT_EFFECT_REGION.type,
    });
  };

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-200 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#EC4899]" />
            Effect Settings
          </div>
          <p className="text-xs text-slate-500 mt-1">Stack effects with zoom for extra depth.</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-400 hover:text-[#EC4899] hover:bg-[#EC4899]/10"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
              <Activity className="w-4 h-4 text-[#34B27B]" />
              Effect Type
            </div>
            <span className="text-[11px] text-slate-500">Choose motion</span>
          </div>
          <Select
            value={effect.type}
            onValueChange={(value) => onChange({ type: value as EffectRegion['type'] })}
          >
            <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200 h-9 text-xs">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1c] border-white/10 text-slate-200">
              <SelectItem value="perspective">Perspective</SelectItem>
              <SelectItem value="shake">Shake</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {effect.type === 'perspective' && (
          <>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-200">Tilt</div>
                  <p className="text-[11px] text-slate-500">Simulates a perspective lean.</p>
                </div>
                <span className="text-[11px] text-slate-400 font-mono">
                  {tiltX.toFixed(1)}° / {tiltY.toFixed(1)}°
                </span>
              </div>
              <div className="grid gap-2">
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Horizontal (Y)</div>
                  <Slider
                    value={[tiltX]}
                    onValueChange={([value]) => onChange({ tiltXDeg: value })}
                    min={-30}
                    max={30}
                    step={0.5}
                    className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
                  />
                </div>
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Vertical (X)</div>
                  <Slider
                    value={[tiltY]}
                    onValueChange={([value]) => onChange({ tiltYDeg: value })}
                    min={-30}
                    max={30}
                    step={0.5}
                    className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
                  />
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Roll</div>
                <span className="text-[11px] text-slate-400 font-mono">{roll.toFixed(1)}°</span>
              </div>
              <Slider
                value={[roll]}
                onValueChange={([value]) => onChange({ rollDeg: value })}
                min={-20}
                max={20}
                step={0.5}
                className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
              />
            </div>

            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-slate-200">Scale</div>
                <span className="text-[11px] text-slate-400 font-mono">{(scale * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[scale]}
                onValueChange={([value]) => onChange({ scale: value })}
                min={0.75}
                max={1.25}
                step={0.01}
                className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
              />
              <p className="text-[11px] text-slate-500">Scaling blends with zoom so you can mix both.</p>
            </div>
          </>
        )}

        {effect.type === 'shake' && (
          <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-200">Shake</div>
              <span className="text-[11px] text-slate-400 font-mono">
                {Math.round(amplitude)}px · {frequency.toFixed(1)}Hz
              </span>
            </div>
            <div className="grid gap-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">Amplitude (px)</div>
                <Slider
                  value={[amplitude]}
                  onValueChange={([value]) => onChange({ amplitudePx: value })}
                  min={0}
                  max={50}
                  step={1}
                  className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
                />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-1">Frequency (Hz)</div>
                <Slider
                  value={[frequency]}
                  onValueChange={([value]) => onChange({ frequencyHz: value })}
                  min={0}
                  max={20}
                  step={0.1}
                  className={cn("[&_[role=slider]]:bg-[#EC4899] [&_[role=slider]]:border-[#EC4899]")}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Adds a handheld jitter. Stack with perspective for drama.</p>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-slate-100 hover:bg-white/5 gap-2"
          onClick={handleReset}
        >
          <RotateCcw className="w-4 h-4" />
          Reset effect
        </Button>
        <div className="text-[11px] text-slate-500">Effects are additive—stack as needed.</div>
      </div>
    </div>
  );
}
