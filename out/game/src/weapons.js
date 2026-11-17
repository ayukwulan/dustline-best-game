// Five distinct handling profiles. Angles use radians; times use seconds.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', category: 'SIDEARM', price: 0, auto: false,
    damage: 34, headshot: 3, rpm: 380, mag: 12, reserve: 48, reload: 1.25,
    spread: 0.006, move: 3, air: 5, recoil: 0.012, bloom: 0.007,
    falloff: [8, 42, 0.65], length: 0.38, description: 'Reliable, precise opening-round sidearm.',
  },
  smg: {
    id: 'smg', name: 'Vex-9', category: 'SMG', price: 1500, auto: true,
    damage: 26, headshot: 3, rpm: 750, mag: 30, reserve: 90, reload: 1.9,
    spread: 0.011, move: 2.1, air: 4, recoil: 0.008, bloom: 0.006,
    falloff: [10, 36, 0.54], length: 0.62, description: 'Fast handling for close lane fights.',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Dusk', category: 'RIFLE', price: 2700, auto: true,
    damage: 33, headshot: 3.2, rpm: 600, mag: 30, reserve: 90, reload: 2.35,
    spread: 0.004, move: 3.2, air: 5, recoil: 0.016, bloom: 0.009,
    falloff: [12, 56, 0.73], length: 0.88, description: 'Accurate first shot. Control your bursts.',
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher 12', category: 'SHOTGUN', price: 1200, auto: false,
    damage: 13, headshot: 2.2, rpm: 72, mag: 6, reserve: 24, reload: 2.8, pellets: 8,
    spread: 0.044, move: 1.8, air: 3, recoil: 0.038, bloom: 0.013,
    falloff: [5, 23, 0.27], length: 1, description: 'Eight pellets. Own the warehouse doors.',
  },
  sniper: {
    id: 'sniper', name: 'Longbow .50', category: 'SNIPER', price: 4750, auto: false,
    damage: 110, headshot: 2.5, rpm: 42, mag: 5, reserve: 20, reload: 3.3,
    spread: 0.002, move: 8, air: 10, recoil: 0.055, bloom: 0.035, adsFov: 32,
    falloff: [20, 120, 0.9], length: 1.25, description: 'Heavy stopping power. Aim down sights.',
  },
};
export const GRENADES = {
  he: { name: 'Spark HE', price: 300, description: '6 m blast radius · up to 90 damage' },
  smoke: { name: 'Haze Smoke', price: 300, description: 'Obscures a lane for 14 seconds' },
};
export const ARMOR = { price: 650, absorb: 0.5 };
export const ECON = { start: 800, kill: 300, win: 3250, loss: [1900, 2400, 2900, 3400], plant: 300, cap: 16000 };
export function damageAtRange(weapon, distance) {
  const [near, far, minimum] = weapon.falloff;
  const fraction = Math.max(0, Math.min(1, (distance - near) / (far - near)));
  return weapon.damage * (1 - fraction * (1 - minimum));
}
export const loadWeapon = id => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });
export const weaponOf = agent => WEAPONS[agent.inventory[agent.slot]?.id || 'pistol'];
export const ammoOf = agent => agent.inventory[agent.slot] || agent.inventory[2];
