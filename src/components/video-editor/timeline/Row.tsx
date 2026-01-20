import { useRow } from "dnd-timeline";
import type { RowDefinition } from "dnd-timeline";

interface RowProps extends RowDefinition {
  children: React.ReactNode;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
}

export default function Row({ id, children, onDrop, onDragOver }: RowProps) {
  const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

  return (
    <div
      className="border-b border-[#18181b] bg-[#18181b]"
      style={{ ...rowWrapperStyle, minHeight: 48, marginBottom: 4 }}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <div ref={setNodeRef} style={rowStyle}>
        {children}
      </div>
    </div>
  );
}
