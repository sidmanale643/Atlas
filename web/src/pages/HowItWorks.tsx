import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { staggerContainer, fadeUp } from "../lib/motion";
import Reveal from "../components/Reveal";
import BrainDiagram from "../components/BrainDiagram";
import shell from "./Landing.module.css";
import styles from "./HowItWorks.module.css";

/* ------------------------------------------------------------------ content */

const STEPS: ReadonlyArray<{ index: string; term: string; lead: string; body: string }> = [
  {
    index: "01",
    term: "A moment goes in",
    lead: "It starts with a sentence.",
    body:
      "You add a moment in plain language — up to ~180 characters, no schema, no tags. “I went to a cafe with Maya yesterday.” That single line is the raw material; everything downstream is Atlas deciding what it means and where it belongs.",
  },
  {
    index: "02",
    term: "The sentence is decoded",
    lead: "Language becomes structure.",
    body:
      "A schema-locked extraction step reads the sentence and returns three things: the named entities (Maya · person, a cafe · place, yesterday · time), the relationship triple that binds them (self → went to a cafe with → Maya), and a weighted activation map across the cortex. This is the only step that calls an LLM.",
  },
];

const RECALL: ReadonlyArray<{ index: string; way: string; via: string; body: string }> = [
  {
    index: "α",
    way: "By meaning",
    via: "vector index · LanceDB",
    body:
      "Your query is embedded and matched against every stored memory by cosine distance — so a search for “coffee with a friend” surfaces the cafe moment even though none of those words appear in it.",
  },
  {
    index: "β",
    way: "By association",
    via: "graph · SQLite",
    body:
      "Memories that share entities or relationship triples are linked structurally. Pull on Maya and the whole thread she runs through comes with her — the way one association drags the next out of the dark.",
  },
  {
    index: "γ",
    way: "By name",
    via: "catalog · full-text",
    body:
      "Exact lookup across names, aliases and summaries. When you know precisely who or what you're after, the catalog returns it directly, without any inference in the loop.",
  },
];

/* ------------------------------------------------------------------ wordmark */

function Wordmark() {
  return (
    <a href="/" className={shell.wordmark}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className={shell.glyph}>
        <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="19.5" cy="12" r="1.9" fill="currentColor" />
        <circle cx="12" cy="20" r="1.5" fill="currentColor" />
        <path d="M19.5 12 L12 20" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      </svg>
      <span>Atlas</span>
    </a>
  );
}

