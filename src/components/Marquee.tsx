import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** One line of text that, when it doesn't fit, slides sideways to show the rest and back. */
export function Marquee({ text, className }: { text: string; className?: string }) {
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
    <span ref={outer} className={`marquee${overflow > 0 ? " moving" : ""}${className ? ` ${className}` : ""}`} title={text}>
      <span ref={inner} className="marquee-inner" style={style}>
        {text}
      </span>
    </span>
  );
}
