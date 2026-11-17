import { rayBox } from './util.js';

export const MAP = { width: 64, depth: 44 };
const solid = (x, z, width, depth, height, material, label = '') => ({
  x1: x, x2: x + width, y1: 0, y2: height, z1: z, z2: z + depth, material, label,
});
// Yard 9 has a sheltered west building and a more open east freight terminal.
// These solids are also the render geometry; decorative ribs sit on their faces.
export const COLLIDERS = [
  solid(-32, -22, 64, 1, 4, 'wall'), solid(-32, 21, 64, 1, 4, 'wall'),
  solid(-32, -21, 1, 42, 4, 'wall'), solid(31, -21, 1, 42, 4, 'wall'),
  solid(-29, -18, 15, 0.65, 5.2, 'warehouse'),
  solid(-29, -18, 0.65, 16, 5.2, 'warehouse'),
  solid(-29, -2.65, 8.5, 0.65, 5.2, 'warehouse'),
  solid(-16.5, -2.65, 2.5, 0.65, 5.2, 'warehouse'),
  solid(-14.65, -17.35, 0.65, 5.35, 5.2, 'warehouse'),
  solid(-14.65, -8, 0.65, 5.35, 5.2, 'warehouse'),
  solid(-26, -15.5, 2.5, 2.3, 1.35, 'crate'),
  solid(-25.5, -7, 2, 2, 2.2, 'crate'),
  solid(-17.5, -15.5, 2, 2, 1.25, 'barrel'),
  solid(14, -16, 8, 2.8, 2.85, 'rust', '09 / 214'),
  solid(25, -15.5, 4, 2.6, 5.1, 'teal', 'HBR 06'),
  solid(15, -5.5, 4.5, 2.5, 2.85, 'teal', 'B / TERMINAL'),
  solid(23, -8, 6, 2.4, 2.85, 'rust', 'SBL 12'),
  solid(21, -11.5, 1.6, 1.5, 1.15, 'crate'),
  solid(27, -3, 1.4, 1.4, 1.15, 'barrel'),
  solid(-2.8, -4, 5.6, 2.4, 2.85, 'rust', 'YARD 9'),
  solid(-2.8, 1.7, 5.6, 2.4, 2.85, 'teal', 'FREIGHT'),
  solid(-7.8, -1.8, 1.8, 1.8, 1.25, 'crate'),
  solid(6, -1, 1.8, 1.8, 1.25, 'crate'),
  solid(-14, 7, 4, 2.6, 2.85, 'teal', 'WEST'),
  solid(10, 7, 4, 2.6, 2.85, 'rust', 'EAST'),
  solid(-20, 3, 2, 1.8, 1.25, 'crate'),
  solid(18, 2.4, 2, 1.8, 1.25, 'crate'),
  solid(-10.5, -8.4, 1.4, 1.4, 1.25, 'barrel'),
  solid(9.5, -8.4, 1.4, 1.4, 1.25, 'barrel'),
  solid(-9, -15.5, 4.5, 2.5, 2.85, 'teal', 'NORTH'),
  solid(4.5, -15.5, 4.5, 2.5, 2.85, 'rust', 'RAIL'),
  solid(-8.5, 13, 4, 2.2, 2.85, 'rust', 'SABLE'),
  solid(4.5, 13, 4, 2.2, 2.85, 'teal', '09 / 117'),
  solid(-1.2, 15.5, 2.4, 1.4, 1.1, 'crate'),
];
export const SITES = {
  A: { x: -21.5, z: -10.2, r: 4.25, name: 'West warehouse', node: 12 },
  B: { x: 20.5, z: -9.2, r: 4.15, name: 'Container terminal', node: 23 },
};
export const SPAWNS = {
  sable: [-7, -3.5, 0, 3.5, 7].map(x => ({ x, z: 19, yaw: 0 })),
  harbor: [-7, -3.5, 0, 3.5, 7].map(x => ({ x, z: -19.2, yaw: Math.PI })),
};
export const POLES = [[-30, 18], [30, 18], [-30, -19], [30, -19], [0, -19]];
// Nodes clear the walls by a full body radius. A connected route exists to
// both doors of A and both approaches to B, including from either spawn.
export const WAYPOINTS = [
  [-7, 19], [0, 19], [7, 19],                // 0..2 south
  [-11, 15.8], [-3.5, 11], [3.5, 11], [11, 15.8],
  [-17, 10.5], [-16.8, 4.8], [-18.5, -0.8], // west approach
  [-18.5, -4], [-20, -6.2], [-21.5, -10.2],
  [-26.8, -10], [-21.5, -15.8], [-12, -10],
  [-11.5, -19], [-19, -19.4],               // north west
  [17, 10.5], [16.5, 1.5], [21, 0], [21, -3.5],
  [20.5, -6.5], [20.5, -9.2], [16, -10.5], [24, -9.2],
  [12, -10.5], [11.5, -17.8],              // north east
  [-7, -19.2], [0, -19.2], [7, -19.2],
  [-8.5, 5], [8.5, 5], [-4.5, -5.5], [4.5, -5.5],
  [0, -10.5], [0, 7], [0, 0], [-4.5, 0], [4.5, 0], // mid cut-through
];