/* A small co-occurrence graph: two memories wiring through a shared person. */
function WiringDiagram() {
  return (
    <svg
      className={styles.wiring}
      viewBox="0 0 640 240"
      role="img"
      aria-label="Two memories linked through a shared entity, illustrating Hebbian wiring"
    >
      <defs>
        <radialGradient id="hiw-node" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(56,130,246,0.28)" />
          <stop offset="100%" stopColor="rgba(56,130,246,0.02)" />
        </radialGradient>
      </defs>

      {/* links */}
      <line className={styles.wireLink} x1="150" y1="78" x2="320" y2="120" />
      <line className={styles.wireLink} x1="150" y1="190" x2="320" y2="120" />
      <line className={styles.wireLinkLive} x1="320" y1="120" x2="500" y2="78" />
      <line className={styles.wireLinkLive} x1="320" y1="120" x2="500" y2="190" />

      {/* memory nodes (left + right) */}
      {[
        { x: 150, y: 78, label: "cafe with Maya" },
        { x: 150, y: 190, label: "Maya's birthday" },
        { x: 500, y: 78, label: "lunch downtown" },
        { x: 500, y: 190, label: "the museum trip" },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r="26" fill="url(#hiw-node)" />
          <circle className={styles.wireMem} cx={n.x} cy={n.y} r="9" />
          <text
            className={styles.wireLabel}
            x={n.x}
            y={n.y + (n.y < 120 ? -22 : 34)}
            textAnchor="middle"
          >
            {n.label}
          </text>
        </g>
      ))}

      {/* shared entity — the synapse in the middle */}
      <circle className={styles.wireHubGlow} cx="320" cy="120" r="40" />
      <circle className={styles.wireHub} cx="320" cy="120" r="15" />
      <text className={styles.wireHubLabel} x="320" y="170" textAnchor="middle">
        Maya
      </text>
      <text className={styles.wireHubTag} x="320" y="186" textAnchor="middle">
        shared entity
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ page */

export default function HowItWorks() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={shell.page}>
      {/* ---- top bar ---- */}
      <motion.header
        className={`${shell.topbar} ${scrolled ? shell.topbarScrolled : ""}`}
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>
          <Wordmark />
        </motion.div>
        <nav className={shell.topnav} aria-label="Primary">
          <motion.a href="/" variants={fadeUp}>Home</motion.a>
          <motion.a href="/#science" variants={fadeUp}>Science</motion.a>
          <motion.a href="/#mcp" variants={fadeUp}>Connect</motion.a>
          <motion.a
            href="https://github.com/sidmanale643/Atlas"
            target="_blank"
            rel="noopener noreferrer"
            variants={fadeUp}
          >
            GitHub
          </motion.a>
          <motion.a className={`nrg-btn ${shell.barCta}`} href="/atlas" variants={fadeUp}>
            Open the atlas
          </motion.a>
        </nav>
      </motion.header>

      <main>
        {/* ============================================================ HERO */}
        <section className={`${shell.hero} ${styles.hero}`}>
          <div className={shell.heroGrid} aria-hidden="true" />
          <div className={shell.heroInner}>
            <p className={`${shell.heroCoord} ${shell.reveal}`}>
              <span className="label">atlas · how it works · build 2026.06</span>
            </p>
            <h1 className={`${shell.heroTitle} ${styles.heroTitle} ${shell.reveal}`}>
              A memory is a
              <br />
              <em>pattern of connection.</em>
            </h1>
            <p className={`${shell.heroSub} ${shell.reveal}`}>
              Atlas doesn't file your memories away. It does what a brain does — breaks a
              moment into people, places, time and feeling, places each fragment across a
              working model of the cortex, then wires it to everything it resembles. Here is
              the whole path, from a sentence to a synapse.
            </p>
            <div className={`${shell.heroCta} ${shell.reveal}`}>
              <a className="nrg-btn nrg-btn--solid" href="/atlas">
                Open the atlas →
              </a>
              <a className="nrg-btn" href="#the-brain">
                Skip to the brain ↓
              </a>
            </div>
          </div>
          <aside className={shell.marginNote} aria-hidden="true">
            fig. 0 — the route a moment travels
          </aside>
        </section>

        {/* ====================================================== THE STEPS */}
        <section className={shell.section} id="capture">
          <div className={shell.sectionHead}>
            <span className="rule-label">before the brain</span>
            <h2>
              From a sentence <em>to a signal.</em>
            </h2>
            <p>
              Two steps turn raw language into something the brain model can hold. They are
              deliberately the boring part — the interesting work happens once the signal
              reaches the cortex.
            </p>
          </div>

          <ol className={styles.steps}>
            {STEPS.map((s) => (
              <Reveal key={s.index} className={styles.step}>
                <span className={styles.stepIndex}>{s.index}</span>
                <div className={styles.stepBody}>
                  <h3 className={styles.stepLead}>{s.lead}</h3>
                  <p className={styles.stepTerm}>{s.term}</p>
                  <p className={styles.stepText}>{s.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        <hr className="nrg-divider" />

        {/* ======================================================= THE BRAIN */}
        <section className={`${shell.section} ${styles.brainSection}`} id="the-brain">
          <div className={shell.sectionHead}>
            <span className="rule-label">the brain</span>
            <h2>
              Every memory <em>lands somewhere.</em>
            </h2>
            <p>
              This is the heart of Atlas. Real brains don't keep memory in one place — they
              distribute it across specialised regions, each handling a different facet of an
              experience. Atlas models that anatomy directly: the activation map from
              extraction lights these same regions, weighting where a given memory truly
              lives.
            </p>
          </div>

          <blockquote className={styles.brainQuote}>
            Recall isn't reading a file. It's a region <em>firing</em> — and the brighter it
            fires, the faster the memory comes back.
          </blockquote>

          <Reveal>
            <BrainDiagram />
          </Reveal>

          <p className={styles.brainHint}>
            <span className="label">tip</span> Hover a region — or use ↑ / ↓ — to see what it
            holds.
          </p>

          <div className={styles.brainNotes}>
            <Reveal className={styles.brainNote}>
              <h3>Laterality is real here</h3>
              <p>
                Each memory's hippocampal activation is split left and right: the left leans
                verbal, the right leans spatial. The same moment is held two ways at once, so
                it can be reached by what was said or by where it happened.
              </p>
            </Reveal>
            <Reveal className={styles.brainNote} delay={0.08}>
              <h3>Type decides anatomy</h3>
              <p>
                An episodic moment leans on the hippocampus; a skill leans on the basal
                ganglia; a charged feeling weights the amygdala. The kind of memory it is
                changes which regions light — exactly as it does in the tissue.
              </p>
            </Reveal>
            <Reveal className={styles.brainNote} delay={0.16}>
              <h3>A principled map, not a scan</h3>
              <p>
                Region weights follow established memory-systems research, but they remain an
                interpretive model — built to make the structure of a memory visible, never to
                diagnose. The point is a faithful metaphor you can actually query.
              </p>
            </Reveal>
          </div>
        </section>

        <hr className="nrg-divider" />

        {/* ========================================================= WIRING */}
        <section className={shell.section} id="wiring">
          <div className={shell.sectionHead}>
            <span className="rule-label">hebbian wiring</span>
            <h2>
              Fire together, <em>wire together.</em>
            </h2>
            <p>
              A memory is never stored alone. When two moments share a person, a place or a
              relationship, Atlas strengthens the link between them — Hebb's rule, the oldest
              law in neuroscience. Over time the shared entities become hubs, and recall
              spreads outward through them.
            </p>
          </div>

          <Reveal>
            <WiringDiagram />
          </Reveal>
          <p className={shell.archNote}>
            Pull on one node and its neighbours light through the shared hub — the same way one
            thought hands you the next.
          </p>
        </section>

        <hr className="nrg-divider" />

        {/* ========================================================= RECALL */}
        <section className={shell.section} id="recall">
          <div className={shell.sectionHead}>
            <span className="rule-label">recall</span>
            <h2>
              Three ways back <em>to a moment.</em>
            </h2>
            <p>
              Because a memory is held as structure, anatomy and meaning at once, there's never
              just one route to it. Atlas runs all three retrieval paths and fuses their
              signal.
            </p>
          </div>

          <ol className={styles.recall}>
            {RECALL.map((r) => (
              <Reveal key={r.way} className={styles.recallItem}>
                <span className={styles.recallIndex}>{r.index}</span>
                <div>
                  <p className={styles.recallHead}>
                    <strong>{r.way}</strong>
                    <code className={styles.recallVia}>{r.via}</code>
                  </p>
                  <p className={styles.recallText}>{r.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>

          <p className={shell.archNote}>
            Signals combine, they don't compete — <code>1 − ∏(1 − signal)</code>. A memory
            found three ways comes back brightest.
          </p>
        </section>

        {/* ======================================================= CTA BAND */}
        <section className={shell.ctaBand}>
          <div className={shell.ctaGrid} aria-hidden="true" />
          <h2>
            Now record a moment of your own.
            <br />
            <em>Watch it find its region.</em>
          </h2>
          <div className={shell.heroCta}>
            <a className="nrg-btn nrg-btn--solid" href="/atlas">
              Open the atlas →
            </a>
            <a className="nrg-btn" href="/">
              Back to home
            </a>
          </div>
        </section>
      </main>

      {/* ========================================================== FOOTER */}
      <footer className={shell.footer}>
        <Wordmark />
        <nav className={shell.footerLinks} aria-label="Footer">
          <a href="/">Home</a>
          <a href="/atlas">Atlas</a>
          <a href="/memories">Memories</a>
          <a href="/graph">Graph</a>
          <a
            href="https://github.com/sidmanale643/Atlas"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </nav>
        <span className={shell.footerFine}>A map of remembered things</span>
      </footer>
    </div>
  );
}
