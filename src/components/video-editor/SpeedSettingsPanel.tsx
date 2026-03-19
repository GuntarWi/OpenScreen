import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Gauge, Trash2 } from "lucide-react";
import type { SpeedRegion } from "./types";

interface SpeedSettingsPanelProps {
  region: SpeedRegion;
  onChange: (patch: Partial<SpeedRegion>) => void;
  onDelete: () => void;
}

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

export function SpeedSettingsPanel({ region, onChange, onDelete }: SpeedSettingsPanelProps) {
  const speed = region.speed ?? 2;

  return (
    <div className="flex-[2] min-w-0 bg-[#09090b] border border-white/5 rounded-2xl p-4 flex flex-col shadow-xl h-full overflow-y-auto custom-scrollbar">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-200 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#F59E0B]" />
            Speed Settings
          </div>
          <p className="text-xs text-slate-500 mt-1">Ramps from 1× to the target speed, then eases back to 1× by the end of the region.</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-slate-400 hover:text-[#ef4444] hover:bg-[#ef4444]/10"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-slate-200">Speed Multiplier</div>
            <span className="text-[11px] text-slate-400 font-mono">{speed.toFixed(2)}×</span>
          </div>
          <Slider
            value={[speed]}
            onValueChange={([value]) => onChange({ speed: value })}
            min={0.1}
            max={8}
            step={0.05}
            className="[&_[role=slider]]:bg-[#F59E0B] [&_[role=slider]]:border-[#F59E0B]"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>0.1× (slow)</span>
            <span>8× (fast)</span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
          <div className="text-xs font-medium text-slate-200 mb-2">Presets</div>
          <div className="grid grid-cols-4 gap-1.5">
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => onChange({ speed: preset })}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-colors border ${
                  Math.abs(speed - preset) < 0.01
                    ? 'bg-[#F59E0B]/20 border-[#F59E0B]/50 text-[#F59E0B]'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                {preset}×
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/5">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {speed > 1
              ? `This section smoothly accelerates from 1× up to ${speed.toFixed(2)}× and returns to 1× at the region end.`
              : speed < 1
              ? `This section eases down into ${speed.toFixed(2)}× slow motion, then comes back to 1× at the region end.`
              : 'This section stays at normal speed (1×) for the full region.'}
          </p>
        </div>
      </div>
    </div>
  );
}
