import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./Landing.module.css";

/** Inline style carrying a CSS custom property (e.g. --i, --w). */
const cssVars = (vars: Record<string, string>): CSSProperties =>
  vars as CSSProperties;

/* ------------------------------------------------------------------ content */

const HERO_METRICS: ReadonlyArray<{ figure: string; label: string }> = [
  { figure: "11", label: "cortical regions mapped" },
  { figure: "2", label: "hippocampi · L verbal / R spatial" },
  { figure: "9", label: "memory tools over MCP" },
  { figure: "384", label: "dimension semantic vectors" },
];

/* Decorative, illustrative extraction trace — not a live call. */
const EXTRACT_ENTITIES: ReadonlyArray<{ mention: string; kind: string; conf: string }> = [
  { mention: "Maya", kind: "person", conf: "0.95" },
  { mention: "a cafe", kind: "place", conf: "0.81" },
  { mention: "yesterday", kind: "time", conf: "0.90" },
];

const EXTRACT_REGIONS: ReadonlyArray<{ region: string; weight: number }> = [
  { region: "Hippocampus", weight: 0.72 },
  { region: "Association cortex", weight: 0.41 },
  { region: "Temporal cortex", weight: 0.28 },
  { region: "Prefrontal cortex", weight: 0.16 },
];



const MCP_TOOLS: ReadonlyArray<{ name: string; note: string }> = [
  { name: "add_memory", note: "write a moment" },
  { name: "search_memories", note: "semantic recall" },
  { name: "get_related_memories", note: "follow a thread" },
  { name: "find_entities", note: "look someone up" },
  { name: "get_entity_memories", note: "everything about X" },
  { name: "get_memory", note: "full record" },
  { name: "list_memories", note: "browse recent" },
  { name: "update_memory_summary", note: "revise" },
  { name: "delete_memory", note: "forget" },
];

const PRINCIPLES: ReadonlyArray<{ index: string; term: string; body: string }> = [
  {
    index: "01",
    term: "Hebbian wiring",
    body: "Co-occurring people, places and relationships strengthen the links between memories — fire together, wire together.",
  },
  {
    index: "02",
    term: "Hippocampal laterality",
    body: "The left hippocampus leans verbal, the right leans spatial. Each memory's activation is split across both.",
  },
  {
    index: "03",
    term: "Type-specific anatomy",
    body: "Episodic recall leans on the hippocampus, skills on the basal ganglia, feeling on the amygdala — each type lights its own regions.",
  },
  {
    index: "04",
    term: "Salience & affect",
    body: "Emotionally charged moments weight the amygdala and surface more readily — the way a vivid memory outshines a dull one.",
  },
];

const FAQS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Where do my memories live?",
    a: "In a local SQLite database on the machine you run Neurogram on. Embeddings are indexed to a Qdrant instance you control — nothing leaves for anywhere you haven't configured.",
  },
  {
    q: "Does it need an LLM?",
    a: "Extraction — turning a sentence into entities, relationships and regions — calls a configured LLM. Everything you've already captured stays browsable without it.",
  },
  {
    q: "What powers “search by meaning”?",
    a: "Sentence-Transformers embeddings (MiniLM, 384 dimensions) stored in Qdrant and matched by cosine similarity — so “coffee with a friend” can surface “espresso with Maya.”",
  },
  {
    q: "Can my AI assistant use it directly?",
    a: "Yes — through the Model Context Protocol server. Any MCP client can write and recall memories with the nine tools listed above.",
  },
  {
    q: "Is the neuroscience literal?",
    a: "It's a principled model, not a clinical scan. Region activations follow established memory-systems research, but they remain an interpretive map — built to make structure visible, not to diagnose.",
  },
];

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/* ------------------------------------------------------------------ wordmark */

function Wordmark() {
  return (
    <a href="/landing" className={styles.wordmark}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className={styles.glyph}>
        <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="19.5" cy="12" r="1.9" fill="currentColor" />
        <circle cx="12" cy="20" r="1.5" fill="currentColor" />
        <path d="M19.5 12 L12 20" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      </svg>
      <span>Neurogram</span>
    </a>
  );
}

