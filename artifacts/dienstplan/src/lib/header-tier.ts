/**
 * Gemeinsame Sticky-Header-Tier-Logik für Dienstplan und Auswertungen.
 *
 * Exports:
 *  - HeaderTier          — Union-Typ der drei Layout-Stufen
 *  - useIsMobileViewport — reagiert auf (max-width: 639px)
 *  - useHeaderTier       — ResizeObserver-basierter labels→icons→stack-Algorithmus
 *
 * Beide Seiten (dienstplan.tsx, auswertungen.tsx) importieren von hier, damit
 * Bugfixes und Erweiterungen nur an einer Stelle gepflegt werden müssen.
 */

import { useLayoutEffect, useRef, useState } from "react";

export type HeaderTier = "labels" | "icons" | "stack";

const MOBILE_STACK_QUERY = "(max-width: 639px)";

export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_STACK_QUERY).matches : false,
  );
  useLayoutEffect(() => {
    const mql = window.matchMedia(MOBILE_STACK_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function useHeaderTier(
  contentKey: string,
  remeasureKey = "",
): { measureRef: React.RefObject<HTMLDivElement>; tier: HeaderTier } {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobileViewport();
  const [tier, setTier] = useState<HeaderTier>("labels");
  const tierRef = useRef<HeaderTier>(tier);
  tierRef.current = tier;
  const failedAt = useRef<{ labels: number; icons: number }>({ labels: 0, icons: 0 });

  useLayoutEffect(() => {
    failedAt.current = { labels: 0, icons: 0 };
    setTier("labels");
  }, [contentKey]);

  useLayoutEffect(() => {
    if (isMobile) return;
    const el = measureRef.current;
    if (!el) return;
    const check = () => {
      const t = tierRef.current;
      const width = el.clientWidth;
      if (width === 0) return;
      if (t !== "stack" && el.scrollWidth > width + 1) {
        failedAt.current[t] = Math.max(failedAt.current[t], width);
        setTier(t === "labels" ? "icons" : "stack");
        return;
      }
      if (t === "stack" && width > failedAt.current.icons + 48) {
        setTier("icons");
      } else if (
        t === "icons" &&
        failedAt.current.labels > 0 &&
        width > failedAt.current.labels + 48
      ) {
        setTier("labels");
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tier, contentKey, remeasureKey, isMobile]);

  return { measureRef: measureRef as React.RefObject<HTMLDivElement>, tier: isMobile ? ("stack" as const) : tier };
}
