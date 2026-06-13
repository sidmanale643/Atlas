# Memory atlas implementation TODO

This checklist turns `MEMORY_ATLAS_PLAN.md` into implementation steps for the
current codebase.

## Current state

- [x] Text memories can be submitted from the browser.
- [x] The server sends memory text to the LLM.
- [x] The LLM returns structured types, emotions, entities, relationships, time,
      actions, topics, salience, and a summary.
- [x] SQLite stores raw memories, extractions, entities, entity links, and
      relationships.
- [x] Three.js renders the translucent `brain.obj`.
- [x] Orbit controls rotate and zoom the brain.
- [x] Region activations are calculated, stored, and returned by the API.
- [ ] Memory nodes are not part of the Three.js scene.
- [ ] The visible graph is still a 2D SVG overlay.
- [ ] The glowing hippocampus is static and does not respond to memory data.

## Scope decision for the current brain model

`brain.obj` is one undivided mesh. It does not identify anatomical surface
regions.

For the MVP:

- represent each brain region with a manually calibrated 3D anchor;
- show region activation with a glow, pulse, or translucent marker around that
  anchor;
- place memory nodes near their highest-weight anchor;
- connect one canonical memory core to every active region anchor.

Do not attempt per-polygon brain-surface coloring with the current OBJ. Exact
surface highlighting requires a segmented model and belongs in the later model
upgrade.

## Definition of done for the 3D memory MVP

The first 3D milestone is complete when:

1. Creating a memory calculates normalized brain-region weights.
2. Reloading the page returns those weights from SQLite.
3. Each memory appears as a selectable Three.js node near its dominant region.
4. The same memory appears in the same position after every reload.
5. Selecting a memory highlights all associated regions according to weight.
6. Lines connect the selected memory core to every participating region.
7. The detail panel explains each activated region and its weight.
8. The old SVG memory graph is removed. ✓

## 1. Validate extraction before using it

Files: `llm.js`, `schemas.js`

- [x] Parse the JSON returned by OpenRouter inside a `try` block.
- [x] Pass the parsed value through `ExtractionSchema.safeParse`.
- [x] Reject the response if it does not match the schema.
- [x] Include a useful server log for malformed JSON or schema failure.
- [x] Keep the API response generic so raw provider output is not exposed to the
      browser.
- [x] Add numeric bounds:
  - confidence: `0` through `1`;
  - memory type weight: `0` through `1`;
  - valence: `-1` through `1`;
  - arousal, intensity, and salience: `0` through `1`.
- [x] Decide whether type weights must sum to at most `1`. If yes, enforce it in
      the Zod schema instead of relying only on the prompt.

Verify:

- [x] A valid extraction passes.
- [x] Invalid JSON returns an extraction failure without creating database rows.
- [x] An out-of-range weight or confidence value is rejected.

## 2. Add the deterministic region mapper

Suggested new file: `region-mapper.js`

- [x] Define the first fixed region names:
  - `hippocampus`;
  - `prefrontal`;
  - `associationCortex`;
  - `temporalCortex`;
  - `basalGanglia`;
  - `cerebellum`;
  - `motorCortex`;
  - `amygdala`;
  - `insula`;
  - `entorhinal`;
  - `parietalCortex`.
- [x] Add the memory-type rules from `MEMORY_ATLAS_PLAN.md`.
- [x] Implement `mapExtractionToRegions(extraction)`.
- [x] Multiply each memory type weight by its region rule weights.
- [x] Add emotion activation only when emotions exist.
- [x] Use emotion intensity and arousal to affect amygdala and insula weights.
- [x] Add motor activation when procedural memories or clear physical actions
      are present.
- [x] Sum duplicate region contributions.
- [x] Remove negligible activations below one documented threshold.
- [x] Normalize the remaining weights so they sum to `1`.
- [x] Sort results from highest to lowest weight.
- [x] Return records shaped like `{ region, weight }`.
- [x] Export a mapping version constant and begin with version `1`.
- [x] Keep all coordinates and colors out of this backend module.

Verify:

