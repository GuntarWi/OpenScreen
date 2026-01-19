import { Button } from "@/components/ui/button";
import { Save, FolderOpen, FileDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProjectToolbarProps {
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onLoadProject: () => void;
  onNewProject: () => void;
  hasUnsavedChanges: boolean;
  currentProjectPath: string | null;
}

export function ProjectToolbar({
  onSaveProject,
  onSaveProjectAs,
  onLoadProject,
  onNewProject,
  hasUnsavedChanges,
  currentProjectPath
}: ProjectToolbarProps) {
  // Helper to get filename from path
  const getBasename = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1];
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-300 hover:text-white hover:bg-white/5"
          >
            File
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={onNewProject}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onLoadProject}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open Project
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSaveProject}>
            <Save className="mr-2 h-4 w-4" />
            Save Project
            {hasUnsavedChanges && <span className="ml-2 text-xs text-yellow-400">•</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSaveProjectAs}>
            <FileDown className="mr-2 h-4 w-4" />
            Save Project As...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="sm"
        onClick={onSaveProject}
        className="text-slate-300 hover:text-white hover:bg-white/5 relative"
        title="Save Project (Ctrl+S)"
      >
        <Save className="h-4 w-4 mr-2" />
        Save
        {hasUnsavedChanges && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-yellow-400 rounded-full"></span>
        )}
      </Button>

      {currentProjectPath && (
        <span className="text-xs text-slate-500 truncate max-w-xs">
          {getBasename(currentProjectPath)}
        </span>
      )}
    </div>
  );
}
