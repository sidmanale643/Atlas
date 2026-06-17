import { useEffect, useRef } from "react";
import "./Atlas.css";

/*
 * The 3D brain lives in web/src/viz/brain/app.js — copied verbatim from the
 * legacy atlas and STRICTLY unchanged. It self-initializes on import and reads
 * the DOM by id/class, and it clones <template id="memoryCardTemplate"> via
 * `.content`. React-built <template> elements don't populate `.content`, so the
 * scaffold below is injected as real parsed HTML, then the module is imported.
 */
const SCAFFOLD = `
  <section class="atlas-grid">
    <aside class="memory-log">
      <div class="memory-log-header">
        <h2 class="atlas-h">Recent traces</h2>
        <div class="atlas-count"><strong id="memoryCount">0</strong><span>shown</span></div>
      </div>

      <div class="atlas-controls">
        <div class="memory-search">
          <label class="visually-hidden" for="memorySearch">Search memories</label>
          <input id="memorySearch" type="search" autocomplete="off"
            placeholder="Search memories by meaning" aria-describedby="memorySearchStatus" />
          <button class="text-button" id="resetFiltersButton" type="button" hidden>Reset</button>
        </div>
        <p class="memory-search-status" id="memorySearchStatus" role="status" aria-live="polite" hidden></p>
        <div class="atlas-actions">
          <div class="source-filter" role="group" aria-label="Filter memories by source">
            <button class="filter-button active" data-filter="all" type="button" aria-pressed="true">All</button>
            <button class="filter-button" data-filter="ui" type="button" aria-pressed="false">User</button>
            <button class="filter-button" data-filter="mcp" type="button" aria-pressed="false">Agent</button>
          </div>
          <button class="text-button" id="clearSelectionButton" type="button" hidden>Clear selection</button>
        </div>
      </div>

      <div class="memory-list" id="memoryList"></div>
      <button class="text-button clear-atlas-button" id="clearButton" type="button">Clear atlas</button>
    </aside>

    <section class="atlas-panel">
      <div class="atlas-heading">
        <h2 class="atlas-h">Association field</h2>
      </div>

      <div class="brain-stage" id="brainStage">
        <button class="brain-fullscreen-button" id="brainFullscreenButton" type="button"
          aria-label="View brain in fullscreen" aria-pressed="false">
          <span aria-hidden="true">↗↙</span><span class="brain-fullscreen-label">Fullscreen</span>
        </button>
        <div class="scan-interface" aria-hidden="true"><span class="scan-reticle"></span></div>
        <canvas class="brain-model" id="brainModel"
          aria-label="Rotating three-dimensional model of a human brain"></canvas>
        <ul class="atlas-visual-key" aria-label="Atlas visual key">
          <li><i class="key-memory"></i><span>Memory</span></li>
          <li><i class="key-region"></i><span>Region activation</span></li>
          <li><i class="key-path"></i><span>Contribution path</span></li>
          <li><i class="key-entity key-entity-person"></i><span>Person</span></li>
          <li><i class="key-entity key-entity-place"></i><span>Place</span></li>
          <li><i class="key-entity key-entity-object"></i><span>Object</span></li>
          <li><i class="key-entity key-entity-concept"></i><span>Concept</span></li>
          <li><i class="key-entity key-entity-organization"></i><span>Organization</span></li>
          <li><i class="key-relationship"></i><span>Relationship</span></li>
        </ul>
        <div class="region-labels" id="regionLabels" aria-label="Active brain regions" hidden></div>
        <div class="memory-hover-panel" id="memoryHoverPanel" role="tooltip" hidden></div>
        <div class="empty-state" id="emptyState"></div>
      </div>
    </section>

    <aside class="atlas-inspector">
      <div class="memory-detail" id="memoryDetail" aria-live="polite"></div>

      <section class="composer">
        <h2 class="atlas-h">Record a memory</h2>
        <form id="memoryForm">
          <label for="memoryInput">What happened?</label>
          <textarea id="memoryInput" rows="5"
            placeholder="I went to a cafe with Maya yesterday..." required></textarea>
          <div class="composer-meta">
            <span>Natural language</span>
            <span id="characterCount">0 / 180</span>
          </div>
          <button class="record-button" type="submit">
            <span>Encode memory</span>
          </button>
        </form>
      </section>
    </aside>
  </section>

  <template id="memoryCardTemplate">
    <article class="memory-card">
      <div class="memory-card-top"><span class="memory-number"></span><time></time></div>
      <p class="memory-text"></p>
      <div class="memory-tags"></div>
    </article>
  </template>
`;

export default function Atlas() {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    document.title = "Atlas · Atlas";
    // Boot the protected brain after the scaffold is in the DOM.
    import("../viz/brain/app.js");

    // Mirror each region label's role text from the detail panel table onto
    // a data-role attribute, so a CSS pseudo-element can render it on hover.
    // The brain module is legacy code we must not modify.
    const syncRoles = () => {
      const rows = document.querySelectorAll<HTMLTableRowElement>(
        ".region-role-table tr[data-region]",
      );
      if (!rows.length) return;
      const roles = new Map<string, string>();
      rows.forEach((row) => {
        const region = row.dataset.region;
        const cell = row.querySelector("td");
        if (region && cell?.textContent) roles.set(region, cell.textContent.trim());
      });
      document
        .querySelectorAll<HTMLButtonElement>(".region-label[data-region]")
        .forEach((label) => {
          const region = label.dataset.region;
          const role = region ? roles.get(region) : null;
          if (role) label.setAttribute("data-role", role);
          else label.removeAttribute("data-role");
        });
    };
    const observer = new MutationObserver(syncRoles);
    observer.observe(document.body, { childList: true, subtree: true });
    syncRoles();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="atlas-root" dangerouslySetInnerHTML={{ __html: SCAFFOLD }} />
  );
}
