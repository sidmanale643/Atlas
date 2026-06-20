export const BRAIN_ATLAS_SOURCE = Object.freeze({
  title: "HRA v1.3 3D Male Allen Brain",
  url: "https://cdn.humanatlas.io/hra-releases/v2.0/models/3d-vh-m-allen-brain.glb",
  sha256: "2b9ad5b53e40e9f0936da74f7be38d2eed15604e26358c3870a0ea13499b9a35",
});

export const BRAIN_ATLAS_URL = "/assets/brain-atlas.glb";
export const REGION_NODE_PREFIX = "region:";

export const BRAIN_ATLAS_EXTRAS = Object.freeze({
  neutralContext: Object.freeze({
    strategy: "inactive-surface-regions",
    contextShellNode: null,
    description:
      "Inactive surface-region meshes collectively provide the neutral context shell; no duplicate context:shell geometry is included.",
  }),
});

const hemispheres = (...names) =>
  Object.freeze({
    L: Object.freeze(names.map((name) => `Allen_${name}_L`)),
    R: Object.freeze(names.map((name) => `Allen_${name}_R`)),
  });

// Source meshes are intentionally assigned at most once. Structures not represented by
// Neurogram's 11-region model (brainstem, ventricles, tracts, etc.) are omitted.
export const REGION_SOURCE_NODES = Object.freeze({
  hippocampus: hemispheres("head_of_hippocampus", "body_of_hippocampus", "tail_of_hippocampus"),
  prefrontal: hemispheres(
    "superior_frontal_gyrus",
    "middle_frontal_gyrus",
    "inferior_frontal_gyrus_triangular_part",
    "inferior_frontal_gyrus_opercular_part",
    "gyrus_rectus_straight_gyrus",
    "medial_orbital_gyrus",
    "anterior_intermediate_orbital_gyrus",
    "posterior_intermediate_orbital_gyrus",
    "lateral_orbital_gyrus",
    "frontal_operculum",
    "rostral_gyrus",
    "frontomarginal_gyrus",
    "frontal_pole",
  ),
  associationCortex: hemispheres(
    "occipital_pole",
    "cuneus",
    "lingual_gyrus_medial_occipitotemporal_gyrus",
    "lateral_occipitotemporal_fusiform_gyrus_occipital_part",
    "inferior_occipital_gyrus",
    "superior_occipital_gyrus",
    "cingulate_gyrus_rostral_anterior_part",
    "cingulate_gyrus_caudal_posterior_part",
    "ingulo_parahippocampal_isthmus",
    "paracingulate_gyrus",
    "angular_gyrus",
    "supramarginal_gyrus",
    "precuneus",
  ),
  temporalCortex: hemispheres(
    "superior_temporal_gyrus",
    "middle_temporal_gyrus",
    "inferior_temporal_gyrus",
    "occipitotemporal_fusiform_gyrus_temporal_part",
    "transverse_temporal_gyrus_Heschls_gyrus",
    "planum_temporale",
    "temporal_pole",
    "planum_polare",
    "lateral_olfactory_gyrus",
  ),
  basalGanglia: hemispheres(
    "head_of_caudate",
    "body_of_caudate",
    "tail_of_caudate",
    "putamen",
    "nucleus_accumbens",
    "external_segment_of_globus_pallidus",
    "internal_segment_of_globus_pallidus",
  ),
  cerebellum: hemispheres(
    "cerebellar_vermis",
    "cerebellar_deep_nuclei",
    "paravermis_of_cerebellum",
    "lateral_hemisphere_of_cerebellum",
  ),
  motorCortex: hemispheres("precentral_gyrus", "paracentral_lobule_rostral_part"),
  amygdala: hemispheres("amygdaloid_complex"),
  insula: hemispheres(
    "frontal_agranular_insular_cortex_area_Fl",
    "temporal_agranular_insular_cortex_area_Tl",
    "long_insular_gyri",
    "short_insular_gyri",
    "limen_insula",
  ),
  entorhinal: hemispheres(
    "anterior_parahippocampal_gyrus",
    "posterior_parahippocampal_gyrus",
    "perirhinal_gyrus_rostral_part_of_FuGt",
    "gyrus_ambiens",
  ),
  parietalCortex: hemispheres(
    "postcentral_gyrus",
    "supraparietal_lobule",
    "paracentral_lobule_caudal_part",
    "parietal_operculum",
  ),
});

export const REGION_NODE_NAMES = Object.freeze(
  Object.fromEntries(
    Object.keys(REGION_SOURCE_NODES).map((key) => [
      key,
      Object.freeze({
        L: `${REGION_NODE_PREFIX}${key}:L`,
        R: `${REGION_NODE_PREFIX}${key}:R`,
      }),
    ]),
  ),
);
