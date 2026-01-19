import { useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import VideoEditor from "./components/video-editor/VideoEditor";

export default function App() {
  const [windowType, setWindowType] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('windowType') || '';
    setWindowType(type);
    if (type === 'hud-overlay' || type === 'source-selector') {
      document.body.style.background = 'transparent';
      document.documentElement.style.background = 'transparent';
      document.getElementById('root')?.style.setProperty('background', 'transparent');
    }
  }, []);

  useEffect(() => {
    const isEditableTarget = (el: Element | null) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      return (el as HTMLElement).isContentEditable;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'q') return;

      const activeEl = document.activeElement;
      if (isEditableTarget(activeEl)) return;

      const selection = window.getSelection();
      if (selection && selection.toString()) return;

      e.preventDefault();
      if (window.electronAPI?.quitApp) {
        window.electronAPI.quitApp();
      } else if (window.electronAPI?.hudOverlayClose) {
        window.electronAPI.hudOverlayClose();
      } else {
        window.close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windowType]);

  switch (windowType) {
    case 'hud-overlay':
      return <LaunchWindow />;
    case 'source-selector':
      return <SourceSelector />;
    case 'editor':
      return <VideoEditor />;
      default:
      return (
        <div className="w-full h-full bg-background text-foreground">
          <h1>Openscreen</h1>
        </div>
      );
  }
}
