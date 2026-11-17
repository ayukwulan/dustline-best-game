import { clamp, turnToward, angleDiff, yawTo, eyeY, collideCircleBox } from './util.js';
import { COLLIDERS, WAYPOINTS, SITES, nearestWaypoint, findPath, walkClear } from './world.js';
import { loadWeapon, weaponOf, ammoOf, ECON, ARMOR } from './weapons.js';
import { losWithSmoke, shoot, reload, interactCharge, throwGrenade } from './combat.js';

export function makeAgent(id, team, name, spawn, rng, isPlayer = false) {
  return {
    id, team, name, isPlayer, ...spawn, y: 0, vy: 0, vx: 0, vz: 0, pitch: 0,
    alive: true, hp: 100, armor: 0, money: ECON.start, kills: 0, deaths: 0,
    inventory: { 2: loadWeapon('pistol') }, slot: 2, grenades: { he: 0, smoke: 0 },
    hasBomb: false, interact: 0, reloading: 0, reloadDuration: 1, recoil: 0, bloom: 0,
    ads: false, crouched: false, walk: 0, nextShot: -1, lastShot: -10, lastHurt: -10,
    skill: 0.64 + rng() * 0.25, reaction: 0, scanAt: 0, target: null, seenAt: -10,
    memory: null, path: [], goal: -1, pathIndex: 0, recalcAt: 0, patrol: 0,
    burst: 0, pauseUntil: 0, strafe: rng() < 0.5 ? -1 : 1, strafeAt: 0,
    state: 'advance', role: 'support', assignedSite: 'A', anchor: 12, stepAt: 0,
  };
}
export function collideAgent(agent) {
  const result = {};
  for (let pass = 0; pass < 2; pass++) {
    for (const box of COLLIDERS) {
      if (agent.y >= box.y2) continue;
      if (collideCircleBox(agent.x, agent.z, 0.34, box, result)) {
        agent.x = result.x; agent.z = result.z;
      }
    }
  }
  agent.x = clamp(agent.x, -30.65, 30.65);
  agent.z = clamp(agent.z, -20.65, 20.65);
}

export function buyForBot(S, agent) {
  // Surviving rifles are worth saving; fresh equipment only spends once.
  if (!agent.inventory[1]) {
    let id = null;
    if (agent.money >= 5400 && agent.id % 5 === 0) id = 'sniper';
    else if (agent.money >= 3350) id = 'rifle';
    else if (agent.money >= 2150) id = 'smg';
    else if (agent.money >= 1850) id = 'shotgun';
    if (id) {
      const prices = { rifle: 2700, smg: 1500, shotgun: 1200, sniper: 4750 };
      agent.money -= prices[id]; agent.inventory[1] = loadWeapon(id); agent.slot = 1;
    }
  }
  if (agent.armor < 55 && agent.money >= ARMOR.price) { agent.armor = 100; agent.money -= ARMOR.price; }
  for (const kind of ['he', 'smoke']) {
    if (!agent.grenades[kind] && agent.money >= 300 && S.rng() < (kind === 'he' ? 0.65 : 0.4)) {
      agent.grenades[kind] = 1; agent.money -= 300;
    }
  }
}
export function assignRoles(S) {
  S.attackSite = S.rng() < 0.5 ? 'A' : 'B';
  const allies = S.agents.filter(a => !a.isPlayer && a.team === 'sable');
  allies.forEach((agent, i) => {
    agent.assignedSite = i === 3 ? (S.attackSite === 'A' ? 'B' : 'A') : S.attackSite;
    agent.role = i === 3 ? 'flanker' : 'support';
    buyForBot(S, agent);
  });
  S.agents.filter(a => a.team === 'harbor').forEach((agent, i) => {
    agent.role = i === 4 ? 'roamer' : 'holder';
    agent.assignedSite = i < 2 ? 'A' : 'B';
    agent.anchor = [12, 15, 23, 24, 35][i];
    buyForBot(S, agent);
  });
}

