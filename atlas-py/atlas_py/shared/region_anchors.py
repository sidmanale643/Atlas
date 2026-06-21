"""Frontend anchor metadata for each anatomical region.

Port of ``src/shared/region-anchors.js``. The brain visualisation uses
one anchor per region (a 3D position plus visual metadata). The
``REGION_COLORS`` palette is intentionally fixed and exposed as a
``MappingProxyType`` to mirror the JavaScript ``Object.freeze`` behavior.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Sequence


REGION_COLORS: MappingProxyType = MappingProxyType({
    "hippocampus": "#ffd38a",
    "prefrontal": "#8edfff",
    "amygdala": "#ff8fa8",
    "temporalCortex": "#b9a7ff",
    "parietalCortex": "#7ee8d3",
    "basalGanglia": "#978cff",
    "cerebellum": "#9ce4ba",
    "motorCortex": "#ffad8a",
    "insula": "#e99fd1",
    "associationCortex": "#d9e4e8",
    "entorhinal": "#80d8d0",
})


def _anchor(
    label: str,
    role: str,
    position: Sequence[float],
    color: str,
    marker_scale: float,
    activation_radius: Sequence[float] | None = None,
    hemisphere_positions: dict | None = None,
) -> dict:
    """Build a frozen-shape anchor dictionary."""

    data: dict = {
        "label": label,
        "role": role,
        "position": tuple(position),
        "color": color,
        "markerScale": marker_scale,
    }
    if activation_radius is not None:
        data["activationRadius"] = tuple(activation_radius)
    if hemisphere_positions is not None:
        data["hemispherePositions"] = {
            side: tuple(coords)
            for side, coords in hemisphere_positions.items()
        }
    return data


REGION_ANCHORS: MappingProxyType = MappingProxyType({
    "hippocampus": _anchor(
        "Hippocampus",
        "Binds events to their spatial and temporal context.",
        [0, -0.85, 0.8],
        REGION_COLORS["hippocampus"],
        0.85,
        hemisphere_positions={
            "left": [-0.93, -0.85, 0.8],
            "right": [0.93, -0.85, 0.8],
        },
    ),
    "prefrontal": _anchor(
        "Prefrontal cortex",
        "Supports active recall, planning, and working control.",
        [0, 0.35, 2.28],
        REGION_COLORS["prefrontal"],
        1.1,
        activation_radius=[1.15, 1.05, 0.78],
    ),
    "associationCortex": _anchor(
        "Association cortex",
        "Integrates concepts across knowledge and sensory systems.",
        [-1.25, 0.75, 0.85],
        REGION_COLORS["associationCortex"],
        1.15,
        activation_radius=[0.95, 1.05, 1.05],
    ),
    "temporalCortex": _anchor(
        "Temporal cortex",
        "Supports semantic knowledge and recognizable concepts.",
        [1.72, -0.45, 0.35],
        REGION_COLORS["temporalCortex"],
        1.1,
        activation_radius=[0.62, 0.9, 1.12],
    ),
    "basalGanglia": _anchor(
        "Basal ganglia",
        "Supports learned routines, habits, and procedural patterns.",
        [0.62, -0.12, 0.25],
        REGION_COLORS["basalGanglia"],
        0.8,
        activation_radius=[0.95, 0.82, 0.95],
    ),
    "cerebellum": _anchor(
        "Cerebellum",
        "Coordinates timing and precision in practiced movement.",
        [0.45, -1.3, -1.15],
        REGION_COLORS["cerebellum"],
        1.1,
        activation_radius=[1.28, 0.72, 1],
    ),
    "motorCortex": _anchor(
        "Motor cortex",
        "Represents and plans physical actions.",
        [1.15, 1.35, 0.05],
        REGION_COLORS["motorCortex"],
        1,
        activation_radius=[0.72, 0.82, 1.05],
    ),
    "amygdala": _anchor(
        "Amygdala",
        "Tags experiences with emotional salience.",
        [0.82, -0.78, 0.72],
        REGION_COLORS["amygdala"],
        0.72,
        activation_radius=[0.82, 0.72, 0.82],
    ),
    "insula": _anchor(
        "Insula",
        "Represents internal feelings and bodily state.",
        [1.48, 0.02, 0.48],
        REGION_COLORS["insula"],
        0.9,
        activation_radius=[0.7, 0.82, 0.82],
    ),
    "entorhinal": _anchor(
        "Entorhinal cortex",
        "Supports spatial context and navigation through memory.",
        [1.08, -0.92, 0.18],
        REGION_COLORS["entorhinal"],
        0.76,
        activation_radius=[0.82, 0.68, 0.88],
    ),
    "parietalCortex": _anchor(
        "Parietal cortex",
        "Supports spatial attention and active information.",
        [0.82, 1.3, -1.08],
        REGION_COLORS["parietalCortex"],
        1.1,
        activation_radius=[1.05, 0.82, 0.95],
    ),
})


def get_region_anchor(region: str) -> dict | None:
    return REGION_ANCHORS.get(region)
