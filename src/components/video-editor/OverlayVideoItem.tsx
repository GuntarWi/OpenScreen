import { useEffect, useRef, useState, useMemo } from "react";
import { Rnd } from "react-rnd";
import { cn } from "@/lib/utils";
import type { OverlayVideoAsset, OverlayVideoRegion } from "./types";

interface OverlayVideoItemProps {
  region: OverlayVideoRegion;
  asset: OverlayVideoAsset;
  containerWidth: number;
  containerHeight: number;
  currentTimeMs: number;
  isPlaying: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onPositionChange: (id: string, position: { x: number; y: number }) => void;
  onSizeChange: (id: string, size: { width: number; height: number }) => void;
}

const HANDLE_COLOR = "#7c3aed";
const PIXEL_GRID_ROWS = 4;
const PIXEL_GRID_COLS = 5;

// Seeded random number generator for consistent but random-looking delays
function seededRandom(seed: number) {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

// Generate pixel grid pieces for the pixel effect
function generatePixelPieces(rows: number, cols: number, seed: number) {
  const pieces: { clipPath: string; delay: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const clipPath = `polygon(
        ${col * (100 / cols)}% ${row * (100 / rows)}%,
        ${(col + 1) * (100 / cols)}% ${row * (100 / rows)}%,
        ${(col + 1) * (100 / cols)}% ${(row + 1) * (100 / rows)}%,
        ${col * (100 / cols)}% ${(row + 1) * (100 / rows)}%
      )`;
      // Use seeded random for truly random-looking but consistent delays
      const pieceSeed = seed + row * 100 + col * 7;
      const delay = seededRandom(pieceSeed);
      pieces.push({ clipPath, delay });
    }
  }
  return pieces;
}

