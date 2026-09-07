'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { MotionClip } from '@/lib/tenant-motion';

// Play a three-track motion clip (body, head, sprout) on three nested SVG
// layers with the Web Animations API, and hand the layers back to neutral
// when the clip is withdrawn.
//
// The Tenant runs two of these at once, one for balance on a perch and one
// for posture during a gesture or a visit, and had the effect written out
// twice. The handoff is the part worth having once: when a clip ends or is
// replaced, each layer's live transform is snapshotted in the cleanup and the
// next run eases from that snapshot to neutral, so an interrupted teeter
// settles instead of snapping upright.
//
// `selectors` must be a module-level constant: it is a dependency, and a new
// array each render would restart the animation every frame.
export function useTrackAnimation(root: RefObject<HTMLElement | null>, selectors: readonly string[], clip: MotionClip | null | undefined, handoffMs: number) {
  const snapshot = useRef<string[]>([]);
  useLayoutEffect(() => {
    const element = root.current;
    const tracks = clip ? [clip.body, clip.head, clip.sprout] : null;
    const animations = selectors.map((selector, index) => {
      const target = element?.querySelector(selector);
      if (!target) return null;
      const frames = tracks?.[index] ?? [
        { offset: 0, transform: snapshot.current[index] ?? 'none' },
        { offset: 1, transform: 'translate(0px,0px) rotate(0deg) scale(1,1)' },
      ];
      return target.animate(frames, { duration: clip?.duration ?? handoffMs, fill: 'both' });
    });
    return () => {
      snapshot.current = selectors.map(selector => {
        const target = element?.querySelector(selector);
        return target ? getComputedStyle(target).transform : 'none';
      });
      animations.forEach(animation => animation?.cancel());
    };
  }, [root, selectors, clip, handoffMs]);
}