/* An oscilloscope/EKG-like phosphor trace, drawn once on load. */
function Oscilloscope() {
  return (
    <svg
      className={styles.scope}
      viewBox="0 0 720 80"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        className={styles.scopeLine}
        d="M0 40 L120 40 L150 40 L168 14 L186 66 L204 28 L222 40 L360 40 L388 40 L404 22 L420 58 L436 40 L560 40 L590 40 L606 30 L620 50 L636 40 L720 40"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ page */

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [extracted, setExtracted] = useState(false);

  // Reveal the extraction trace once it scrolls into view.
  const labRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = labRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setExtracted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setExtracted(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page} ref={rootRef}>
      {/* ---- top bar ---- */}
      <header className={styles.topbar}>
        <Wordmark />
        <nav className={styles.topnav} aria-label="Primary">
          <a href="#extraction">Extraction</a>
          <a href="#architecture">Architecture</a>
          <a href="#mcp">Connect</a>
          <a href="#science">Science</a>
          <a className={`nrg-btn ${styles.barCta}`} href="/atlas">
            Open the atlas
          </a>
        </nav>
      </header>

      <main>
        {/* ============================================================ HERO */}
        <section className={styles.hero}>
          <div className={styles.heroGrid} aria-hidden="true" />
          <div className={styles.heroInner}>
            <p className={`${styles.heroCoord} ${styles.reveal}`}>
              <span className="label">atlas · build 2026.06</span>
            </p>
            <h1 className={`${styles.heroTitle} ${styles.reveal}`}>
              Neurons that fire together
              <br />
              <em>wire&nbsp;together.</em>
            </h1>
            <p className={`${styles.heroSub} ${styles.reveal}`}>
              Add a moment. Neurogram breaks it into people, places, time and
              activity — places it anatomically across the cortex — then draws the
              associations that make it retrievable. A brain, not a notebook.
            </p>
            <div className={`${styles.heroCta} ${styles.reveal}`}>
              <a className="nrg-btn nrg-btn--solid" href="/atlas">
                Open the atlas →
              </a>
              <a className="nrg-btn" href="#extraction">
                See how it works
              </a>
            </div>
            <Oscilloscope />
            <dl className={`${styles.metrics} ${styles.reveal}`}>
              {HERO_METRICS.map((m) => (
                <div className={styles.metric} key={m.label}>
                  <dt>{m.figure}</dt>
                  <dd>{m.label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <aside className={styles.marginNote} aria-hidden="true">
            fig. 1 — a single moment, decomposed and re-wired
          </aside>
        </section>

        {/* ====================================================== EXTRACTION */}
        <section className={styles.section} id="extraction">
          <div className={styles.sectionHead}>
            <span className="rule-label">extraction lab</span>
            <h2>From a sentence to a synapse.</h2>
            <p>
              Natural language is decoded under a locked schema into entities,
              relationship triples and a weighted cortical activation map — the
              raw material the atlas wires together.
            </p>
          </div>

          <div className={styles.lab} ref={labRef}>
            <div className={styles.labInput}>
              <span className="label">input · ≤180 chars</span>
              <p className={styles.labSentence}>
                <span className={styles.markPerson}>I went to a cafe with Maya</span>{" "}
                <span className={styles.markTime}>yesterday</span>.
              </p>
              <code className={styles.labReq}>POST /api/extract</code>
            </div>

            <div className={styles.labArrow} aria-hidden="true">
              <span className={styles.labArrowLine} />
              <span className={styles.labArrowText}>decode</span>
              <span className={styles.labArrowLine} />
            </div>

            <div
              className={`${styles.labOutput} ${extracted ? styles.labOutputLive : ""}`}
            >
              <div className={styles.labCol}>
                <span className="label">named entities</span>
                <ul className={styles.entList}>
                  {EXTRACT_ENTITIES.map((e, i) => (
                    <li key={e.mention} style={cssVars({ "--i": String(i) })}>
                      <b>{e.mention}</b>
                      <small>
                        {e.kind} · {e.conf}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.labCol}>
                <span className="label">relationship triple</span>
                <p className={styles.triple} style={cssVars({ "--i": "1" })}>
                  <b>self</b>
                  <em>went to a cafe with</em>
                  <b>Maya</b>
                </p>
                <span className="label">cortical activation</span>
                <ul className={styles.meterList}>
                  {EXTRACT_REGIONS.map((r, i) => (
                    <li key={r.region} style={cssVars({ "--i": String(i + 2) })}>
                      <span className={styles.meterHead}>
                        <span>{r.region}</span>
                        <strong>{pct(r.weight)}</strong>
                      </span>
                      <span className={styles.meter}>
                        <span
                          className={styles.meterFill}
                          style={cssVars({ "--w": pct(r.weight) })}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <hr className="nrg-divider" />

        {/* ==================================================== ARCHITECTURE */}
        <section className={styles.section} id="architecture">
          <div className={styles.sectionHead}>
            <span className="rule-label">how it fits</span>
            <h2>
              One write, two stores, <em>three ways back.</em>
            </h2>
            <p>
              A moment is captured once, then persisted to a relational graph and a
              vector index at the same time — so it can be recalled by meaning, by
              association, or by name. A Node server orchestrates the write; an MCP
              server exposes it to agents.
            </p>
          </div>

          <div className={styles.archChart}>
            <svg
              viewBox="0 0 960 520"
              className={styles.archSvg}
              aria-label="Architecture diagram: capture flow splits to two stores, three recall paths converge back"
              role="img"
            >
              {/* ---- row 1: capture pipeline ---- */}
              <text x="0" y="18" className={styles.archLabel}>CAPTURE</text>

              <rect x="0" y="30" width="150" height="48" rx="4" className={styles.archNode} />
              <text x="75" y="50" textAnchor="middle" className={styles.archNodeTitle}>Natural</text>
              <text x="75" y="66" textAnchor="middle" className={styles.archNodeTitle}>language</text>

              <line x1="150" y1="54" x2="190" y2="54" className={styles.archArrow} />
              <polygon points="186,49 196,54 186,59" className={styles.archArrowHead} />

              <rect x="196" y="30" width="150" height="48" rx="4" className={styles.archNode} />
              <text x="271" y="50" textAnchor="middle" className={styles.archNodeTitle}>Schema-locked</text>
              <text x="271" y="66" textAnchor="middle" className={styles.archNodeTitle}>extraction</text>

              <line x1="346" y1="54" x2="386" y2="54" className={styles.archArrow} />
              <polygon points="382,49 392,54 382,59" className={styles.archArrowHead} />

              <rect x="392" y="30" width="150" height="48" rx="4" className={styles.archNode} />
              <text x="467" y="50" textAnchor="middle" className={styles.archNodeTitle}>Cortical map</text>
              <text x="467" y="66" textAnchor="middle" className={styles.archNodeSub}>11 ROIs</text>

              <line x1="542" y1="54" x2="582" y2="54" className={styles.archArrow} />
              <polygon points="578,49 588,54 578,59" className={styles.archArrowHead} />

              <rect x="588" y="30" width="150" height="48" rx="4" className={styles.archNodeHighlight} />
              <text x="663" y="50" textAnchor="middle" className={styles.archNodeTitleHl}>Embedding</text>
              <text x="663" y="66" textAnchor="middle" className={styles.archNodeSubHl}>384-d</text>

              {/* ---- split: branching lines from embedding down to stores ---- */}
              <line x1="663" y1="78" x2="663" y2="108" className={styles.archPipe} />
              <line x1="663" y1="108" x2="310" y2="108" className={styles.archPipe} />
              <line x1="663" y1="108" x2="820" y2="108" className={styles.archPipe} />
              {/* left branch */}
              <line x1="310" y1="108" x2="310" y2="130" className={styles.archPipe} />
              <polygon points="305,126 310,136 315,126" className={styles.archPipeHead} />
              {/* right branch */}
              <line x1="820" y1="108" x2="820" y2="130" className={styles.archPipe} />
              <polygon points="815,126 820,136 825,126" className={styles.archPipeHead} />

              {/* ---- row 2: two stores ---- */}
              <text x="0" y="155" className={styles.archLabel}>ONE WRITE · TWO STORES</text>

              {/* SQLite */}
              <rect x="155" y="168" width="310" height="80" rx="4" className={styles.archStoreNode} />
              <text x="175" y="192" className={styles.archStoreName}>SQLite</text>
              <text x="280" y="192" className={styles.archStoreCode}>engram.db</text>
              <text x="175" y="214" className={styles.archStoreRole}>Source of truth · the graph</text>
              <text x="175" y="234" className={styles.archStoreDetail}>memories · extractions · entities · relationships · region activations</text>

              {/* Qdrant */}
              <rect x="555" y="168" width="310" height="80" rx="4" className={styles.archStoreNode} />
              <text x="575" y="192" className={styles.archStoreName}>Qdrant</text>
              <text x="680" y="192" className={styles.archStoreCode}>neurogram_memories</text>
              <text x="575" y="214" className={styles.archStoreRole}>Semantic index</text>
              <text x="575" y="234" className={styles.archStoreDetail}>384-dimension vectors · cosine distance</text>

              {/* ---- merge lines from stores to recall row ---- */}
              <line x1="310" y1="248" x2="310" y2="278" className={styles.archPipe} />
              <line x1="820" y1="248" x2="820" y2="278" className={styles.archPipe} />
              <line x1="310" y1="278" x2="820" y2="278" className={styles.archPipe} />
              {/* three branches down */}
              <line x1="260" y1="278" x2="260" y2="300" className={styles.archPipe} />
              <polygon points="255,296 260,306 265,296" className={styles.archPipeHead} />
              <line x1="540" y1="278" x2="540" y2="300" className={styles.archPipe} />
              <polygon points="535,296 540,306 545,296" className={styles.archPipeHead} />
              <line x1="820" y1="278" x2="820" y2="300" className={styles.archPipe} />
              <polygon points="815,296 820,306 825,296" className={styles.archPipeHead} />

              {/* ---- row 3: three recall paths ---- */}
              <text x="0" y="325" className={styles.archLabel}>THREE WAYS BACK</text>

              {/* Semantic recall */}
              <rect x="80" y="340" width="360" height="90" rx="4" className={styles.archRecallNode} />
              <text x="100" y="364" className={styles.archRecallName}>Semantic recall</text>
              <text x="100" y="386" className={styles.archRecallDesc}>Embed the query, take the cosine-nearest</text>
              <text x="100" y="402" className={styles.archRecallDesc}>vectors from Qdrant.</text>
              <text x="100" y="420" className={styles.archRecallTag}>GET /api/memories/search</text>

              {/* Structural links */}
              <rect x="460" y="340" width="160" height="90" rx="4" className={styles.archRecallNode} />
              <text x="480" y="364" className={styles.archRecallName}>Structural</text>
              <text x="480" y="380" className={styles.archRecallName}>links</text>
              <text x="480" y="402" className={styles.archRecallDesc}>Memories sharing</text>
              <text x="480" y="418" className={styles.archRecallDesc}>entities or triples</text>

              {/* Entity & catalog */}
              <rect x="640" y="340" width="230" height="90" rx="4" className={styles.archRecallNode} />
              <text x="660" y="364" className={styles.archRecallName}>Entity & catalog</text>
              <text x="660" y="386" className={styles.archRecallDesc}>Full-text search across names,</text>
              <text x="660" y="402" className={styles.archRecallDesc}>aliases, summaries and raw text.</text>
              <text x="660" y="420" className={styles.archRecallTag}>GET /api/catalog</text>

              {/* ---- recall-to-user arrows converging at bottom ---- */}
              <line x1="260" y1="430" x2="260" y2="460" className={styles.archPipe} />
              <line x1="540" y1="430" x2="540" y2="460" className={styles.archPipe} />
              <line x1="820" y1="430" x2="820" y2="460" className={styles.archPipe} />
              <line x1="260" y1="460" x2="820" y2="460" className={styles.archPipe} />
              <line x1="540" y1="460" x2="540" y2="480" className={styles.archPipe} />
              <polygon points="535,476 540,486 545,476" className={styles.archPipeHead} />

              <rect x="440" y="488" width="200" height="30" rx="4" className={styles.archUserNode} />
              <text x="540" y="508" textAnchor="middle" className={styles.archUserLabel}>You / MCP Client</text>
            </svg>
          </div>

          <p className={styles.archNote}>
            Related-memories fuses structural + semantic signal —{" "}
            <code>1 − ∏(1 − signal)</code>. Surfaces:{" "}
            <a href="/atlas">Atlas</a>, <a href="/memories">Memories</a>,{" "}
            <a href="/graph">Graph</a>.
          </p>
        </section>

        <hr className="nrg-divider" />

        {/* ============================================================= MCP */}
        <section className={styles.section} id="mcp">
          <div className={styles.mcp}>
            <div className={styles.mcpCopy}>
              <span className="rule-label">model context protocol</span>
              <h2>Give your agent a hippocampus.</h2>
              <p>
                Neurogram ships an MCP server. Point any client — Claude among them
                — at it, and your assistant writes to and recalls from the same
                atlas you explore, persisting memory across every session.
              </p>
              <p className={styles.mcpFine}>
                Reads are safe by default — <code>delete_memory</code> is the only
                destructive call, and it confirms first.
              </p>
            </div>

            <div className={styles.mcpRight}>
              <div className={styles.mcpTerminal}>
                <div className={styles.mcpBar} aria-hidden="true">
                  <span className={styles.mcpName}>claude_desktop_config.json</span>
                </div>
                <pre className={styles.mcpCode}>
                  <code>
                    {"{\n"}
                    {"  "}
                    <span className={styles.tokK}>"mcpServers"</span>
                    {": {\n"}
                    {"    "}
                    <span className={styles.tokK}>"neurogram"</span>
                    {": {\n"}
                    {"      "}
                    <span className={styles.tokK}>"command"</span>
                    {": "}
                    <span className={styles.tokS}>"npx"</span>
                    {",\n"}
                    {"      "}
                    <span className={styles.tokK}>"args"</span>
                    {": ["}
                    <span className={styles.tokS}>"neurogram-mcp"</span>
                    {"]\n"}
                    {"    }\n"}
                    {"  }\n"}
                    {"}"}
                  </code>
                </pre>
              </div>

              <ul className={styles.mcpTools}>
                {MCP_TOOLS.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                    <span>{t.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <hr className="nrg-divider" />

        {/* ========================================================= SCIENCE */}
        <section className={styles.section} id="science">
          <div className={styles.sectionHead}>
            <span className="rule-label">the science</span>
          </div>
          <blockquote className={styles.quote}>
            A memory isn't a file you store. It's a <em>pattern of connection</em>
            {" "}— and connection is something you can map.
          </blockquote>
          <ol className={styles.principles}>
            {PRINCIPLES.map((p) => (
              <li key={p.term}>
                <span className={styles.principleIndex}>{p.index}</span>
                <strong>{p.term}</strong>
                <span className={styles.archDetail}>{p.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <hr className="nrg-divider" />

        {/* ============================================================= FAQ */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className="rule-label">the honest answers</span>
            <h2>Questions, answered plainly.</h2>
          </div>
          <div className={styles.faq}>
            {FAQS.map((f) => (
              <details className={styles.faqItem} key={f.q}>
                <summary>
                  <span>{f.q}</span>
                  <i className={styles.faqMark} aria-hidden="true" />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ======================================================= CTA BAND */}
        <section className={styles.ctaBand}>
          <div className={styles.ctaGrid} aria-hidden="true" />
          <h2>
            Open the workspace. Record your first memory.
            <br />
            <em>Watch the associations draw themselves.</em>
          </h2>
          <div className={styles.heroCta}>
            <a className="nrg-btn nrg-btn--solid" href="/atlas">
              Open the atlas →
            </a>
            <a className="nrg-btn" href="/memories">
              Browse memories
            </a>
          </div>
        </section>
      </main>

      {/* ========================================================== FOOTER */}
      <footer className={styles.footer}>
        <Wordmark />
        <nav className={styles.footerLinks} aria-label="Footer">
          <a href="/atlas">Atlas</a>
          <a href="/memories">Memories</a>
          <a href="/graph">Graph</a>
          <a href="/memories/compare">Compare</a>
        </nav>
        <span className={styles.footerFine}>A map of remembered things</span>
      </footer>
    </div>
  );
}
