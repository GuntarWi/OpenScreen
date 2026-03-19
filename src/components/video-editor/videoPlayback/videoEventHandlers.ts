import type React from 'react';
import type { TrimRegion } from '../types';

interface VideoEventHandlersParams {
  video: HTMLVideoElement;
  isSeekingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  allowPlaybackRef: React.MutableRefObject<boolean>;
  currentTimeRef: React.MutableRefObject<number>;
  timeUpdateAnimationRef: React.MutableRefObject<number | null>;
  onPlayStateChange: (playing: boolean) => void;
  onTimeUpdate: (time: number) => void;
  trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
  onSeekActivity?: () => void;
  mapSourceToTimelineMs?: (sourceMs: number) => number;
  mapTimelineToSourceMs?: (timelineMs: number) => number;
  getPlaybackRateForTimelineMs?: (timelineMs: number) => number;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
  const {
    video,
    isSeekingRef,
    isPlayingRef,
    allowPlaybackRef,
    currentTimeRef,
    timeUpdateAnimationRef,
    onPlayStateChange,
    onTimeUpdate,
    trimRegionsRef,
    onSeekActivity,
    mapSourceToTimelineMs,
    mapTimelineToSourceMs,
    getPlaybackRateForTimelineMs,
  } = params;

  const toTimelineMs = (sourceMs: number) => mapSourceToTimelineMs ? mapSourceToTimelineMs(sourceMs) : sourceMs;
  const toSourceMs = (timelineMs: number) => mapTimelineToSourceMs ? mapTimelineToSourceMs(timelineMs) : timelineMs;

  const emitTime = (timeValue: number) => {
    currentTimeRef.current = timeValue * 1000;
    onTimeUpdate(timeValue);
  };

  // Helper function to check if current time is within a trim region
  const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
    const trimRegions = trimRegionsRef.current;
    return trimRegions.find(
      (region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs
    ) || null;
  };

  function updateTime() {
    if (!video) return;
    
    const currentTimeMs = toTimelineMs(video.currentTime * 1000);
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    
    // If we're in a trim region during playback, skip to the end of it
    if (activeTrimRegion && !video.paused && !video.ended) {
      const skipToTime = toSourceMs(activeTrimRegion.endMs) / 1000;
      
      // If the skip would take us past the video duration, pause instead
      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(activeTrimRegion.endMs / 1000);
      }
    } else {
      emitTime(currentTimeMs / 1000);
    }

    if (!video.paused && !video.ended && getPlaybackRateForTimelineMs) {
      video.playbackRate = getPlaybackRateForTimelineMs(currentTimeMs);
    }
    
    if (!video.paused && !video.ended) {
      timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
    }
  }

  const handlePlay = () => {
    if (isSeekingRef.current) {
      video.pause();
      return;
    }

    if (!allowPlaybackRef.current) {
      video.pause();
      return;
    }

    isPlayingRef.current = true;
    onPlayStateChange(true);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
    }
    timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
  };

    const handlePause = () => {
    isPlayingRef.current = false;
    onPlayStateChange(false);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
      timeUpdateAnimationRef.current = null;
    }
    emitTime(toTimelineMs(video.currentTime * 1000) / 1000);
  };

  const handleSeeked = () => {
    isSeekingRef.current = false;
    onSeekActivity?.();

    const currentTimeMs = toTimelineMs(video.currentTime * 1000);
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    
    // If we seeked into a trim region while playing, skip to the end
    if (activeTrimRegion && isPlayingRef.current && !video.paused) {
      const skipToTime = toSourceMs(activeTrimRegion.endMs) / 1000;
      
      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(activeTrimRegion.endMs / 1000);
      }
    } else {
      if (!isPlayingRef.current && !video.paused) {
        video.pause();
      }
      emitTime(currentTimeMs / 1000);
    }
  };

  const handleSeeking = () => {
    isSeekingRef.current = true;
    onSeekActivity?.();

    if (!isPlayingRef.current && !video.paused) {
      video.pause();
    }
    emitTime(toTimelineMs(video.currentTime * 1000) / 1000);
  };

  return {
    handlePlay,
    handlePause,
    handleSeeked,
    handleSeeking,
  };
}
