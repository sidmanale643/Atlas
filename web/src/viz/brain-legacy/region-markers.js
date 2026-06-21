import * as THREE from "three";
import { LEGACY_REGION_COLORS } from "./region-colors.js";

const REGION_MARKER_SHAPES = Object.freeze({
  prefrontal: { scale: [0.72, 0.38, 0.28], rotation: [-0.12, 0, 0] },
  associationCortex: { scale: [0.44, 0.62, 0.34], rotation: [0.28, -0.38, -0.32] },
  temporalCortex: { scale: [0.52, 0.3, 0.48], rotation: [0.08, 0.32, -0.16] },
  parietalCortex: { scale: [0.46, 0.44, 0.58], rotation: [-0.25, 0.18, 0.24] },
  motorCortex: { scale: [0.3, 0.64, 0.32], rotation: [0.42, 0.06, -0.42] },
  entorhinal: { scale: [0.34, 0.2, 0.26], rotation: [0.18, 0.18, 0.12] },
});

function createHitMaterial() {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
}

function createDeepRegionMaterial(region) {
  const color = LEGACY_REGION_COLORS[region];
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.5,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  material.userData.isDeepRegionMaterial = true;
  return material;
}

function createBasalGangliaMaterial(lightnessOffset = 0) {
  const material = createDeepRegionMaterial("basalGanglia");
  material.color.offsetHSL(0, 0, lightnessOffset);
  material.emissive.copy(material.color);
  material.roughness = 0.72;
  return material;
}

