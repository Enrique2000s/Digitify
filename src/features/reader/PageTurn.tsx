import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** A page as drawn on screen: its image and size in CSS pixels. */
export interface TurnPage {
  src: string;
  width: number;
  height: number;
}

/**
 * One page turn (D-021). `base` is what lies under the turning leaf, in screen order; the leaf
 * sits over `base[slot]` and turns around its `side` edge's opposite (the spine). A `reverse`
 * turn plays backwards: the leaf starts turned over and comes down onto the page.
 */
export interface Turn {
  base: TurnPage[];
  slot: number;
  /** Which side of the spine the leaf is on before it turns. */
  side: "left" | "right";
  front: TurnPage;
  /** The page printed on the back of the leaf, or plain paper. */
  back: TurnPage | null;
  reverse: boolean;
  /** Turned by dragging a corner rather than played. */
  dragged?: { corner: "top" | "bottom" };
  /** For a dragged turn: let go, to finish (true) or fall back (false). */
  release?: boolean;
}

/**
 * The turn from the pages on screen to the next ones. In two-page views the leaf is the page next
 * to the spine on the side being turned; with one page, the page itself turns around its inner edge.
 * Returns null when the two views can't be turned as a book (a wide page or the cover alone).
 */
export function buildTurn(before: TurnPage[], after: TurnPage[], forward: boolean, rtl: boolean): Turn | null {
  if (before.length === 2 && after.length === 2) {
    const right = forward !== rtl;
    return right
      ? { base: [before[0], after[1]], slot: 1, side: "right", front: before[1], back: after[0], reverse: false }
      : { base: [after[0], before[1]], slot: 0, side: "left", front: before[0], back: after[1], reverse: false };
  }
  if (before.length === 1 && after.length === 1) {
    const side = rtl ? "left" : "right";
    return forward
      ? { base: [after[0]], slot: 0, side, front: before[0], back: null, reverse: false }
      : { base: [before[0]], slot: 0, side, front: after[0], back: null, reverse: true };
  }
  return null;
}

const DURATION = 620;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

// ------------------------------------------------------------------ WebGL page curl

