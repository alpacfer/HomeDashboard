'use client';

import { useEffect, useState } from 'react';

// Whether the viewer asked for reduced motion. The accessibility path that
// scripts/screenshot.mjs exercises with --reduced-motion: the clock swaps its
// Tenant for a still resident, and a daily fact's clip is its poster only.
// Written once here; it was the same matchMedia effect in two components.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return reduced;
}
