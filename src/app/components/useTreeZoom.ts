'use client';

import { useEffect, useRef, useCallback, type RefObject } from 'react';
import { select } from 'd3-selection';
import 'd3-transition'; // augments selections with .transition()
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Pan/zoom for the family tree, backed by d3-zoom.
 *
 * Why d3 and not the hand-rolled version it replaces: the transform is written
 * IMPERATIVELY to the content node (no React state, so panning/pinching never
 * re-renders the whole tree), and d3 owns the gesture handling — cursor-anchored
 * wheel zoom, trackpad pinch (ctrl+wheel), native two-finger touch pinch,
 * double-tap/double-click zoom, and tap-vs-drag (`clickDistance`, so a tap still
 * opens a card while a drag pans, even when it starts on a card). There is NO CSS
 * transition on the transform — live gestures are 1:1 with the input; only the
 * programmatic focus/fit moves animate, via d3 transitions.
 */
export function useTreeZoom({
  viewportRef,
  contentRef,
  scaleLabelRef,
  minScale = 0.25,
  maxScale = 2.5,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  scaleLabelRef?: RefObject<HTMLElement | null>;
  minScale?: number;
  maxScale?: number;
}) {
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);

  useEffect(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;

    const z = d3zoom<HTMLDivElement, unknown>()
      .scaleExtent([minScale, maxScale])
      // Always bind touch handlers. d3's default sniffs `ontouchstart`, which is
      // absent on some hybrid/desktop-touch setups — forcing it on guarantees
      // two-finger pinch works wherever touch input exists.
      .touchable(() => true)
      .clickDistance(6) // <6px of travel still counts as a click → card taps survive
      .on('zoom', (e) => {
        const { x, y, k } = e.transform;
        // transform.toString() omits px units (invalid for CSS), so build it here.
        content.style.transform = `translate(${x}px,${y}px) scale(${k})`;
        if (scaleLabelRef?.current) scaleLabelRef.current.textContent = `${Math.round(k * 100)}%`;
      });

    const sel = select(vp);
    sel.call(z);
    zoomRef.current = z;

    return () => {
      sel.on('.zoom', null); // remove every listener d3 installed
      zoomRef.current = null;
    };
  }, [viewportRef, contentRef, scaleLabelRef, minScale, maxScale]);

  /** Smoothly bring a world-space bounding box into view, centred and capped. */
  const focusBox = useCallback(
    (
      minX: number,
      minY: number,
      maxX: number,
      maxY: number,
      opts?: { maxScale?: number; animate?: boolean },
    ) => {
      const vp = viewportRef.current;
      const z = zoomRef.current;
      if (!vp || !z) return;
      const capScale = opts?.maxScale ?? 1.15;
      const animate = opts?.animate ?? true;
      const pad = 56;
      const W = vp.clientWidth;
      const H = vp.clientHeight;
      const bw = maxX - minX + pad * 2;
      const bh = maxY - minY + pad * 2;
      const k = clamp(Math.min(W / bw, H / bh), minScale, capScale);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const t = zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy);
      const sel = select(vp);
      if (animate) sel.transition().duration(450).call(z.transform, t);
      else sel.call(z.transform, t);
    },
    [viewportRef, minScale],
  );

  /** Fit the whole laid-out tree (width × height world units) on screen. */
  const fitAll = useCallback(
    (width: number, height: number, opts?: { animate?: boolean }) =>
      focusBox(0, 0, width, height, { maxScale: 1, animate: opts?.animate ?? true }),
    [focusBox],
  );

  /** Toolbar +/− : zoom around the viewport centre by `factor`, animated. */
  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      const z = zoomRef.current;
      if (!vp || !z) return;
      select(vp).transition().duration(200).call(z.scaleBy, factor);
    },
    [viewportRef],
  );

  return { focusBox, fitAll, zoomBy };
}
