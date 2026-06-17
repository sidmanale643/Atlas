import { useEffect, useRef } from "react";

export default function EegWaveform() {
  const lineRef = useRef<SVGPolylineElement>(null);

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;

    let offset = 0;
    let animId: number;

    function animate() {
      const pts: string[] = [];
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * 1440;
        const phase = (i / steps) * Math.PI * 8 + offset;
        let y = 30 + Math.sin(phase) * 6;
        if (i % 20 === 10) y -= 22;
        if (i % 20 === 11) y += 18;
        if (i % 20 === 12) y -= 10;
        pts.push(`${x},${y}`);
      }
      el!.setAttribute("points", pts.join(" "));
      offset += 0.04;
      animId = requestAnimationFrame(animate);
    }

    animate();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <svg
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        zIndex: 5,
        pointerEvents: "none",
      }}
      viewBox="0 0 1440 60"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <polyline
        ref={lineRef}
        points=""
        stroke="#6ab0ff"
        strokeWidth="1"
        fill="none"
        opacity="0.3"
      />
    </svg>
  );
}