const VERTEX = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// The leaf rolls around a cylinder of radius uRadius whose axis passes through uAxis; uNormal points
// toward the rolled-up side. Each pixel takes the topmost layer of paper that covers it: the part
// turned over and lying flat, the top or bottom of the cylinder, or the leaf still flat on the page.
const FRAGMENT = `
precision highp float;
uniform vec2 uSize;
uniform float uDpr;
uniform vec4 uRect;
uniform vec2 uAxis;
uniform vec2 uNormal;
uniform float uRadius;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasBack;
const float PI = 3.14159265;

bool inside(vec2 p) {
  vec2 uv = (p - uRect.xy) / uRect.zw;
  return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0;
}
vec4 front(vec2 p, float shade) {
  vec2 uv = (p - uRect.xy) / uRect.zw;
  return vec4(texture2D(uFront, uv).rgb * shade, 1.0);
}
vec4 back(vec2 p, float shade) {
  vec2 uv = (p - uRect.xy) / uRect.zw;
  vec3 paper = uHasBack > 0.5 ? texture2D(uBack, vec2(1.0 - uv.x, uv.y)).rgb : vec3(0.93, 0.91, 0.87);
  return vec4(paper * shade, 1.0);
}
void main() {
  vec2 q = vec2(gl_FragCoord.x, uSize.y * uDpr - gl_FragCoord.y) / uDpr;
  float s = dot(q - uAxis, uNormal);
  float r = max(uRadius, 0.001);
  if (s < 0.0) {
    vec2 over = q + uNormal * (PI * r - 2.0 * s);
    if (inside(over)) { gl_FragColor = back(over, 0.94); return; }
    if (inside(q)) { gl_FragColor = front(q, 1.0); return; }
    gl_FragColor = vec4(0.0);
    return;
  }
  if (s <= r) {
    float high = PI - asin(s / r);
    vec2 top = q + uNormal * (high * r - s);
    if (inside(top)) { gl_FragColor = back(top, 0.72 + 0.28 * sin(high)); return; }
    float low = asin(s / r);
    vec2 bottom = q + uNormal * (low * r - s);
    if (inside(bottom)) { gl_FragColor = front(bottom, 1.0 - 0.38 * (1.0 - cos(low))); return; }
  }
  if (inside(q)) {
    float alpha = 0.34 * (1.0 - clamp((s - r) / 46.0, 0.0, 1.0));
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }
  gl_FragColor = vec4(0.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
  return shader;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous"; // the page server allows it, so WebGL may read the pixels
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });
}

function texture(gl: WebGLRenderingContext, unit: number, image: HTMLImageElement | null) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [name, value] of [
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
  ]) {
    gl.texParameteri(gl.TEXTURE_2D, name, value);
  }
  if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([237, 232, 222, 255]));
}

/** Where the leaf's free corner is at progress `t` (0 = flat, 1 = turned over onto the other side). */
function cornerAt(rect: DOMRect, side: "left" | "right", corner: "top" | "bottom", t: number) {
  const startX = side === "right" ? rect.right : rect.left;
  const endX = side === "right" ? rect.left - rect.width : rect.right + rect.width;
  const y = corner === "bottom" ? rect.bottom : rect.top;
  const lift = Math.sin(Math.PI * t) * rect.height * 0.12 * (corner === "bottom" ? -1 : 1);
  return { x: startX + (endX - startX) * t, y: y + lift };
}

function Curl({ turn, slot, stage, dragPoint, onDone, onFail }: {
  turn: Turn;
  slot: React.RefObject<HTMLDivElement | null>;
  stage: HTMLElement;
  dragPoint: React.RefObject<{ x: number; y: number } | null>;
  onDone: (finished: boolean) => void;
  onFail: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef(turn.reverse ? 1 : 0);
  const release = useRef(turn.release);
  release.current = turn.release;

  useEffect(() => {
    const element = canvas.current;
    const gl = element?.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!element || !gl) {
      onFail();
      return;
    }
    let frame = 0;
    let cancelled = false;
    const corner = turn.dragged?.corner ?? "bottom";
    Promise.all([loadImage(turn.front.src), turn.back ? loadImage(turn.back.src) : Promise.resolve(null)])
      .then(([frontImage, backImage]) => {
        if (cancelled) return;
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program failed");
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "aPos");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        texture(gl, 0, frontImage);
        texture(gl, 1, backImage);
        const uniform = (name: string) => gl.getUniformLocation(program, name);
        gl.uniform1i(uniform("uFront"), 0);
        gl.uniform1i(uniform("uBack"), 1);
        gl.uniform1f(uniform("uHasBack"), backImage ? 1 : 0);

        let last = performance.now();
        const draw = (now: number) => {
          const dt = Math.min(64, now - last);
          last = now;
          const box = stage.getBoundingClientRect();
          const leaf = slot.current?.getBoundingClientRect();
          if (!leaf) return;
          const rect = new DOMRect(leaf.left - box.left, leaf.top - box.top, leaf.width, leaf.height);
          const dpr = window.devicePixelRatio || 1;
          if (element.width !== Math.round(box.width * dpr) || element.height !== Math.round(box.height * dpr)) {
            element.width = Math.round(box.width * dpr);
            element.height = Math.round(box.height * dpr);
          }
          gl.viewport(0, 0, element.width, element.height);

          // Played turns follow the clock; dragged ones follow the pointer until let go.
          let point;
          const pointer = dragPoint.current;
          if (turn.dragged && release.current === undefined && pointer) {
            point = { x: pointer.x - box.left, y: pointer.y - box.top };
            const start = cornerAt(rect, turn.side, corner, 0).x;
            progress.current = Math.max(0, Math.min(1, Math.abs(point.x - start) / (2 * rect.width)));
          } else {
            const target = turn.dragged ? (release.current ? 1 : 0) : turn.reverse ? 0 : 1;
            const step = dt / DURATION;
            progress.current = target > progress.current ? Math.min(target, progress.current + step) : Math.max(target, progress.current - step);
            point = cornerAt(rect, turn.side, corner, turn.dragged ? progress.current : easeInOut(progress.current));
            if (progress.current === target) {
              onDone(target === 1 || (turn.reverse && !turn.dragged));
              return;
            }
          }
          const t = progress.current;
          const start = cornerAt(rect, turn.side, corner, 0);
          const dx = start.x - point.x;
          const dy = start.y - point.y;
          const length = Math.hypot(dx, dy) || 0.0001;
          gl.uniform2f(uniform("uSize"), box.width, box.height);
          gl.uniform1f(uniform("uDpr"), dpr);
          gl.uniform4f(uniform("uRect"), rect.x, rect.y, rect.width, rect.height);
          gl.uniform2f(uniform("uAxis"), (start.x + point.x) / 2, (start.y + point.y) / 2);
          gl.uniform2f(uniform("uNormal"), dx / length, dy / length);
          gl.uniform1f(uniform("uRadius"), rect.width * 0.09 * (1 - t) + 0.5);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
      })
      .catch((error) => {
        console.warn("page curl unavailable", error);
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [turn.front.src, turn.back?.src]);

  return <canvas ref={canvas} className="page-curl" />;
}

/**
 * Draws a page turn over the reader's stage: the pages underneath, and the leaf turning in 3D
 * ("turn") or curling (WebGL, "curl"). Falls back to the 3D turn if WebGL can't draw the pages.
 */
export function PageTurnLayer({ turn, effect, stage, dragPoint, onDone }: {
  turn: Turn;
  effect: "turn" | "curl";
  stage: HTMLElement | null;
  dragPoint: React.RefObject<{ x: number; y: number } | null>;
  /** Called once the leaf has landed; `finished` is false when a dragged turn fell back. */
  onDone: (finished: boolean) => void;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(effect);
  const done = useRef(false);
  const finish = (finished: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(finished);
  };
  // A dragged turn can't fall back to CSS mid-drag; it simply completes.
  useLayoutEffect(() => {
    if (mode === "turn" && turn.dragged && turn.release === undefined) finish(true);
  }, [mode]);

  const height = Math.max(...turn.base.map((page) => page.height), turn.front.height);
  const offsets = turn.base.map((_, index) => turn.base.slice(0, index).reduce((sum, page) => sum + page.width, 0));
  const leafStyle: CSSProperties = {
    left: offsets[turn.slot],
    width: turn.front.width,
    height: turn.front.height,
    top: (height - turn.front.height) / 2,
    transformOrigin: turn.side === "right" ? "left center" : "right center",
  };
  const width = turn.base.reduce((sum, page) => sum + page.width, 0);
  return (
    <div className="page-turn" aria-hidden>
      <div className="page-turn-book" style={{ width, height }}>
        {turn.base.map((page, index) => (
          <img key={index} className="reader-page" src={page.src} alt="" style={{ left: offsets[index], width: page.width, height: page.height, top: (height - page.height) / 2 }} />
        ))}
        <div
          ref={slot}
          className={`page-leaf${mode === "turn" ? ` turning-${turn.side}${turn.reverse ? " reverse" : ""}` : " measuring"}`}
          style={leafStyle}
          onAnimationEnd={() => finish(true)}
        >
          {mode === "turn" && (
            <>
              <img className="leaf-face reader-page" src={turn.front.src} alt="" />
              {turn.back ? <img className="leaf-face leaf-back reader-page" src={turn.back.src} alt="" /> : <div className="leaf-face leaf-back blank" />}
            </>
          )}
        </div>
      </div>
      {mode === "curl" && stage && <Curl turn={turn} slot={slot} stage={stage} dragPoint={dragPoint} onDone={finish} onFail={() => setMode("turn")} />}
    </div>
  );
}
