export function animateLegacyMemoryNodes(group, elapsed) {
  for (const node of group.children) {
    const pulse = 1 + Math.sin(elapsed * 2.1 + node.userData.pulseOffset) * 0.08;
    node.scale.setScalar((node.userData.selectionScale || 1) * pulse);
    const aura = node.userData.aura;
    if (aura) aura.scale.setScalar(1 + Math.sin(elapsed * 1.5 + node.userData.pulseOffset) * 0.1);
  }
}

export function animateLegacyConnections(group, elapsed) {
  for (const connection of group.children) {
    if (!connection.visible) continue;
    const { curve, particles, speed, weight } = connection.userData;
    particles.forEach((particle, index) => {
      const progress = (elapsed * speed + index / particles.length) % 1;
      particle.position.copy(curve.getPointAt(progress));
      particle.scale.setScalar(0.8 + Math.sin(progress * Math.PI) * (0.45 + weight * 0.3));
      particle.material.opacity = 0.45 + Math.sin(progress * Math.PI) * 0.5;
    });
  }
}
