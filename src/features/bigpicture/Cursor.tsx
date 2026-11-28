import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { claimSticksForCursor, usePad, useSticks } from "../../lib/gamepad";

const CLICKABLE = "button, a, input, select, label, [data-bp-focus], [role=button], [role=tab], [role=slider], [role=checkbox]";

/**
 * The round pointer of Big Picture (D-025): the left stick moves it, the right stick scrolls what's
 * under it, A clicks. The mouse moves it too, replacing the system pointer inside the window. While
 * it's shown, the left stick moves only the cursor (it doesn't also step a selection).
 *
 * `mouseOnly` (selection mode): the controller keeps its selection, and the round cursor is the
 * mouse's alone. It shows when the mouse moves and goes when a controller button is pressed.
 */
export function Cursor({ speed, autoHide = false, mouseOnly = false }: { speed: number; autoHide?: boolean; mouseOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Over a reader or the player, the cursor hides with the bars when it's left alone.
  const idle = useRef(0);
  const wake = () => {
    if (!autoHide) return;
    ref.current?.classList.remove("idle");
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => ref.current?.classList.add("idle"), 2600);
  };
  const position = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const lastHover = useRef<Element | null>(null);
  // Set while the cursor itself moves the selection, so that isn't taken for the controller's.
  const ownFocus = useRef(false);

  const place = (x: number, y: number) => {
    position.current = { x, y };
    if (ref.current) ref.current.style.transform = `translate(${x}px, ${y}px)`;
    wake();
  };
  /** What the cursor is over hears about it (selection rings, controls that show on movement). */
  const hover = (fromStick: boolean) => {
    const { x, y } = position.current;
    const under = document.elementFromPoint(x, y);
    if (fromStick && under) under.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
    if (under === lastHover.current) return;
    lastHover.current = under;
    const target = under?.closest<HTMLElement>("[data-bp-focus]");
    if (target && document.activeElement !== target) {
      ownFocus.current = true;
      target.focus({ preventScroll: true });
      ownFocus.current = false;
    }
  };

  // In selection mode the cursor is shown only while the mouse is in use.
  const show = (on: boolean) => {
    ref.current?.classList.toggle("hidden", !on);
    document.documentElement.classList.toggle("bp-cursor-on", on);
  };

  useEffect(() => {
    const release = mouseOnly ? () => {} : claimSticksForCursor();
    wake();
    show(!mouseOnly);
    // The mouse drives the same cursor.
    const onMouse = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      if (mouseOnly) show(true);
      place(event.clientX, event.clientY);
      hover(false);
    };
    window.addEventListener("mousemove", onMouse, { passive: true });
    // In selection mode, the selection moving any other way (the controller, the keyboard) puts the
    // mouse's cursor away.
    const onFocus = () => {
      if (mouseOnly && !ownFocus.current) show(false);
    };
    document.addEventListener("focusin", onFocus);
    // Lets automated tests put the cursor somewhere without a controller.
    const w = window as unknown as { __digitifyCursor?: (x: number, y: number) => void };
    w.__digitifyCursor = (x, y) => {
      place(x, y);
      hover(true);
    };
    return () => {
      release();
      window.clearTimeout(idle.current);
      document.documentElement.classList.remove("bp-cursor-on");
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("focusin", onFocus);
      delete w.__digitifyCursor;
    };
  }, []);

  useSticks((sticks, dt) => {
    if (mouseOnly) return;
    if (sticks.lx || sticks.ly) {
      const p = position.current;
      place(Math.max(0, Math.min(window.innerWidth - 2, p.x + sticks.lx * speed * dt)), Math.max(0, Math.min(window.innerHeight - 2, p.y + sticks.ly * speed * dt)));
      hover(true);
    }
    if (sticks.rx || sticks.ry) {
      // Up and down scroll what scrolls up and down under the cursor, sideways what scrolls sideways
      // (D-184): over a row of covers, up and down still scroll the page, not just the row (which
      // only scrolls sideways), and a clipped name or cover (overflow hidden) never takes it.
      const p = position.current;
      const under = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      const scroller = (axis: "x" | "y", amount: number) => {
        for (let e = under; e; e = e.parentElement) {
          const style = getComputedStyle(e);
          const overflow = axis === "y" ? style.overflowY : style.overflowX;
          if (overflow !== "auto" && overflow !== "scroll") continue;
          const room = axis === "y" ? (amount > 0 ? e.scrollHeight - e.clientHeight - e.scrollTop : e.scrollTop) : amount > 0 ? e.scrollWidth - e.clientWidth - e.scrollLeft : e.scrollLeft;
          if (room > 1) return e;
        }
        return null;
      };
      if (sticks.ry) scroller("y", sticks.ry)?.scrollBy({ top: sticks.ry * 1600 * dt, behavior: "instant" });
      if (sticks.rx) scroller("x", sticks.rx)?.scrollBy({ left: sticks.rx * 1600 * dt, behavior: "instant" });
    }
  });

  usePad((action) => {
    // With the selection in charge, a button hands back from the mouse to the selection.
    if (mouseOnly) {
      show(false);
      return;
    }
    // Any button brings a hidden cursor back, like the bars.
    wake();
    if (action !== "accept") return;
    const { x, y } = position.current;
    const under = document.elementFromPoint(x, y);
    const target = under?.closest<HTMLElement>(CLICKABLE);
    const press = (element: Element) => {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        const Event = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type.endsWith("down") ? 1 : 0, ...(type.startsWith("pointer") ? { pointerType: "mouse", pointerId: 1, isPrimary: true } : {}) }));
      }
    };
    if (target instanceof HTMLInputElement && target.type === "range") {
      // A slider (volume, a page): jump to where the cursor points.
      const r = target.getBoundingClientRect();
      const min = Number(target.min || 0);
      const max = Number(target.max || 100);
      const fraction = Math.min(1, Math.max(0, (x - r.left) / r.width));
      const value = target.dir === "rtl" ? max - fraction * (max - min) : min + fraction * (max - min);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(target, String(value));
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (target?.getAttribute("role") === "slider") {
      // Digitify's own sliders (the player's position bar) work from presses.
      press(target);
    } else if (target) {
      target.focus({ preventScroll: true });
      // Menus that open on a press (not a click) open too.
      press(target);
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

  // Drawn on top of everything, pop-ups included (menus, dialogs and panels open in their own
  // layer above the page, D-087).
  return createPortal(
    <div ref={ref} className={`bp-cursor${mouseOnly ? " hidden" : ""}`} aria-hidden style={{ transform: `translate(${position.current.x}px, ${position.current.y}px)` }} />,
    document.body,
  );
}
