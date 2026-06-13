const params = new URLSearchParams(window.location.search);
let leftMemoryId = params.get("left") || "";
let rightMemoryId = params.get("right") || "";
let loading = false;

const elements = {
  status: document.querySelector("#compareStatus"),
  content: document.querySelector("#comparisonContent"),
  pair: document.querySelector("#memoryPair"),
  analysisPanel: document.querySelector("#analysisPanel"),
  relationship: document.querySelector("#analysisRelationship"),
  meta: document.querySelector("#analysisMeta"),
  overview: document.querySelector("#analysisOverview"),
  findings: document.querySelector("#analysisFindings"),
  structural: document.querySelector("#structuralDiff"),
  regions: document.querySelector("#regionDiff"),
  activationOverview: document.querySelector("#activationOverview"),
  activationFindings: document.querySelector("#activationFindings"),
  activationNotes: document.querySelector("#activationNotes"),
  swap: document.querySelector("#swapMemories"),
  regenerate: document.querySelector("#regenerateComparison"),
};

elements.swap.addEventListener("click", () => {
  if (loading) return;
  [leftMemoryId, rightMemoryId] = [rightMemoryId, leftMemoryId];
  syncUrl();
  loadComparison();
});
elements.regenerate.addEventListener("click", () => loadComparison(true));

if (!leftMemoryId || !rightMemoryId || leftMemoryId === rightMemoryId) {
  showStatus(
    "Choose two different memories from the memory catalog before opening this page.",
    true,
  );
  elements.swap.disabled = true;
  elements.regenerate.disabled = true;
} else {
  loadComparison();
}

async function loadComparison(regenerate = false) {
  if (loading) return;
  loading = true;
  elements.swap.disabled = true;
  elements.regenerate.disabled = true;
  showStatus(
    regenerate
      ? "Regenerating AI analysis…"
      : "Loading memories and generating comparison…",
  );

  try {
    const response = await fetch("/api/memory-comparisons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leftMemoryId,
        rightMemoryId,
        regenerate,
      }),
    });
    const result = await response.json();
    if (!response.ok && !result.left) {
      throw new Error(readError(result));
    }
    renderComparison(result);
    if (response.ok) {
      hideStatus();
    } else {
      showStatus(
        `AI analysis unavailable: ${result.detail || result.error}. This failed result was not saved; deterministic differences and activation explanations are shown below.`,
        true,
      );
    }
  } catch (error) {
    elements.content.hidden = true;
    showStatus(`Unable to compare memories: ${error.message}`, true);
  } finally {
    loading = false;
    elements.swap.disabled = false;
    elements.regenerate.disabled = false;
  }
}

function renderComparison(result) {
  elements.content.hidden = false;
  renderMemoryPair(result.left, result.right);
  renderAnalysis(result.analysis, result.generation);
  renderStructuralDiff(result.structuralDiff);
  renderActivationAnalysis(result.structuralDiff?.activationAnalysis);
  renderRegionDiff(result.structuralDiff?.regions || []);
}

function renderMemoryPair(left, right) {
  elements.pair.replaceChildren(
    createMemoryCard("Left memory", left),
    createMemoryCard("Right memory", right),
  );
}

function createMemoryCard(label, memory) {
  const article = document.createElement("article");
  article.className = "compare-memory-card";
  const eyebrow = paragraph(label, "eyebrow");
  const title = document.createElement("h2");
  title.textContent = memory.title || memory.summary || "Untitled memory";
  const text = paragraph(memory.raw_text, "memory-raw-text");
  const summary = paragraph(
    memory.summary || "No stored summary",
    "memory-summary",
  );
  const meta = document.createElement("dl");
  meta.className = "memory-meta";
  appendMeta(meta, "Source", memory.source === "mcp" ? "Agent" : "User");
  appendMeta(meta, "Ingested", formatDateTime(memory.ingestion_date));
  appendMeta(meta, "Created", formatDateTime(memory.created_at));
  article.append(eyebrow, title, text, summary, meta);
  return article;
}

