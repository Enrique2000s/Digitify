import { useEffect, useRef } from "react";
import { claimSticksForCursor, usePad, useSticks } from "../../lib/gamepad";

const CLICKABLE = "button, a, input, select, label, [data-bp-focus], [role=button], [role=tab], [role=slider], [role=checkbox]";

/**
 * The round pointer of Big Picture (D-025): the left stick moves it, the right stick scrolls what's
 * under it, A clicks. The mouse moves it too, replacing the system pointer inside the window. While
 * it's shown, the left stick moves only the cursor (it doesn't also step a selection).
 */
export function Cursor({ speed }: { speed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const lastHover = useRef<Element | null>(null);

  const place = (x: number, y: number) => {
    position.current = { x, y };
    if (ref.current) ref.current.style.transform = `translate(${x}px, ${y}px)`;
  };
  /** What the cursor is over hears about it (selection rings, controls that show on movement). */
  const hover = (fromStick: boolean) => {
    const { x, y } = position.current;
    const under = document.elementFromPoint(x, y);
    if (fromStick && under) under.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
    if (under === lastHover.current) return;
    lastHover.current = under;
    const target = under?.closest<HTMLElement>("[data-bp-focus]");
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  };

  useEffect(() => {
    const release = claimSticksForCursor();
    document.documentElement.classList.add("bp-cursor-on");
    // The mouse drives the same cursor.
    const onMouse = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      place(event.clientX, event.clientY);
      hover(false);
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    // Lets automated tests put the cursor somewhere without a controller.
    const w = window as unknown as { __digitifyCursor?: (x: number, y: number) => void };
    w.__digitifyCursor = (x, y) => {
      place(x, y);
      hover(true);
    };
    return () => {
      release();
      document.documentElement.classList.remove("bp-cursor-on");
      window.removeEventListener("mousemove", onMouse);
      delete w.__digitifyCursor;
    };
  }, []);

  useSticks((sticks, dt) => {
    if (sticks.lx || sticks.ly) {
      const p = position.current;
      place(Math.max(0, Math.min(window.innerWidth - 2, p.x + sticks.lx * speed * dt)), Math.max(0, Math.min(window.innerHeight - 2, p.y + sticks.ly * speed * dt)));
      hover(true);
    }
    if (sticks.rx || sticks.ry) {
      const p = position.current;
      let element = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      while (element && !(element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2)) element = element.parentElement;
      element?.scrollBy({ left: sticks.rx * 1600 * dt, top: sticks.ry * 1600 * dt, behavior: "instant" });
    }
  });

  usePad((action) => {
    if (action !== "accept") return;
    const { x, y } = position.current;
    const under = document.elementFromPoint(x, y);
    const target = under?.closest<HTMLElement>(CLICKABLE);
    if (target) {
      target.focus({ preventScroll: true });
      target.click();
    } else {
      // Anything else (a reader's page, the video) gets an ordinary click where the cursor is.
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        under?.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
      }
    }
    return true;
  });

  return <div ref={ref} className="bp-cursor" aria-hidden style={{ transform: `translate(${position.current.x}px, ${position.current.y}px)` }} />;
}
