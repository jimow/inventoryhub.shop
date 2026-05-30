"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Top-of-page progress bar that:
 *  1. Starts the instant the user clicks a same-origin <Link> or hits a button
 *     that calls router.push (we intercept document-level clicks).
 *  2. Climbs asymptotically toward 90% while the new route is fetching.
 *  3. Snaps to 100% and fades out once the pathname / search params change
 *     (i.e. the new server render has landed).
 */
export function NavProgress() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const key = pathname + "?" + sp.toString();
  const lastKey = useRef(key);

  const [progress, setProgress] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function start() {
    if (tickRef.current) clearInterval(tickRef.current);
    setProgress(8);
    let p = 8;
    tickRef.current = setInterval(() => {
      // Approach 90% but never reach it until the navigation actually finishes.
      p = Math.min(90, p + Math.max(0.5, (90 - p) * 0.08));
      setProgress(p);
    }, 150);
    // Safety net — never stay visible longer than 8s.
    setTimeout(() => { if (tickRef.current) clearInterval(tickRef.current); }, 8000);
  }

  function finish() {
    if (tickRef.current) clearInterval(tickRef.current);
    setProgress(100);
    setTimeout(() => setProgress(0), 350);
  }

  // Intercept clicks on internal links.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const a = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (a.target === "_blank") return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        // Same path + same hash = scrolly link, don't animate.
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch { return; }
      start();
    }
    function onPopState() { start(); }
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Snap to 100% when path changes.
  useEffect(() => {
    if (key !== lastKey.current) {
      lastKey.current = key;
      finish();
    }
  }, [key]);

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-[3px] pointer-events-none">
      <div
        className="h-full bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.6)]"
        style={{
          width: `${progress}%`,
          opacity: progress === 0 ? 0 : 1,
          transition: progress === 100
            ? "width 250ms ease-out, opacity 350ms ease-out 200ms"
            : "width 250ms ease-out, opacity 200ms",
        }}
      />
    </div>
  );
}