function navigate(S, bot, x, z, dt, speed = 3.65) {
  const distance = Math.hypot(x - bot.x, z - bot.z);
  if (distance < 0.55) return true;
  let tx = x, tz = z;
  if (!walkClear(bot.x, bot.z, x, z)) {
    const goal = nearestWaypoint(x, z);
    if (bot.goal !== goal || S.time >= bot.recalcAt || bot.pathIndex >= bot.path.length) {
      bot.goal = goal;
      bot.path = findPath(nearestWaypoint(bot.x, bot.z), goal);
      bot.pathIndex = 0;
      bot.recalcAt = S.time + 2.5;
    }
    while (bot.pathIndex < bot.path.length) {
      const point = WAYPOINTS[bot.path[bot.pathIndex]];
      if (Math.hypot(point[0] - bot.x, point[1] - bot.z) >= 0.6) break;
      bot.pathIndex++;
    }
    if (bot.pathIndex >= bot.path.length) return false;
    [tx, tz] = WAYPOINTS[bot.path[bot.pathIndex]];
    // Smooth a route only when the entire body fits the shortcut.
    if (bot.pathIndex + 1 < bot.path.length) {
      const next = WAYPOINTS[bot.path[bot.pathIndex + 1]];
      if (walkClear(bot.x, bot.z, ...next)) { bot.pathIndex++; [tx, tz] = next; }
    }
  }
  const length = Math.hypot(tx - bot.x, tz - bot.z) || 1;
  bot.vx = (tx - bot.x) / length * Math.min(speed, length / dt);
  bot.vz = (tz - bot.z) / length * Math.min(speed, length / dt);
  bot.yaw = turnToward(bot.yaw, yawTo(bot.x, bot.z, tx, tz), dt * 5.5);
  return false;
}
function scan(S, bot) {
  let found = null, best = bot.hasBomb ? 17 : 29;
  for (const enemy of S.agents) {
    if (enemy.team === bot.team || !enemy.alive) continue;
    const distance = Math.hypot(enemy.x - bot.x, enemy.z - bot.z);
    if (distance >= best) continue;
    const angle = Math.abs(angleDiff(bot.yaw, yawTo(bot.x, bot.z, enemy.x, enemy.z)));
    if (distance > 7 && angle > Math.PI / 3) continue;
    if (!losWithSmoke(S, bot.x, eyeY(bot), bot.z, enemy.x, eyeY(enemy) - 0.12, enemy.z)) continue;
    found = enemy; best = distance;
  }
  if (found) {
    if (bot.target !== found) {
      bot.reaction = S.time + 0.28 + (1 - bot.skill) * 0.65 + S.rng() * 0.2;
      bot.burst = 0;
    }
    bot.target = found; bot.seenAt = S.time; bot.memory = { x: found.x, z: found.z };
  } else if (S.time - bot.seenAt > 0.3) bot.target = null;
  // Turn toward the source of a hit, but still require sight to shoot it.
  if (!found && bot.lastAttacker?.alive && S.time - bot.lastHurt < 0.7) {
    bot.yaw = yawTo(bot.x, bot.z, bot.lastAttacker.x, bot.lastAttacker.z);
  }
}
function engage(S, bot, enemy, dt) {
  const dx = enemy.x - bot.x, dz = enemy.z - bot.z;
  const distance = Math.hypot(dx, dz) || 1;
  bot.yaw = turnToward(bot.yaw, yawTo(bot.x, bot.z, enemy.x, enemy.z), dt * 7);
  bot.state = bot.hp < 32 ? 'retreat' : 'engage';
  if (S.time >= bot.strafeAt) {
    bot.strafe *= -1; bot.strafeAt = S.time + 0.8 + S.rng();
  }
  const recovering = bot.reloading || bot.hp < 32;
  const stance = S.time < bot.pauseUntil || recovering ? 1.25 : 0.25;
  bot.vx = -dz / distance * bot.strafe * stance;
  bot.vz = dx / distance * bot.strafe * stance;
  const preferred = weaponOf(bot).id === 'shotgun' ? 6 : weaponOf(bot).id === 'sniper' ? 24 : 14;
  const advance = recovering ? -1.7 : distance > preferred ? 1.65 : 0;
  if (advance) {
    const tx = bot.x + dx / distance * advance, tz = bot.z + dz / distance * advance;
    if (walkClear(bot.x, bot.z, tx, tz)) { bot.vx += dx / distance * advance; bot.vz += dz / distance * advance; }
  }
  if (S.time < bot.reaction || bot.reloading) return;
  if (!ammoOf(bot).mag) { reload(S, bot); return; }
  if (S.time < bot.pauseUntil) return;
  if (!bot.burst) bot.burst = weaponOf(bot).auto ? 2 + Math.floor(S.rng() * 3) : 1;
  if (S.time >= bot.nextShot && Math.abs(angleDiff(bot.yaw, yawTo(bot.x, bot.z, enemy.x, enemy.z))) < 0.16 &&
      losWithSmoke(S, bot.x, eyeY(bot), bot.z, enemy.x, eyeY(enemy) - 0.15, enemy.z)) {
    const head = S.rng() < 0.13;
    const aimY = enemy.y + (enemy.crouched ? 0.88 : head ? 1.65 : 1.18);
    const error = (0.004 + (1 - bot.skill) * 0.027 + Math.hypot(enemy.vx, enemy.vz) * 0.0015) * distance;
    const ax = dx + (S.rng() - 0.5) * error * 2;
    const ay = aimY - eyeY(bot) + (S.rng() - 0.5) * error * 2;
    const az = dz + (S.rng() - 0.5) * error * 2;
    const length = Math.hypot(ax, ay, az);
    bot.ads = distance > 18;
    if (shoot(S, bot, ax / length, ay / length, az / length)) bot.burst--;
    if (!bot.burst) bot.pauseUntil = S.time + 0.35 + S.rng() * 0.45;
    if (distance > 10 && distance < 22 && S.rng() < 0.028) throwGrenade(S, bot, 'he');
  }
}

