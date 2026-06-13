import { createHash } from "crypto";
import { getRegionContributions } from "./shared/region-mapper.js";
import { REGION_ANCHORS } from "./shared/region-anchors.js";

export function createMemoryComparisonInput(memory) {
  const extraction = unwrapExtraction(memory.extraction);
  return {
    id: String(memory.id),
    text: String(memory.raw_text || ""),
    summary: String(memory.summary || extraction.summary || ""),
    source: String(memory.source || "ui"),
    createdAt: memory.created_at || null,
    updatedAt: memory.updated_at || null,
    ingestionDate: memory.ingestion_date || null,
    occurredAt: normalizeOccurredAt(extraction.occurredAt),
    types: normalizeWeightedValues(extraction.types, "type", "weight"),
    entities: normalizeEntities(memory.entities, extraction.entities),
    relationships: normalizeRelationships(
      memory.relationships,
      extraction.relationships,
    ),
    actions: normalizeStrings(extraction.actions),
    topics: normalizeStrings(extraction.topics),
  };
}

export function hashMemoryComparisonInput(leftMemory, rightMemory) {
  const payload = {
    left: createMemoryComparisonInput(leftMemory),
    right: createMemoryComparisonInput(rightMemory),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildMemoryStructuralDiff(leftMemory, rightMemory) {
  const left = createMemoryComparisonInput(leftMemory);
  const right = createMemoryComparisonInput(rightMemory);
  const leftExtraction = unwrapExtraction(leftMemory.extraction);
  const rightExtraction = unwrapExtraction(rightMemory.extraction);
  const regions = diffRegions(
    leftMemory.regions,
    rightMemory.regions,
    leftExtraction,
    rightExtraction,
  );
  return {
    types: diffWeightedValues(left.types, right.types, "type"),
    occurredAt: {
      left: left.occurredAt,
      right: right.occurredAt,
      changed: JSON.stringify(left.occurredAt) !== JSON.stringify(right.occurredAt),
    },
    entities: diffValues(left.entities, right.entities, entityKey),
    relationships: diffValues(
      left.relationships,
      right.relationships,
      relationshipKey,
    ),
    actions: diffValues(left.actions, right.actions),
    topics: diffValues(left.topics, right.topics),
    provenance: {
      source: valueDelta(left.source, right.source),
      createdAt: valueDelta(left.createdAt, right.createdAt),
      updatedAt: valueDelta(left.updatedAt, right.updatedAt),
      ingestionDate: valueDelta(left.ingestionDate, right.ingestionDate),
    },
    regions,
    activationAnalysis: buildActivationAnalysis(
      leftExtraction,
      rightExtraction,
      regions,
    ),
  };
}

function unwrapExtraction(extraction) {
  return extraction?.extraction_json || extraction || {};
}

function normalizeOccurredAt(value) {
  return {
    text: String(value?.text || ""),
    normalized: value?.normalized || null,
  };
}

function normalizeWeightedValues(values, labelKey, weightKey) {
  return [...(values || [])]
    .map((value) => ({
      [labelKey]: String(value?.[labelKey] || "").trim(),
      [weightKey]: finiteNumber(value?.[weightKey]),
    }))
    .filter((value) => value[labelKey])
    .sort((a, b) => a[labelKey].localeCompare(b[labelKey]));
}

function normalizeEntities(storedEntities, extractedEntities) {
  const values = storedEntities?.length
    ? storedEntities.map((entity) => ({
        name: entity.canonical_name || entity.mention,
        kind: entity.kind,
      }))
    : (extractedEntities || []).map((entity) => ({
        name: entity.canonicalName || entity.mention,
        kind: entity.kind,
      }));
  return uniqueBy(
    values
      .map((entity) => ({
        name: String(entity.name || "").trim(),
        kind: String(entity.kind || "").trim(),
      }))
      .filter((entity) => entity.name),
    entityKey,
  );
}

function normalizeRelationships(storedRelationships, extractedRelationships) {
  const values = storedRelationships?.length
    ? storedRelationships.map((relationship) => ({
        subject:
          relationship.source_name ||
          relationship.source?.canonical_name ||
          relationship.subject,
        predicate: relationship.predicate,
        object:
          relationship.target_name ||
          relationship.target?.canonical_name ||
          relationship.object,
      }))
    : extractedRelationships || [];
  return uniqueBy(
    values
      .map((relationship) => ({
        subject: String(relationship.subject || "").trim(),
        predicate: String(relationship.predicate || "").trim(),
        object: String(relationship.object || "").trim(),
      }))
      .filter(
        (relationship) =>
          relationship.subject ||
          relationship.predicate ||
          relationship.object,
      ),
    relationshipKey,
  );
}

function normalizeStrings(values) {
  return [...new Set(
    (values || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));
}

function diffWeightedValues(left, right, key) {
  const leftMap = new Map(left.map((value) => [normalizeKey(value[key]), value]));
  const rightMap = new Map(right.map((value) => [normalizeKey(value[key]), value]));
  const labels = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
  return labels.map((label) => {
    const leftValue = leftMap.get(label) || null;
    const rightValue = rightMap.get(label) || null;
    const leftWeight = leftValue?.weight ?? null;
    const rightWeight = rightValue?.weight ?? null;
    return {
      type: leftValue?.[key] || rightValue?.[key] || label,
      left: leftWeight,
      right: rightWeight,
      delta:
        leftWeight === null || rightWeight === null
          ? null
          : rightWeight - leftWeight,
    };
  });
}

function diffValues(left, right, key = normalizeKey) {
  const leftMap = new Map(left.map((value) => [key(value), value]));
  const rightMap = new Map(right.map((value) => [key(value), value]));
  const sharedKeys = [...leftMap.keys()]
    .filter((value) => rightMap.has(value))
    .sort();
  return {
    shared: sharedKeys.map((value) => leftMap.get(value)),
    leftOnly: [...leftMap.keys()]
      .filter((value) => !rightMap.has(value))
      .sort()
      .map((value) => leftMap.get(value)),
    rightOnly: [...rightMap.keys()]
      .filter((value) => !leftMap.has(value))
      .sort()
      .map((value) => rightMap.get(value)),
  };
}

function diffRegions(
  leftRegions = [],
  rightRegions = [],
  leftExtraction = {},
  rightExtraction = {},
) {
  const normalize = (regions) =>
    new Map(
      regions.map((region) => [
        String(region.region),
        {
          weight: finiteNumber(region.weight),
          left: nullableNumber(region.hemispheres?.left),
          right: nullableNumber(region.hemispheres?.right),
        },
      ]),
    );
  const left = normalize(leftRegions);
  const right = normalize(rightRegions);
  const leftContributions = groupRegionContributions(leftExtraction);
  const rightContributions = groupRegionContributions(rightExtraction);
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .map((region) => {
      const leftValue = left.get(region) || null;
      const rightValue = right.get(region) || null;
      return {
        region,
        label: REGION_ANCHORS[region]?.label || humanize(region),
        role: REGION_ANCHORS[region]?.role || "",
        left: leftValue,
        right: rightValue,
        leftReasons: describeContributions(leftContributions.get(region)),
        rightReasons: describeContributions(rightContributions.get(region)),
        delta: {
          weight: subtractNullable(rightValue?.weight, leftValue?.weight),
          leftHemisphere: subtractNullable(rightValue?.left, leftValue?.left),
          rightHemisphere: subtractNullable(rightValue?.right, leftValue?.right),
        },
      };
    });
}

function buildActivationAnalysis(leftExtraction, rightExtraction, regions) {
  const leftDominantType = getDominantType(leftExtraction);
  const rightDominantType = getDominantType(rightExtraction);
  const changedRegions = regions
    .filter(({ delta }) => Math.abs(delta.weight || 0) >= 0.005)
    .sort(
      (a, b) =>
        Math.abs(b.delta.weight) - Math.abs(a.delta.weight) ||
        a.region.localeCompare(b.region),
    );
  const findings = changedRegions.map((region) => ({
    region: region.region,
    label: region.label,
    role: region.role,
    leftWeight: region.left?.weight ?? null,
    rightWeight: region.right?.weight ?? null,
    delta: region.delta.weight,
    explanation: explainRegionDifference(region),
    leftReasons: region.leftReasons,
    rightReasons: region.rightReasons,
  }));
  const typeComparison =
    leftDominantType && rightDominantType
      ? `The left memory is weighted most as ${leftDominantType.type} (${formatPercent(
          leftDominantType.weight,
        )}), while the right is weighted most as ${rightDominantType.type} (${formatPercent(
          rightDominantType.weight,
        )}).`
      : "One or both memories lack a dominant extracted memory type.";
  const largestShifts = changedRegions.slice(0, 3).map((region) => {
    const side = region.delta.weight > 0 ? "right" : "left";
    return `${region.label} is ${formatPercentagePoints(
      Math.abs(region.delta.weight),
    )} higher on the ${side}`;
  });

  return {
    summary: `${typeComparison}${
      largestShifts.length
        ? ` The largest relative shifts are: ${largestShifts.join("; ")}.`
        : " Their relative activation profiles are nearly the same."
    }`,
    findings,
    notes: [
      "Region percentages are normalized within each memory, so a stronger signal in one area can reduce another area's relative share even when its raw mapped signal is unchanged.",
      "Emotion mapping uses extracted emotional type weight plus intensity and arousal. Positive or negative valence does not by itself select a different region.",
      "These values explain Neurogram's mapping heuristic; they are not measured neural activity or literal storage locations.",
    ],
  };
}

function groupRegionContributions(extraction) {
  const grouped = new Map();
  for (const contribution of getRegionContributions(extraction)) {
    const values = grouped.get(contribution.region) || [];
    values.push(contribution);
    grouped.set(contribution.region, values);
  }
  return grouped;
}

function describeContributions(contributions = []) {
  return [...contributions]
    .sort((a, b) => b.amount - a.amount)
    .map((contribution) => {
      if (contribution.source === "type") {
        return `${capitalize(contribution.type)} type at ${formatPercent(
          contribution.typeWeight,
        )}, with ${formatPercent(
          contribution.ruleWeight,
        )} of that signal mapped here`;
      }
      if (contribution.source === "emotion") {
        return `"${contribution.label}" at ${formatPercent(
          contribution.intensity,
        )} intensity and ${formatPercent(
          contribution.arousal,
        )} arousal, with ${formatPercent(
          contribution.ruleWeight,
        )} of that signal mapped here`;
      }
      return `Physical action "${contribution.action}" adds a motor signal`;
    });
}

function explainRegionDifference(region) {
  const delta = region.delta.weight;
  if (delta === null) {
    const presentSide = region.left ? "left" : "right";
    return `${region.label} is present only in the ${presentSide} memory's mapped profile.`;
  }
  if (Math.abs(delta) < 0.005) {
    return `Both memories allocate nearly the same relative share to ${region.label}.`;
  }
  const higherSide = delta > 0 ? "right" : "left";
  const higherReasons =
    higherSide === "right" ? region.rightReasons : region.leftReasons;
  const reason = higherReasons[0]
    ? ` The strongest mapped reason on that side is ${lowercaseFirst(
        higherReasons[0],
      )}.`
    : "";
  return `${region.label} is ${formatPercentagePoints(
    Math.abs(delta),
  )} higher in the ${higherSide} memory.${reason}`;
}

function getDominantType(extraction) {
  return [...(extraction.types || [])].sort(
    (a, b) => b.weight - a.weight || a.type.localeCompare(b.type),
  )[0] || null;
}

function valueDelta(left, right) {
  return { left, right, changed: left !== right };
}

function subtractNullable(right, left) {
  return right === undefined ||
      right === null ||
      left === undefined ||
      left === null
    ? null
    : right - left;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueBy(values, key) {
  return [...new Map(values.map((value) => [key(value), value])).values()].sort(
    (a, b) => key(a).localeCompare(key(b)),
  );
}

function entityKey(entity) {
  return `${normalizeKey(entity.kind)}:${normalizeKey(entity.name)}`;
}

function relationshipKey(relationship) {
  return [
    relationship.subject,
    relationship.predicate,
    relationship.object,
  ].map(normalizeKey).join(":");
}

function normalizeKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function formatPercentagePoints(value) {
  return `${Math.round((Number(value) || 0) * 100)} percentage points`;
}

function humanize(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function lowercaseFirst(value) {
  const text = String(value || "");
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}