- [x] A semantic memory activates temporal and association cortex.
- [x] An episodic memory activates the hippocampus and prefrontal cortex.
- [x] An emotional episodic memory activates more than one region.
- [x] The same extraction always returns the same ordered weights.
- [x] Every returned weight is between `0` and `1`.
- [x] Returned weights sum to `1`, allowing a small floating-point tolerance.

## 3. Store and return region activations

Files: `db.js`, `server.js`

- [x] Call the mapper inside `storeMemory`.
- [x] Save the mapped results with `saveRegionActivations`.
- [x] Keep memory creation, extraction storage, entity links, relationships, and
      region activation storage in the same transaction.
- [x] Return regions from `POST /api/memories`.
- [x] Update `GET /api/memories` to include regions for every memory.
- [x] Keep `GET /api/memories/:id` returning the same region shape.
- [x] Add an idempotent backfill for memories that have an extraction but no
      activation rows for the current mapping version.
- [x] Recompute only missing or old mapping versions.

Verify:

- [x] Creating a memory inserts several `region_activations` rows.
- [x] Reloading the page preserves the same region weights.
- [x] Running the backfill twice does not duplicate rows.
- [x] Deleting a memory removes its region activation rows through the foreign
      key cascade.

## 4. Define fixed 3D region anchors

Suggested location: near the Three.js scene setup in `app.js`. Move this into a
small separate module only if `app.js` becomes hard to follow.

- [x] Create one anchor entry for every region returned by the mapper.
- [x] Give each entry:
  - a stable region key matching the backend;
  - a readable label;
  - a position in brain-model coordinates;
  - a display color;
  - an optional marker scale.
- [x] Attach anchors to the same transformed Three.js group as the brain model.
- [x] Calibrate coordinates after the OBJ has been centered and scaled.
- [x] Use visible temporary debug markers while calibrating.
- [x] Confirm left/right placement and camera orientation for each anchor.
- [x] Hide debug labels and helper geometry after calibration.
- [x] Keep anchor positions fixed across sessions.

Verify:

- [x] Every backend region key resolves to one frontend anchor.
- [x] No memory falls back to the scene origin.
- [x] Anchors stay attached to the brain while it rotates.
- [x] The main regions appear inside or directly above the expected part of the
      visible brain.

## 5. Replace the static hippocampus highlight

File: `app.js`

- [x] Remove the permanently emissive hippocampus behavior.
- [x] Keep anatomical helper geometry only if it can use the same idle and
      active states as every other region.
- [x] Create one region marker object per anchor.
- [x] Give markers an idle state with low or zero opacity.
- [x] Give markers an active state driven by activation weight.
- [x] Scale opacity, emissive intensity, marker size, or pulse amplitude by
      region weight.
- [x] Reset all markers before applying a new selection.
- [x] Do not animate every region when no memory is selected.
- [x] Respect `prefers-reduced-motion` by disabling pulses.

Verify:

- [ ] A semantic memory does not always light the hippocampus.
- [ ] Different memory types visibly light different regions.
- [ ] A stronger activation is visibly stronger than a weak activation.
- [ ] Clearing selection returns every marker to its idle state.

## 6. Create stable 3D memory placement

File: `app.js`

- [x] Read each memory's highest-weight region as its dominant anchor.
- [x] Implement a deterministic hash from the memory ID.
- [x] Convert the hash into a small local offset around the dominant anchor.
- [x] Keep the offset outside the brain surface enough to remain clickable.
- [x] Avoid the centroid of all associated regions.
- [x] Store calculated positions in memory-node state, not in SQLite.
- [x] Use the same calculation after every reload.
- [x] Add simple collision spacing for memories sharing one anchor.
- [x] Do not add force-directed movement.

Verify:

- [x] Two memories in the same region do not occupy the exact same point.
- [x] A memory never changes position just because another memory was added.
- [x] Reloading produces the same position for every existing memory.
- [x] Orbiting the camera proves nodes are in the 3D scene, not an HTML overlay.

## 7. Render memory nodes in Three.js

Files: `app.js`, `index.html`, `styles.css`

