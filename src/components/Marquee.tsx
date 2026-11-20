import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * One line of text that, when it doesn't fit, slides sideways to show the rest and back. `hover`
 * (D-150, for cards in grids): it ends in "…" and slides only while its card is pointed at, has the
 * keyboard, or is Big Picture's selection.
 */
export function Marquee({ text, className, hover = false }: { text: string; className?: string; hover?: boolean }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      setOverflow(Math.max(0, Math.ceil(inner.current.scrollWidth - outer.current.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    return () => observer.disconnect();
  }, [text]);
  // About 30 px a second, with pauses at both ends (see the keyframes).
  const style = overflow > 0 ? ({ "--shift": `-${overflow}px`, "--duration": `${Math.max(4, overflow / 30 + 3)}s` } as CSSProperties) : undefined;
  return (
    <span ref={outer} className={`marquee${overflow > 0 ? " moving" : ""}${hover ? " on-hover" : ""}${className ? ` ${className}` : ""}`} title={text}>
      <span ref={inner} className="marquee-inner" style={style}>
        {text}
      </span>
    </span>
  );
}
