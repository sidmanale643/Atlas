import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "../lib/motion";
import InteractiveArchitecture from "../components/InteractiveArchitecture";
import NeuralCanvas from "../components/NeuralCanvas";
import EegWaveform from "../components/EegWaveform";
import styles from "./Landing.module.css";
import { useAuth } from "../auth/AuthProvider";

/** Inline style carrying a CSS custom property (e.g. --i, --w). */
const cssVars = (vars: Record<string, string>): CSSProperties =>
  vars as CSSProperties;

/* ------------------------------------------------------------------ content */

const HERO_METRICS: ReadonlyArray<{ figure: string; label: string }> = [
  { figure: "11", label: "facets extracted per moment" },
  { figure: "2", label: "indexes for instant recall" },
  { figure: "9", label: "tools to read & write memory" },
  { figure: "18", label: "endpoints to read & write memory" },
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
    q: "Where do my memories actually live?",
    a: "On your machine. SQLite holds the graph (the bones); LanceDB holds the embeddings (the smell). Only the extraction step calls the LLM provider you configure.",
  },
  {
    q: "Does it need an LLM?",
    a: "Extraction — turning a sentence into entities, relationships and regions — calls a configured LLM. Everything you've already captured stays browsable without it.",
  },
  {
    q: "How is this different from ChatGPT's memory?",
    a: "ChatGPT keeps a short, opaque summary it manages for you. Atlas keeps the full record — every entity, relationship and region — under your control, queryable by meaning, by association or by name, and shareable with any MCP-capable assistant.",
  },
  {
    q: "What do I actually need to run it?",
    a: "A local Node server, a SQLite file and a local LanceDB directory — all of which you keep. Bring your own LLM key for the extraction step. No Atlas cloud account or telemetry.",
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
      <span>Atlas</span>
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
  const auth = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);
  const [extracted, setExtracted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.page} ref={rootRef}>
      {/* ---- top bar ---- */}
      <motion.header
        className={`${styles.topbar} ${scrolled ? styles.topbarScrolled : ""}`}
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>
          <Wordmark />
        </motion.div>
        <nav className={styles.topnav} aria-label="Primary">
          <motion.a href="/how-it-works" variants={fadeUp}>How it works</motion.a>
          <motion.a href="#architecture" variants={fadeUp}>Architecture</motion.a>
          <motion.a href="#mcp" variants={fadeUp}>Connect</motion.a>
          <motion.a href="#science" variants={fadeUp}>Science</motion.a>
          <motion.a href="https://github.com/sidmanale643/Atlas" target="_blank" rel="noopener noreferrer" variants={fadeUp}>GitHub</motion.a>
          <motion.div className={styles.authControls} variants={fadeUp}>
            {auth.state.kind === "authenticated" ? (
              <>
                <span className={styles.accountEmail} title={auth.state.user.email}>{auth.state.user.email ?? "Signed in"}</span>
                <button type="button" onClick={() => void auth.logout()}>Log out</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => auth.openAuthModal("login")}>Log in</button>
                <button type="button" onClick={() => auth.openAuthModal("signup")}>Sign up</button>
              </>
            )}
          </motion.div>
          <motion.a className={`nrg-btn ${styles.barCta}`} href="/atlas" variants={fadeUp}>
            Open the atlas
          </motion.a>
        </nav>
      </motion.header>

      <main>
        {/* ============================================================ HERO */}
        <section className={styles.hero}>
          <div className={styles.heroGrid} aria-hidden="true" />
          <NeuralCanvas />
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
              Add a moment. Atlas breaks it into people, places, time and
              activity — places it anatomically across the cortex — then draws the
              associations that make it retrievable. A brain, not a notebook.
            </p>
            <div className={`${styles.heroCta} ${styles.reveal}`}>
              <a className="nrg-btn nrg-btn--solid" href="/atlas">
                Open the atlas →
              </a>
              <a className="nrg-btn" href="/how-it-works">
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
          <EegWaveform />
          <aside className={styles.marginNote} aria-hidden="true">
            fig. 1 — a single moment, decomposed and re-wired
          </aside>
        </section>

        {/* ====================================================== EXTRACTION */}
        <section className={styles.section} id="extraction">
          <div className={styles.sectionHead}>
            <span className="rule-label">extraction lab</span>
            <h2>From a memory to a synapse.</h2>
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
              One memory, one source, <em>three ways back.</em>
            </h2>
            <p>
              A moment is captured once, then persisted to a relational graph and a
              vector index as a rebuildable projection — so it can be recalled by meaning, by
              association, or by name. A Node server orchestrates the write; an MCP
              server exposes it to agents.
            </p>
          </div>

          <InteractiveArchitecture />

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
                Atlas ships an MCP server. Point any client — Claude among them
                — at it, and your assistant writes to and recalls from the same
                atlas you explore, persisting memory across every session.
              </p>
              <p className={styles.mcpFine}>
                Reads are safe by default — <code>delete_memory</code> is the only
                destructive call, and it confirms first.
              </p>
              <div className={styles.mcpInstall}>
                <span className={styles.mcpInstallLabel}>Quick start</span>
                <pre className={styles.mcpInstallCode}><code>{"npm i -g atlas-mcp\nnpx atlas-mcp"}</code></pre>
              </div>
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
                    <span className={styles.tokK}>"atlas"</span>
                    {": {\n"}
                    {"      "}
                    <span className={styles.tokK}>"command"</span>
                    {": "}
                    <span className={styles.tokS}>"npx"</span>
                    {",\n"}
                    {"      "}
                    <span className={styles.tokK}>"args"</span>
                    {": ["}
                    <span className={styles.tokS}>"atlas-mcp"</span>
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
          <a href="https://github.com/sidmanale643/Atlas" target="_blank" rel="noopener noreferrer">GitHub</a>
        </nav>
        <span className={styles.footerFine}>A map of remembered things</span>
      </footer>
    </div>
  );
}
