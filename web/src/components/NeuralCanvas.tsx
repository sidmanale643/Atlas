import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  r: number;
  glow: number;
  glowDecay: number;
  connections: number[];
}

interface Pulse {
  src: number;
  dst: number;
  t: number;
  speed: number;
}

const NODE_COUNT = 28;
const BLUE = "#6ab0ff";
const BLUE_DIM = "rgba(106,176,255,";

export default function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    let animId: number;
    let pulseIntervals: ReturnType<typeof setInterval>[] = [];

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = W() * dpr;
      canvas!.height = H() * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function mkNodes() {
      nodes = [];
      const minDist = 55;
      for (let i = 0; i < NODE_COUNT; i++) {
        let x = 0, y = 0, attempts = 0;
        do {
          x = 0.06 + Math.random() * 0.86;
          y = 0.04 + Math.random() * 0.88;
          attempts++;
        } while (
          attempts < 50 &&
          nodes.some((n) => {
            const dx = (n.x - x) * W();
            const dy = (n.y - y) * H();
            return Math.sqrt(dx * dx + dy * dy) < minDist;
          })
        );
        nodes.push({
          x,
          y,
          r: 2 + Math.random() * 2.5,
          glow: 0,
          glowDecay: 0.012 + Math.random() * 0.01,
          connections: [],
        });
      }
      nodes.forEach((n, i) => {
        nodes.forEach((m, j) => {
          if (i === j) return;
          const dx = (n.x - m.x) * W();
          const dy = (n.y - m.y) * H();
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140 && n.connections.length < 4) n.connections.push(j);
        });
      });
    }

    function firePulse() {
      const src = Math.floor(Math.random() * nodes.length);
      const node = nodes[src];
      if (!node.connections.length) return;
      const dst =
        node.connections[Math.floor(Math.random() * node.connections.length)];
      pulses.push({
        src,
        dst,
        t: 0,
        speed: 0.018 + Math.random() * 0.014,
      });
      nodes[src].glow = 1;
    }

    function draw() {
      ctx!.clearRect(0, 0, W(), H());
      const w = W(),
        h = H();

      for (const n of nodes) {
        if (n.glow > 0) n.glow = Math.max(0, n.glow - n.glowDecay);
      }

      for (const n of nodes) {
        for (const j of n.connections) {
          const m = nodes[j];
          ctx!.beginPath();
          ctx!.moveTo(n.x * w, n.y * h);
          ctx!.lineTo(m.x * w, m.y * h);
          ctx!.strokeStyle = BLUE_DIM + "0.07)";
          ctx!.lineWidth = 0.5;
          ctx!.stroke();
        }
      }

      pulses = pulses.filter((p) => p.t <= 1);
      for (const p of pulses) {
        p.t += p.speed;
        const src = nodes[p.src],
          dst = nodes[p.dst];
        const x = src.x * w + (dst.x - src.x) * w * p.t;
        const y = src.y * h + (dst.y - src.y) * h * p.t;

        ctx!.beginPath();
        ctx!.moveTo(src.x * w, src.y * h);
        ctx!.lineTo(x, y);
        ctx!.strokeStyle = BLUE_DIM + 0.5 * p.t + ")";
        ctx!.lineWidth = 1;
        ctx!.stroke();

        ctx!.beginPath();
        ctx!.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx!.fillStyle = BLUE;
        ctx!.fill();

        if (p.t >= 1) nodes[p.dst].glow = 1;
      }

      for (const n of nodes) {
        const glow = n.glow;
        if (glow > 0) {
          ctx!.beginPath();
          ctx!.arc(n.x * w, n.y * h, n.r * 3.5 * glow, 0, Math.PI * 2);
          ctx!.fillStyle = BLUE_DIM + glow * 0.15 + ")";
          ctx!.fill();
        }
        ctx!.beginPath();
        ctx!.arc(n.x * w, n.y * h, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = glow > 0.1 ? BLUE : BLUE_DIM + "0.3)";
        ctx!.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    mkNodes();
    draw();

    pulseIntervals.push(setInterval(firePulse, 260));
    pulseIntervals.push(setInterval(firePulse, 520));

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animId);
      pulseIntervals.forEach(clearInterval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: "55%",
        height: "100%",
        pointerEvents: "none",
      }}
      aria-hidden="true"
    />
  );
}
