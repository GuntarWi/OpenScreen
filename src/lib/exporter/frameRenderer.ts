import { Application, BlurFilter } from 'pixi.js';
import { getAssetPath } from '@/lib/assetPath';
import { RECORDING_ASSET_ID, type ZoomRegion, CropRegion, AnnotationRegion, EffectRegion, ScreenOffset, VideoAsset, VideoClip, PaddingKeyframe, BackgroundItem, MaskItem } from '@/components/video-editor/types';
import {
  DEFAULT_BACKGROUND_ACCENT_COLOR,
  DEFAULT_BACKGROUND_BACKDROP_COLOR,
  DEFAULT_BACKGROUND_VALUE,
  DEFAULT_RETRO_GRID_ANGLE,
  DEFAULT_RETRO_GRID_DENSITY,
  DEFAULT_RIPPLE_COUNT,
  DEFAULT_RIPPLE_SPEED,
  getBackgroundItemSource,
  getRetroGridCellSize,
  getRippleAnimationDurationSeconds,
  inferBackgroundKindFromValue,
  MAGICUI_RETRO_GRID_VALUE,
  MAGICUI_RIPPLE_VALUE,
  resolveActiveBackgroundItem,
} from '@/components/video-editor/backgroundUtils';
import { interpolatePadding } from '@/utils/paddingKeyframes';
import { ZOOM_DEPTH_SCALES } from '@/components/video-editor/types';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from '@/components/video-editor/videoPlayback/constants';
import { clampFocusToStage as clampFocusToStageUtil } from '@/components/video-editor/videoPlayback/focusUtils';
import { renderAnnotations } from './annotationRenderer';
import { computeEffectState, type CombinedEffectState } from '@/components/video-editor/videoPlayback/effectUtils';
import { ClipPixiRenderer } from '@/components/video-editor/videoPlayback/clipPixiRenderer';

const EFFECT_PERSPECTIVE = 1200;
const SKEW_TO_TILT_RATIO = 0.55;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const RETRO_GRID_ANIMATION_DURATION_SECONDS = 15;
const RETRO_GRID_GRID_HEIGHT_RATIO = 3;
const RETRO_GRID_GRID_LINE_ALIGNMENT_OFFSET_PX = 0.5;
const RETRO_GRID_GRID_LINE_ANTIALIAS_MULTIPLIER = 0.9;
const RETRO_GRID_GRID_LINE_WIDTH_PX = 0.92;
const RETRO_GRID_GRID_START_OFFSET_RATIO = -0.5;
const RETRO_GRID_GRID_WIDTH_RATIO = 6;
const RETRO_GRID_GRID_X_OFFSET_RATIO = -2;
const RETRO_GRID_PERSPECTIVE_PX = 200;

const RETRO_GRID_VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const RETRO_GRID_FRAGMENT_SHADER_SOURCE = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 u_container_size;
uniform vec2 u_viewport_size;
uniform vec4 u_line_color;
uniform float u_angle;
uniform float u_cell_size;
uniform float u_device_pixel_ratio;
uniform float u_time;

const float animationDurationSeconds = ${RETRO_GRID_ANIMATION_DURATION_SECONDS.toFixed(1)};
const float gridHeightRatio = ${RETRO_GRID_GRID_HEIGHT_RATIO.toFixed(1)};
const float gridStartOffsetRatio = ${RETRO_GRID_GRID_START_OFFSET_RATIO.toFixed(1)};
const float gridWidthRatio = ${RETRO_GRID_GRID_WIDTH_RATIO.toFixed(1)};
const float gridXOffsetRatio = ${RETRO_GRID_GRID_X_OFFSET_RATIO.toFixed(1)};
const float gridLineAlignmentOffsetPx = ${RETRO_GRID_GRID_LINE_ALIGNMENT_OFFSET_PX.toFixed(1)};
const float gridLineAntialiasMultiplier = ${RETRO_GRID_GRID_LINE_ANTIALIAS_MULTIPLIER.toFixed(1)};
const float horizontalLodLevelOneEndPx = 5.6;
const float horizontalLodLevelOneStartPx = 2.8;
const float horizontalLodLevelTwoEndPx = 3.0;
const float horizontalLodLevelTwoStartPx = 1.4;
const float horizontalCompressionEndPx = 2.8;
const float horizontalCompressionStartPx = 1.2;
const float lineWidthPx = ${RETRO_GRID_GRID_LINE_WIDTH_PX.toFixed(2)};
const float perspectivePx = ${RETRO_GRID_PERSPECTIVE_PX.toFixed(1)};
const float gridTravelRatio = 0.5;
const float verticalCompressionEndPx = 2.6;
const float verticalCompressionStartPx = 1.0;
const float verticalEdgeCompressionEnd = 0.95;
const float verticalEdgeCompressionStart = 0.45;
const float verticalLodLevelEnd = 0.64;
const float verticalLodLevelStart = 0.22;
const float verticalTopCompressionEndCells = 6.0;
const float verticalTopCompressionStartCells = 2.0;

float renderGridLine(
  float wrappedCoord,
  float antiAliasWidth,
  float softnessBoost
) {
  return 1.0 - smoothstep(
    lineWidthPx,
    lineWidthPx + (antiAliasWidth * (1.5 + softnessBoost)),
    wrappedCoord
  );
}

