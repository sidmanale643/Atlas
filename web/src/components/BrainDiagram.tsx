import { useCallback, useEffect, useState } from "react";
import styles from "./BrainDiagram.module.css";

/* ------------------------------------------------------------------ data
 * A lateral (sagittal) brain with the memory-systems regions Atlas models.
 * Each region carries the role it plays and the memory type it anatomically
 * leans on — the same principles the extraction step encodes as activation.
 * Hotspot coords live in the 0–680 × 0–520 viewBox of the SVG below.
 */
interface Region {
  id: string;
  index: string;
  name: string;
  type: string;
  /** deep limbic structure vs. surface cortex — drives the dot styling */
  deep?: boolean;
  /** hotspot ellipse on the brain */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  body: string;
}

const REGIONS: ReadonlyArray<Region> = [
  {
    id: "hippocampus",
    index: "01",
    name: "Hippocampus",
    type: "Episodic memory",
    deep: true,
    cx: 372,
    cy: 268,
    rx: 34,
    ry: 18,
    body:
      "The seahorse-shaped engine of episodic memory. It binds the scattered fragments of a moment — who, where, when — into a single retrievable trace. Atlas leans on it hardest: the left hippocampus weights verbal detail, the right weights spatial layout, so every memory's activation is split across both.",
  },
  {
    id: "amygdala",
    index: "02",
    name: "Amygdala",
    type: "Emotional salience",
    deep: true,
    cx: 320,
    cy: 290,
    rx: 22,
    ry: 16,
    body:
      "Sits just ahead of the hippocampus and tags a moment with feeling. Emotionally charged memories light it brightly and, weighted by that salience, surface more readily later — the reason a vivid memory outshines a dull one.",
  },
  {
    id: "basal-ganglia",
    index: "03",
    name: "Basal ganglia",
    type: "Procedural memory",
    deep: true,
    cx: 296,
    cy: 224,
    rx: 26,
    ry: 16,
    body:
      "The substrate of skills and habits — memory you enact rather than recall. When a moment is about doing rather than recounting, activation shifts here, away from the hippocampal episodic core.",
  },
  {
    id: "prefrontal",
    index: "04",
    name: "Prefrontal cortex",
    type: "Source & planning",
    cx: 168,
    cy: 214,
    rx: 40,
    ry: 30,
    body:
      "The front of the map holds working memory and source attribution — where a memory came from, when, and how it connects to intent. It keeps recall grounded, distinguishing what happened from what was merely imagined.",
  },
  {
    id: "temporal",
    index: "05",
    name: "Temporal cortex",
    type: "Semantic memory",
    cx: 344,
    cy: 332,
    rx: 52,
    ry: 26,
    body:
      "Beneath the lateral sulcus lives semantic knowledge — names, facts, the meaning of things stripped of when you learned them. It lets Atlas resolve a mention like “a cafe” into a concept that links to every other cafe you've stored.",
  },
  {
    id: "association",
    index: "06",
    name: "Association cortex",
    type: "Multimodal binding",
    cx: 432,
    cy: 168,
    rx: 50,
    ry: 32,
    body:
      "The parietal association areas weave the senses together — sight, sound, place — into the unified texture of an experience. It is the connective tissue that lets one memory reach across modalities to another.",
  },
];

/* ------------------------------------------------------------------ component */

