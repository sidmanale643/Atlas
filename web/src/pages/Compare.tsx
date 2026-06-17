import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type {
  ComparisonFact,
  ComparisonResult,
  Memory,
} from "../lib/types";
import styles from "./Compare.module.css";

/* ---------------------------------------------------------------------------
 * Local shapes for `structuralDiff` (typed `unknown` in lib/types.ts).
 * Mirrors buildMemoryStructuralDiff() in src/memory-comparison.js exactly.
 * ------------------------------------------------------------------------- */

interface DiffEntity {
  name: string;
  kind: string;
}

interface DiffRelationship {
  subject: string;
  predicate: string;
  object: string;
}

interface TypeDelta {
  type: string;
  left: number | null;
  right: number | null;
  delta: number | null;
}

interface OccurredAtValue {
  text: string;
  normalized: string | null;
}

interface SetDiff<T> {
  shared: T[];
  leftOnly: T[];
  rightOnly: T[];
}

interface ProvenanceField {
  left: unknown;
  right: unknown;
  changed?: boolean;
}

interface RegionHemispheres {
  weight: number | null;
  left: number | null;
  right: number | null;
}

interface RegionDelta {
  weight: number | null;
  leftHemisphere: number | null;
  rightHemisphere: number | null;
}

interface RegionDiffRow {
  region: string;
  label: string;
  role: string;
  left: RegionHemispheres | null;
  right: RegionHemispheres | null;
  leftReasons: string[];
  rightReasons: string[];
  delta: RegionDelta;
}

interface ActivationFinding {
  region: string;
  label: string;
  role: string;
  leftWeight: number | null;
  rightWeight: number | null;
  delta: number | null;
  explanation: string;
  leftReasons: string[];
  rightReasons: string[];
}

interface ActivationAnalysis {
  summary: string;
  findings: ActivationFinding[];
  notes: string[];
}

interface StructuralDiff {
  types: TypeDelta[];
  occurredAt: { left: OccurredAtValue; right: OccurredAtValue; changed: boolean };
  entities: SetDiff<DiffEntity>;
  relationships: SetDiff<DiffRelationship>;
  actions: SetDiff<string>;
  topics: SetDiff<string>;
  provenance: Record<string, ProvenanceField>;
  regions: RegionDiffRow[];
  activationAnalysis: ActivationAnalysis;
}

