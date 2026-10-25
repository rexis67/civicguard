import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TARGET_SELECTOR = "a:not(.no-cursor-snap), button:not(.no-cursor-snap), .cursor-target";
const REST_POSITIONS = {
  tl: { x: -18, y: -18 },
  tr: { x: 6, y: -18 },
  br: { x: 6, y: 6 },
  bl: { x: -18, y: 6 },
};
const BRACKET_KEYS = Object.keys(REST_POSITIONS);
const BRACKET_SIZE = 12;
const OUTSET = 3;
const EDGE_GUTTER = 30;

// hit-testing forces layout, so keep it well below one call per frame
const HIT_TEST_INTERVAL_MS = 80;
const RECT_REFRESH_MS = 120;
const IDLE_TEST_DELAY_MS = 140;
const SCROLL_WINDOW_MS = 160;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

function findTargetAtPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  return hit instanceof Element ? hit.closest(TARGET_SELECTOR) : null;
}

export default function TargetCursor() {
  const [enabled, setEnabled] = useState(false);
  const wrapperRef = useRef(null);
  const dotRef = useRef(null);
  const bracketRefs = useRef({});

  useEffect(() => {
    const smallScreen = window.matchMedia("(max-width: 768px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const updateAvailability = () => {
      setEnabled(!isTouchDevice() && !smallScreen.matches && !reducedMotion.matches);
    };

    updateAvailability();
    smallScreen.addEventListener("change", updateAvailability);
    reducedMotion.addEventListener("change", updateAvailability);
    window.addEventListener("resize", updateAvailability, { passive: true });

    return () => {
      smallScreen.removeEventListener("change", updateAvailability);
      reducedMotion.removeEventListener("change", updateAvailability);
      window.removeEventListener("resize", updateAvailability);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const wrapper = wrapperRef.current;
    const dot = dotRef.current;
    if (!wrapper || !dot) return undefined;

    const brackets = bracketRefs.current;
    if (BRACKET_KEYS.some((key) => !brackets[key])) return undefined;

    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;

    let pointerX = viewportWidth / 2;
    let pointerY = viewportHeight / 2;
    let lastMoveAt = 0;

    let targetElement = null;
    let targetRect = null;
    let lockedPositions = null;
    let strength = 0;
    let strengthTarget = 0;
    let rotation = 0;
    let scale = 1;
    let scaleTarget = 1;
    let dotScale = 1;
    let dotScaleTarget = 1;

    let visible = false;
    let bodyCursorHidden = false;
    let needsHitTest = false;
    let idleTested = true;
    let lastHitTest = 0;
    let lastRectRefresh = 0;
    let scrollUntil = 0;

    let frameHandle = 0;
    let lastFrame = performance.now();
    const lastBracketTransforms = {};

    const setVisible = (next) => {
      if (visible === next) return;
      visible = next;
      wrapper.style.opacity = next ? "1" : "0";
      wrapper.style.visibility = next ? "visible" : "hidden";
      if (bodyCursorHidden !== next) {
        bodyCursorHidden = next;
        document.body.classList.toggle("has-cursor", next);
      }
    };

    const startLoop = () => {
      if (frameHandle) return;
      lastFrame = performance.now();
      frameHandle = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (!frameHandle) return;
      cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    };

    function hitTest(now) {
      lastHitTest = now;
      needsHitTest = false;

      const found = findTargetAtPoint(pointerX, pointerY);
      if (found === targetElement) return;

      if (found) {
        targetElement = found;
        targetRect = found.getBoundingClientRect();
        strengthTarget = 1;
        lastRectRefresh = now;
      } else {
        targetElement = null;
        targetRect = null;
        strengthTarget = 0;
      }
    }

    function refreshTargetRect(now) {
      if (!targetElement) return;

      if (!targetElement.isConnected) {
        targetElement = null;
        targetRect = null;
        lockedPositions = null;
        strengthTarget = 0;
        return;
      }

      targetRect = targetElement.getBoundingClientRect();
      lastRectRefresh = now;
    }

    function tick(now) {
      const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      if (needsHitTest && now - lastHitTest >= HIT_TEST_INTERVAL_MS) hitTest(now);
      if (!idleTested && now - lastMoveAt >= IDLE_TEST_DELAY_MS) {
        hitTest(now);
        idleTested = true;
      }

      const scrolling = now < scrollUntil;
      if (targetElement && (scrolling || now - lastRectRefresh >= RECT_REFRESH_MS)) {
        refreshTargetRect(now);
      }

      const strengthEase = 1 - Math.exp(-deltaSeconds * 22);
      const rotationEase = 1 - Math.exp(-deltaSeconds * 14);
      const scaleEase = 1 - Math.exp(-deltaSeconds * 18);

      strength += (strengthTarget - strength) * strengthEase;
      if (Math.abs(strengthTarget - strength) < 0.002) strength = strengthTarget;

      scale += (scaleTarget - scale) * scaleEase;
      dotScale += (dotScaleTarget - dotScale) * scaleEase;

      if (targetElement) {
        // Unwind the idle spin so the brackets line up with the element edges.
        let normalized = rotation % 360;
        if (normalized > 180) normalized -= 360;
        rotation = normalized * (1 - rotationEase);
        if (Math.abs(rotation) < 0.05) rotation = 0;
      } else {
        rotation = (rotation + deltaSeconds * 180) % 360;
      }

      // Position is applied 1:1 with the pointer: any easing here reads as input lag.
      const renderX = clamp(pointerX, EDGE_GUTTER, viewportWidth - EDGE_GUTTER);
      const renderY = clamp(pointerY, EDGE_GUTTER, viewportHeight - EDGE_GUTTER);

      wrapper.style.transform =
        `translate3d(${renderX.toFixed(2)}px, ${renderY.toFixed(2)}px, 0) ` +
        `rotate(${rotation.toFixed(2)}deg) scale(${scale.toFixed(3)})`;

      const dotTransform = `scale(${dotScale.toFixed(3)})`;
      if (dot.style.transform !== dotTransform) dot.style.transform = dotTransform;

      if (targetElement && targetRect) {
        const left = targetRect.left - OUTSET;
        const top = targetRect.top - OUTSET;
        const right = targetRect.right + OUTSET - BRACKET_SIZE;
        const bottom = targetRect.bottom + OUTSET - BRACKET_SIZE;
        const parallaxX = (renderX - (targetRect.left + targetRect.width / 2)) * 0.2;
        const parallaxY = (renderY - (targetRect.top + targetRect.height / 2)) * 0.2;
        const maxX = Math.max(0, viewportWidth - BRACKET_SIZE);
        const maxY = Math.max(0, viewportHeight - BRACKET_SIZE);

        lockedPositions = {
          tl: {
            x: clamp(left + parallaxX, 0, maxX) - renderX,
            y: clamp(top + parallaxY, 0, maxY) - renderY,
          },
          tr: {
            x: clamp(right + parallaxX, 0, maxX) - renderX,
            y: clamp(top + parallaxY, 0, maxY) - renderY,
          },
          br: {
            x: clamp(right + parallaxX, 0, maxX) - renderX,
            y: clamp(bottom + parallaxY, 0, maxY) - renderY,
          },
          bl: {
            x: clamp(left + parallaxX, 0, maxX) - renderX,
            y: clamp(bottom + parallaxY, 0, maxY) - renderY,
          },
        };
      }

      for (const key of BRACKET_KEYS) {
        const rest = REST_POSITIONS[key];
        const destination = lockedPositions?.[key];

        const x = destination ? rest.x + (destination.x - rest.x) * strength : rest.x;
        const y = destination ? rest.y + (destination.y - rest.y) * strength : rest.y;
        const transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;

        if (lastBracketTransforms[key] !== transform) {
          lastBracketTransforms[key] = transform;
          brackets[key].style.transform = transform;
        }
      }

      frameHandle = visible ? requestAnimationFrame(tick) : 0;
    }

    function handlePointerMove(event) {
      if (event.pointerType === "touch") return;

      pointerX = event.clientX;
      pointerY = event.clientY;
      lastMoveAt = performance.now();
      idleTested = false;
      needsHitTest = true;

      if (!visible) {
        setVisible(true);
        startLoop();
      }
    }

    function handlePointerDown(event) {
      if (event.pointerType === "touch") return;
      scaleTarget = 0.9;
      dotScaleTarget = 0.7;
      needsHitTest = true;
    }

    function handlePointerUp() {
      scaleTarget = 1;
      dotScaleTarget = 1;
    }

    function handleScroll() {
      scrollUntil = performance.now() + SCROLL_WINDOW_MS;
      needsHitTest = true;
      idleTested = false;
    }

    function handleResize() {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      scrollUntil = performance.now() + SCROLL_WINDOW_MS;
      needsHitTest = true;
      idleTested = false;
    }

    function hideCursor() {
      if (!visible) return;

      setVisible(false);
      stopLoop();
      targetElement = null;
      targetRect = null;
      lockedPositions = null;
      strength = 0;
      strengthTarget = 0;
      scale = 1;
      scaleTarget = 1;
      dotScale = 1;
      dotScaleTarget = 1;
      rotation = 0;
    }

    function handleWindowLeave(event) {
      if (event.relatedTarget === null) hideCursor();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") hideCursor();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerover", handlePointerMove, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("pointercancel", handlePointerUp, { passive: true });
    window.addEventListener("pointerleave", handleWindowLeave);
    window.addEventListener("blur", hideCursor);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    window.addEventListener("resize", handleResize, { passive: true });
    document.addEventListener("pointerout", handleWindowLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerover", handlePointerMove);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("pointerleave", handleWindowLeave);
      window.removeEventListener("blur", hideCursor);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("pointerout", handleWindowLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.body.classList.remove("has-cursor");
    };
  }, [enabled]);

  if (!enabled) return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="target-cursor-wrapper"
      ref={wrapperRef}
      style={{ opacity: 0, visibility: "hidden" }}
    >
      <span className="target-cursor-dot" ref={dotRef} />
      {BRACKET_KEYS.map((key) => (
        <span
          className={`target-cursor-bracket target-cursor-bracket-${key}`}
          key={key}
          ref={(node) => {
            bracketRefs.current[key] = node;
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
