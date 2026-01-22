export interface ChromaKeyColor {
  r: number;
  g: number;
  b: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export const parseHexColor = (hex: string): ChromaKeyColor => {
  const cleaned = hex.replace('#', '');
  const expanded = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;
  const intVal = parseInt(expanded, 16);
  if (Number.isNaN(intVal)) {
    return { r: 0, g: 255, b: 0 };
  }
  return {
    r: (intVal >> 16) & 0xff,
    g: (intVal >> 8) & 0xff,
    b: intVal & 0xff,
  };
};

export const applyChromaKeyToImageData = (
  data: Uint8ClampedArray,
  key: ChromaKeyColor,
  threshold: number,
  softness: number
) => {
  const t = clamp(threshold);
  const s = clamp(softness);
  const maxDist = Math.sqrt(255 * 255 * 3);

  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - key.r;
    const dg = data[i + 1] - key.g;
    const db = data[i + 2] - key.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / maxDist;

    let alpha = 1;
    if (dist <= t) {
      alpha = 0;
    } else if (s > 0) {
      alpha = clamp((dist - t) / s);
    }

    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
};
