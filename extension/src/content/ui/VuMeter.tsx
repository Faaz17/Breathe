import { useEffect, useRef } from 'react';

import { capture } from '../capture';

// Reads the live level every animation frame and writes the bar width directly
// to the DOM node — never via React state — so the meter stays smooth without
// re-rendering the panel (performance budget in design_rules.md).
export function VuMeter() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId = requestAnimationFrame(function paint() {
      const bar = barRef.current;
      if (bar) {
        bar.style.width = `${Math.round(capture.getLevel() * 100)}%`;
      }
      rafId = requestAnimationFrame(paint);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-zinc-800"
      role="presentation"
    >
      <div ref={barRef} className="h-full w-0 rounded-full bg-emerald-500" />
    </div>
  );
}
