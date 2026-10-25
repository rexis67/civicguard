import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";

const TARGET_SELECTOR = "a:not(.no-cursor-snap), button:not(.no-cursor-snap), .cursor-target";
const REST_POSITIONS = {
  tl: { x: -18, y: -18 },
  tr: { x: 6, y: -18 },
  br: { x: 6, y: 6 },
  bl: { x: -18, y: 6 },
};
const BRACKET_SIZE = 12;
const OUTSET = 3;
const EDGE_GUTTER = 30;

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
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let rawPointerX = pointerX;
    let rawPointerY = pointerY;
    let lockedTarget = null;
    let rotationTween = null;
    let restartTween = null;
    let pointerInside = false;
    const lockState = { strength: 0 };

    document.body.classList.add("has-cursor");
    gsap.set(wrapper, { x: pointerX, y: pointerY, rotation: 0, scale: 1, autoAlpha: 0 });
    Object.entries(REST_POSITIONS).forEach(([key, position]) => {
      gsap.set(brackets[key], position);
    });

    let moveX;
    let moveY;

    function createPointerTweens() {
      moveX = gsap.quickTo(wrapper, "x", {
        duration: 0.1,
        ease: "power3.out",
      });
      moveY = gsap.quickTo(wrapper, "y", {
        duration: 0.1,
        ease: "power3.out",
      });
    }

    createPointerTweens();

    function startRotation() {
      restartTween = null;
      rotationTween?.kill();
      gsap.set(wrapper, { rotation: 0 });
      rotationTween = gsap.to(wrapper, {
        rotation: 360,
        duration: 2,
        ease: "none",
        repeat: -1,
      });
    }

    function getTargetPositions(rect) {
      const left = rect.left - OUTSET;
      const top = rect.top - OUTSET;
      const right = rect.right + OUTSET - BRACKET_SIZE;
      const bottom = rect.bottom + OUTSET - BRACKET_SIZE;

      return {
        tl: { x: left, y: top },
        tr: { x: right, y: top },
        br: { x: right, y: bottom },
        bl: { x: left, y: bottom },
      };
    }

    function updateLockedBrackets() {
      if (!lockedTarget) return;
      if (!lockedTarget.isConnected) {
        releaseTarget();
        return;
      }

      const rect = lockedTarget.getBoundingClientRect();
      const positions = getTargetPositions(rect);
      const parallaxX = (rawPointerX - (rect.left + rect.width / 2)) * 0.2;
      const parallaxY = (rawPointerY - (rect.top + rect.height / 2)) * 0.2;
      const strength = lockState.strength;
      const maxBracketX = Math.max(0, window.innerWidth - BRACKET_SIZE);
      const maxBracketY = Math.max(0, window.innerHeight - BRACKET_SIZE);

      Object.entries(positions).forEach(([key, position]) => {
        const rest = REST_POSITIONS[key];
        gsap.set(brackets[key], {
          x: gsap.utils.interpolate(
            rest.x,
            clamp(position.x + parallaxX, 0, maxBracketX) - pointerX,
            strength,
          ),
          y: gsap.utils.interpolate(
            rest.y,
            clamp(position.y + parallaxY, 0, maxBracketY) - pointerY,
            strength,
          ),
        });
      });
    }

    function lockToTarget(target) {
      if (!target || target === lockedTarget) return;

      restartTween?.kill();
      restartTween = null;
      rotationTween?.kill();
      rotationTween = null;
      gsap.set(wrapper, { rotation: 0 });
      gsap.killTweensOf(lockState);
      lockState.strength = 0;
      lockedTarget = target;
      gsap.to(lockState, {
        strength: 1,
        duration: 0.2,
        ease: "power2.out",
      });
    }

    function releaseTarget() {
      if (!lockedTarget) return;

      lockedTarget = null;
      gsap.killTweensOf(lockState);
      lockState.strength = 0;
      Object.entries(REST_POSITIONS).forEach(([key, position]) => {
        gsap.to(brackets[key], {
          ...position,
          duration: 0.3,
          ease: "power3.out",
          overwrite: true,
        });
      });

      restartTween?.kill();
      restartTween = gsap.delayedCall(0.35, startRotation);
    }

    function updatePointer(clientX, clientY) {
      const reentering = !pointerInside;
      pointerInside = true;
      document.body.classList.add("has-cursor");
      rawPointerX = clientX;
      rawPointerY = clientY;
      pointerX = clamp(clientX, EDGE_GUTTER, window.innerWidth - EDGE_GUTTER);
      pointerY = clamp(clientY, EDGE_GUTTER, window.innerHeight - EDGE_GUTTER);

      if (reentering) {
        gsap.set(wrapper, {
          x: pointerX,
          y: pointerY,
          rotation: 0,
          scale: 1,
          autoAlpha: 1,
        });
      } else {
        gsap.set(wrapper, { autoAlpha: 1 });
        moveX(pointerX);
        moveY(pointerY);
      }

      const target = findTargetAtPoint(rawPointerX, rawPointerY);
      if (target) {
        lockToTarget(target);
      } else {
        releaseTarget();
        if (!rotationTween && !restartTween) startRotation();
      }
    }

    function handlePointerMove(event) {
      if (event.pointerType === "touch") return;
      updatePointer(event.clientX, event.clientY);
    }

    function handlePointerOver(event) {
      if (event.pointerType === "touch") return;
      updatePointer(event.clientX, event.clientY);
    }

    function handlePointerDown(event) {
      if (event.pointerType === "touch") return;
      gsap.to(dot, { scale: 0.7, duration: 0.3, overwrite: true });
      gsap.to(wrapper, { scale: 0.9, duration: 0.2, overwrite: true });
    }

    function handlePointerUp() {
      gsap.to(dot, { scale: 1, duration: 0.3, overwrite: true });
      gsap.to(wrapper, { scale: 1, duration: 0.2, overwrite: true });
    }

    function handleScroll() {
      if (!lockedTarget) return;
      if (findTargetAtPoint(rawPointerX, rawPointerY) !== lockedTarget) releaseTarget();
    }

    function handleWindowLeave() {
      if (!pointerInside) return;

      pointerInside = false;
      document.body.classList.remove("has-cursor");
      rotationTween?.kill();
      rotationTween = null;
      restartTween?.kill();
      restartTween = null;
      gsap.killTweensOf([wrapper, dot, ...Object.values(brackets), lockState]);
      lockState.strength = 0;
      lockedTarget = null;
      gsap.set(wrapper, { autoAlpha: 0, rotation: 0, scale: 1 });
      gsap.set(dot, { scale: 1 });
      Object.entries(REST_POSITIONS).forEach(([key, position]) => {
        gsap.set(brackets[key], position);
      });
      moveX.tween.kill();
      moveY.tween.kill();
      createPointerTweens();
    }

    function handlePointerOut(event) {
      if (event.relatedTarget === null) handleWindowLeave();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") handleWindowLeave();
    }

    gsap.ticker.add(updateLockedBrackets);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerover", handlePointerOver, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("pointercancel", handlePointerUp, { passive: true });
    window.addEventListener("pointerleave", handleWindowLeave);
    window.addEventListener("blur", handleWindowLeave);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });

    return () => {
      document.body.classList.remove("has-cursor");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerover", handlePointerOver);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("pointerleave", handleWindowLeave);
      window.removeEventListener("blur", handleWindowLeave);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("scroll", handleScroll, true);
      gsap.ticker.remove(updateLockedBrackets);
      rotationTween?.kill();
      restartTween?.kill();
      moveX.tween.kill();
      moveY.tween.kill();
      gsap.killTweensOf([wrapper, dot, ...Object.values(brackets), lockState]);
    };
  }, [enabled]);

  if (!enabled) return null;

  return createPortal(
    <div aria-hidden="true" className="target-cursor-wrapper" ref={wrapperRef}>
      <span className="target-cursor-dot" ref={dotRef} />
      <span className="target-cursor-bracket target-cursor-bracket-tl" ref={(node) => { bracketRefs.current.tl = node; }} />
      <span className="target-cursor-bracket target-cursor-bracket-tr" ref={(node) => { bracketRefs.current.tr = node; }} />
      <span className="target-cursor-bracket target-cursor-bracket-br" ref={(node) => { bracketRefs.current.br = node; }} />
      <span className="target-cursor-bracket target-cursor-bracket-bl" ref={(node) => { bracketRefs.current.bl = node; }} />
    </div>,
    document.body,
  );
}