function renderAnalysis(analysis, generation) {
  elements.findings.replaceChildren();
  elements.meta.replaceChildren();
  if (!analysis) {
    elements.analysisPanel.classList.add("is-unavailable");
    elements.relationship.textContent = "Analysis unavailable";
    elements.overview.textContent =
      "The provider did not return a validated comparison.";
    elements.meta.append(badge("Not saved"));
    return;
  }
  elements.analysisPanel.classList.remove("is-unavailable");
  elements.relationship.textContent = capitalize(analysis.relationship);
  elements.overview.textContent = analysis.overview;
  elements.meta.append(
    badge(formatPercent(analysis.confidence)),
    badge(generation.cached ? "Cached" : "Generated"),
    badge(generation.saved ? "Saved" : "Not saved"),
    badge(generation.model),
  );
  elements.findings.append(
    createFindingSection("Shared facts", analysis.sharedFacts),
    createFindingSection("Differences", analysis.differences),
    createFindingSection("Contradictions", analysis.contradictions),
    createCaveatSection(analysis.caveats),
  );
}

function renderActivationAnalysis(analysis) {
  elements.activationFindings.replaceChildren();
  elements.activationNotes.replaceChildren();
  elements.activationOverview.textContent =
    analysis?.summary || "No activation explanation is available.";

  (analysis?.findings || []).slice(0, 6).forEach((finding) => {
    const article = document.createElement("article");
    article.className = "activation-finding";
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = finding.label;
    heading.append(title, badge(formatSignedPercent(finding.delta)));
    const explanation = paragraph(finding.explanation);
    const role = paragraph(finding.role, "activation-role");
    const reasons = document.createElement("div");
    reasons.className = "activation-reason-pair";
    reasons.append(
      labeledList("Left mapping inputs", finding.leftReasons),
      labeledList("Right mapping inputs", finding.rightReasons),
    );
    article.append(heading, explanation, role, reasons);
    elements.activationFindings.append(article);
  });

  (analysis?.notes || []).forEach((note) => {
    const item = document.createElement("li");
    item.textContent = note;
    elements.activationNotes.append(item);
  });
}

function createFindingSection(title, findings = []) {
  const section = document.createElement("section");
  section.className = "finding-section";
  const heading = document.createElement("h3");
  heading.textContent = `${title} · ${findings.length}`;
  section.append(heading);
  if (!findings.length) {
    section.append(paragraph("None identified.", "empty-copy"));
    return section;
  }
  findings.forEach((finding) => {
    const card = document.createElement("article");
    card.className = "finding-card";
    const top = document.createElement("div");
    top.append(
      paragraph(finding.statement),
      badge(formatPercent(finding.confidence)),
    );
    const evidence = document.createElement("div");
    evidence.className = "finding-evidence";
    evidence.append(
      evidenceQuote("Left", finding.leftEvidence),
      evidenceQuote("Right", finding.rightEvidence),
    );
    card.append(top, evidence);
    section.append(card);
  });
  return section;
}

function createCaveatSection(caveats = []) {
  const section = document.createElement("section");
  section.className = "finding-section";
  const heading = document.createElement("h3");
  heading.textContent = `Caveats · ${caveats.length}`;
  const list = document.createElement("ul");
  list.className = "plain-list";
  (caveats.length ? caveats : ["None identified."]).forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
  section.append(heading, list);
  return section;
}

function evidenceQuote(label, value) {
  const block = document.createElement("blockquote");
  const strong = document.createElement("strong");
  strong.textContent = label;
  block.append(strong, document.createTextNode(value || "No evidence on this side"));
  return block;
}

function renderStructuralDiff(diff) {
  elements.structural.replaceChildren();
  if (!diff) return;
  const grid = document.createElement("div");
  grid.className = "diff-grid";
  grid.append(
    createTypeDiff(diff.types),
    createOccurredAtDiff(diff.occurredAt),
    createSetDiff("Entities", diff.entities, formatEntity),
    createSetDiff("Relationships", diff.relationships, formatRelationship),
    createSetDiff("Actions", diff.actions),
    createSetDiff("Topics", diff.topics),
    createProvenanceDiff(diff.provenance),
  );
  elements.structural.append(grid);
}

function createTypeDiff(types = []) {
  const section = diffSection("Memory types");
  const list = document.createElement("ul");
  list.className = "plain-list";
  (types.length ? types : [{ type: "None", left: null, right: null }]).forEach(
    (type) => {
      const item = document.createElement("li");
      item.textContent = `${capitalize(type.type)}: ${formatOptionalPercent(type.left)} → ${formatOptionalPercent(type.right)}`;
      list.append(item);
    },
  );
  section.append(list);
  return section;
}