void main() {
  float angle = radians(clamp(u_angle, 1.0, 89.0));
  float sinAngle = sin(angle);
  float cosAngle = cos(angle);
  vec2 screen = vec2(
    (gl_FragCoord.x / u_device_pixel_ratio) - (u_container_size.x * 0.5),
    (u_container_size.y * 0.5) - (gl_FragCoord.y / u_device_pixel_ratio)
  );

  vec3 rayOrigin = vec3(0.0, 0.0, perspectivePx);
  vec3 rayDirection = normalize(vec3(screen, -perspectivePx));
  vec3 planeXAxis = vec3(1.0, 0.0, 0.0);
  vec3 planeYAxis = vec3(0.0, cosAngle, sinAngle);
  vec3 planeNormal = normalize(cross(planeXAxis, planeYAxis));
  float denominator = dot(rayDirection, planeNormal);

  if (abs(denominator) < 0.0001) {
    discard;
  }

  float distanceToPlane = dot(-rayOrigin, planeNormal) / denominator;

  if (distanceToPlane <= 0.0) {
    discard;
  }

  vec3 hitPoint = rayOrigin + (rayDirection * distanceToPlane);
  float localX = hitPoint.x;
  float localY = dot(hitPoint, planeYAxis);
  float gridWidth = u_viewport_size.x * gridWidthRatio;
  float gridHeight = u_viewport_size.y * gridHeightRatio;
  float gridScrollSpeed = (gridHeight * gridTravelRatio) / animationDurationSeconds;
  float patternOffsetY = u_time * gridScrollSpeed;
  float gridLeft = (-0.5 * u_container_size.x) + (gridXOffsetRatio * u_container_size.x);
  float gridTop = (-0.5 * u_container_size.y) + (gridStartOffsetRatio * gridHeight);
  vec2 planePosition = vec2(localX - gridLeft, localY - gridTop);

  if (
    planePosition.x < 0.0 ||
    planePosition.y < 0.0 ||
    planePosition.x > gridWidth ||
    planePosition.y > gridHeight
  ) {
    discard;
  }

  vec2 patternPosition = vec2(planePosition.x, planePosition.y - patternOffsetY);
  vec2 wrapped = mod(
    patternPosition + vec2(gridLineAlignmentOffsetPx),
    u_cell_size
  );
  vec2 patternDerivative = max(fwidth(patternPosition), vec2(0.0001));
  vec2 antiAliasWidth = patternDerivative * gridLineAntialiasMultiplier;
  float horizontalCellSpanPx = u_cell_size / patternDerivative.y;
  float horizontalCompression = 1.0 - smoothstep(
    horizontalCompressionStartPx,
    horizontalCompressionEndPx,
    horizontalCellSpanPx
  );
  float verticalCellSpanPx = u_cell_size / patternDerivative.x;
  float sideDistance = abs((planePosition.x / gridWidth) * 2.0 - 1.0);
  float verticalEdgeCompression = smoothstep(
    verticalEdgeCompressionStart,
    verticalEdgeCompressionEnd,
    sideDistance
  );
  float verticalTopCompression = 1.0 - smoothstep(
    u_cell_size * verticalTopCompressionStartCells,
    u_cell_size * verticalTopCompressionEndCells,
    planePosition.y
  );
  float verticalCompression =
    (1.0 - smoothstep(
      verticalCompressionStartPx,
      verticalCompressionEndPx,
      verticalCellSpanPx
    )) * verticalEdgeCompression * verticalTopCompression;
  float horizontalSoftnessBoost = 1.0 + (horizontalCompression * 3.0);
  float verticalSoftnessBoost = 1.0 + (verticalCompression * 3.5);
  float verticalLod = smoothstep(
    verticalLodLevelStart,
    verticalLodLevelEnd,
    verticalCompression
  );
  float verticalLineFine = renderGridLine(
    wrapped.x,
    antiAliasWidth.x,
    verticalSoftnessBoost
  );
  float verticalWrappedLod = mod(
    patternPosition.x + gridLineAlignmentOffsetPx,
    u_cell_size * 2.0
  );
  float verticalLineCoarse = renderGridLine(
    verticalWrappedLod,
    antiAliasWidth.x,
    verticalSoftnessBoost + verticalLod
  );
  float verticalLine = max(
    verticalLineFine * (1.0 - verticalLod),
    verticalLineCoarse * verticalLod
  );
  float horizontalLodLevelOne = 1.0 - smoothstep(
    horizontalLodLevelOneStartPx,
    horizontalLodLevelOneEndPx,
    horizontalCellSpanPx
  );
  float horizontalLodLevelTwo = 1.0 - smoothstep(
    horizontalLodLevelTwoStartPx,
    horizontalLodLevelTwoEndPx,
    horizontalCellSpanPx
  );
  float horizontalLineFine = renderGridLine(
    wrapped.y,
    antiAliasWidth.y,
    horizontalSoftnessBoost
  );
  float horizontalWrappedLodOne = mod(
    patternPosition.y + gridLineAlignmentOffsetPx,
    u_cell_size * 2.0
  );
  float horizontalWrappedLodTwo = mod(
    patternPosition.y + gridLineAlignmentOffsetPx,
    u_cell_size * 4.0
  );
  float horizontalLineCoarse = renderGridLine(
    horizontalWrappedLodOne,
    antiAliasWidth.y,
    horizontalSoftnessBoost + horizontalLodLevelOne
  );
  float horizontalLineExtraCoarse = renderGridLine(
    horizontalWrappedLodTwo,
    antiAliasWidth.y,
    horizontalSoftnessBoost + horizontalLodLevelOne + horizontalLodLevelTwo
  );
  float horizontalLineReduced = max(
    horizontalLineFine * (1.0 - horizontalLodLevelOne),
    horizontalLineCoarse * horizontalLodLevelOne
  );
  float horizontalLine = max(
    horizontalLineReduced * (1.0 - horizontalLodLevelTwo),
    horizontalLineExtraCoarse * horizontalLodLevelTwo
  );
  float line = max(verticalLine, horizontalLine);

  if (line <= 0.001) {
    discard;
  }

  float alpha = u_line_color.a * line;
  gl_FragColor = vec4(u_line_color.rgb * alpha, alpha);
}
`;

interface RetroGridProgramInfo {
  attributeLocation: number;
  program: WebGLProgram;
  uniforms: {
    angle: WebGLUniformLocation;
    cellSize: WebGLUniformLocation;
    containerSize: WebGLUniformLocation;
    devicePixelRatio: WebGLUniformLocation;
    lineColor: WebGLUniformLocation;
    time: WebGLUniformLocation;
    viewportSize: WebGLUniformLocation;
  };
}

let retroGridColorResolveContext: CanvasRenderingContext2D | null | undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createRetroGridShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  gl.deleteShader(shader);
  return null;
}

function createRetroGridProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertexShader = createRetroGridShader(gl, gl.VERTEX_SHADER, RETRO_GRID_VERTEX_SHADER_SOURCE);
  const fragmentShader = createRetroGridShader(gl, gl.FRAGMENT_SHADER, RETRO_GRID_FRAGMENT_SHADER_SOURCE);
  if (!vertexShader || !fragmentShader) {
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  gl.deleteProgram(program);
  return null;
}

function getRetroGridProgramInfo(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
): RetroGridProgramInfo | null {
  const attributeLocation = gl.getAttribLocation(program, 'a_position');
  const angle = gl.getUniformLocation(program, 'u_angle');
  const cellSize = gl.getUniformLocation(program, 'u_cell_size');
  const containerSize = gl.getUniformLocation(program, 'u_container_size');
  const devicePixelRatio = gl.getUniformLocation(program, 'u_device_pixel_ratio');
  const lineColor = gl.getUniformLocation(program, 'u_line_color');
  const time = gl.getUniformLocation(program, 'u_time');
  const viewportSize = gl.getUniformLocation(program, 'u_viewport_size');

  if (
    attributeLocation < 0 ||
    !angle ||
    !cellSize ||
    !containerSize ||
    !devicePixelRatio ||
    !lineColor ||
    !time ||
    !viewportSize
  ) {
    return null;
  }

  return {
    attributeLocation,
    program,
    uniforms: {
      angle,
      cellSize,
      containerSize,
      devicePixelRatio,
      lineColor,
      time,
      viewportSize,
    },
  };
}

function getRetroGridColorResolveContext(): CanvasRenderingContext2D | null {
  if (retroGridColorResolveContext !== undefined) {
    return retroGridColorResolveContext;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  retroGridColorResolveContext = canvas.getContext('2d', { willReadFrequently: true });
  return retroGridColorResolveContext;
}

function resolveRetroGridLineColor(color: string, alpha = 1): Float32Array {
  const context = getRetroGridColorResolveContext();
  if (!context) {
    return new Float32Array([0.5, 0.5, 0.5, alpha]);
  }

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;

  return new Float32Array([
    pixel[0] / 255,
    pixel[1] / 255,
    pixel[2] / 255,
    (pixel[3] / 255) * alpha,
  ]);
}

interface FrameRenderConfig {
  width: number;
  height: number;
  wallpaper: string;
  backgroundItems?: BackgroundItem[];
  maskItems?: MaskItem[];
  zoomRegions: ZoomRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  paddingKeyframes?: PaddingKeyframe[];
  cropRegion: CropRegion;
  screenOffset?: ScreenOffset;
  videoWidth: number;
  videoHeight: number;
  annotationRegions?: AnnotationRegion[];
  videoAssets?: VideoAsset[];
  videoClips?: VideoClip[];
  effectRegions?: EffectRegion[];
  previewWidth?: number;
  previewHeight?: number;
}

interface AnimationState {
  scale: number;
  focusX: number;
  focusY: number;
}

// Renders video frames with all effects (background, zoom, crop, blur, shadow, clips) to an offscreen canvas for export.

export class FrameRenderer {
  private app: Application | null = null;
  private backgroundSprite: HTMLCanvasElement | null = null;
  private blurFilter: BlurFilter | null = null;
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenCtx: CanvasRenderingContext2D | null = null;
  private effectCanvas: HTMLCanvasElement | null = null;
  private effectCtx: CanvasRenderingContext2D | null = null;
  private config: FrameRenderConfig;
  private animationState: AnimationState;
  private layoutCache: any = null;
  private currentVideoTime = 0;
  private clipRenderer: ClipPixiRenderer | null = null;
  private screenOffsetPx = { x: 0, y: 0 };
  private recordingClipIds: string[] = [];
  private recordingVideo: HTMLVideoElement | null = null;
  private backgroundImageCache = new Map<string, HTMLImageElement>();
  private backgroundVideoCache = new Map<string, HTMLVideoElement>();
  private retroGridCanvas: HTMLCanvasElement | null = null;
  private retroGridGl: WebGLRenderingContext | null = null;
  private retroGridProgramInfo: RetroGridProgramInfo | null = null;
  private retroGridPositionBuffer: WebGLBuffer | null = null;

  constructor(config: FrameRenderConfig) {
    this.config = config;
    const screenOffset = config.screenOffset || { x: 0, y: 0 };
    this.screenOffsetPx = {
      x: (screenOffset.x / 100) * config.width,
      y: (screenOffset.y / 100) * config.height,
    };
    this.animationState = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };
  }

  async initialize(): Promise<void> {
    // Create canvas for rendering
    const canvas = document.createElement('canvas');
    canvas.width = this.config.width;
    canvas.height = this.config.height;
    
    // Try to set colorSpace if supported (may not be available on all platforms)
    try {
      if (canvas && 'colorSpace' in canvas) {
        // @ts-ignore
        canvas.colorSpace = 'srgb';
      }
    } catch (error) {
      // Silently ignore colorSpace errors on platforms that don't support it
      console.warn('[FrameRenderer] colorSpace not supported on this platform:', error);
    }

    // Initialize PixiJS with optimized settings for export performance
    this.app = new Application();
    await this.app.init({
      canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundAlpha: 0,
      antialias: false,
      resolution: 1,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false,
    });

    // Setup renderer for all clips
    this.app.stage.sortableChildren = true;
    this.clipRenderer = new ClipPixiRenderer(this.app.stage);
    this.clipRenderer.setZIndex(1);
    this.clipRenderer.setAssets(this.config.videoAssets || []);
    this.clipRenderer.setMaskItems(this.config.maskItems || []);
    this.clipRenderer.syncClips(this.config.videoClips || []);
    this.clipRenderer.setStageSize({ width: this.config.width, height: this.config.height });
    this.recordingClipIds = this.getRecordingClipIds();
    if (this.recordingVideo) {
      this.clipRenderer.setExternalVideo(RECORDING_ASSET_ID, this.recordingVideo, { allowSeek: false });
    }

    // Setup background (render separately, not in PixiJS)
    await this.setupBackground();

    // Setup blur filter for recording clip(s)
    this.blurFilter = new BlurFilter();
    this.blurFilter.quality = 3;
    this.blurFilter.resolution = this.app.renderer.resolution;
    this.blurFilter.blur = 0;

    // Setup composite canvas for final output with shadows
    this.compositeCanvas = document.createElement('canvas');
    this.compositeCanvas.width = this.config.width;
    this.compositeCanvas.height = this.config.height;
    this.compositeCtx = this.compositeCanvas.getContext('2d', { willReadFrequently: false });
    
    if (!this.compositeCtx) {
      throw new Error('Failed to get 2D context for composite canvas');
    }

    // Setup screen canvas for effect transforms
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = this.config.width;
    this.screenCanvas.height = this.config.height;
    this.screenCtx = this.screenCanvas.getContext('2d', { willReadFrequently: false });

    if (!this.screenCtx) {
      throw new Error('Failed to get 2D context for screen canvas');
    }

    // Setup effect canvas for post-perspective shadow compositing
    this.effectCanvas = document.createElement('canvas');
    this.effectCanvas.width = this.config.width;
    this.effectCanvas.height = this.config.height;
    this.effectCtx = this.effectCanvas.getContext('2d', { willReadFrequently: false });

    if (!this.effectCtx) {
      throw new Error('Failed to get 2D context for effect canvas');
    }

    // Setup shadow canvas if needed
    if (this.config.showShadow) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.config.width;
      this.shadowCanvas.height = this.config.height;
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: false });
      
      if (!this.shadowCtx) {
        throw new Error('Failed to get 2D context for shadow canvas');
      }
    }

    this.updateLayout(0);

  }

  private async setupBackground(): Promise<void> {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = this.config.width;
    bgCanvas.height = this.config.height;
    this.backgroundSprite = bgCanvas;
    await this.renderBackgroundFrame(0);
  }

  private async resolveBackgroundSourceUrl(source: string): Promise<string> {
    if (
      source === MAGICUI_RETRO_GRID_VALUE ||
      source === MAGICUI_RIPPLE_VALUE ||
      source.startsWith('#') ||
      source.startsWith('linear-gradient') ||
      source.startsWith('radial-gradient') ||
      source.startsWith('data:') ||
      source.startsWith('http') ||
      source.startsWith('file://')
    ) {
      return source;
    }

    return getAssetPath(source.replace(/^\//, ''));
  }

  private destroyRetroGridRenderer(): void {
    if (this.retroGridGl) {
      if (this.retroGridPositionBuffer) {
        this.retroGridGl.deleteBuffer(this.retroGridPositionBuffer);
      }
      if (this.retroGridProgramInfo) {
        this.retroGridGl.deleteProgram(this.retroGridProgramInfo.program);
      }
    }

    this.retroGridPositionBuffer = null;
    this.retroGridProgramInfo = null;
    this.retroGridGl = null;
    this.retroGridCanvas = null;
  }

  private ensureRetroGridRenderer(width: number, height: number): boolean {
    if (
      this.retroGridCanvas &&
      this.retroGridGl &&
      this.retroGridProgramInfo &&
      this.retroGridPositionBuffer &&
      this.retroGridCanvas.width === width &&
      this.retroGridCanvas.height === height
    ) {
      return true;
    }

    this.destroyRetroGridRenderer();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });

    if (!gl || !gl.getExtension('OES_standard_derivatives')) {
      return false;
    }

    const program = createRetroGridProgram(gl);
    if (!program) {
      return false;
    }

    const programInfo = getRetroGridProgramInfo(gl, program);
    if (!programInfo) {
      gl.deleteProgram(program);
      return false;
    }

    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
      gl.deleteProgram(program);
      return false;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.viewport(0, 0, width, height);

    this.retroGridCanvas = canvas;
    this.retroGridGl = gl;
    this.retroGridProgramInfo = programInfo;
    this.retroGridPositionBuffer = positionBuffer;
    return true;
  }

  private drawRetroGridShaderBackground(
    ctx: CanvasRenderingContext2D,
    timeMs: number,
    blurAmount = 0,
    backdropColor = DEFAULT_BACKGROUND_BACKDROP_COLOR,
    accentColor = DEFAULT_BACKGROUND_ACCENT_COLOR,
    angleDeg = DEFAULT_RETRO_GRID_ANGLE,
    density = DEFAULT_RETRO_GRID_DENSITY,
  ): boolean {
    const renderWidth = Math.max(1, Math.round(this.config.previewWidth || this.config.width));
    const renderHeight = Math.max(1, Math.round(this.config.previewHeight || this.config.height));

    if (!this.ensureRetroGridRenderer(renderWidth, renderHeight)) {
      return false;
    }

    const gl = this.retroGridGl;
    const canvas = this.retroGridCanvas;
    const programInfo = this.retroGridProgramInfo;
    const positionBuffer = this.retroGridPositionBuffer;

    if (!gl || !canvas || !programInfo || !positionBuffer) {
      return false;
    }

    const viewportWidth = renderWidth;
    const viewportHeight = renderHeight;
    const lineColor = resolveRetroGridLineColor(accentColor, 0.72);

    gl.useProgram(programInfo.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(programInfo.attributeLocation);
    gl.vertexAttribPointer(programInfo.attributeLocation, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(programInfo.uniforms.angle, clamp(angleDeg, 1, 89));
    gl.uniform1f(programInfo.uniforms.cellSize, Math.max(getRetroGridCellSize(density), 1));
    gl.uniform2f(programInfo.uniforms.containerSize, renderWidth, renderHeight);
    gl.uniform1f(programInfo.uniforms.devicePixelRatio, 1);
    gl.uniform4fv(programInfo.uniforms.lineColor, lineColor);
    gl.uniform1f(programInfo.uniforms.time, timeMs / 1000);
    gl.uniform2f(programInfo.uniforms.viewportSize, viewportWidth, viewportHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    ctx.save();
    if (blurAmount > 0) {
      ctx.filter = `blur(${blurAmount}px)`;
    }
    ctx.fillStyle = backdropColor;
    ctx.fillRect(0, 0, this.config.width, this.config.height);
    ctx.drawImage(canvas, 0, 0, this.config.width, this.config.height);

    const fadeGradient = ctx.createLinearGradient(0, this.config.height, 0, 0);
    fadeGradient.addColorStop(0, 'rgba(0,0,0,1)');
    fadeGradient.addColorStop(0.9, 'rgba(0,0,0,0)');
    ctx.fillStyle = fadeGradient;
    ctx.fillRect(0, 0, this.config.width, this.config.height);
    ctx.restore();

    return true;
  }

  private drawRetroGridBackground(
    ctx: CanvasRenderingContext2D,
    timeMs: number,
    blurAmount = 0,
    backdropColor = DEFAULT_BACKGROUND_BACKDROP_COLOR,
    accentColor = DEFAULT_BACKGROUND_ACCENT_COLOR,
    angleDeg = DEFAULT_RETRO_GRID_ANGLE,
    density = DEFAULT_RETRO_GRID_DENSITY,
  ): void {
    if (this.drawRetroGridShaderBackground(ctx, timeMs, blurAmount, backdropColor, accentColor, angleDeg, density)) {
      return;
    }

    const width = this.config.width;
    const height = this.config.height;
    const cellSize = getRetroGridCellSize(density);
    const angleFactor = Math.min(1, Math.max(0, (angleDeg - 25) / 60));
    const horizonY = height * (0.48 - angleFactor * 0.18);
    const centerX = width / 2;
    const gridHeight = height * 3;
    const visibleGridHeight = Math.max(1, height - horizonY);
    const scrollSpeedPx = (gridHeight * 0.5) / 15;
    const scrollOffsetPx = ((timeMs / 1000) * scrollSpeedPx) % cellSize;
    const glowPulse = 0.9 + 0.1 * Math.sin((timeMs / 1000) * Math.PI * 2 * 0.2);

    ctx.save();
    if (blurAmount > 0) {
      ctx.filter = `blur(${blurAmount}px)`;
    }

    ctx.fillStyle = backdropColor;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 10 * glowPulse;

    const verticalLineCount = Math.max(10, Math.round((width / cellSize) * 0.9));
    const bottomSpread = width * 2.8;
    const horizonSpread = width * (0.12 + angleFactor * 0.14);

    for (let i = -verticalLineCount; i <= verticalLineCount; i += 1) {
      const t = i / verticalLineCount;
      ctx.beginPath();
      ctx.moveTo(centerX + t * horizonSpread, horizonY);
      ctx.lineTo(centerX + t * bottomSpread, height);
      ctx.stroke();
    }

    const horizontalLineCount = Math.max(12, Math.ceil(gridHeight / cellSize) + 2);
    for (let i = 0; i < horizontalLineCount; i += 1) {
      const planeY = i * cellSize + scrollOffsetPx;
      const depth = Math.max(0, Math.min(1, planeY / gridHeight));
      const eased = depth * depth;
      const y = horizonY + eased * visibleGridHeight;
      const halfWidth = eased * width * 2.9;
      ctx.beginPath();
      ctx.moveTo(centerX - halfWidth, y);
      ctx.lineTo(centerX + halfWidth, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawRippleBackground(
    ctx: CanvasRenderingContext2D,
    timeMs: number,
    blurAmount = 0,
    backdropColor = DEFAULT_BACKGROUND_BACKDROP_COLOR,
    accentColor = DEFAULT_BACKGROUND_ACCENT_COLOR,
    rippleSpeed = DEFAULT_RIPPLE_SPEED,
    rippleCount = DEFAULT_RIPPLE_COUNT,
  ): void {
    const width = this.config.width;
    const height = this.config.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseSize = Math.min(width, height) * 0.2;
    const circleGap = Math.min(width, height) * 0.065;
    const numCircles = rippleCount;
    const animationSeconds = getRippleAnimationDurationSeconds(rippleSpeed);
    const elapsedSeconds = timeMs / 1000;

    ctx.save();
    if (blurAmount > 0) {
      ctx.filter = `blur(${blurAmount}px)`;
    }

    ctx.fillStyle = backdropColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = accentColor;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 14;

    for (let i = 0; i < numCircles; i += 1) {
      const delayedSeconds = elapsedSeconds - i * 0.06;
      const cycle = ((delayedSeconds / animationSeconds) % 1 + 1) % 1;
      const eased = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);
      const scale = 1 - 0.1 * eased;
      const radius = ((baseSize + i * circleGap) * scale) / 2;
      const opacityStep = numCircles > 1 ? 0.18 / (numCircles - 1) : 0;
      const baseOpacity = Math.max(0.03, 0.24 - i * opacityStep);
      const opacity = baseOpacity * (0.85 + (1 - eased) * 0.15);
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.globalAlpha = opacity;
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawBackgroundFill(ctx: CanvasRenderingContext2D, value: string): void {
    if (value.startsWith('#')) {
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, this.config.width, this.config.height);
      return;
    }

    if (value.startsWith('linear-gradient') || value.startsWith('radial-gradient')) {
      const gradientMatch = value.match(/(linear|radial)-gradient\((.+)\)/);
      if (gradientMatch) {
        const [, type, params] = gradientMatch;
        const parts = params.split(',').map((part) => part.trim());
        let gradient: CanvasGradient;

        if (type === 'linear') {
          gradient = ctx.createLinearGradient(0, 0, 0, this.config.height);
          parts.forEach((part, index) => {
            if (part.startsWith('to ') || part.includes('deg')) {
              return;
            }
            const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
            if (colorMatch) {
              gradient.addColorStop(index / Math.max(1, parts.length - 1), colorMatch[1]);
            }
          });
        } else {
          const cx = this.config.width / 2;
          const cy = this.config.height / 2;
          const radius = Math.max(this.config.width, this.config.height) / 2;
          gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          parts.forEach((part, index) => {
            const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
            if (colorMatch) {
              gradient.addColorStop(index / Math.max(1, parts.length - 1), colorMatch[1]);
            }
          });
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.config.width, this.config.height);
        return;
      }
    }

    ctx.fillStyle = value || '#000000';
    ctx.fillRect(0, 0, this.config.width, this.config.height);
  }

  private drawBackgroundMedia(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    fit: 'cover' | 'contain',
    blurAmount = 0,
  ): void {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      return;
    }

    const sourceAspect = sourceWidth / sourceHeight;
    const canvasAspect = this.config.width / this.config.height;
    let drawWidth: number;
    let drawHeight: number;
    let drawX: number;
    let drawY: number;

    if (fit === 'contain') {
      if (sourceAspect > canvasAspect) {
        drawWidth = this.config.width;
        drawHeight = drawWidth / sourceAspect;
        drawX = 0;
        drawY = (this.config.height - drawHeight) / 2;
      } else {
        drawHeight = this.config.height;
        drawWidth = drawHeight * sourceAspect;
        drawX = (this.config.width - drawWidth) / 2;
        drawY = 0;
      }
    } else {
      if (sourceAspect > canvasAspect) {
        drawHeight = this.config.height;
        drawWidth = drawHeight * sourceAspect;
        drawX = (this.config.width - drawWidth) / 2;
        drawY = 0;
      } else {
        drawWidth = this.config.width;
        drawHeight = drawWidth / sourceAspect;
        drawX = 0;
        drawY = (this.config.height - drawHeight) / 2;
      }
    }

    ctx.save();
    if (blurAmount > 0) {
      ctx.filter = `blur(${blurAmount}px)`;
    }
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
  }

  private async getCachedBackgroundImage(source: string): Promise<HTMLImageElement> {
    const resolved = await this.resolveBackgroundSourceUrl(source);
    const cached = this.backgroundImageCache.get(resolved);
    if (cached) {
      return cached;
    }

    const image = new Image();
    if (
      typeof window !== 'undefined' &&
      resolved.startsWith('http') &&
      !resolved.startsWith(window.location.origin)
    ) {
      image.crossOrigin = 'anonymous';
    }

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Failed to load background image: ${resolved}`));
      image.src = resolved;
    });

    this.backgroundImageCache.set(resolved, image);
    return image;
  }

  private async getCachedBackgroundVideo(cacheKey: string, source: string): Promise<HTMLVideoElement> {
    const resolved = await this.resolveBackgroundSourceUrl(source);
    const key = `${cacheKey}:${resolved}`;
    const cached = this.backgroundVideoCache.get(key);
    if (cached) {
      return cached;
    }

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = resolved;

    await new Promise<void>((resolve, reject) => {
      const handleReady = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`Failed to load background video: ${resolved}`));
      };
      const cleanup = () => {
        video.removeEventListener('loadeddata', handleReady);
        video.removeEventListener('error', handleError);
      };
      video.addEventListener('loadeddata', handleReady);
      video.addEventListener('error', handleError);
      video.load();
    });

    this.backgroundVideoCache.set(key, video);
    return video;
  }

  private async seekBackgroundVideo(video: HTMLVideoElement, targetTimeSeconds: number): Promise<void> {
    if (!Number.isFinite(targetTimeSeconds)) {
      return;
    }

    if (Math.abs((video.currentTime || 0) - targetTimeSeconds) <= 0.033) {
      return;
    }

    await new Promise<void>((resolve) => {
      const handleSeeked = () => {
        video.removeEventListener('seeked', handleSeeked);
        resolve();
      };
      video.addEventListener('seeked', handleSeeked);
      try {
        video.currentTime = targetTimeSeconds;
      } catch {
        video.removeEventListener('seeked', handleSeeked);
        resolve();
      }
    });
  }

  private async renderBackgroundFrame(timeMs: number): Promise<void> {
    if (!this.backgroundSprite) {
      return;
    }

    const bgCanvas = this.backgroundSprite;
    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) {
      return;
    }

    bgCtx.clearRect(0, 0, this.config.width, this.config.height);
    bgCtx.fillStyle = '#000000';
    bgCtx.fillRect(0, 0, this.config.width, this.config.height);

    const activeItem = resolveActiveBackgroundItem(this.config.backgroundItems || [], Math.round(timeMs));
    const rawSource = getBackgroundItemSource(activeItem, this.config.videoAssets || []);
    const hasTimelineBackgrounds = (this.config.backgroundItems?.length ?? 0) > 0;
    const source = rawSource || (!hasTimelineBackgrounds ? this.config.wallpaper || DEFAULT_BACKGROUND_VALUE : null);
    const kind = activeItem?.kind === 'video' && rawSource
      ? 'video'
      : activeItem?.kind ?? inferBackgroundKindFromValue(source || DEFAULT_BACKGROUND_VALUE);
    const fit = activeItem?.fit ?? 'cover';
    const blurAmount = activeItem?.blurAmount ?? (!hasTimelineBackgrounds && this.config.showBlur ? 2 : 0);
    const backdropColor = activeItem?.backdropColor ?? DEFAULT_BACKGROUND_BACKDROP_COLOR;
    const accentColor = activeItem?.accentColor ?? DEFAULT_BACKGROUND_ACCENT_COLOR;
    const retroGridAngle = activeItem?.retroGridAngle ?? DEFAULT_RETRO_GRID_ANGLE;
    const retroGridDensity = activeItem?.retroGridDensity ?? DEFAULT_RETRO_GRID_DENSITY;
    const rippleSpeed = activeItem?.rippleSpeed ?? DEFAULT_RIPPLE_SPEED;
    const rippleCount = activeItem?.rippleCount ?? DEFAULT_RIPPLE_COUNT;
    const presetTimeMs = activeItem ? Math.max(0, timeMs - activeItem.startMs) : timeMs;

    if (!source) {
      return;
    }

    try {
      if (kind === 'video' && activeItem) {
        const video = await this.getCachedBackgroundVideo(activeItem.assetId || source, source);
        const assetDurationMs = activeItem.assetId
          ? this.config.videoAssets?.find((asset) => asset.id === activeItem.assetId)?.durationMs ?? 0
          : 0;
        const localTimelineMs = Math.max(0, timeMs - activeItem.startMs);
        const maxPlayableMs = assetDurationMs > 0
          ? Math.max(0, assetDurationMs - 16)
          : localTimelineMs;
        const targetTimeSeconds = Math.max(0, Math.min(localTimelineMs, maxPlayableMs)) / 1000;
        await this.seekBackgroundVideo(video, targetTimeSeconds);
        this.drawBackgroundMedia(bgCtx, video, video.videoWidth || this.config.width, video.videoHeight || this.config.height, fit, blurAmount);
        return;
      }

      if (kind === 'preset' && source === MAGICUI_RETRO_GRID_VALUE) {
        this.drawRetroGridBackground(bgCtx, presetTimeMs, blurAmount, backdropColor, accentColor, retroGridAngle, retroGridDensity);
        return;
      }

      if (kind === 'preset' && source === MAGICUI_RIPPLE_VALUE) {
        this.drawRippleBackground(bgCtx, presetTimeMs, blurAmount, backdropColor, accentColor, rippleSpeed, rippleCount);
        return;
      }

      if (kind === 'color' || kind === 'gradient' || source.startsWith('#') || source.startsWith('linear-gradient') || source.startsWith('radial-gradient')) {
        this.drawBackgroundFill(bgCtx, source);
        return;
      }

      const image = await this.getCachedBackgroundImage(source);
      this.drawBackgroundMedia(bgCtx, image, image.naturalWidth || image.width, image.naturalHeight || image.height, fit, blurAmount);
    } catch (error) {
      console.error('[FrameRenderer] Error rendering background frame, using fallback:', error);
      bgCtx.fillStyle = '#000000';
      bgCtx.fillRect(0, 0, this.config.width, this.config.height);
    }
  }

  async renderFrame(timestamp: number): Promise<void> {
    if (!this.app || !this.clipRenderer) {
      throw new Error('Renderer not initialized');
    }

    this.currentVideoTime = timestamp / 1000000;

    const timeMs = this.currentVideoTime * 1000;

    // Apply layout with current time for keyframe interpolation
    this.updateLayout(timeMs);
    await this.renderBackgroundFrame(timeMs);
    const effectState = computeEffectState(this.config.effectRegions || [], timeMs);
    const TICKS_PER_FRAME = 1;
    
    let maxMotionIntensity = 0;
    for (let i = 0; i < TICKS_PER_FRAME; i++) {
      const motionIntensity = this.updateAnimationState(timeMs);
      maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);
    }
    
    // Apply transform once with maximum motion intensity from all ticks
    this.clipRenderer.setCameraTransform({
      scale: this.animationState.scale,
      focusX: this.animationState.focusX,
      focusY: this.animationState.focusY,
    });
    this.applyRecordingBlur(maxMotionIntensity);
    this.applyScreenOffsetToRecording(this.animationState.scale);

    await this.clipRenderer.prepareFrame(timeMs);

    // Render the PixiJS stage to its canvas (video clips, transparent background)
    this.app.renderer.render(this.app.stage);

    // Composite with shadows to final output canvas
    await this.compositeWithShadows(effectState, timeMs);
  }

  private updateLayout(timeMs?: number): void {
    if (!this.app) return;

    const { width, height } = this.config;
    const { cropRegion, borderRadius = 0, padding: basePadding = 0, paddingKeyframes = [] } = this.config;
    // Interpolate padding from keyframes if available
    const padding = timeMs !== undefined && paddingKeyframes.length > 0
      ? interpolatePadding(paddingKeyframes, timeMs, basePadding)
      : basePadding;
    const videoWidth = this.config.videoWidth;
    const videoHeight = this.config.videoHeight;

    // Calculate cropped video dimensions
    const cropStartX = cropRegion.x;
    const cropStartY = cropRegion.y;
    const cropEndX = cropRegion.x + cropRegion.width;
    const cropEndY = cropRegion.y + cropRegion.height;

    const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
    const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);

    // Calculate scale to fit in viewport
    // Padding is a percentage (0-100), where 50% ~ 0.8 scale
    const paddingScale = 1.0 - (padding / 100) * 0.4;
    const viewportWidth = width * paddingScale;
    const viewportHeight = height * paddingScale;
    const scale = Math.min(viewportWidth / croppedVideoWidth, viewportHeight / croppedVideoHeight);

    const croppedDisplayWidth = croppedVideoWidth * scale;
    const croppedDisplayHeight = croppedVideoHeight * scale;
    const centerOffsetX = (width - croppedDisplayWidth) / 2;
    const centerOffsetY = (height - croppedDisplayHeight) / 2;

    // scale border radius by export/preview canvas ratio
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
    const scaledBorderRadius = borderRadius * canvasScaleFactor;

    if (this.clipRenderer) {
      this.clipRenderer.setStageSize({ width, height });
      this.clipRenderer.setRecordingLayout({
        cropRegion,
        padding,
        borderRadius: scaledBorderRadius,
        screenOffsetPx: this.screenOffsetPx,
      });
    }

    // Cache layout info
    this.layoutCache = {
      stageSize: { width, height },
      videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
      baseScale: scale,
      baseOffset: { x: centerOffsetX, y: centerOffsetY },
      maskRect: { x: 0, y: 0, width: croppedDisplayWidth, height: croppedDisplayHeight },
    };
  }

  private applyScreenOffsetToRecording(zoomScale: number): void {
    if (!this.clipRenderer) return;
    this.clipRenderer.applyScreenOffset(zoomScale);
  }

  setRecordingVideo(video: HTMLVideoElement): void {
    this.recordingVideo = video;
    this.recordingClipIds = this.getRecordingClipIds();
    if (!this.clipRenderer) return;
    this.clipRenderer.setExternalVideo(RECORDING_ASSET_ID, video, { allowSeek: false });
  }

  private getRecordingClipIds(): string[] {
    return (this.config.videoClips || [])
      .filter((clip) => clip.applyCamera || clip.assetId === RECORDING_ASSET_ID)
      .map((clip) => clip.id);
  }

  private applyRecordingBlur(motionIntensity: number): void {
    if (!this.blurFilter || !this.clipRenderer) return;
    const shouldBlur = (this.config.motionBlurEnabled ?? true) && motionIntensity > 0.0005;
    const motionBlur = shouldBlur ? Math.min(6, motionIntensity * 120) : 0;
    this.blurFilter.blur = motionBlur;

    const filters = motionBlur > 0 ? [this.blurFilter] : null;
    this.recordingClipIds.forEach((id) => {
      const item = this.clipRenderer?.getClipItem(id);
      if (item) {
        item.container.filters = filters;
      }
    });
  }

  private clampFocusToStage(focus: { cx: number; cy: number }, depth: number): { cx: number; cy: number } {
    if (!this.layoutCache) return focus;
    return clampFocusToStageUtil(focus, depth as any, this.layoutCache);
  }

  private computeEffectTransform(
    effectState: CombinedEffectState,
    w: number,
    h: number
  ): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const scale = effectState.scale ?? 1;
    const offsetX = effectState.offsetX ?? 0;
    const offsetY = effectState.offsetY ?? 0;
    const rollDeg = (effectState.roll ?? 0) * RAD_TO_DEG;
    const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
    const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);

    // Use DOMMatrix to mirror the preview transform as closely as possible
    if (typeof DOMMatrix !== 'undefined' && typeof DOMPoint !== 'undefined') {
      const matrix = new DOMMatrix();
      matrix.m34 = -1 / EFFECT_PERSPECTIVE;
      matrix.scaleSelf(scale, scale, 1);
      matrix.translateSelf(offsetX, offsetY, 0);
      // Match on-screen CSS transform order and orientation
      matrix.rotateSelf(rotXDeg, rotYDeg, rollDeg);

      const centerX = w / 2;
      const centerY = h / 2;

      const project = (x: number, y: number) => {
        const pt = new DOMPoint(x - centerX, y - centerY, 0, 1).matrixTransform(matrix);
        const wComp = pt.w || 1;
        return {
          x: pt.x / wComp + centerX,
          y: pt.y / wComp + centerY,
        };
      };

      const p0 = project(0, 0);
      const p1 = project(w, 0);
      const p2 = project(0, h);

      return {
        a: (p1.x - p0.x) / w,
        b: (p1.y - p0.y) / w,
        c: (p2.x - p0.x) / h,
        d: (p2.y - p0.y) / h,
        e: p0.x,
        f: p0.y,
      };
    }

    // Fallback affine approximation when DOMMatrix is unavailable
    const rollRad = effectState.roll ?? 0;
    const skewX = (rotXDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;
    const skewY = (rotYDeg * DEG_TO_RAD) * SKEW_TO_TILT_RATIO;

    const centerX = w / 2;
    const centerY = h / 2;

    const applyFallback = (x: number, y: number) => {
      // Translate to center
      let px = x - centerX;
      let py = y - centerY;

      // Apply scale then offset
      px *= scale;
      py *= scale;
      px += offsetX;
      py += offsetY;

      // Roll around Z axis
      if (rollRad !== 0) {
        const cosR = Math.cos(rollRad);
        const sinR = Math.sin(rollRad);
        const rx = px * cosR - py * sinR;
        const ry = px * sinR + py * cosR;
        px = rx;
        py = ry;
      }

      // Approximate perspective lean using skew (with corrected sign to match preview)
      const sx = px + skewX * py;
      const sy = py + skewY * px;

      return { x: sx + centerX, y: sy + centerY };
    };

    const f0 = applyFallback(0, 0);
    const f1 = applyFallback(w, 0);
    const f2 = applyFallback(0, h);

    return {
      a: (f1.x - f0.x) / w,
      b: (f1.y - f0.y) / w,
      c: (f2.x - f0.x) / h,
      d: (f2.y - f0.y) / h,
      e: f0.x,
      f: f0.y,
    };
  }

  private createProjectionFunction(
    effectState: CombinedEffectState,
    w: number,
    h: number
  ): ((x: number, y: number) => { x: number; y: number }) | null {
    if (typeof DOMMatrix === 'undefined' || typeof DOMPoint === 'undefined') {
      return null;
    }

    const scale = effectState.scale ?? 1;
    const offsetX = effectState.offsetX ?? 0;
    const offsetY = effectState.offsetY ?? 0;
    const rollDeg = (effectState.roll ?? 0) * RAD_TO_DEG;
    const rotXDeg = (effectState.tiltYDeg ?? ((effectState.skewY ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0;
    const rotYDeg = -((effectState.tiltXDeg ?? ((effectState.skewX ?? 0) * RAD_TO_DEG) / SKEW_TO_TILT_RATIO) || 0);

    const matrix = new DOMMatrix();
    matrix.m34 = -1 / EFFECT_PERSPECTIVE;
    matrix.scaleSelf(scale, scale, 1);
    matrix.translateSelf(offsetX, offsetY, 0);
    matrix.rotateSelf(rotXDeg, rotYDeg, rollDeg);

    const centerX = w / 2;
    const centerY = h / 2;

    return (x: number, y: number) => {
      const pt = new DOMPoint(x - centerX, y - centerY, 0, 1).matrixTransform(matrix);
      const wComp = pt.w || 1;
      return {
        x: pt.x / wComp + centerX,
        y: pt.y / wComp + centerY,
      };
    };
  }

  private computeAffineFromTriangles(
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    sx2: number,
    sy2: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number
  ): { a: number; b: number; c: number; d: number; e: number; f: number } | null {
    const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(det) < 1e-8) return null;

    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / det;
    const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / det;
    const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / det;
    const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / det;
    const e = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / det;
    const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / det;

    return { a, b, c, d, e, f };
  }

  private drawScreenWithPerspective(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    effectState: CombinedEffectState
  ): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } {
    const w = source.width;
    const h = source.height;
    const project = this.createProjectionFunction(effectState, w, h);

    if (!project) {
      const affine = this.computeEffectTransform(effectState, w, h);
      ctx.save();
      ctx.setTransform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
      return { canvas: ctx.canvas as HTMLCanvasElement, offsetX: 0, offsetY: 0 };
    }

    // Use a 2D grid of patches for proper perspective in both X and Y directions
    // Each grid point is projected using the full 3D matrix for accurate perspective
    // Minimal subdivisions to eliminate visible seam lines (8x6 grid = only 48 patches)
    const subdivisionsX = Math.max(8, Math.round(w / 160));
    const subdivisionsY = Math.max(6, Math.round(h / 160));
    const xCoords = new Array(subdivisionsX + 1);
    const yCoords = new Array(subdivisionsY + 1);
    for (let i = 0; i <= subdivisionsX; i++) {
      xCoords[i] = Math.round((i / subdivisionsX) * w);
    }
    for (let j = 0; j <= subdivisionsY; j++) {
      yCoords[j] = Math.round((j / subdivisionsY) * h);
    }
    xCoords[subdivisionsX] = w;
    yCoords[subdivisionsY] = h;
    const bleed = Math.min(3, Math.max(1, Math.round(Math.max(w, h) / 800)));
    const clipPad = Math.max(0.35, Math.min(1.25, bleed * 0.6));
    const pad = Math.ceil(Math.max(2, clipPad + bleed + 1));

    const projectedCorners = [project(0, 0), project(w, 0), project(0, h), project(w, h)];
    let minX = projectedCorners[0].x;
    let maxX = projectedCorners[0].x;
    let minY = projectedCorners[0].y;
    let maxY = projectedCorners[0].y;
    for (const pt of projectedCorners) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }

    const offsetX = -minX + pad;
    const offsetY = -minY + pad;
    const outWidth = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const outHeight = Math.max(1, Math.ceil(maxY - minY + pad * 2));

    const expandTriangle = (
      p0: { x: number; y: number },
      p1: { x: number; y: number },
      p2: { x: number; y: number }
    ) => {
      const cx = (p0.x + p1.x + p2.x) / 3;
      const cy = (p0.y + p1.y + p2.y) / 3;

      const expand = (p: { x: number; y: number }) => {
        const vx = p.x - cx;
        const vy = p.y - cy;
        const len = Math.hypot(vx, vy);
        if (len <= 0) return p;
        const scale = (len + clipPad) / len;
        return { x: cx + vx * scale, y: cy + vy * scale };
      };

      return [expand(p0), expand(p1), expand(p2)];
    };

    // Create an intermediate canvas to render perspective without transparency issues
    // This prevents grid seams from showing through when there's transparency on top
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = outWidth;
    tempCanvas.height = outHeight;
    const tempCtx = tempCanvas.getContext('2d')!;

    // Enable high-quality smoothing during patch rendering to maintain quality with zoom+perspective
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';

    for (let j = 0; j < subdivisionsY; j++) {
      for (let i = 0; i < subdivisionsX; i++) {
        const sx = xCoords[i];
        const sy = yCoords[j];
        const sx1 = xCoords[i + 1];
        const sy1 = yCoords[j + 1];
        const sw = sx1 - sx;
        const sh = sy1 - sy;
        if (sw <= 0 || sh <= 0) continue;

        // Project corners
        const tlRaw = project(sx, sy);
        const trRaw = project(sx1, sy);
        const blRaw = project(sx, sy1);
        const brRaw = project(sx1, sy1);
        const tl = { x: tlRaw.x + offsetX, y: tlRaw.y + offsetY };
        const tr = { x: trRaw.x + offsetX, y: trRaw.y + offsetY };
        const bl = { x: blRaw.x + offsetX, y: blRaw.y + offsetY };
        const br = { x: brRaw.x + offsetX, y: brRaw.y + offsetY };

        // Bleed source pixels to avoid seams while clipping to the projected patch.
        const padLeft = Math.min(bleed, sx);
        const padTop = Math.min(bleed, sy);
        const padRight = Math.min(bleed, w - sx1);
        const padBottom = Math.min(bleed, h - sy1);
        const sxPad = sx - padLeft;
        const syPad = sy - padTop;
        const swPad = sw + padLeft + padRight;
        const shPad = sh + padTop + padBottom;

        const drawTriangle = (
          sx0: number,
          sy0: number,
          sx1t: number,
          sy1t: number,
          sx2: number,
          sy2: number,
          d0: { x: number; y: number },
          d1: { x: number; y: number },
          d2: { x: number; y: number }
        ) => {
          const matrix = this.computeAffineFromTriangles(
            sx0,
            sy0,
            sx1t,
            sy1t,
            sx2,
            sy2,
            d0.x,
            d0.y,
            d1.x,
            d1.y,
            d2.x,
            d2.y
          );
          if (!matrix) return;

          const [p0, p1, p2] = expandTriangle(d0, d1, d2);
          tempCtx.save();
          tempCtx.setTransform(1, 0, 0, 1, 0, 0);
          tempCtx.beginPath();
          tempCtx.moveTo(p0.x, p0.y);
          tempCtx.lineTo(p1.x, p1.y);
          tempCtx.lineTo(p2.x, p2.y);
          tempCtx.closePath();
          tempCtx.clip();

          tempCtx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
          tempCtx.drawImage(source, sxPad, syPad, swPad, shPad, -padLeft, -padTop, swPad, shPad);
          tempCtx.restore();
        };

        drawTriangle(0, 0, sw, 0, 0, sh, tl, tr, bl);
        drawTriangle(sw, sh, sw, 0, 0, sh, br, tr, bl);
      }
    }

    return {
      canvas: tempCanvas,
      offsetX: minX - pad,
      offsetY: minY - pad,
    };
  }

  private updateAnimationState(timeMs: number): number {
    if (!this.layoutCache) return 0;

    const { region, strength } = findDominantRegion(this.config.zoomRegions, timeMs);
    
    const defaultFocus = DEFAULT_FOCUS;
    let targetScaleFactor = 1;
    let targetFocus = { ...defaultFocus };

    if (region && strength > 0) {
      const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
      const regionFocus = this.clampFocusToStage(region.focus, region.depth);
      
      targetScaleFactor = 1 + (zoomScale - 1) * strength;
      targetFocus = {
        cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
        cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
      };
    }

    const state = this.animationState;

    const prevScale = state.scale;
    const prevFocusX = state.focusX;
    const prevFocusY = state.focusY;

    const scaleDelta = targetScaleFactor - state.scale;
    const focusXDelta = targetFocus.cx - state.focusX;
    const focusYDelta = targetFocus.cy - state.focusY;

    let nextScale = prevScale;
    let nextFocusX = prevFocusX;
    let nextFocusY = prevFocusY;

    if (Math.abs(scaleDelta) > MIN_DELTA) {
      nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
    } else {
      nextScale = targetScaleFactor;
    }

    if (Math.abs(focusXDelta) > MIN_DELTA) {
      nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
    } else {
      nextFocusX = targetFocus.cx;
    }

    if (Math.abs(focusYDelta) > MIN_DELTA) {
      nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
    } else {
      nextFocusY = targetFocus.cy;
    }

    state.scale = nextScale;
    state.focusX = nextFocusX;
    state.focusY = nextFocusY;

    return Math.max(
      Math.abs(nextScale - prevScale),
      Math.abs(nextFocusX - prevFocusX),
      Math.abs(nextFocusY - prevFocusY)
    );
  }

  private async compositeWithShadows(effectState: CombinedEffectState, timeMs: number): Promise<void> {
    if (!this.compositeCanvas || !this.compositeCtx || !this.app || !this.screenCanvas || !this.screenCtx || !this.effectCanvas || !this.effectCtx) return;

    const videoCanvas = this.app.canvas as HTMLCanvasElement;
    const ctx = this.compositeCtx;
    const w = this.compositeCanvas.width;
    const h = this.compositeCanvas.height;

    // Calculate scale factor based on export vs preview dimensions for annotations
    const previewWidth = this.config.previewWidth || 1920;
    const previewHeight = this.config.previewHeight || 1080;
    const scaleX = this.config.width / previewWidth;
    const scaleY = this.config.height / previewHeight;
    const scaleFactor = (scaleX + scaleY) / 2;

    // Clear composite canvas
    ctx.clearRect(0, 0, w, h);
    
    // Enable high-quality smoothing for final composite
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw background layer (without effect transforms)
    if (this.backgroundSprite) {
      const bgCanvas = this.backgroundSprite;
      if (this.config.showBlur) {
        ctx.save();
        ctx.filter = 'blur(6px)';
        ctx.drawImage(bgCanvas, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(bgCanvas, 0, 0, w, h);
      }
    } else {
      console.warn('[FrameRenderer] No background sprite found during compositing!');
    }

    const screenCtx = this.screenCtx;
    screenCtx.clearRect(0, 0, w, h);
    
    // Enable high-quality smoothing for border radius and shadow rendering
    screenCtx.imageSmoothingEnabled = true;
    screenCtx.imageSmoothingQuality = 'high';

    // Midground annotations (between wallpaper and screen)
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0) {
      await renderAnnotations(
        screenCtx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor,
        'midground'
      );
    }

    // Draw video with optional shadow
    screenCtx.filter = 'none';
    screenCtx.drawImage(videoCanvas, 0, 0, w, h);
    screenCtx.filter = 'none';

    let finalScreen = this.screenCanvas;
    let finalScreenOffsetX = 0;
    let finalScreenOffsetY = 0;
    if (effectState.active) {
      const effectCtx = this.effectCtx;
      effectCtx.setTransform(1, 0, 0, 1, 0, 0);
      effectCtx.clearRect(0, 0, w, h);
      const effectResult = this.drawScreenWithPerspective(effectCtx, this.screenCanvas, effectState);
      finalScreen = effectResult.canvas;
      finalScreenOffsetX = effectResult.offsetX;
      finalScreenOffsetY = effectResult.offsetY;
    }

    const drawX = finalScreenOffsetX;
    const drawY = finalScreenOffsetY;

    if (this.config.showShadow && this.config.shadowIntensity > 0) {
      const intensity = this.config.shadowIntensity;
      const baseBlur1 = 48 * intensity;
      const baseBlur2 = 16 * intensity;
      const baseBlur3 = 8 * intensity;
      const baseAlpha1 = 0.7 * intensity;
      const baseAlpha2 = 0.5 * intensity;
      const baseAlpha3 = 0.3 * intensity;
      const baseOffset = 12 * intensity;
      ctx.save();
      ctx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset/3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset/6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
      ctx.drawImage(finalScreen, drawX, drawY);
      ctx.restore();
    } else {
      ctx.drawImage(finalScreen, drawX, drawY);
    }

    // Draw foreground annotations on composite canvas
    if (this.config.annotationRegions && this.config.annotationRegions.length > 0) {
      await renderAnnotations(
        ctx,
        this.config.annotationRegions,
        this.config.width,
        this.config.height,
        timeMs,
        scaleFactor,
        'foreground'
      );
    }
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.compositeCanvas) {
      throw new Error('Renderer not initialized');
    }
    return this.compositeCanvas;
  }


  destroy(): void {
    if (this.clipRenderer) {
      this.clipRenderer.destroy();
      this.clipRenderer = null;
    }
    this.backgroundSprite = null;
    if (this.app) {
      if (this.app.ticker) {
        this.app.ticker.stop();
      }
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
      this.app = null;
    }
    this.blurFilter = null;
    this.backgroundImageCache.clear();
    this.backgroundVideoCache.forEach((video) => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    });
    this.backgroundVideoCache.clear();
    this.destroyRetroGridRenderer();
    this.shadowCanvas = null;
    this.shadowCtx = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.screenCanvas = null;
    this.screenCtx = null;
    this.effectCanvas = null;
    this.effectCtx = null;
  }
}
