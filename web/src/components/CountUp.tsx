import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/* Animated integer readout. Tweens from its previous value to `value` whenever
   `value` changes; snaps instantly under prefers-reduced-motion. Used for the
   catalog total and graph stats so numbers "settle" rather than pop. */
export default function CountUp({
  value,
  duration = 0.6,
  className,
  format = (n) => n.toLocaleString(),
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value, duration, reduced]);

  return <span className={className}>{format(display)}</span>;
}