function createBasalGangliaMarker(definition) {
  const marker = new THREE.Group();
  const hitTargets = [];
  const markerScale = definition.markerScale || 1;

  const addPart = (parent, name, geometry, material, position, scale) => {
    const part = new THREE.Mesh(geometry, material);
    part.name = name;
    part.position.set(...position);
    if (scale) part.scale.set(...scale);
    part.userData = {
      region: "basalGanglia",
      anatomicalPart: name,
      isRegionMarker: true,
    };
    parent.add(part);
    hitTargets.push(part);
    return part;
  };

  const addBridge = (parent, start, end, index) => {
    const direction = end.clone().sub(start);
    const bridge = addPart(
      parent,
      `striatal-bridge-${index}`,
      new THREE.CylinderGeometry(0.017, 0.012, 1, 8),
      createBasalGangliaMaterial(0.05),
      start.clone().add(end).multiplyScalar(0.5).toArray(),
    );
    bridge.scale.y = direction.length();
    bridge.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
  };

  for (const [hemisphere, side] of [["left", -1], ["right", 1]]) {
    const hemisphereStart = hitTargets.length;
    const caudateMedialOffset = side * -0.06;
    const anatomy = new THREE.Group();
    anatomy.name = `${hemisphere}-basal-ganglia`;
    anatomy.position.set(
      (side * 0.58 - definition.position[0]) / markerScale,
      -definition.position[1] - 0.12,
      0.25 - definition.position[2],
    );
    anatomy.rotation.y = side * -0.08;
    marker.add(anatomy);

    // The caudate wraps around the lentiform nuclei as a tapered C rather
    // than reading as another isolated oval.
    const caudatePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * -0.05 + caudateMedialOffset, 0.12, 0.34),
      new THREE.Vector3(side * -0.03 + caudateMedialOffset, 0.26, 0.2),
      new THREE.Vector3(side * -0.01 + caudateMedialOffset, 0.3, -0.04),
      new THREE.Vector3(side * 0.02 + caudateMedialOffset, 0.25, -0.27),
      new THREE.Vector3(side * 0.04 + caudateMedialOffset, 0.08, -0.4),
      new THREE.Vector3(side * 0.05 + caudateMedialOffset, -0.13, -0.32),
    ], false, "centripetal");
    addPart(
      anatomy,
      "caudate-body-and-tail",
      new THREE.TubeGeometry(caudatePath, 40, 0.055, 10, false),
      createBasalGangliaMaterial(0.08),
      [0, 0, 0],
    );
    addPart(
      anatomy,
      "caudate-head",
      new THREE.SphereGeometry(1, 24, 18),
      createBasalGangliaMaterial(0.08),
      [side * -0.05 + caudateMedialOffset, 0.08, 0.34],
      [0.11, 0.14, 0.13],
    );

    [
      [[side * -0.025 + caudateMedialOffset, 0.255, 0.16], [side * 0.045, 0.13, 0.12]],
      [[side * -0.005 + caudateMedialOffset, 0.29, -0.02], [side * 0.055, 0.15, 0]],
      [[side * 0.015 + caudateMedialOffset, 0.245, -0.2], [side * 0.065, 0.12, -0.1]],
    ].forEach(([start, end], index) => {
      addBridge(
        anatomy,
        new THREE.Vector3(...start),
        new THREE.Vector3(...end),
        index,
      );
    });

    // Putamen and globus pallidus form the lentiform nucleus. Offset the
    // pallidum medially so both volumes remain legible through the shell.
    const putamen = addPart(
      anatomy,
      "putamen",
      new THREE.SphereGeometry(1, 28, 20),
      createBasalGangliaMaterial(0.02),
      [side * 0.09, -0.01, 0],
      [0.24, 0.19, 0.3],
    );
    putamen.rotation.x = -0.16;
    putamen.rotation.y = side * 0.2;

    const pallidum = addPart(
      anatomy,
      "globus-pallidus",
      new THREE.SphereGeometry(1, 24, 18),
      createBasalGangliaMaterial(-0.1),
      [side * -0.1, -0.015, 0.015],
      [0.12, 0.145, 0.22],
    );
    pallidum.rotation.x = -0.18;
    pallidum.rotation.y = side * 0.24;

    addPart(
      anatomy,
      "nucleus-accumbens",
      new THREE.SphereGeometry(1, 20, 14),
      createBasalGangliaMaterial(0.14),
      [side * 0.01, -0.17, 0.22],
      [0.115, 0.075, 0.11],
    );
    for (let index = hemisphereStart; index < hitTargets.length; index += 1) {
      hitTargets[index].userData.hemisphere = hemisphere;
    }
  }

  marker.userData = {
    region: "basalGanglia",
    isDeepRegion: true,
    bilateral: true,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createCerebellumGeometry(scale, phase = 0) {
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    // Closely spaced shallow bands suggest cerebellar folia without adding a
    // second texture asset. Two frequencies keep the silhouette organic while
    // preserving the broad, flattened posterior lobe.
    const folia = 1
      + Math.sin(point.y * 30 + point.z * 4 + phase) * 0.025
      + Math.sin(point.y * 17 - point.x * 3 + phase) * 0.015;
    positions.setXYZ(
      index,
      point.x * scale[0] * folia,
      point.y * scale[1] * folia,
      point.z * scale[2] * folia,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createCerebellumMarker(definition) {
  const color = LEGACY_REGION_COLORS.cerebellum;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.3,
    roughness: 0.88,
    metalness: 0,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  material.userData.isCerebellumMaterial = true;

  const anatomy = new THREE.Group();
  anatomy.rotation.set(-0.08, 0.16, 0.02);
  const hitTargets = [];

  // Two broad hemispheres create the paired posterior mass visible in real
  // anatomy. They overlap slightly at the midline so no background can leak
  // through as the model rotates.
  for (const [hemisphere, side, phase] of [
    ["left", -1, 0],
    ["right", 1, Math.PI * 0.35],
  ]) {
    const lobe = new THREE.Mesh(
      createCerebellumGeometry([0.86, 0.6, 0.78], phase),
      material,
    );
    lobe.position.set(side * 0.5, 0, 0);
    lobe.rotation.z = side * -0.08;
    lobe.userData = {
      region: "cerebellum",
      hemisphere,
      isRegionMarker: true,
    };
    anatomy.add(lobe);
    hitTargets.push(lobe);
  }

  // The vermis bridges the hemispheres and gives the upper edge enough mass
  // to tuck continuously beneath the occipital lobes.
  const vermis = new THREE.Mesh(
    createCerebellumGeometry([0.34, 0.64, 0.68], Math.PI * 0.7),
    material,
  );
  vermis.position.set(0, 0.06, 0.05);
  vermis.userData = { region: "cerebellum", isRegionMarker: true };
  anatomy.add(vermis);
  hitTargets.push(vermis);

  const marker = new THREE.Group();
  marker.add(anatomy);
  marker.userData = {
    region: "cerebellum",
    isDeepRegion: false,
    bilateral: true,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createHippocampusGeometry(points) {
  const tubularSegments = 32;
  const radialSegments = 12;
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  const radial = new THREE.Vector3();

  for (let segment = 0; segment <= tubularSegments; segment += 1) {
    const t = segment / tubularSegments;
    curve.getPointAt(t, point);

    // A hippocampus is not a pipe: the posterior tail is narrow and the
    // anterior head is fuller. The localized swell preserves that silhouette
    // without making the entire structure visually heavy.
    const taper = THREE.MathUtils.smoothstep(t, 0, 0.68);
    const head = Math.exp(-((t - 0.78) ** 2) / 0.035);
    const radius = THREE.MathUtils.lerp(0.07, 0.11, taper) + head * 0.035;

    for (let side = 0; side <= radialSegments; side += 1) {
      const angle = (side / radialSegments) * Math.PI * 2;
      radial
        .copy(frames.normals[segment])
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(frames.binormals[segment], Math.sin(angle));
      positions.push(
        point.x + radial.x * radius,
        point.y + radial.y * radius,
        point.z + radial.z * radius,
      );
    }
  }

  const ringSize = radialSegments + 1;
  for (let segment = 0; segment < tubularSegments; segment += 1) {
    for (let side = 0; side < radialSegments; side += 1) {
      const a = segment * ringSize + side;
      const b = (segment + 1) * ringSize + side;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createHippocampusMarker(definition) {
  const marker = new THREE.Group();
  const hitTargets = [];
  for (const [hemisphere, side] of [["left", -1], ["right", 1]]) {
    const points = [
      [0.9, -0.96, -0.42], [0.96, -0.98, -0.2], [0.98, -0.94, 0.04],
      [0.95, -0.86, 0.28], [0.87, -0.74, 0.48], [0.76, -0.61, 0.61],
      [0.7, -0.49, 0.58], [0.75, -0.43, 0.48],
    ].map(([x, y, z]) => new THREE.Vector3(
      side * x - definition.position[0],
      y - definition.position[1],
      z - definition.position[2],
    ));
    const hitTarget = new THREE.Mesh(
      createHippocampusGeometry(points),
      createDeepRegionMaterial("hippocampus"),
    );
    hitTarget.userData = { region: "hippocampus", hemisphere, isRegionMarker: true };
    marker.add(hitTarget);
    hitTargets.push(hitTarget);
  }
  marker.userData = {
    region: "hippocampus",
    isDeepRegion: true,
    bilateral: true,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createAmygdalaGeometry() {
  const geometry = new THREE.SphereGeometry(1, 36, 24);
  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    const axialDistance = Math.abs(point.z);
    const poleTaper = 1 - 0.16 * axialDistance ** 1.6;
    const anteriorFullness = THREE.MathUtils.lerp(0.9, 1.08, (point.z + 1) * 0.5);

    // The amygdala is a compact, asymmetric almond-shaped nucleus: broader
    // anteriorly and tapered posteriorly, rather than a generic sphere.
    positions.setXYZ(
      index,
      point.x * 0.34 * poleTaper * anteriorFullness,
      point.y * 0.23 * poleTaper,
      point.z * 0.4,
    );
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createAmygdalaMarker(definition) {
  const marker = new THREE.Group();
  const hitTargets = [];
  const markerScale = definition.markerScale || 1;

  for (const [hemisphere, side] of [["left", -1], ["right", 1]]) {
    const nucleus = new THREE.Mesh(
      createAmygdalaGeometry(),
      createDeepRegionMaterial("amygdala"),
    );
    nucleus.position.x = (
      side * Math.abs(definition.center[0]) - definition.position[0]
    ) / markerScale;
    nucleus.rotation.set(0.12, side * 0.18, side * -0.08);
    nucleus.userData = { region: "amygdala", hemisphere, isRegionMarker: true };
    marker.add(nucleus);
    hitTargets.push(nucleus);
  }

  marker.userData = {
    region: "amygdala",
    isDeepRegion: true,
    bilateral: true,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createInsulaGeometry() {
  const outline = new THREE.Shape();
  outline.moveTo(-0.5, -0.25);
  outline.bezierCurveTo(-0.56, 0.02, -0.48, 0.36, -0.28, 0.48);
  outline.bezierCurveTo(-0.03, 0.59, 0.32, 0.5, 0.47, 0.26);
  outline.bezierCurveTo(0.57, 0.07, 0.49, -0.27, 0.22, -0.42);
  outline.bezierCurveTo(-0.02, -0.53, -0.38, -0.45, -0.5, -0.25);

  const depth = 0.18;
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth,
    steps: 1,
    curveSegments: 12,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.075,
    bevelThickness: 0.055,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createInsulaRidge(points, material) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0.145)),
    false,
    "centripetal",
  );
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, 0.018, 7, false),
    material,
  );
}

function createInsulaMarker(definition) {
  const marker = new THREE.Group();
  const hitTargets = [];
  const markerScale = definition.markerScale || 1;

  for (const [hemisphere, side] of [["left", -1], ["right", 1]]) {
    const anatomy = new THREE.Group();
    anatomy.name = `${hemisphere}-insula`;
    anatomy.position.x = (
      side * Math.abs(definition.center[0]) - definition.position[0]
    ) / markerScale;
    // The insula is a buried cortical plate on the lateral wall, not an oval
    // nucleus. Turn the extruded fan outward in each hemisphere.
    anatomy.rotation.set(-0.08, side * Math.PI / 2, side * -0.08);

    const surface = new THREE.Group();
    surface.scale.set(1.5, 0.9, 1);
    anatomy.add(surface);

    const plate = new THREE.Mesh(
      createInsulaGeometry(),
      createDeepRegionMaterial("insula"),
    );
    plate.userData = { region: "insula", hemisphere, isRegionMarker: true };
    surface.add(plate);
    hitTargets.push(plate);

    // Shallow radiating ridges evoke the short and long insular gyri while
    // keeping the silhouette readable through the translucent cerebral shell.
    const ridgeMaterial = createDeepRegionMaterial("insula");
    ridgeMaterial.color.offsetHSL(0, -0.08, 0.1);
    ridgeMaterial.emissive.copy(ridgeMaterial.color);
    ridgeMaterial.opacity = 0.82;
    [
      [[-0.36, 0.26], [-0.12, 0.18], [0.18, 0.12], [0.39, 0.18]],
      [[-0.38, 0.04], [-0.13, 0.01], [0.16, -0.05], [0.4, -0.15]],
      [[-0.26, 0.43], [-0.08, 0.24], [0.03, 0.02], [0.1, -0.32]],
    ].forEach((points) => surface.add(createInsulaRidge(points, ridgeMaterial)));

    marker.add(anatomy);
  }

  marker.userData = {
    region: "insula",
    isDeepRegion: true,
    bilateral: true,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function createMotorCortexMarker(definition) {
  const marker = new THREE.Group();
  const hitTarget = new THREE.Mesh(
    new THREE.BoxGeometry(4.1, 2.1, 0.5),
    createHitMaterial(),
  );
  hitTarget.position.set(
    -definition.position[0],
    1.15 - definition.position[1],
    0.18 - definition.position[2],
  );
  hitTarget.rotation.x = -0.04;
  hitTarget.userData = { region: "motorCortex", isRegionMarker: true };
  marker.add(hitTarget);
  marker.userData = {
    region: "motorCortex",
    isDeepRegion: false,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets: [hitTarget],
  };
  return marker;
}

function createRegionMarker(region, definition) {
  if (region === "hippocampus") return createHippocampusMarker(definition);
  if (region === "amygdala") return createAmygdalaMarker(definition);
  if (region === "basalGanglia") return createBasalGangliaMarker(definition);
  if (region === "cerebellum") return createCerebellumMarker(definition);
  if (region === "insula") return createInsulaMarker(definition);
  if (region === "motorCortex") return createMotorCortexMarker(definition);
  const marker = new THREE.Group();
  const shape = REGION_MARKER_SHAPES[region];
  const isDeepRegion = definition.kind === "deep";
  const hitTargets = [];
  const markerScale = definition.markerScale || 1;
  const hemisphereEntries = definition.bilateral
    ? [["left", -Math.abs(definition.center[0])], ["right", Math.abs(definition.center[0])]]
    : [[null, definition.position[0]]];
  for (const [hemisphere, worldX] of hemisphereEntries) {
    const target = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      isDeepRegion ? createDeepRegionMaterial(region) : createHitMaterial(),
    );
    // The marker group is scaled as activation changes. Compensate its base
    // scale here so mirrored target centers still land at ±worldX.
    target.position.x = (worldX - definition.position[0]) / markerScale;
    if (shape) {
      target.scale.set(...shape.scale).multiplyScalar(1.12);
      target.rotation.set(
        shape.rotation[0],
        hemisphere === "left" ? -shape.rotation[1] : shape.rotation[1],
        hemisphere === "left" ? -shape.rotation[2] : shape.rotation[2],
      );
    } else {
      target.scale.setScalar(0.2);
    }
    target.userData = { region, hemisphere, isRegionMarker: true };
    marker.add(target);
    hitTargets.push(target);
  }
  marker.userData = {
    region,
    isDeepRegion,
    bilateral: definition.bilateral || false,
    markerScale: definition.markerScale,
    weight: 0,
    hitTargets,
  };
  return marker;
}

function getRegionMarkerScale(marker) {
  const { bilateral, isDeepRegion, markerScale, weight } = marker.userData;
  if (bilateral) return markerScale;
  const strength = Math.sqrt(THREE.MathUtils.clamp(weight, 0, 1));
  if (marker.userData.region === "cerebellum") {
    return markerScale * (0.94 + strength * 0.1);
  }
  return markerScale * (isDeepRegion ? 1.08 : 1) * (0.94 + strength * 0.5);
}

function setRegionMarkerWeight(marker, value, focused = false) {
  const weight = THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
  marker.userData.weight = weight;
  marker.visible = weight > 0;
  const focusScale = marker.userData.bilateral ? 1 : focused ? 1.12 : 1;
  marker.scale.setScalar(getRegionMarkerScale(marker) * focusScale);
  marker.traverse((object) => {
    const material = object.material;
    if (material?.userData.isCerebellumMaterial) {
      material.emissiveIntensity = focused
        ? 0.82
        : THREE.MathUtils.lerp(0.18, 0.5, Math.sqrt(weight));
      return;
    }
    if (!material?.userData.isDeepRegionMaterial) return;
    if (marker.userData.region === "hippocampus") {
      material.opacity = focused
        ? 0.68
        : THREE.MathUtils.lerp(0.3, 0.48, Math.sqrt(weight));
      material.emissiveIntensity = focused
        ? 0.72
        : THREE.MathUtils.lerp(0.18, 0.42, Math.sqrt(weight));
      return;
    }
    material.opacity = focused
      ? 0.94
      : THREE.MathUtils.lerp(0.5, 0.82, Math.sqrt(weight));
    material.emissiveIntensity = focused
      ? 1.15
      : THREE.MathUtils.lerp(0.35, 0.78, Math.sqrt(weight));
  });
}

export function createLegacyRegionMarkers(parent, regions) {
  const group = new THREE.Group();
  const markers = new Map();
  const hitTargets = [];
  group.name = "legacy-region-markers";

  for (const [region, definition] of Object.entries(regions)) {
    const anchor = new THREE.Group();
    anchor.position.set(...definition.position);
    const marker = createRegionMarker(region, definition);
    marker.visible = false;
    anchor.add(marker);
    group.add(anchor);
    marker.scale.setScalar(marker.userData.markerScale || 1);
    markers.set(region, marker);
    hitTargets.push(...marker.userData.hitTargets);
  }
  parent.add(group);
  parent.updateMatrixWorld(true);

  // Connections and visible markers must share the same endpoint source.
  // Measure the procedural marker meshes after their anchor and base scale are
  // applied, then convert those centers back into the brain-content space where
  // memory nodes and tube geometry live.
  const connectionTargets = new Map();
  for (const [region, marker] of markers) {
    const centers = [];
    const hemisphereCenters = new Map();
    for (const target of marker.userData.hitTargets) {
      const center = new THREE.Box3()
        .setFromObject(target)
        .getCenter(new THREE.Vector3());
      parent.worldToLocal(center);
      const coordinates = center.toArray();
      centers.push(center);
      if (target.userData.hemisphere) {
        if (!hemisphereCenters.has(target.userData.hemisphere)) {
          hemisphereCenters.set(target.userData.hemisphere, []);
        }
        hemisphereCenters.get(target.userData.hemisphere).push(
          new THREE.Vector3(...coordinates),
        );
      }
    }
    if (!centers.length) continue;
    const center = centers
      .reduce((sum, point) => sum.add(point), new THREE.Vector3())
      .multiplyScalar(1 / centers.length)
      .toArray();
    const hemispheres = Object.fromEntries(
      [...hemisphereCenters].map(([hemisphere, points]) => [
        hemisphere,
        points
          .reduce((sum, point) => sum.add(point), new THREE.Vector3())
          .multiplyScalar(1 / points.length)
          .toArray(),
      ]),
    );
    connectionTargets.set(region, { center, ...hemispheres });
  }

  return {
    group,
    markers,
    hitTargets,
    connectionTargets,
    update({ memory, focusedRegion }) {
      markers.forEach((marker) => setRegionMarkerWeight(marker, 0));
      for (const activation of memory?.regions || []) {
        const marker = markers.get(activation.region);
        if (marker) {
          setRegionMarkerWeight(
            marker,
            activation.weight,
            activation.region === focusedRegion,
          );
        }
      }
    },
    dispose() {
      group.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material?.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}

export function updateLegacyRegionMarkers(state, next) {
  state.update(next);
}
