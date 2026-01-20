export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '4:5';

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  platform?: string;
}

export const RESOLUTION_PRESETS: Record<AspectRatio, ResolutionPreset[]> = {
  '16:9': [
    { id: 'auto', label: 'Auto (Source)', width: 0, height: 0 },
    { id: 'youtube-4k', label: '4K (2160p)', width: 3840, height: 2160, platform: 'YouTube' },
    { id: 'youtube-1440p', label: '1440p (2K)', width: 2560, height: 1440, platform: 'YouTube' },
    { id: 'youtube-1080p', label: '1080p (Full HD)', width: 1920, height: 1080, platform: 'YouTube' },
    { id: 'youtube-720p', label: '720p (HD)', width: 1280, height: 720, platform: 'YouTube' },
  ],
  '9:16': [
    { id: 'auto', label: 'Auto (Source)', width: 0, height: 0 },
    { id: 'tiktok-1080', label: '1080×1920', width: 1080, height: 1920, platform: 'TikTok/Reels' },
    { id: 'tiktok-720', label: '720×1280', width: 720, height: 1280, platform: 'TikTok/Reels' },
  ],
  '1:1': [
    { id: 'auto', label: 'Auto (Source)', width: 0, height: 0 },
    { id: 'square-1080', label: '1080×1080', width: 1080, height: 1080, platform: 'Instagram' },
    { id: 'square-720', label: '720×720', width: 720, height: 720, platform: 'Instagram' },
  ],
  '4:3': [
    { id: 'auto', label: 'Auto (Source)', width: 0, height: 0 },
    { id: '4-3-1440', label: '1440×1080', width: 1440, height: 1080 },
    { id: '4-3-1024', label: '1024×768', width: 1024, height: 768 },
  ],
  '4:5': [
    { id: 'auto', label: 'Auto (Source)', width: 0, height: 0 },
    { id: '4-5-1080', label: '1080×1350', width: 1080, height: 1350, platform: 'Instagram' },
    { id: '4-5-864', label: '864×1080', width: 864, height: 1080, platform: 'Instagram' },
  ],
};

export function getResolutionPreset(aspectRatio: AspectRatio, presetId: string): ResolutionPreset | undefined {
  return RESOLUTION_PRESETS[aspectRatio].find(p => p.id === presetId);
}

export function getAspectRatioValue(aspectRatio: AspectRatio): number {
  switch (aspectRatio) {
    case '16:9': return 16 / 9;
    case '9:16': return 9 / 16;
    case '1:1':  return 1;
    case '4:3':  return 4 / 3;
    case '4:5':  return 4 / 5;
  }
}

export function getAspectRatioDimensions(
  aspectRatio: AspectRatio,
  baseWidth: number
): { width: number; height: number } {
  const ratio = getAspectRatioValue(aspectRatio);
  return {
    width: baseWidth,
    height: baseWidth / ratio,
  };
}

export function getAspectRatioLabel(aspectRatio: AspectRatio): string {
  return aspectRatio;
}


export function formatAspectRatioForCSS(aspectRatio: AspectRatio): string {
  return aspectRatio.replace(':', '/');
}