export function walkClear(x, z, tx, tz, radius = 0.4) {
  const distance = Math.hypot(tx - x, tz - z);
  if (distance < 1e-8) return true;
  for (const box of COLLIDERS) {
    const expanded = { ...box, x1: box.x1 - radius, x2: box.x2 + radius, z1: box.z1 - radius, z2: box.z2 + radius };
    if (rayBox(x, 0.6, z, (tx - x) / distance, 0, (tz - z) / distance, expanded) < distance) return false;
  }
  return true;
}
export const EDGES = WAYPOINTS.map(([x, z], i) => {
  const neighbors = [];
  WAYPOINTS.forEach(([tx, tz], j) => {
    const cost = Math.hypot(tx - x, tz - z);
    if (i !== j && cost <= 9.5 && walkClear(x, z, tx, tz)) neighbors.push([j, cost]);
  });
  return neighbors;
});
export function nearestWaypoint(x, z, requireClear = true) {
  let nearest = -1, best = Infinity;
  WAYPOINTS.forEach(([tx, tz], i) => {
    const distance = Math.hypot(x - tx, z - tz);
    if (distance < best && (!requireClear || walkClear(x, z, tx, tz))) {
      nearest = i; best = distance;
    }
  });
  return nearest < 0 ? nearestWaypoint(x, z, false) : nearest;
}
export function findPath(from, to) {
  const costs = WAYPOINTS.map(() => Infinity), previous = WAYPOINTS.map(() => -1);
  const visited = new Set();
  costs[from] = 0;
  while (visited.size < WAYPOINTS.length) {
    let node = -1;
    costs.forEach((cost, i) => {
      if (!visited.has(i) && Number.isFinite(cost) && (node < 0 || cost < costs[node])) node = i;
    });
    if (node < 0) return [];
    if (node === to) break;
    visited.add(node);
    for (const [neighbor, length] of EDGES[node]) {
      if (costs[node] + length < costs[neighbor]) {
        costs[neighbor] = costs[node] + length; previous[neighbor] = node;
      }
    }
  }
  const route = [];
  for (let node = to; node >= 0; node = previous[node]) route.unshift(node);
  return route;
}
export function rayWorld(ox, oy, oz, dx, dy, dz, range = 120) {
  let hit = range;
  for (const box of COLLIDERS) hit = Math.min(hit, rayBox(ox, oy, oz, dx, dy, dz, box));
  if (dy < -1e-8) hit = Math.min(hit, Math.max(0, -oy / dy));
  return hit;
}
export function losClear(ax, ay, az, bx, by, bz) {
  const length = Math.hypot(bx - ax, by - ay, bz - az);
  return length < 1e-7 || rayWorld(ax, ay, az, (bx - ax) / length, (by - ay) / length, (bz - az) / length, length) >= length - 0.001;
}
export function siteAt(x, z) {
  return Object.keys(SITES).find(key => Math.hypot(x - SITES[key].x, z - SITES[key].z) <= SITES[key].r) || null;
}
