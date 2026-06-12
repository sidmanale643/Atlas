export const REGION_MAPPING_VERSION = 1;

export const REGION_NAMES = Object.freeze([
  "hippocampus",
  "prefrontal",
  "associationCortex",
  "temporalCortex",
  "basalGanglia",
  "cerebellum",
  "motorCortex",
  "amygdala",
  "insula",
  "entorhinal",
  "parietalCortex",
]);

const REGION_RULES = Object.freeze({
  episodic: {
    hippocampus: 0.65,
    prefrontal: 0.2,
    associationCortex: 0.15,
  },
  semantic: {
    temporalCortex: 0.55,
    associationCortex: 0.35,
    prefrontal: 0.1,
  },
  procedural: {
    basalGanglia: 0.45,
    cerebellum: 0.35,
    motorCortex: 0.2,
  },
  emotional: {
    amygdala: 0.5,
    insula: 0.25,
    prefrontal: 0.15,
    hippocampus: 0.1,
  },
  spatial: {
    hippocampus: 0.4,
    entorhinal: 0.3,
    parietalCortex: 0.3,
  },
  working: {
    prefrontal: 0.6,
    parietalCortex: 0.4,
  },
});

// Contributions below this level do not produce a useful visible activation.
export const MIN_REGION_ACTIVATION = 0.01;

const EMOTION_REGION_RULE = Object.freeze({
  amygdala: 0.65,
  insula: 0.35,
});
const MOTOR_ACTION_ACTIVATION = 0.2;
const PHYSICAL_ACTION_PATTERN =
  /\b(?:climb|climbed|climbing|crawl|crawled|crawling|dance|danced|dancing|drive|drove|driving|exercise|exercised|exercising|grab|grabbed|grabbing|jump|jumped|jumping|kick|kicked|kicking|lift|lifted|lifting|move|moved|moving|play|played|playing|pull|pulled|pulling|push|pushed|pushing|ride|rode|riding|run|ran|running|swim|swam|swimming|throw|threw|throwing|walk|walked|walking|write|wrote|writing)\b/i;

function addContribution(totals, region, amount) {
  if (amount > 0) {
    totals.set(region, (totals.get(region) || 0) + amount);
  }
}

export function getRegionContributions(extraction) {
  const contributions = [];

  for (const { type, weight } of extraction.types || []) {
    const rule = REGION_RULES[type];
    if (!rule || weight <= 0) continue;

    for (const [region, regionWeight] of Object.entries(rule)) {
      contributions.push({
        region,
        source: "type",
        type,
        typeWeight: weight,
        ruleWeight: regionWeight,
        amount: weight * regionWeight,
      });
    }
  }

  for (const emotion of extraction.emotions || []) {
    const emotionActivation = emotion.intensity * emotion.arousal;
    for (const [region, regionWeight] of Object.entries(EMOTION_REGION_RULE)) {
      contributions.push({
        region,
        source: "emotion",
        label: emotion.label,
        intensity: emotion.intensity,
        arousal: emotion.arousal,
        confidence: emotion.confidence,
        ruleWeight: regionWeight,
        amount: emotionActivation * regionWeight,
      });
    }
  }

  const physicalAction = (extraction.actions || []).find((action) =>
    PHYSICAL_ACTION_PATTERN.test(action)
  );
  if (physicalAction) {
    contributions.push({
      region: "motorCortex",
      source: "action",
      action: physicalAction,
      amount: MOTOR_ACTION_ACTIVATION,
    });
  }

  return contributions;
}

export function mapExtractionToRegions(extraction) {
  const totals = new Map();

  for (const { region, amount } of getRegionContributions(extraction)) {
    addContribution(totals, region, amount);
  }

  const significant = [...totals.entries()].filter(
    ([, weight]) => weight >= MIN_REGION_ACTIVATION
  );
  const totalWeight = significant.reduce((sum, [, weight]) => sum + weight, 0);

  if (totalWeight === 0) return [];

  return significant
    .map(([region, weight]) => ({ region, weight: weight / totalWeight }))
    .sort((a, b) => b.weight - a.weight || a.region.localeCompare(b.region));
}
