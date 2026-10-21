'use client';

import * as React from 'react';

import {
  clampWorkbenchWidth,
  DEFAULT_WORKBENCH_WIDTH,
  readWorkbenchWidth,
  WORKBENCH_WIDTH_KEY,
  workbenchWidthBounds,
} from './workbench-layout';

/** Local layout preference only: never remount the editor or the live task. */
export function useWorkbenchResize() {
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const [preferredWidth, setPreferredWidth] = React.useState(DEFAULT_WORKBENCH_WIDTH);
  const preference = React.useRef(DEFAULT_WORKBENCH_WIDTH);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    originalPreference: number;
  } | null>(null);

  React.useEffect(() => {
    try {
      const restored = readWorkbenchWidth(localStorage.getItem(WORKBENCH_WIDTH_KEY));
      preference.current = restored;
      setPreferredWidth(restored);
    } catch {
      // Layout remains usable when storage is unavailable.
    }
    const element = layoutRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bounds = workbenchWidthBounds(containerWidth);
  const width = clampWorkbenchWidth(preferredWidth, containerWidth);

  const changeWidth = (next: number, persist: boolean) => {
    preference.current = next;
    setPreferredWidth(next);
    if (persist) {
      try {
        localStorage.setItem(WORKBENCH_WIDTH_KEY, String(next));
      } catch {
        // A denied or full store must not prevent resizing.
      }
    }
  };

  const finishDrag = (element: HTMLDivElement, cancelled: boolean) => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    setDragging(false);
    changeWidth(
      cancelled ? session.originalPreference : clampWorkbenchWidth(preference.current, containerWidth),
      !cancelled,
    );
    if (element.hasPointerCapture(session.pointerId)) {
      element.releasePointerCapture(session.pointerId);
    }
  };

  const separatorProps: React.HTMLAttributes<HTMLDivElement> = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical',
    'aria-valuemin': bounds.min,
    'aria-valuemax': Math.floor(bounds.max),
    'aria-valuenow': width,
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: width,
        originalPreference: preference.current,
      };
      setDragging(true);
    },
    onPointerMove(event) {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      changeWidth(clampWorkbenchWidth(session.startWidth + event.clientX - session.startX, containerWidth), false);
    },
    onPointerUp(event) {
      if (drag.current?.pointerId === event.pointerId) finishDrag(event.currentTarget, false);
    },
    onPointerCancel(event) {
      if (drag.current?.pointerId === event.pointerId) finishDrag(event.currentTarget, true);
    },
    onLostPointerCapture(event) {
      if (drag.current?.pointerId === event.pointerId) finishDrag(event.currentTarget, true);
    },
    onDoubleClick() {
      changeWidth(DEFAULT_WORKBENCH_WIDTH, true);
    },
    onKeyDown(event) {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        finishDrag(event.currentTarget, true);
        return;
      }
      if (drag.current) return;
      const step = event.shiftKey ? 64 : 16;
      let next: number;
      switch (event.key) {
        case 'ArrowLeft': next = width - step; break;
        case 'ArrowRight': next = width + step; break;
        case 'Home': next = bounds.min; break;
        case 'End': next = bounds.max; break;
        case 'Enter':
          event.preventDefault();
          changeWidth(DEFAULT_WORKBENCH_WIDTH, true);
          return;
        default: return;
      }
      event.preventDefault();
      changeWidth(clampWorkbenchWidth(next, containerWidth), true);
    },
  };

  return { layoutRef, width, dragging, separatorProps };
}