export function OverlayVideoItem({
  region,
  asset,
  containerWidth,
  containerHeight,
  currentTimeMs,
  isPlaying,
  isSelected,
  onSelect,
  onPositionChange,
  onSizeChange,
}: OverlayVideoItemProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isDraggingRef = useRef(false);
  const lastSyncTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef(false);
  const [isInteracting, setIsInteracting] = useState(false);

  const x = (region.position.x / 100) * containerWidth;
  const y = (region.position.y / 100) * containerHeight;
  const width = (region.size.width / 100) * containerWidth;
  const height = (region.size.height / 100) * containerHeight;

  // Debug: Log preview position (once per region)
  useEffect(() => {
    console.log('[Preview Position Debug]', JSON.stringify({
      regionId: region.id,
      regionPosition: region.position,
      containerWidth,
      containerHeight,
      x: x.toFixed(1),
      y: y.toFixed(1),
      width: width.toFixed(1),
      height: height.toFixed(1),
    }));
  }, [region.id, region.position, containerWidth, containerHeight, x, y, width, height]);

  const isActive = currentTimeMs >= region.startMs && currentTimeMs <= region.endMs;
  const isVisible = isActive || isSelected;
  const borderRadius = region.borderRadius ?? 0;
  const fit = region.fit ?? "contain";

  // Effect properties
  const enterEffect = region.enterEffect ?? 'none';
  const exitEffect = region.exitEffect ?? 'none';
  const fadeInMs = region.fadeInMs ?? 300;
  const fadeOutMs = region.fadeOutMs ?? 300;

  // Calculate effect state
  const effectState = useMemo(() => {
    if (!isActive) return { opacity: 1, pixelProgress: 1, isEntering: false, isExiting: false };
    
    const timeSinceStart = currentTimeMs - region.startMs;
    const timeUntilEnd = region.endMs - currentTimeMs;
    
    let opacity = 1;
    let pixelProgress = 1;
    let isEntering = false;
    let isExiting = false;
    
    // Enter effect
    if (timeSinceStart < fadeInMs && enterEffect !== 'none') {
      isEntering = true;
      const progress = Math.min(1, timeSinceStart / fadeInMs);
      if (enterEffect === 'fade') {
        opacity = progress;
      } else if (enterEffect === 'pixel') {
        pixelProgress = progress;
        opacity = 1;
      }
    }
    
    // Exit effect (only if not in enter phase)
    if (!isEntering && timeUntilEnd < fadeOutMs && exitEffect !== 'none') {
      isExiting = true;
      const progress = Math.min(1, timeUntilEnd / fadeOutMs);
      if (exitEffect === 'fade') {
        opacity = progress;
      } else if (exitEffect === 'pixel') {
        pixelProgress = progress;
        opacity = 1;
      }
    }
    
    return { opacity, pixelProgress, isEntering, isExiting };
  }, [currentTimeMs, region.startMs, region.endMs, enterEffect, exitEffect, fadeInMs, fadeOutMs, isActive]);

  // Generate pixel pieces for pixel effect
  const pixelPieces = useMemo(() => {
    if (enterEffect !== 'pixel' && exitEffect !== 'pixel') return [];
    // Use region id hash as seed for consistent random delays
    const seed = region.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return generatePixelPieces(PIXEL_GRID_ROWS, PIXEL_GRID_COLS, seed);
  }, [region.id, enterEffect, exitEffect]);

  // Track pixel effect state for CSS transitions
  const isPixelEntering = enterEffect === 'pixel' && effectState.isEntering;
  const isPixelExiting = exitEffect === 'pixel' && effectState.isExiting;
  const showPixelMask = enterEffect === 'pixel' || exitEffect === 'pixel';

  // Handle play/pause state sync
  useEffect(() => {
    if (!isVisible || !isActive) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
      wasPlayingRef.current = true;
    } else if (!isPlaying && !video.paused) {
      video.pause();
      wasPlayingRef.current = false;
    }
  }, [isPlaying, isVisible, isActive]);

  // Handle time sync - only seek when paused or when drift is significant
  useEffect(() => {
    if (!isVisible) return;
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;

    const durationMs = asset.durationMs > 0 ? asset.durationMs : 0;
    const rawLocalMs = isActive ? Math.max(0, currentTimeMs - region.startMs) : 0;
    const maxMs = durationMs > 0 ? Math.max(0, durationMs - 1) : 0;
    const clampedMs = durationMs > 0 ? Math.min(rawLocalMs, maxMs) : rawLocalMs;
    const targetSeconds = clampedMs / 1000;

    const applyTime = () => {
      if (!Number.isFinite(targetSeconds)) return;
      
      const drift = Math.abs(video.currentTime - targetSeconds);
      
      // During playback, only seek if drift exceeds 150ms to avoid constant seeking
      // When paused, seek with tighter threshold (20ms)
      const threshold = isPlaying ? 0.15 : 0.02;
      
      if (drift > threshold) {
        try {
          video.currentTime = targetSeconds;
          lastSyncTimeRef.current = targetSeconds;
        } catch {
          // Ignore seek failures while metadata is loading.
        }
      }
    };

    if (video.readyState >= 1) {
      applyTime();
      return;
    }

    const handleLoaded = () => applyTime();
    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    return () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
    };
  }, [asset.durationMs, asset.src, currentTimeMs, isActive, isVisible, isPlaying, region.startMs]);

  // Pause video when it becomes inactive
  useEffect(() => {
    if (!isActive) {
      const video = videoRef.current;
      if (video && !video.paused) {
        video.pause();
      }
    }
  }, [isActive]);

  if (!isVisible) {
    return null;
  }

  const overlayOpacity = isActive || isSelected ? 1 : 0.35;
  const getParentSize = (node?: HTMLElement | null) => {
    const parent = node?.parentElement;
    const width = parent?.clientWidth || containerWidth;
    const height = parent?.clientHeight || containerHeight;
    return { width, height };
  };

  return (
    <Rnd
      position={{ x, y }}
      size={{ width, height }}
      onDragStart={() => {
        isDraggingRef.current = true;
        setIsInteracting(true);
      }}
      onDragStop={(_e, d) => {
        const parentSize = getParentSize(d.node);
        if (parentSize.width <= 0 || parentSize.height <= 0) return;
        const xPercent = (d.x / parentSize.width) * 100;
        const yPercent = (d.y / parentSize.height) * 100;
        onPositionChange(region.id, { x: xPercent, y: yPercent });
        setTimeout(() => {
          isDraggingRef.current = false;
          setIsInteracting(false);
        }, 50);
      }}
      onResizeStart={() => {
        setIsInteracting(true);
      }}
      onResizeStop={(_e, _direction, ref, _delta, position) => {
        setIsInteracting(false);
        const parentSize = getParentSize(ref);
        if (parentSize.width <= 0 || parentSize.height <= 0) return;
        const xPercent = (position.x / parentSize.width) * 100;
        const yPercent = (position.y / parentSize.height) * 100;
        const widthPercent = (ref.offsetWidth / parentSize.width) * 100;
        const heightPercent = (ref.offsetHeight / parentSize.height) * 100;
        onPositionChange(region.id, { x: xPercent, y: yPercent });
        onSizeChange(region.id, { width: widthPercent, height: heightPercent });
      }}
      onClick={() => {
        if (isDraggingRef.current) return;
        onSelect(region.id);
      }}
      disableDragging={!isSelected || isPlaying}
      enableResizing={isSelected && !isPlaying}
      className={cn(
        isSelected ? "cursor-move" : "cursor-pointer"
      )}
      style={{
        zIndex: isSelected ? region.zIndex + 1000 : region.zIndex,
        pointerEvents: isSelected && !isPlaying ? "auto" : "none",
        border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
        boxShadow: isSelected ? `0 0 0 1px ${HANDLE_COLOR}55` : "none",
        backgroundColor: isSelected ? `${HANDLE_COLOR}14` : "transparent",
        borderRadius,
        transition: isInteracting ? "none" : "border 0.15s, box-shadow 0.15s, background-color 0.15s",
      }}
      resizeHandleStyles={{
        topLeft: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          left: "-6px",
          top: "-6px",
          cursor: "nwse-resize",
        },
        topRight: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          right: "-6px",
          top: "-6px",
          cursor: "nesw-resize",
        },
        bottomLeft: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          left: "-6px",
          bottom: "-6px",
          cursor: "nesw-resize",
        },
        bottomRight: {
          width: "12px",
          height: "12px",
          backgroundColor: isSelected ? "white" : "transparent",
          border: isSelected ? `2px solid ${HANDLE_COLOR}` : "none",
          borderRadius: "50%",
          right: "-6px",
          bottom: "-6px",
          cursor: "nwse-resize",
        },
      }}
    >
      <div className={cn("w-full h-full overflow-hidden")} style={{ opacity: overlayOpacity * effectState.opacity, borderRadius }}>
        {(() => {
          const crop = region.crop;
          const hasCrop = crop && (crop.x !== 0 || crop.y !== 0 || crop.width !== 100 || crop.height !== 100);
          
          const videoStyle = hasCrop && crop ? {
            objectFit: 'cover' as const,
            borderRadius,
            transform: `scale(${100 / crop.width}, ${100 / crop.height}) translate(${-crop.x * (100 / crop.width)}%, ${-crop.y * (100 / crop.height)}%)`,
            transformOrigin: 'top left',
          } : {
            objectFit: fit,
            borderRadius,
          };

          // Pixel effect: single video with grid mask overlay using CSS transitions
          // Determine mask state: entering = mask starts visible and fades out, exiting = mask fades in
          const shouldShowMask = isPixelEntering || isPixelExiting;
          const maskRevealed = isPixelEntering ? effectState.pixelProgress >= 0.99 : false;
          const maskHidden = isPixelExiting ? effectState.pixelProgress <= 0.01 : true;
          const transitionDuration = isPixelEntering ? fadeInMs : fadeOutMs;
          
          return (
            <div className="relative w-full h-full">
              <video
                ref={videoRef}
                src={asset.src}
                muted
                playsInline
                preload="auto"
                className="w-full h-full"
                style={videoStyle}
              />
              {showPixelMask && pixelPieces.length > 0 && (
                <div 
                  className="absolute inset-0 pointer-events-none overflow-hidden" 
                  style={{ borderRadius }}
                >
                  {pixelPieces.map((piece, index) => {
                    // For entering: start at opacity 1 (hidden), transition to 0 (revealed)
                    // For exiting: start at opacity 0 (revealed), transition to 1 (hidden)
                    const delayMs = piece.delay * transitionDuration * 0.8;
                    const pieceTransitionMs = transitionDuration * 0.5;
                    
                    let targetOpacity: number;
                    if (isPixelEntering) {
                      targetOpacity = maskRevealed ? 0 : 1;
                    } else if (isPixelExiting) {
                      targetOpacity = maskHidden ? 0 : 1;
                    } else {
                      // Not in effect - fully transparent (video visible)
                      targetOpacity = 0;
                    }
                    
                    return (
                      <div
                        key={index}
                        className="absolute inset-0"
                        style={{
                          clipPath: piece.clipPath,
                          backgroundColor: '#000',
                          opacity: targetOpacity,
                          transition: shouldShowMask 
                            ? `opacity ${pieceTransitionMs}ms ease-out ${delayMs}ms` 
                            : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </Rnd>
  );
}
