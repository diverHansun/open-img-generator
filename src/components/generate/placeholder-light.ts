/**
 * Deterministic "random" light for waiting frames: each job id gets its own
 * palette, glow positions and tempo, stable across snapshots and SSR.
 */

const PALETTES = [
  { base: '#ebe5dd', colors: ['#d98470', '#78a99f', '#879fbe', '#e2bd7b'] },
  { base: '#e7e4ec', colors: ['#a99bd1', '#d79aa8', '#efc3a0', '#7f97b8'] },
  { base: '#e2e9ea', colors: ['#6fa6b8', '#9cc7c0', '#e6d3a8', '#8b8fc4'] },
  { base: '#e6e8df', colors: ['#8fae8b', '#c9b07a', '#6f9a9e', '#d7a48a'] },
  { base: '#e5e7eb', colors: ['#9aa7b8', '#c9a9a0', '#7d8da3', '#e3d6c8'] },
  { base: '#ede4de', colors: ['#d9876a', '#e8b46f', '#b97c8f', '#8a9ec2'] },
] as const;

function hash(text: string): number {
  // FNV-1a: well spread for short, similar ids such as job-a / job-b.
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function generator(seed: number) {
  let state = seed || 1;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeholderLight(id: string): Record<`--${string}`, string> {
  const random = generator(hash(id));
  const between = (min: number, max: number) => min + random() * (max - min);
  const palette = PALETTES[Math.floor(random() * PALETTES.length)]!;
  // Rotate the palette so the same family still lands in different corners.
  const shift = Math.floor(random() * palette.colors.length);
  const colors = palette.colors.map((_, i) => palette.colors[(i + shift) % palette.colors.length]!);
  const percent = (min: number, max: number) => `${between(min, max).toFixed(1)}%`;
  const seconds = (min: number, max: number) => `${between(min, max).toFixed(2)}s`;

  const drift = between(11, 15);
  const fold = between(14, 19);
  const halo = between(8, 11);
  const sheen = between(5.5, 7.5);

  return {
    '--light-base': palette.base,
    '--light-c1': colors[0]!,
    '--light-c2': colors[1]!,
    '--light-c3': colors[2]!,
    '--light-c4': colors[3]!,
    '--light-a-x': percent(15, 40),
    '--light-a-y': percent(18, 42),
    '--light-b-x': percent(60, 85),
    '--light-b-y': percent(15, 40),
    '--light-c-x': percent(55, 82),
    '--light-c-y': percent(60, 86),
    '--light-d-x': percent(16, 42),
    '--light-d-y': percent(58, 84),
    '--light-angle': `${Math.round(between(0, 360))}deg`,
    '--light-spin': `${Math.round(between(55, 95)) * (random() < 0.5 ? -1 : 1)}deg`,
    '--light-drift': `${drift.toFixed(2)}s`,
    '--light-fold': `${fold.toFixed(2)}s`,
    '--light-halo': `${halo.toFixed(2)}s`,
    '--light-sheen': `${sheen.toFixed(2)}s`,
    // Negative delays start each frame mid-motion instead of all at rest.
    '--light-drift-delay': `-${(random() * drift).toFixed(2)}s`,
    '--light-fold-delay': `-${(random() * fold).toFixed(2)}s`,
    '--light-halo-delay': `-${(random() * halo).toFixed(2)}s`,
    '--light-sheen-delay': seconds(-sheen, 0),
    '--light-sheen-tilt': `${Math.round(between(100, 130))}deg`,
    '--light-halo-direction': random() < 0.5 ? 'normal' : 'reverse',
  };
}