/* ---------------------------------------------------------------------------
 * Formatters — ported 1:1 from public/js/compare.js
 * ------------------------------------------------------------------------- */

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatPercent(value: number | null | undefined): string {
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatOptionalPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "Not present" : formatPercent(value);
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  const formatted = formatPercent(Math.abs(value));
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatted}`;
}

function formatValue(value: unknown): string {
  if (!value) return "Not available";
  const text = String(value);
  return text.includes("T") ? formatDateTime(text) : text;
}

function formatOccurredAt(value: OccurredAtValue | null | undefined): string {
  if (!value) return "Not available";
  return value.text || value.normalized || "Not specified";
}

function capitalize(value: string | null | undefined): string {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "Not available";
}

function humanize(value: string | null | undefined): string {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function formatEntity(entity: DiffEntity): string {
  return `${entity.name} · ${entity.kind}`;
}

function formatRelationship(relationship: DiffRelationship): string {
  return `${relationship.subject} ${relationship.predicate} ${relationship.object}`;
}

function readError(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const obj = payload as { error?: unknown; detail?: unknown };
    if (typeof obj.error === "string") return obj.error;
    if (Array.isArray(obj.error)) {
      return obj.error
        .map((issue) =>
          issue && typeof issue === "object" && "message" in issue
            ? String((issue as { message: unknown }).message)
            : String(issue),
        )
        .join("; ");
    }
  }
  return "Comparison request failed";
}

/* ---------------------------------------------------------------------------
 * Small presentational helpers
 * ------------------------------------------------------------------------- */

function Badge({ children }: { children: React.ReactNode }) {
  return <span className={styles.badge}>{children}</span>;
}

function LabeledList<T>({
  label,
  values,
  formatter = (v) => String(v),
}: {
  label: string;
  values: T[] | undefined;
  formatter?: (value: T) => string;
}) {
  const items = values ?? [];
  return (
    <div className={styles.diffList}>
      <strong className={styles.listLabel}>{label}</strong>
      <ul className={styles.plainList}>
        {items.length ? (
          items.map((value, index) => <li key={index}>{formatter(value)}</li>)
        ) : (
          <li>None</li>
        )}
      </ul>
    </div>
  );
}

function MemoryColumn({ label, memory }: { label: string; memory: Memory }) {
  const entities = memory.entities ?? [];
  const regions = memory.regions ?? [];
  return (
    <article className={styles.memoryColumn}>
      <span className={styles.colLabel}>{label}</span>
      <h2 className={styles.memoryTitle}>
        {memory.title || memory.summary || "Untitled memory"}
      </h2>
      <p className={styles.memoryText}>{memory.raw_text}</p>
      <p className={styles.memorySummary}>{memory.summary || "No stored summary"}</p>

      <dl className={styles.metaGrid}>
        <dt>Type</dt>
        <dd>{capitalize(memory.type)}</dd>
        <dt>Source</dt>
        <dd>{memory.source === "mcp" ? "Agent" : "User"}</dd>
        <dt>Confidence</dt>
        <dd>{formatOptionalPercent(memory.confidence)}</dd>
        <dt>Ingested</dt>
        <dd>{formatDateTime(memory.ingestion_date)}</dd>
        <dt>Created</dt>
        <dd>{formatDateTime(memory.created_at)}</dd>
      </dl>

      <div className={styles.tagGroup}>
        <strong className={styles.listLabel}>Key entities</strong>
        <div className={styles.chips}>
          {entities.length ? (
            entities.map((entity) => (
              <span key={entity.id} className={styles.chip}>
                {entity.canonical_name}
                <span className={styles.chipKind}> {entity.kind}</span>
              </span>
            ))
          ) : (
            <span className={styles.empty}>None extracted</span>
          )}
        </div>
      </div>

      <div className={styles.tagGroup}>
        <strong className={styles.listLabel}>Active regions</strong>
        <div className={styles.chips}>
          {regions.length ? (
            regions.map((region) => (
              <span key={region.region} className={styles.chip}>
                {humanize(region.region)}
                <span className={styles.chipKind}> {formatPercent(region.weight)}</span>
              </span>
            ))
          ) : (
            <span className={styles.empty}>None mapped</span>
          )}
        </div>
      </div>
    </article>
  );
}

function EvidenceQuote({ side, value }: { side: string; value?: string }) {
  return (
    <blockquote className={styles.evidence}>
      <strong className={styles.evidenceSide}>{side}</strong>
      {value || "No evidence on this side"}
    </blockquote>
  );
}

function FindingSection({
  title,
  findings = [],
}: {
  title: string;
  findings?: ComparisonFact[];
}) {
  return (
    <section className={styles.findingSection}>
      <h3 className={styles.subheading}>
        {title} <span className={styles.count}>{findings.length}</span>
      </h3>
      {findings.length ? (
        findings.map((finding, index) => (
          <article key={index} className={styles.findingItem}>
            <div className={styles.findingTop}>
              <p className={styles.findingStatement}>{finding.statement}</p>
              <Badge>{formatPercent(finding.confidence)}</Badge>
            </div>
            <div className={styles.evidencePair}>
              <EvidenceQuote side="Left" value={finding.leftEvidence} />
              <EvidenceQuote side="Right" value={finding.rightEvidence} />
            </div>
          </article>
        ))
      ) : (
        <p className={styles.empty}>None identified.</p>
      )}
    </section>
  );
}

function CaveatSection({ caveats = [] }: { caveats?: string[] }) {
  const items = caveats.length ? caveats : ["None identified."];
  return (
    <section className={styles.findingSection}>
      <h3 className={styles.subheading}>
        Caveats <span className={styles.count}>{caveats.length}</span>
      </h3>
      <ul className={styles.plainList}>
        {items.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

interface State {
  status: "idle" | "loading" | "ready" | "error";
  result: ComparisonResult | null;
  message: string | null;
  isError: boolean;
}

export default function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const left = searchParams.get("left") || "";
  const right = searchParams.get("right") || "";

  const [state, setState] = useState<State>({
    status: "idle",
    result: null,
    message: null,
    isError: false,
  });

  const invalidPair = !left || !right || left === right;

  const loadComparison = useCallback(
    async (leftId: string, rightId: string, regenerate: boolean) => {
      setState((prev) => ({
        ...prev,
        status: "loading",
        message: regenerate
          ? "Regenerating AI analysis…"
          : "Loading memories and generating comparison…",
        isError: false,
      }));
      try {
        const result = await api.compare(leftId, rightId, regenerate);
        // analysis === null means the provider failed but deterministic
        // differences are still present; show them with an inline notice.
        const analysisFailed = result.analysis === null;
        setState({
          status: "ready",
          result,
          message: analysisFailed
            ? `AI analysis unavailable${
                result.detail || result.error
                  ? `: ${result.detail || result.error}`
                  : ""
              }. This failed result was not saved; deterministic differences and activation explanations are shown below.`
            : null,
          isError: analysisFailed,
        });
      } catch (error) {
        const err = error as Error & { payload?: unknown };
        const message = err.payload
          ? readError(err.payload)
          : err.message || "Comparison request failed";
        setState({
          status: "error",
          result: null,
          message: `Unable to compare memories: ${message}`,
          isError: true,
        });
      }
    },
    [],
  );

  useEffect(() => {
    document.title = "Compare memories · Atlas";
  }, []);

  useEffect(() => {
    if (invalidPair) {
      setState({ status: "idle", result: null, message: null, isError: false });
      return;
    }
    void loadComparison(left, right, false);
  }, [left, right, invalidPair, loadComparison]);

  const busy = state.status === "loading";

  const handleSwap = () => {
    if (busy || invalidPair) return;
    setSearchParams({ left: right, right: left });
  };

  const handleRegenerate = () => {
    if (busy || invalidPair) return;
    void loadComparison(left, right, true);
  };

  const result = state.result;
  const diff = (result?.structuralDiff as StructuralDiff | undefined) ?? null;
  const activation = diff?.activationAnalysis ?? null;
  const regions = diff?.regions ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Compare memories</h1>
        <p className={styles.lede}>
          AI interpretation is grounded in exact evidence. Structural and neural
          differences remain available if generation fails.
        </p>
        <div className={styles.controls}>
          <Link to="/memories" className="nrg-btn">
            &larr; Back to memories
          </Link>
          <button
            type="button"
            className="nrg-btn"
            onClick={handleSwap}
            disabled={busy || invalidPair}
          >
            Swap sides
          </button>
          <button
            type="button"
            className="nrg-btn"
            onClick={handleRegenerate}
            disabled={busy || invalidPair}
          >
            Regenerate analysis
          </button>
        </div>
      </header>

      <hr className="nrg-divider" />

      {invalidPair ? (
        <p className={styles.notice}>
          Choose two different memories from the{" "}
          <Link to="/memories">memory catalog</Link> before opening this page.
        </p>
      ) : null}

      {!invalidPair && state.status === "loading" ? (
        <p className={styles.notice}>{state.message}</p>
      ) : null}

      {!invalidPair && state.status === "error" ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>{state.message}</p>
      ) : null}

      {!invalidPair && state.status === "ready" && result ? (
        <div className={styles.content}>
          {/* ---- Memory pair, separated by a vertical hairline ---- */}
          <section className={styles.memoryPair}>
            <MemoryColumn label="Left memory" memory={result.left} />
            <div className={styles.vrule} aria-hidden="true" />
            <MemoryColumn label="Right memory" memory={result.right} />
          </section>

          <hr className="nrg-divider" />

          {/* ---- AI analysis ---- */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>
                {result.analysis
                  ? capitalize(result.analysis.relationship)
                  : "Analysis unavailable"}
              </h2>
              <div className={styles.metaRow}>
                {result.analysis ? (
                  <>
                    <Badge>{formatPercent(result.analysis.confidence)}</Badge>
                    <Badge>{result.generation.cached ? "Cached" : "Generated"}</Badge>
                    <Badge>{result.generation.saved ? "Saved" : "Not saved"}</Badge>
                    <Badge>{result.generation.model}</Badge>
                  </>
                ) : (
                  <Badge>Not saved</Badge>
                )}
              </div>
            </div>

            {state.isError && state.message ? (
              <p className={`${styles.notice} ${styles.noticeError}`}>
                {state.message}
              </p>
            ) : null}

            <p className={styles.overview}>
              {result.analysis
                ? result.analysis.overview
                : "The provider did not return a validated comparison. Deterministic differences and activation explanations are shown below."}
            </p>

            {result.analysis ? (
              <div className={styles.findings}>
                <FindingSection
                  title="Shared facts"
                  findings={result.analysis.sharedFacts}
                />
                <FindingSection
                  title="Differences"
                  findings={result.analysis.differences}
                />
                <FindingSection
                  title="Contradictions"
                  findings={result.analysis.contradictions}
                />
                <CaveatSection caveats={result.analysis.caveats} />
              </div>
            ) : null}
          </section>

          <hr className="nrg-divider" />

          {/* ---- Stored / structural differences ---- */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Stored differences</h2>
            </div>
            {diff ? (
              <div className={styles.diffGrid}>
                {/* Memory types */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Memory types</h3>
                  <ul className={styles.plainList}>
                    {(diff.types.length
                      ? diff.types
                      : [{ type: "None", left: null, right: null, delta: null }]
                    ).map((type, index) => (
                      <li key={index}>
                        {capitalize(type.type)}: {formatOptionalPercent(type.left)}{" "}
                        &rarr; {formatOptionalPercent(type.right)}
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Occurrence */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Occurrence</h3>
                  <div className={styles.diffSides}>
                    <LabeledList
                      label="Left"
                      values={[formatOccurredAt(diff.occurredAt?.left)]}
                    />
                    <LabeledList
                      label="Right"
                      values={[formatOccurredAt(diff.occurredAt?.right)]}
                    />
                  </div>
                </section>

                {/* Entities */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Entities</h3>
                  <LabeledList
                    label="Shared"
                    values={diff.entities?.shared}
                    formatter={formatEntity}
                  />
                  <LabeledList
                    label="Left only"
                    values={diff.entities?.leftOnly}
                    formatter={formatEntity}
                  />
                  <LabeledList
                    label="Right only"
                    values={diff.entities?.rightOnly}
                    formatter={formatEntity}
                  />
                </section>

                {/* Relationships */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Relationships</h3>
                  <LabeledList
                    label="Shared"
                    values={diff.relationships?.shared}
                    formatter={formatRelationship}
                  />
                  <LabeledList
                    label="Left only"
                    values={diff.relationships?.leftOnly}
                    formatter={formatRelationship}
                  />
                  <LabeledList
                    label="Right only"
                    values={diff.relationships?.rightOnly}
                    formatter={formatRelationship}
                  />
                </section>

                {/* Actions */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Actions</h3>
                  <LabeledList label="Shared" values={diff.actions?.shared} />
                  <LabeledList label="Left only" values={diff.actions?.leftOnly} />
                  <LabeledList label="Right only" values={diff.actions?.rightOnly} />
                </section>

                {/* Topics */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Topics</h3>
                  <LabeledList label="Shared" values={diff.topics?.shared} />
                  <LabeledList label="Left only" values={diff.topics?.leftOnly} />
                  <LabeledList label="Right only" values={diff.topics?.rightOnly} />
                </section>

                {/* Provenance */}
                <section className={styles.diffSection}>
                  <h3 className={styles.subheading}>Provenance</h3>
                  <dl className={styles.metaGrid}>
                    {Object.entries(diff.provenance ?? {}).map(([label, value]) => (
                      <div key={label} className={styles.metaPair}>
                        <dt>{humanize(label)}</dt>
                        <dd>
                          {formatValue(value.left)} &rarr; {formatValue(value.right)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
            ) : (
              <p className={styles.empty}>No stored differences available.</p>
            )}
          </section>

          <hr className="nrg-divider" />

          {/* ---- Why activation differs ---- */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Why activation differs</h2>
            </div>

            <p className={styles.overview}>
              {activation?.summary || "No activation explanation is available."}
            </p>

            <div className={styles.activationFindings}>
              {(activation?.findings ?? []).slice(0, 6).map((finding) => (
                <article key={finding.region} className={styles.activationFinding}>
                  <div className={styles.activationHead}>
                    <h3 className={styles.subheading}>{finding.label}</h3>
                    <Badge>{formatSignedPercent(finding.delta)}</Badge>
                  </div>
                  <p className={styles.activationExplain}>{finding.explanation}</p>
                  {finding.role ? (
                    <p className={styles.activationRole}>{finding.role}</p>
                  ) : null}
                  <div className={styles.diffSides}>
                    <LabeledList
                      label="Left mapping inputs"
                      values={finding.leftReasons}
                    />
                    <LabeledList
                      label="Right mapping inputs"
                      values={finding.rightReasons}
                    />
                  </div>
                </article>
              ))}
            </div>

            {activation?.notes?.length ? (
              <ul className={styles.notes}>
                {activation.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            ) : null}

            {/* Region activation diff table with hemisphere deltas */}
            <div className={styles.tableFrame}>
              <table className={styles.regionTable}>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Left</th>
                    <th>Right</th>
                    <th>Delta</th>
                    <th>Hemisphere delta L / R</th>
                  </tr>
                </thead>
                <tbody>
                  {regions.length ? (
                    regions.map((region) => (
                      <tr key={region.region}>
                        <td>{humanize(region.region)}</td>
                        <td>{formatOptionalPercent(region.left?.weight)}</td>
                        <td>{formatOptionalPercent(region.right?.weight)}</td>
                        <td>{formatSignedPercent(region.delta.weight)}</td>
                        <td>
                          {formatSignedPercent(region.delta.leftHemisphere)} /{" "}
                          {formatSignedPercent(region.delta.rightHemisphere)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>No region activation data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
