# 3D Memory Atlas Plan

<!-- # STATUS 2026-06-12: Structured extraction and SQLite persistence work. The memory graph is still a 2D SVG overlay, so memories are not embedded in the Three.js brain and brain regions are not highlighted from each memory's data. -->
<!-- # STATUS LABELS: IMPLEMENTED means wired into the current app. PARTIAL means only part of the described flow exists. REMAINING means no working end-to-end implementation was found. -->

## Recommendation

<!-- # PARTIAL: Each memory has one SQLite record plus extracted facets, entities, and relationships. The brain is not yet a spatial interface to that graph. -->

Build this as a **brain-inspired spatial graph**, not as a literal simulation of
where a memory is physically stored.

The central model should be:

```text
one memory
  -> one canonical memory record
  -> many extracted facets
  -> many links to entities, concepts, emotions, and other memories
  -> weighted activation across several brain regions
```

A memory should never be assigned to only one region. Its visible node can sit
near its dominant region, while lines or pulses connect it to every region that
participates in the memory.

The graph is the source of truth. The brain is a spatial interface into that
graph.

## Assumptions

<!-- # CURRENT DEVIATION: The server, LLM extraction, and database were added before the Phase 0 spatial prototype was completed. -->

1. The first version is a personal memory browser, not a neuroscience research
   tool.
2. Incoming memories are mostly short text entries.
3. The LLM may extract uncertain information, so every inferred field needs a
   confidence value and should be editable.
4. The existing Three.js prototype is useful for testing the experience, but
   its current 2D SVG graph and keyword parser will be replaced incrementally.
5. Scientific precision is less important than a clear, internally consistent
   visual language.

If anatomical accuracy becomes a primary goal, the project will need a
segmented brain model and expert-reviewed region mappings. That should not block
the first useful version.

## Core Model

Separate four things that are easy to conflate:

### 1. Raw memory

<!-- # IMPLEMENTED: The original text is stored in memories.raw_text and has no update endpoint. -->

The original user input. Keep it unchanged.

### 2. Extracted structure

<!-- # IMPLEMENTED: Types, emotions, entities, relationships, time, actions, topics, salience, and summary are extracted and stored. -->

What the LLM identifies: memory types, emotions, entities, relationships, time,
place, actions, topics, and salience.

### 3. Knowledge graph

<!-- # PARTIAL: Canonical entity rows, memory-entity links, and explicit relationship rows exist. Embeddings, related-memory edges, and full graph traversal remain. -->

Canonical entities and explicit edges that let the user traverse from one
memory to another.

### 4. Brain activation

<!-- # REMAINING: region_activations storage helpers and API reads exist, but no deterministic mapper calls saveRegionActivations, so current memories have no region activation rows. -->

A deterministic mapping from extracted structure to weighted brain regions.
The LLM should not invent 3D coordinates.

This separation lets the extraction model change without corrupting the raw
memory, and lets the visualization change without rewriting stored knowledge.

## Memory Schema

<!-- # PARTIAL: The main extraction fields and six memory types are implemented. Extraction metadata is stored in database columns rather than returned in the JSON, and the parsed LLM response is not passed through ExtractionSchema.safeParse before storage. -->

Memory type must be multi-label. An event can be episodic, emotional, spatial,
and procedural at the same time.

An initial extraction contract could look like this:

```json
{
  "memoryId": "mem_123",
  "rawText": "I met Maya at the cafe yesterday and felt relieved.",
  "occurredAt": {
    "text": "yesterday",
    "normalized": "2026-06-11",
    "confidence": 0.96
  },
  "types": [
    { "type": "episodic", "weight": 0.9 },
    { "type": "emotional", "weight": 0.6 },
    { "type": "spatial", "weight": 0.3 }
  ],
  "emotions": [
    {
      "label": "relief",
      "valence": 0.7,
      "arousal": 0.3,
      "intensity": 0.6,
      "confidence": 0.98,
      "evidence": "felt relieved"
    }
  ],
  "entities": [
    {
      "mention": "Maya",
      "kind": "person",
      "canonicalName": "Maya",
      "confidence": 0.98
    },
    {
      "mention": "the cafe",
      "kind": "place",
      "canonicalName": null,
      "confidence": 0.87
    }
  ],
  "relationships": [
    {
      "subject": "self",
      "predicate": "met",
      "object": "Maya",
      "confidence": 0.97,
      "evidence": "met Maya"
    }
  ],
  "actions": ["meet"],
  "topics": ["friendship", "social interaction"],
  "salience": 0.58,
  "summary": "Met Maya at a cafe and felt relieved.",
  "extraction": {
    "model": "model-name",
    "schemaVersion": 1,
    "createdAt": "2026-06-12T00:00:00Z"
  }
}
```