- [x] Create a Three.js group dedicated to memory nodes.
- [x] Start with normal meshes for correctness and selection.
- [x] Use one sphere or compact marker per memory.
- [x] Render every memory core in one neutral color.
- [x] Scale the node by salience within a restrained minimum and maximum.
- [x] Store the memory ID in `mesh.userData`.
- [ ] Add a small secondary-type ring only after basic nodes work.
- [x] Keep labels hidden by default.
- [x] Show screen-positioned labels for every active region on selection.
- [ ] Consider `InstancedMesh` only after the 100-memory check shows normal
      meshes are too slow.

Verify:

- [x] Every loaded memory creates exactly one 3D node.
- [x] Region colors appear only on activation fields and contribution paths.
- [x] Node size reflects salience without becoming unreadably small or large.
- [x] Nodes rotate with the brain coordinate system.

## 8. Add raycast selection and camera focus

File: `app.js`

- [x] Create one `THREE.Raycaster`.
- [x] Convert canvas pointer coordinates to normalized device coordinates.
- [x] Raycast only against selectable memory objects.
- [x] Select the memory ID stored in the hit mesh.
- [x] Prevent a drag used for orbiting from also selecting a node.
- [x] Stop auto-rotation after the user selects a memory.
- [x] Move the camera target toward the selected node with a short transition.
- [x] Keep keyboard and list-card selection working.
- [x] Make list-card selection focus the matching 3D node.
- [x] Add a clear-selection action.

Verify:

- [x] Clicking empty space does not select a memory.
- [x] Clicking a node selects the correct memory.
- [x] Orbiting does not cause accidental selections.
- [x] Selecting a memory card focuses the same node.
- [x] Selection still works after resize and on high-DPI displays.

## 9. Draw region connections

File: `app.js`

- [x] Create a Three.js group for activation connections.
- [x] Clear this group whenever selection changes.
- [x] Draw lines only for the hovered or selected memory.
- [x] Connect the memory core to every stored positive region activation.
- [x] Vary line opacity or width by activation weight.
- [x] Focus the dominant-region path by default and retain every other path.
- [x] Render lines inside the same transformed coordinate system as the brain
      and memory nodes.
- [x] Do not render all memories' connections at once.

Verify:

- [x] A multi-region memory displays more than one connection.
- [x] Connections stay attached while orbiting.
- [x] Selecting another memory removes the previous lines.
- [x] No stale lines remain after deleting or clearing memories.

## 10. Explain activation in the detail panel

Files: `app.js`, `styles.css`

- [x] Show the selected memory's raw text and summary.
- [x] List active regions from highest to lowest weight.
- [x] Display each weight as a percentage.
- [x] Explain the contributing memory types for each region.
- [x] Include emotion contribution when applicable.
- [x] Keep extraction confidence separate from region weight.
- [x] Show a clear message if an old memory has no region data.
- [x] Explain each region's atlas role.
- [x] State that activations are mapped rather than measured.
- [x] Synchronize 3D markers, screen labels, and detail rows.

Verify:

- [x] The explanation matches the mapper output.
- [x] Region percentages match the visible highlight strengths.
- [x] A user can tell why the dominant region was chosen.

## 11. Remove the SVG graph

Files: `index.html`, `app.js`, `styles.css`

- [x] Delete the `brain-outline` SVG from `index.html`.
- [x] Remove `nodesGroup` and `connectionsGroup`.
- [x] Remove `renderGraph`, `makeGraph`, `createSvgElement`, and SVG selection
      code after the Three.js replacement works.
- [x] Remove CSS used only by `.brain-outline`, `.node`, and `.connection`.
- [x] Keep fragment tags in the memory cards and detail panel.
- [x] Check that the brain canvas remains responsive after removing the SVG
      layer.

Verify:

- [x] No SVG memory nodes remain in the DOM.
- [x] All memory selection paths use Three.js nodes or memory cards.
- [x] The page still works with zero memories.

## 12. Add extraction correction

Files: `server.js`, `db.js`, `schemas.js`, `app.js`

- [ ] Define which extracted fields the user can edit in the first version.
- [ ] Add a schema for corrected extraction data.
- [ ] Add an endpoint that creates a new authoritative extraction version.
- [ ] Never overwrite the original raw memory text.
- [ ] Mark the correction as authoritative.
- [ ] Rebuild entity links, relationships, and region activations from the
      authoritative extraction in one transaction.
- [ ] Add edit, save, and cancel controls to the detail panel.
- [ ] Reload the corrected memory after saving.

