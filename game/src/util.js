// Simulation math. Coordinates are metres; yaw zero faces the north wall.
export function mulberry32(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 0x100000000;
  };
}
export const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
export const lerp = (start, finish, fraction) => start + (finish - start) * fraction;
export const eyeY = agent => agent.y + (agent.crouched ? 1.03 : 1.65);
export function angleDiff(start, finish) {
  return Math.atan2(Math.sin(finish - start), Math.cos(finish - start));
}
export function turnToward(start, finish, step) {
  return start + clamp(angleDiff(start, finish), -step, step);
}
export const yawTo = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);

// Project a moving circular footprint outside a solid rectangle.
export function collideCircleBox(x, z, radius, box, result) {
  const nearX = clamp(x, box.x1, box.x2), nearZ = clamp(z, box.z1, box.z2);
  const offsetX = x - nearX, offsetZ = z - nearZ;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance >= radius) return false;
  result.x = x;
  result.z = z;
  if (distance > 0.000001) {
    result.x += offsetX * (radius / distance - 1);
    result.z += offsetZ * (radius / distance - 1);
  } else {
    const escape = [x - box.x1, box.x2 - x, z - box.z1, box.z2 - z];
    switch (escape.indexOf(Math.min(...escape))) {
      case 0: result.x = box.x1 - radius; break;
      case 1: result.x = box.x2 + radius; break;
      case 2: result.z = box.z1 - radius; break;
      case 3: result.z = box.z2 + radius; break;
    }
  }
  return true;
}

// Slabs include rays starting inside geometry and parallel directions.
export function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let enter = 0, leave = Infinity;
  for (const [origin, direction, low, high] of [
    [ox, dx, box.x1, box.x2], [oy, dy, box.y1, box.y2], [oz, dz, box.z1, box.z2],
  ]) {
    if (Math.abs(direction) < 1e-10) {
      if (origin < low || origin > high) return Infinity;
      continue;
    }
    const first = (low - origin) / direction, last = (high - origin) / direction;
    enter = Math.max(enter, Math.min(first, last));
    leave = Math.min(leave, Math.max(first, last));
    if (leave < enter) return Infinity;
  }
  return enter;
}

// Separate head sphere and body capsule let crouching and jumping affect hits.
export function rayCapsule(ox, oy, oz, dx, dy, dz, agent) {
  const height = agent.crouched ? 1.22 : 1.84;
  let nearest = Infinity, part = 'body';
  const sphere = (cx, cy, cz, radius, label) => {
    const sx = ox - cx, sy = oy - cy, sz = oz - cz;
    const dot = sx * dx + sy * dy + sz * dz;
    const discriminant = dot * dot - (sx * sx + sy * sy + sz * sz - radius * radius);
    if (discriminant < 0) return;
    const hit = -dot - Math.sqrt(discriminant);
    if (hit >= 0 && hit < nearest) { nearest = hit; part = label; }
  };
  sphere(agent.x, agent.y + height - 0.2, agent.z, 0.22, 'head');
  const a = dx * dx + dz * dz;
  const sx = ox - agent.x, sz = oz - agent.z;
  const dot = sx * dx + sz * dz;
  const discriminant = dot * dot - a * (sx * sx + sz * sz - 0.31 * 0.31);
  if (a > 1e-10 && discriminant >= 0) {
    for (const t of [(-dot - Math.sqrt(discriminant)) / a, (-dot + Math.sqrt(discriminant)) / a]) {
      const y = oy + dy * t;
      if (t >= 0 && t < nearest && y >= agent.y + 0.38 && y <= agent.y + height - 0.44) {
        nearest = t; part = 'body';
      }
    }
  }
  sphere(agent.x, agent.y + 0.38, agent.z, 0.31, 'body');
  sphere(agent.x, agent.y + height - 0.44, agent.z, 0.31, 'body');
  return Number.isFinite(nearest) ? { t: nearest, part } : null;
}