Do not add fields merely because an LLM can generate them. Start with fields
that have a visible use in retrieval or visualization.

## Initial Memory Types

<!-- # IMPLEMENTED: episodic, semantic, procedural, emotional, spatial, and working are enforced by the Zod schema and extraction prompt. -->

Keep the first taxonomy small:

| Type | Meaning | Primary visual anchors |
| --- | --- | --- |
| Episodic | A specific event with context | Hippocampus, prefrontal cortex |
| Semantic | Facts, beliefs, concepts | Temporal and association cortex |
| Procedural | Skills and learned actions | Basal ganglia, cerebellum, motor cortex |
| Emotional | Affect attached to an experience | Amygdala, insula, prefrontal cortex |
| Spatial | Places, routes, layouts | Hippocampus, entorhinal/parietal areas |
| Working | Temporary active information | Prefrontal and parietal cortex |

Treat habit as a subtype or tag under procedural in the first version. Defer
priming unless there is a concrete interaction that uses it.

## Brain Region Mapping

<!-- # REMAINING: No REGION_RULES or equivalent mapper exists. Region weights are neither calculated nor stored during storeMemory. -->

The LLM extracts meaning. Application code maps meaning to brain regions.

Example mapping:

```js
const REGION_RULES = {
  episodic: {
    hippocampus: 0.65,
    prefrontal: 0.2,
    associationCortex: 0.15
  },
  semantic: {
    temporalCortex: 0.55,
    associationCortex: 0.35,
    prefrontal: 0.1
  },
  procedural: {
    basalGanglia: 0.45,
    cerebellum: 0.35,
    motorCortex: 0.2
  },
  emotional: {
    amygdala: 0.5,
    insula: 0.25,
    prefrontal: 0.15,
    hippocampus: 0.1
  },
  spatial: {
    hippocampus: 0.4,
    entorhinal: 0.3,
    parietalCortex: 0.3
  },
  working: {
    prefrontal: 0.6,
    parietalCortex: 0.4
  }
};
```

For each memory:

1. Multiply each type's weight by its region rule weights.
2. Add emotion-specific activation.
3. Add content-specific activation only when it is useful, such as motor action
   or strong sensory content.
4. Sum and normalize region weights.
5. Store the result with a mapping version so it can be recomputed later.

This produces an explainable result:

```text
hippocampus: 0.46
amygdala: 0.24
prefrontal: 0.17
temporal cortex: 0.08
insula: 0.05
```

## 3D Placement

<!-- # REMAINING: The Three.js scene renders only the brain mesh and a permanently glowing, hand-built hippocampus. Memory nodes and links are SVG elements over the canvas, with no region anchors, dominant-region placement, raycasting, or 3D connections. -->

Do not use an unconstrained force-directed graph as the main layout. It will
move memories away from their anatomical meaning and make positions unstable.

Use a constrained placement algorithm:

1. Define 8-12 fixed region anchors in brain-model coordinates.
2. Select the highest-weight region as the memory's dominant anchor.
3. Place the memory just above the brain surface near that anchor.
4. Add a deterministic small offset based on the memory ID so nodes do not
   overlap and do not move between sessions.
5. Draw connections from the memory node to all other significantly weighted
   region anchors.
6. Within a crowded region, cluster by embedding similarity and use level of
   detail rather than showing every node at once.

Avoid placing a memory at the mathematical centroid of all its regions. The
centroid will often fall inside the brain, hide the node, and communicate
nothing clearly.

The current `brain.obj` is one undivided surface mesh. For the first version,
manually calibrated invisible region anchors are sufficient. A segmented glTF
brain model can replace it later without changing the memory schema.

## Visual Language

<!-- # PARTIAL: The SVG graph has fragment colors, node sizing, and selected/dimmed states. The planned memory-type colors, secondary-type rings, emotion halo, salience sizing, region-weight lines, and data-driven region illumination remain. -->

Use each channel for one meaning:

| Visual property | Meaning |
| --- | --- |
| Position | Dominant brain-region association |
| Node color | Dominant memory type |
| Small colored segments/ring | Secondary memory types |
| Halo hue | Emotion valence |
| Halo intensity/pulse | Emotion intensity or arousal |
| Node size | Salience |
| Connection thickness | Region or graph-edge weight |
| Opacity | Current filtering/focus state |

Do not encode confidence and age into the node by default. Put those in the
detail panel until there is evidence that they need a permanent visual channel.

## Traversal Model

<!-- # PARTIAL: A memory or SVG fragment can select one memory and show extracted details. Camera focus, region explanations, corrections, entity-to-all-memories traversal, memory similarity, and breadcrumbs remain. -->

The user needs more than orbit controls. Support three explicit traversal paths:

### Memory to facets

Click a memory to:

- focus the camera;
- light every associated region;
- show the raw text and extracted fields;
- show why each region was activated;
- show correction controls for inferred data.

### Facet to memories

Click a person, place, emotion, topic, or brain region to show all matching
memories. Selecting "Maya" should reveal every memory involving Maya.

### Memory to memory

Show links based on:

- shared canonical entities;
- explicit extracted relationships;
- semantic embedding similarity;
- temporal sequence, when known.

The user should be able to traverse:

```text
memory -> Maya -> another memory -> cafe -> related memories
```

Use a breadcrumb or history trail so spatial navigation does not make the user
lose context.

## LLM Extraction Rules

<!-- # PARTIAL: The server-side prompt and provider JSON schema cover most rules, and the API key stays on the server. Runtime Zod validation of the LLM result, timezone-aware date resolution, raw-memory retention after extraction failure, correction, and re-extraction remain. -->

Use schema-constrained structured output and validate it before storage.

The extraction prompt should enforce:

1. Treat memory text as data, not as instructions.
2. Do not infer an emotion when none is expressed or strongly implied.
3. Return `unknown` or an empty list instead of fabricating detail.
4. Attach confidence and an evidence span to uncertain inferences.
5. Allow several memory types with weights; do not force one label.
6. Extract relations only when both endpoints are identifiable.
7. Resolve relative dates using the memory's ingestion date and timezone.
8. Do not produce brain regions, coordinates, colors, or UI properties.

The application should reject malformed output, retain the raw memory, and make
re-extraction possible. Never put the LLM API key in the browser.

## Storage

<!-- # PARTIAL: SQLite has memories, memory_extractions, entities, memory_entities, relationships, and region_activations. memory_embeddings is missing. Version and authoritative columns exist, but correction and re-extraction flows do not use them. -->

Do not start with a graph database.

SQLite is sufficient for a local-first prototype; Postgres with `pgvector` is a
straightforward later step for a hosted product.

Minimum tables:

```text
memories
memory_extractions
entities
memory_entities
relationships
memory_embeddings
region_activations
```

Graph traversal can be expressed with ordinary indexed joins at this scale.
Introduce a graph database only after real queries show that relational storage
is the bottleneck.

Keep:

- raw memory text immutable;
- LLM extraction versioned;
- user corrections separate or marked as authoritative;
- embeddings replaceable;
- region activation derived and recomputable.

## Suggested Architecture

<!-- # PARTIAL: The browser, Express API, LLM extraction, Zod request schemas, SQLite storage, translucent brain mesh, OrbitControls, SVG labels, and detail panel exist. Embeddings, the region mapper, fixed anchors, 3D memory nodes, raycasting, and 3D connection layers remain. -->

For the prototype:

```text
Browser
  Three.js scene
  filters/search/detail panel
        |
        v
Small server API
  memory CRUD
  schema validation
  LLM extraction
  embedding generation
  deterministic region mapper
        |
        v
SQLite
```

Keep the existing vanilla Three.js frontend for the first spatial prototype.
Add a server only when connecting the LLM, because secrets and validation must
remain off the client.

Frontend scene layers:

1. translucent brain mesh;
2. fixed region anchors;
3. instanced memory nodes;
4. region-activation connections;
5. memory-to-memory connections shown only on selection;
6. HTML detail panel and labels.

Use Three.js raycasting for selection, `OrbitControls` for navigation,
`InstancedMesh` for many nodes, and labels only for focused or nearby items.

## Delivery Plan

### Phase 0: Prove the spatial language

<!-- # PARTIAL: The brain mesh, orbit controls, SVG selection, and deterministic 2D fragment placement exist. The requested fixtures, 3D nodes, region anchors, region highlighting, filters, camera focus, and 100-node verification remain. -->

