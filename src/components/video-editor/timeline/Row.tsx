import { useRow } from "dnd-timeline";
import type { RowDefinition } from "dnd-timeline";
import { cn } from "@/lib/utils";
import { TIMELINE_SIDEBAR_WIDTH } from "./constants";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  height?: number;
  sidebar?: React.ReactNode;
  indicatorPlacement?: 'before' | 'after' | null;
  selected?: boolean;
}

export default function Row({
  id,
  children,
  onDrop,
  onDragOver,
  onDragLeave,
  onClick,
  height = 48,
  sidebar,
  indicatorPlacement = null,
  selected = false,
}: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle, setSidebarRef } = useRow({ id });

  return (
    <div
      className={cn(
        "border-b border-[#18181b] bg-[#18181b] relative transition-colors",
        selected && "bg-[#1a1d1f]",
      )}
      style={{ ...rowWrapperStyle, minHeight: height, marginBottom: 2 }}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
    >
      {indicatorPlacement ? (
        <div
          className="absolute left-0 right-0 z-20 h-[2px] bg-[#34B27B] shadow-[0_0_0_1px_rgba(52,178,123,0.25)] pointer-events-none"
          style={{ top: indicatorPlacement === 'before' ? 0 : undefined, bottom: indicatorPlacement === 'after' ? 0 : undefined }}
        />
      ) : null}
      <div className="flex" style={{ minHeight: height }}>
        {sidebar ? (
          <div
            ref={setSidebarRef}
            className="shrink-0 transition-colors"
            style={{ minHeight: height, width: TIMELINE_SIDEBAR_WIDTH, minWidth: TIMELINE_SIDEBAR_WIDTH }}
          >
            <div
              className={cn(
                "h-full overflow-hidden border-r border-white/5 px-2 py-1 flex items-stretch transition-colors",
                selected ? "bg-[#171a1d]" : "bg-[#131316]",
              )}
            >
              {sidebar}
            </div>
          </div>
        ) : null}
        <div
          ref={setNodeRef}
          style={{ ...rowStyle, minHeight: height }}
          className={cn(
            "flex-1 transition-colors",
            selected && "bg-[#0d0f11]/70",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
