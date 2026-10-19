export const WORKBENCH_WIDTH_KEY = 'oig:workbench-width';
export const DEFAULT_WORKBENCH_WIDTH = 356;
export const MIN_WORKBENCH_WIDTH = 300;
export const MAX_WORKBENCH_WIDTH = 640;
export const MIN_STAGE_WIDTH = 360;
export const WORKBENCH_GUTTER = 18;

export function workbenchWidthBounds(containerWidth: number) {
  return {
    min: MIN_WORKBENCH_WIDTH,
    max: Number.isFinite(containerWidth) && containerWidth > 0
      ? Math.max(
          MIN_WORKBENCH_WIDTH,
          Math.min(MAX_WORKBENCH_WIDTH, Math.floor(containerWidth - MIN_STAGE_WIDTH - WORKBENCH_GUTTER)),
        )
      : MAX_WORKBENCH_WIDTH,
  };
}

export function clampWorkbenchWidth(width: number, containerWidth = 0): number {
  const { min, max } = workbenchWidthBounds(containerWidth);
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_WORKBENCH_WIDTH;
  return Math.round(Math.max(min, Math.min(max, safeWidth)));
}

export function readWorkbenchWidth(stored: string | null): number {
  if (stored === null || stored.trim() === '') return DEFAULT_WORKBENCH_WIDTH;
  return clampWorkbenchWidth(Number(stored));
}