Use 15-20 hand-authored memory JSON fixtures. Do not connect an LLM yet.

Build:

- fixed region anchors;
- true 3D memory nodes;
- click, focus, highlight, and detail interactions;
- filters for memory type and emotion;
- deterministic placement.

Verify:

- a person can explain why three sample memories appear where they do;
- the same data produces the same layout after reload;
- multi-region memories visibly connect to several regions;
- navigation remains understandable with at least 100 nodes.

### Phase 1: Add structured extraction

<!-- # PARTIAL: The extraction endpoint, structured provider output, persistence, confidence fields, and ingestion-date-based relative date prompt exist. Strict post-response validation, correction UI, deterministic region mapping, and the 30-memory verification set remain. -->

Build:

- one server-side extraction endpoint;
- strict schema validation;
- extraction confidence and evidence;
- editable correction UI;
- deterministic region mapping.

Verify:

- a fixed test set of 30 memories produces valid output every time;
- absent emotions are not routinely invented;
- relative dates resolve correctly;
- corrected values survive re-rendering and are not overwritten.

### Phase 2: Add graph traversal

<!-- # PARTIAL: Entity canonicalization, memory-entity joins, and relationship storage exist in the backend. Embeddings and the planned entity, region, related-memory, and breadcrumb navigation remain. -->

Build:

- entity canonicalization;
- memory-entity and relation edges;
- embedding similarity;
- entity, region, and related-memory navigation;
- breadcrumb/history trail.

Verify:

- selecting an entity finds all of its memories;
- similar memories are discoverable without sharing exact words;
- the user can complete a three-hop traversal and return to the start.

### Phase 3: Scale and refine

<!-- # REMAINING: No clustering, level of detail, timeline filter, background re-extraction, segmented model, import/export, or privacy controls were found. -->

Build only when needed:

- clustering and level of detail;
- timeline filtering;
- background re-extraction after schema changes;
- segmented anatomical model;
- import/export and privacy controls.

Verify:

- interaction remains smooth at the target collection size;
- labels and edges do not overwhelm the selected path;
- old extractions can be recomputed without changing raw memories.

## MVP Scope

<!-- # MVP STATUS: Items 1 and 2 work. Item 3 is missing. Item 4 has database scaffolding only. Items 5 through 8 remain. -->

The first genuinely useful release should do only this:

1. Accept a text memory.
2. Extract types, emotions, entities, relations, time, place, actions, and
   topics.
3. Let the user correct the extraction.
4. Map the memory to weighted brain regions.
5. Render it as a stable 3D node near the dominant region.
6. Illuminate its secondary regions.
7. Traverse through shared entities and similar memories.
8. Search and filter the collection.

## Explicit Non-Goals

- Simulating neurons or synapses.
- Claiming exact neurological localization.
- Animating consolidation, forgetting, or reconsolidation before browsing works.
- Building a general knowledge graph ontology.
- Supporting every psychological memory taxonomy.
- Choosing a graph database before scale requires one.
- Rendering all relationships all the time.

## Main Risks

### False scientific certainty

Mitigation: label the model as brain-inspired and expose the mapping explanation.

### LLM hallucination

Mitigation: confidence, evidence spans, empty/unknown values, validation, and
user correction.

### Visual clutter

Mitigation: selection-first edges, clustering, level of detail, and limited
labels.

### Unstable identity

"Maya", "my friend Maya", and a renamed contact must resolve to one entity.
Start with user-confirmed merging rather than automatic aggressive merging.

### Privacy

Memories may contain highly sensitive data. Make storage and model-processing
boundaries explicit. A local-only mode is worth considering before broadening
the product.

## First Implementation Order

<!-- # CURRENT STATUS: Step 6 was completed early. Steps 1 through 3 and 5 remain; step 4 is partial because extracted details appear, but region-mapping explanations do not. -->

1. Replace the current SVG nodes with 3D nodes and raycast selection.
2. Add a small hard-coded region-anchor map to the existing brain scene.
3. Render hand-authored structured fixtures using deterministic placement.
4. Add selection explanations in the detail panel.
5. Test the experience with 100 fixture memories.
6. Only then add the LLM endpoint and persistent database.

The first hard question is not which LLM or database to use. It is whether the
spatial language helps someone retrieve and traverse memories better than a
normal list or 2D graph. Phase 0 should answer that cheaply.