Verify:

- [ ] A correction survives reload.
- [ ] A corrected type changes region placement and highlighting.
- [ ] Re-extraction does not overwrite an authoritative correction.
- [ ] Previous extraction versions remain available in SQLite.

## 13. Add basic search and filters

Files: `index.html`, `app.js`, `styles.css`, and `server.js` only if server-side
queries become necessary.

- [x] Add text search over raw text, summary, and entity names.
- [ ] Add a memory-type filter.
- [ ] Add an emotion filter only when at least one memory has emotions.
- [ ] Add a brain-region filter using stored activations.
- [x] Dim or hide nonmatching 3D nodes consistently.
- [x] Keep the selected memory visible or clear selection when it is filtered
      out.
- [x] Add a reset-filters action.

Verify:

- [x] Search finds raw text and canonical entity names.
- [ ] Type and region filters can be combined.
- [x] Reset returns every memory node.

## 14. Add entity and related-memory traversal

Files: `server.js`, `db.js`, `app.js`

- [ ] Make entity chips in the detail panel selectable.
- [ ] Use `GET /api/entities/:id/memories` to load all linked memories.
- [ ] Highlight matching memory nodes without changing their positions.
- [ ] Add links based on shared canonical entities.
- [ ] Add explicit relationship details between memories where available.
- [ ] Add a small breadcrumb or history list.
- [ ] Let the user return to the previous memory or entity selection.

Verify:

- [ ] Selecting one person finds every linked memory.
- [ ] The user can move memory to entity to another memory.
- [ ] Back navigation returns to the previous selection.

## 15. Add embeddings after entity traversal works

Files: `db.js`, `server.js`, `llm.js` or a dedicated embedding module.

- [ ] Add the missing `memory_embeddings` table.
- [ ] Store the embedding model and version.
- [ ] Generate one embedding from stable memory content.
- [ ] Add a similarity query suitable for the current collection size.
- [ ] Return only a small number of related memories.
- [ ] Show related-memory links only for the selected memory.
- [ ] Keep embeddings replaceable and separate from raw memory data.

Verify:

- [ ] Similar memories can be found without exact shared words.
- [ ] Unrelated memories do not dominate the results.
- [ ] Regenerating embeddings does not modify raw memories or extractions.

## 16. Test the complete 3D flow

- [ ] Create a fixed fixture set covering all six memory types.
- [ ] Include multi-label, emotional, no-emotion, person, place, and action
      examples.
- [ ] Test at least three memories manually before increasing the collection.
- [ ] Load 100 fixtures and inspect frame rate, labels, selection, and clutter.
- [ ] Confirm deterministic node positions with a reload screenshot comparison.
- [ ] Confirm region weights with direct SQLite queries.
- [ ] Test desktop and mobile layouts.
- [ ] Test `prefers-reduced-motion`.
- [ ] Test zero memories, one memory, and many memories.
- [ ] Test extraction failure without losing the typed text.

## Later work

Do these only after the 3D MVP and traversal checks pass.

- [ ] Cluster crowded regions by embedding similarity.
- [ ] Add level of detail for large collections.
- [ ] Add timeline filtering.
- [ ] Add background re-extraction after schema changes.
- [ ] Replace `brain.obj` with a segmented glTF model.
- [ ] Map region highlights to real segmented surface meshes.
- [ ] Add import and export.
- [ ] Document local storage, model-provider, and privacy boundaries.
- [ ] Add a local-only extraction mode if the product requires it.

## Recommended implementation order

1. Complete sections 1 through 3 so region data is correct and persistent.
2. Complete sections 4 and 5 to prove region highlighting on the current model.
3. Complete sections 6 through 9 to embed selectable memories in the brain.
4. Complete sections 10 and 11 to finish the user-facing 3D replacement.
5. Run section 16 before adding correction or traversal.
6. Complete sections 12 through 14 for the MVP browsing workflow.
7. Add embeddings and later work only after the simpler graph paths work.


Add reference to skills like cycling reading : DONE
memory decay
memory confusion testing
mcp : DONE (verify)
add profile.md
add semantic (hybrid search) with turbovec and sentence transformers
optionally use ML for entity extraction
optional clustering