export function updateBot(S, bot, dt) {
  if (!bot.alive || S.phase !== 'live') return;
  bot.vx = 0; bot.vz = 0; bot.ads = false; bot.crouched = false;
  if (S.time >= bot.scanAt) { scan(S, bot); bot.scanAt = S.time + 0.12; }
  let interacting = false;
  const bomb = S.bomb;
  const visibleEnemy = bot.target?.alive && S.time - bot.seenAt < 0.24;
  // Defenders race the fuse. One defuses; others cover, using physical bomb position.
  const mustDefuse = bot.team === 'harbor' && bomb.state === 'planted' && bomb.timer < 8;
  if (visibleEnemy && !mustDefuse) {
    bot.interact = 0;
    engage(S, bot, bot.target, dt);
  } else if (bot.team === 'sable') {
    if (bomb.state === 'dropped') {
      bot.state = 'retrieve';
      navigate(S, bot, bomb.x, bomb.z, dt, 4.2);
    } else if (bomb.state === 'planted') {
      bot.state = 'cover';
      const site = SITES[bomb.site];
      const cover = WAYPOINTS[bot.id % 2 ? site.node : (bomb.site === 'A' ? 15 : 26)];
      if (navigate(S, bot, ...cover, dt, 3.6)) bot.yaw = turnToward(bot.yaw, Math.sin(S.time * 0.35 + bot.id) * 0.8, dt);
    } else if (bot.hasBomb) {
      bot.role = 'carrier'; bot.state = 'advance';
      const site = SITES[S.attackSite];
      if (navigate(S, bot, site.x, site.z, dt, 4)) {
        bot.state = 'plant'; interacting = true;
      } else if (bot.grenades.smoke && Math.hypot(bot.x - site.x, bot.z - site.z) < 12 && S.rng() < dt * 0.25) throwGrenade(S, bot, 'smoke');
    } else {
      const site = SITES[bot.assignedSite];
      const point = WAYPOINTS[bot.role === 'flanker' ? (bot.assignedSite === 'A' ? 15 : 26) : site.node];
      bot.state = 'support';
      if (navigate(S, bot, ...point, dt)) {
        // Watch the north approaches, periodically checking the other doorway.
        bot.yaw = turnToward(bot.yaw, Math.sin(S.time * 0.5 + bot.id) * 1.1, dt * 1.8);
        bot.crouched = bot.id % 2 === 0;
      }
    }
  } else if (bomb.state === 'planted') {
    bot.state = 'rotate';
    const defenders = S.agents.filter(a => a.alive && a.team === 'harbor');
    const defuser = defenders.reduce((best, a) => Math.hypot(a.x - bomb.x, a.z - bomb.z) < Math.hypot(best.x - bomb.x, best.z - bomb.z) ? a : best, bot);
    if (defuser === bot) {
      if (navigate(S, bot, bomb.x, bomb.z, dt, 4.4)) { bot.state = 'defuse'; interacting = true; }
    } else {
      const cover = WAYPOINTS[SITES[bomb.site].node];
      navigate(S, bot, cover[0] + (bot.id % 2 ? 1.6 : -1.6), cover[1] + 1.8, dt, 4.1);
      bot.yaw = turnToward(bot.yaw, Math.PI, dt * 2);
    }
  } else if (bot.memory && S.time - bot.seenAt < 3) {
    bot.state = 'investigate'; navigate(S, bot, bot.memory.x, bot.memory.z, dt);
  } else {
    const patrol = [35, 33, 37, 34];
    const point = WAYPOINTS[bot.role === 'roamer' ? patrol[Math.floor(S.time / 8) % patrol.length] : bot.anchor];
    bot.state = bot.role === 'roamer' ? 'patrol' : 'hold';
    if (navigate(S, bot, ...point, dt, 3.7)) {
      bot.yaw = turnToward(bot.yaw, Math.PI + Math.sin(S.time * 0.55 + bot.id) * 0.95, dt * 1.8);
      bot.crouched = bot.id % 2 === 0;
    }
  }
  if (!visibleEnemy && ammoOf(bot).mag < weaponOf(bot).mag * 0.4) reload(S, bot);
  bot.x += bot.vx * dt; bot.z += bot.vz * dt;
  collideAgent(bot);
  bot.walk += Math.hypot(bot.vx, bot.vz) * dt * 2.3;
  interactCharge(S, bot, interacting, dt);
}
