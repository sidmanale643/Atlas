"""Brain-inspired region definitions and surface mapping.

Port of ``src/shared/brain-regions.js``. The constants and helpers are
frozen in the JavaScript version to prevent accidental mutation, and the
Python port uses frozenset/tuple equivalents to keep the same shape.
"""

from __future__ import annotations

from typing import Iterable, Sequence


CORE_BRAIN_REGIONS: tuple[str, ...] = (
    "hippocampus",
    "prefrontal",
    "temporalCortex",
    "parietalCortex",
    "amygdala",
    "basalGanglia",
    "cerebellum",
    "motorCortex",
    "insula",
)


_SURFACE_REGION_PROFILES: dict[str, dict] = {
    "prefrontal": {
        "center": (0, 0.35, 1.8),
        "radius": (1.8, 1.45, 1.15),
        "bilateral": False,
    },
    "temporalCortex": {
        "center": (1.45, -0.5, 0.35),
        "radius": (0.85, 1.1, 1.45),
        "bilateral": True,
    },
    "parietalCortex": {
        "center": (0, 1.2, -0.9),
        "radius": (1.9, 1.05, 1.35),
        "bilateral": False,
    },
    "cerebellum": {
        "center": (0, -1.55, -1.45),
        "radius": (1.45, 0.7, 1.1),
        "bilateral": False,
    },
    "motorCortex": {
        "center": (0, 1.25, 0.25),
        "radius": (1.9, 0.7, 0.75),
        "bilateral": False,
    },
    "insula": {
        "center": (1.25, -0.05, 0.45),
        "radius": (0.7, 0.8, 0.8),
        "bilateral": True,
    },
}


def get_surface_brain_region(point: Sequence[float]) -> str | None:
    """Map a 3D point to the closest anatomical surface region.

    Mirrors the JavaScript implementation exactly. Bilateral regions use
    the absolute value of the X coordinate so that symmetric points on
    either side of the brain resolve to the same region label.
    """

    closest_region: str | None = None
    closest_distance = float("inf")

    for region, profile in _SURFACE_REGION_PROFILES.items():
        x = abs(point[0]) if profile["bilateral"] else point[0]
        distance = 0.0
        for index, center in enumerate(profile["center"]):
            coordinate = x if index == 0 else point[index]
            normalized = (coordinate - center) / profile["radius"][index]
            distance += normalized * normalized

        if distance < closest_distance:
            closest_region = region
            closest_distance = distance

    return closest_region
