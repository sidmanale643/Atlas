/* ============================================================================
   Shared motion vocabulary for the Neurogram SPA.
   One place to tune timing so every page moves on the same instrument-like curve:
   short durations, small offsets, gentle easing. Honor prefers-reduced-motion via
   <MotionConfig reducedMotion="user"> in main.tsx (collapses these automatically).
   ========================================================================== */
import type { Transition, Variants } from "framer-motion";

/* Matches Landing's existing cubic-bezier so CSS and JS motion agree. */
export const EASE = [0.2, 0.7, 0.2, 1] as const;

/* Standard entrance: rise 12px + fade. Used by <Reveal> and as a stagger child. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE },
  },
};

/* Parent that releases its children in a gentle cascade. Pair with `fadeUp`
   children, or any variant exposing `hidden`/`show`. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/* Route transition — opacity-dominant (only a 6px nudge) so it is safe to apply
   anywhere, including over the WebGL brain stage. Spread onto a motion element. */
export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: EASE } as Transition,
};

/* Soft spring for panels that slide in (graph detail panel, etc.). */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 32,
};