export default function BrainDiagram() {
  const [active, setActive] = useState<string>("hippocampus");

  const select = useCallback(
    (id: string) => () => setActive((prev) => (prev === id ? prev : id)),
    [],
  );

  const onKey = useCallback(
    (id: string) => (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      setActive(id);
    },
    [],
  );

  // Arrow-key cycling through regions for keyboard users.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const i = REGIONS.findIndex((r) => r.id === active);
      if (i === -1) return;
      const next =
        e.key === "ArrowDown"
          ? (i + 1) % REGIONS.length
          : (i - 1 + REGIONS.length) % REGIONS.length;
      setActive(REGIONS[next].id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active]);

  return (
    <div className={styles.wrap}>
      {/* ---- the brain ---- */}
      <div className={styles.stage}>
        <span className={styles.reticle} aria-hidden="true" />
        <svg
          className={styles.brain}
          viewBox="0 0 680 520"
          role="group"
          aria-label="Interactive lateral diagram of the brain's memory regions"
        >
          <title>Memory regions of the brain</title>

          <defs>
            <radialGradient id="bd-core" cx="50%" cy="46%" r="60%">
              <stop offset="0%" stopColor="rgba(56,130,246,0.16)" />
              <stop offset="70%" stopColor="rgba(56,130,246,0.04)" />
              <stop offset="100%" stopColor="rgba(56,130,246,0)" />
            </radialGradient>
          </defs>

          {/* soft inner glow */}
          <ellipse cx="330" cy="240" rx="270" ry="190" fill="url(#bd-core)" />

          {/* cerebrum outline — lateral view, frontal pole at left */}
          <path
            className={styles.outline}
            d="M120 250
               C96 196 132 132 214 108
               C300 82 408 86 482 124
               C548 158 566 214 540 262
               C566 300 548 350 498 352
               C470 392 402 404 356 386
               C338 420 276 426 240 404
               C176 410 128 372 118 320
               C92 306 92 274 120 250 Z"
          />

          {/* lateral sulcus — the deep groove above the temporal lobe */}
          <path
            className={styles.sulcus}
            d="M196 318 C266 300 352 306 430 332"
          />
          {/* central sulcus */}
          <path
            className={styles.sulcus}
            d="M330 116 C312 168 320 214 296 252"
          />
          {/* decorative gyri folds */}
          <path className={styles.gyrus} d="M168 168 C210 150 268 152 300 174" />
          <path className={styles.gyrus} d="M360 132 C404 138 446 156 470 188" />
          <path className={styles.gyrus} d="M214 220 C256 206 300 210 332 232" />
          <path className={styles.gyrus} d="M392 210 C436 216 472 236 492 268" />
          <path className={styles.gyrus} d="M250 360 C300 350 352 356 396 374" />

          {/* brainstem + cerebellum hint */}
          <path
            className={styles.stem}
            d="M356 388 C372 420 372 452 360 484"
          />
          <path
            className={styles.cerebellum}
            d="M470 360 C520 360 548 392 540 430 C532 462 492 470 462 452"
          />

          {/* region hotspots */}
          {REGIONS.map((r) => {
            const on = active === r.id;
            return (
              <g
                key={r.id}
                className={`${styles.region} ${on ? styles.regionOn : ""} ${
                  r.deep ? styles.regionDeep : ""
                }`}
                onClick={select(r.id)}
                onMouseEnter={select(r.id)}
                onKeyDown={onKey(r.id)}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${r.name} — ${r.type}`}
              >
                <ellipse
                  className={styles.regionGlow}
                  cx={r.cx}
                  cy={r.cy}
                  rx={r.rx + 10}
                  ry={r.ry + 10}
                />
                <ellipse
                  className={styles.regionShape}
                  cx={r.cx}
                  cy={r.cy}
                  rx={r.rx}
                  ry={r.ry}
                />
                <circle
                  className={styles.regionDot}
                  cx={r.cx}
                  cy={r.cy}
                  r={3.2}
                />
                <text
                  className={styles.regionIndex}
                  x={r.cx}
                  y={r.cy - r.ry - 8}
                  textAnchor="middle"
                >
                  {r.index}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ---- the legend / reader ---- */}
      <ol className={styles.list} aria-label="Brain memory regions">
        {REGIONS.map((r) => {
          const on = active === r.id;
          return (
            <li key={r.id} className={on ? styles.rowOn : undefined}>
              <button
                type="button"
                className={styles.row}
                aria-expanded={on}
                onClick={select(r.id)}
                onMouseEnter={select(r.id)}
              >
                <span className={styles.rowIndex}>{r.index}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowHead}>
                    <strong>{r.name}</strong>
                    <em className={styles.rowType}>{r.type}</em>
                  </span>
                  <span className={styles.rowBody}>{r.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