function createOccurredAtDiff(value = {}) {
  const section = diffSection("Occurrence");
  section.append(
    sideBySide(
      formatOccurredAt(value.left),
      formatOccurredAt(value.right),
    ),
  );
  return section;
}

function createSetDiff(title, value = {}, formatter = String) {
  const section = diffSection(title);
  section.append(
    labeledList("Shared", value.shared, formatter),
    labeledList("Left only", value.leftOnly, formatter),
    labeledList("Right only", value.rightOnly, formatter),
  );
  return section;
}

function createProvenanceDiff(provenance = {}) {
  const section = diffSection("Provenance");
  const list = document.createElement("dl");
  list.className = "diff-meta";
  Object.entries(provenance).forEach(([label, value]) => {
    appendMeta(
      list,
      humanize(label),
      `${formatValue(value.left)} → ${formatValue(value.right)}`,
    );
  });
  section.append(list);
  return section;
}

function renderRegionDiff(regions) {
  elements.regions.replaceChildren();
  regions.forEach((region) => {
    const row = document.createElement("tr");
    row.append(
      cell(humanize(region.region)),
      cell(formatOptionalPercent(region.left?.weight)),
      cell(formatOptionalPercent(region.right?.weight)),
      cell(formatSignedPercent(region.delta.weight)),
      cell(
        `${formatSignedPercent(region.delta.leftHemisphere)} / ${formatSignedPercent(region.delta.rightHemisphere)}`,
      ),
    );
    elements.regions.append(row);
  });
  if (!regions.length) {
    const row = document.createElement("tr");
    const empty = cell("No region activation data");
    empty.colSpan = 5;
    row.append(empty);
    elements.regions.append(row);
  }
}

function diffSection(title) {
  const section = document.createElement("section");
  section.className = "diff-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  return section;
}

function labeledList(label, values = [], formatter = String) {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-list";
  const heading = document.createElement("strong");
  heading.textContent = label;
  const list = document.createElement("ul");
  list.className = "plain-list";
  (values.length ? values : ["None"]).forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value === "None" ? value : formatter(value);
    list.append(item);
  });
  wrapper.append(heading, list);
  return wrapper;
}

function sideBySide(left, right) {
  const wrapper = document.createElement("div");
  wrapper.className = "diff-sides";
  wrapper.append(
    labeledList("Left", [left]),
    labeledList("Right", [right]),
  );
  return wrapper;
}

function appendMeta(list, label, value) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function badge(value) {
  const span = document.createElement("span");
  span.className = "compare-badge";
  span.textContent = value;
  return span;
}

function paragraph(value, className = "") {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = value || "";
  return element;
}

function cell(value) {
  const element = document.createElement("td");
  element.textContent = value;
  return element;
}

function formatEntity(entity) {
  return `${entity.name} · ${entity.kind}`;
}

function formatRelationship(relationship) {
  return `${relationship.subject} ${relationship.predicate} ${relationship.object}`;
}

function formatOccurredAt(value) {
  if (!value) return "Not available";
  return value.text || value.normalized || "Not specified";
}

function formatValue(value) {
  if (!value) return "Not available";
  return String(value).includes("T") ? formatDateTime(value) : String(value);
}

function formatDateTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatPercent(value) {
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatOptionalPercent(value) {
  return value === null || value === undefined
    ? "Not present"
    : formatPercent(value);
}

function formatSignedPercent(value) {
  if (value === null || value === undefined) return "n/a";
  const formatted = formatPercent(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`;
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : "Not available";
}

function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function readError(result) {
  if (typeof result.error === "string") return result.error;
  if (Array.isArray(result.error)) {
    return result.error.map((issue) => issue.message).join("; ");
  }
  return "Comparison request failed";
}

function syncUrl() {
  const query = new URLSearchParams({
    left: leftMemoryId,
    right: rightMemoryId,
  });
  window.history.replaceState(null, "", `/memories/compare?${query}`);
}

function showStatus(message, error = false) {
  elements.status.hidden = false;
  elements.status.classList.toggle("is-error", error);
  elements.status.textContent = message;
}

function hideStatus() {
  elements.status.hidden = true;
}
