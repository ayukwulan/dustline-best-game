import { clamp, eyeY, rayCapsule } from './util.js';
import { rayWorld, losClear, siteAt } from './world.js';
import { weaponOf, ammoOf, damageAtRange, ECON, ARMOR } from './weapons.js';

export function losWithSmoke(S, ax, ay, az, bx, by, bz) {
  if (!losClear(ax, ay, az, bx, by, bz)) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  for (const cloud of S.grenades) {
    if (cloud.kind !== 'smoke' || cloud.phase !== 'burst') continue;
    const t = clamp(((cloud.x - ax) * dx + (cloud.y + 1 - ay) * dy + (cloud.z - az) * dz) / (lengthSquared || 1), 0, 1);
    if (Math.hypot(ax + t * dx - cloud.x, ay + t * dy - cloud.y - 1, az + t * dz - cloud.z) < cloud.radius) return false;
  }
  return true;
}

export function fireHitscan(S, shooter, dx, dy, dz) {
  const weapon = weaponOf(shooter), y = eyeY(shooter);
  let distance = rayWorld(shooter.x, y, shooter.z, dx, dy, dz);
  let victim = null, part = null;
  for (const agent of S.agents) {
    if (!agent.alive || agent.team === shooter.team) continue;
    const intersection = rayCapsule(shooter.x, y, shooter.z, dx, dy, dz, agent);
    if (intersection && intersection.t < distance) {
      distance = intersection.t; victim = agent; part = intersection.part;
    }
  }
  const end = { x: shooter.x + dx * distance, y: y + dy * distance, z: shooter.z + dz * distance };
  S.events.push({ type: 'tracer', start: { x: shooter.x, y, z: shooter.z }, end, player: shooter.isPlayer });
  if (distance < 119) S.events.push({ type: 'impact', ...end, blood: !!victim });
  if (victim) {
    if (shooter.isPlayer) S.stats.hits++;
    applyDamage(S, victim, damageAtRange(weapon, distance) * (part === 'head' ? weapon.headshot : 1), shooter, part);
  }
  return victim;
}

// A normalized aim direction gets the same cone, movement penalty and recoil
// for every agent. Bots provide aim error before arriving here.
export function shoot(S, agent, dx, dy, dz) {
  const ammo = ammoOf(agent), weapon = weaponOf(agent);
  if (S.phase !== 'live' || !agent.alive || agent.reloading || S.time < agent.nextShot) return false;
  if (!ammo.mag) {
    agent.nextShot = S.time + 0.2;
    if (agent.isPlayer) S.events.push({ type: 'dry' });
    reload(S, agent);
    return false;
  }
  ammo.mag--;
  agent.nextShot = S.time + 60 / weapon.rpm;
  agent.lastShot = S.time;
  const moving = Math.hypot(agent.vx, agent.vz) > 1.2;
  let cone = weapon.spread * (agent.ads ? 0.42 : 1) * (moving ? weapon.move : 1) * (agent.y > 0.04 ? weapon.air : 1);
  if (agent.crouched) cone *= 0.8;
  cone += agent.bloom;
  // Local right and up perpendicular to the ray, including vertical aim.
  const horizontal = Math.hypot(dx, dz) || 1;
  const rx = -dz / horizontal, rz = dx / horizontal;
  const ux = -dy * rz, uy = dz * rx - dx * rz, uz = dy * rx;
  for (let pellet = 0; pellet < (weapon.pellets || 1); pellet++) {
    const angle = S.rng() * Math.PI * 2, radius = Math.sqrt(S.rng()) * cone;
    const side = Math.cos(angle) * radius, vertical = Math.sin(angle) * radius;
    const x = dx + rx * side + ux * vertical, y = dy + uy * vertical, z = dz + rz * side + uz * vertical;
    const length = Math.hypot(x, y, z);
    if (agent.isPlayer) S.stats.shots++;
    fireHitscan(S, agent, x / length, y / length, z / length);
  }
  agent.bloom = Math.min(0.045, agent.bloom + weapon.bloom);
  agent.recoil = Math.min(0.14, agent.recoil + weapon.recoil);
  S.events.push({ type: 'shot', agent, weapon: weapon.id });
  return true;
}

export function reload(S, agent) {
  const ammo = ammoOf(agent), weapon = weaponOf(agent);
  if (agent.reloading || !ammo.reserve || ammo.mag === weapon.mag || !agent.alive) return;
  agent.reloading = weapon.reload;
  agent.reloadDuration = weapon.reload;
  if (agent.isPlayer) S.events.push({ type: 'reload' });
}
export function updateWeapon(agent, dt) {
  agent.bloom = Math.max(0, agent.bloom - dt * 0.045);
  agent.recoil *= Math.exp(-dt * 9);
  if (agent.reloading > 0) {
    agent.reloading = Math.max(0, agent.reloading - dt);
    if (agent.reloading === 0) {
      const ammo = ammoOf(agent);
      const amount = Math.min(weaponOf(agent).mag - ammo.mag, ammo.reserve);
      ammo.mag += amount; ammo.reserve -= amount;
    }
  }
}
export function dropCharge(S, agent) {
  if (!agent.hasBomb) return;
  agent.hasBomb = false;
  Object.assign(S.bomb, { state: 'dropped', carrier: null, x: agent.x, z: agent.z, droppedBy: agent.id, pickupAfter: S.time + 2 });
}
export function applyDamage(S, target, damage, attacker = null, part = 'body') {
  if (!target.alive || S.phase !== 'live') return;
  const absorbed = Math.min(target.armor, damage * ARMOR.absorb);
  target.armor -= absorbed;
  const loss = Math.min(target.hp, damage - absorbed);
  target.hp = Math.max(0, target.hp - loss);
  target.lastHurt = S.time;
  target.lastAttacker = attacker;
  target.interact = 0;
  if (attacker?.isPlayer && attacker !== target) {
    S.stats.damage += loss;
    S.events.push({ type: 'hit', kill: target.hp === 0, head: part === 'head' });
  }
  if (target.isPlayer) S.events.push({ type: 'hurt' });
  if (target.hp > 0) return;
  target.alive = false;
  target.diedAt = S.time;
  target.deaths++;
  dropCharge(S, target);
  if (attacker && attacker.team !== target.team) {
    attacker.kills++;
    attacker.money = Math.min(ECON.cap, attacker.money + ECON.kill);
  }
  S.feed.unshift({ time: S.time, killer: attacker?.name || 'Yard', team: attacker?.team || '', victim: target.name, victimTeam: target.team, head: part === 'head' });
  S.feed.length = Math.min(S.feed.length, 5);
  S.events.push({ type: 'death', agent: target });
  checkRoundEnd(S);
}

export function endRound(S, winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'roundEnd';
  S.endAt = S.time;
  S.winner = winner;
  S.reason = reason;
  S.score[winner]++;
  const loser = winner === 'sable' ? 'harbor' : 'sable';
  S.lossStreak[winner] = 0;
  S.lossStreak[loser]++;
  for (const agent of S.agents) {
    const reward = agent.team === winner ? ECON.win : ECON.loss[Math.min(3, S.lossStreak[loser] - 1)];
    agent.money = Math.min(ECON.cap, agent.money + reward);
    agent.interact = 0;
  }
  S.matchOver = S.score[winner] >= 8 || S.round >= 15;
  S.events.push({ type: 'round', winner, reason });
}
export function checkRoundEnd(S) {
  if (S.phase !== 'live') return;
  const sable = S.agents.some(a => a.alive && a.team === 'sable');
  const harbor = S.agents.some(a => a.alive && a.team === 'harbor');
  if (!harbor) endRound(S, 'sable', 'All HARBOR defenders eliminated');
  else if (!sable && S.bomb.state !== 'planted') endRound(S, 'harbor', 'SABLE squad eliminated');
}

export function interactCharge(S, agent, held, dt) {
  const bomb = S.bomb;
  if (agent.team === 'sable' && bomb.state === 'dropped' && (agent.id !== bomb.droppedBy || S.time >= bomb.pickupAfter) && Math.hypot(agent.x - bomb.x, agent.z - bomb.z) < 1.05) {
    bomb.state = 'carried'; bomb.carrier = agent; agent.hasBomb = true;
    S.events.push({ type: 'pickup', agent });
  }
  const site = siteAt(agent.x, agent.z);
  const planting = agent.hasBomb && bomb.state === 'carried' && site;
  const defusing = agent.team === 'harbor' && bomb.state === 'planted' && Math.hypot(agent.x - bomb.x, agent.z - bomb.z) < 1.45;
  if (!held || (!planting && !defusing) || agent.y > 0.04 || Math.hypot(agent.vx, agent.vz) > 0.35 || S.time - agent.lastHurt < 0.2) {
    agent.interact = 0; return;
  }
  agent.interact += dt;
  agent.interactKind = planting ? 'plant' : 'defuse';
  if (planting && agent.interact >= 3) {
    agent.hasBomb = false; agent.interact = 0;
    Object.assign(bomb, { state: 'planted', x: agent.x, z: agent.z, site, timer: 35, carrier: null, beepAt: 0 });
    agent.money = Math.min(ECON.cap, agent.money + ECON.plant);
    S.events.push({ type: 'plant', site });
  } else if (defusing && agent.interact >= 5) {
    bomb.state = 'defused';
    endRound(S, 'harbor', 'Charge defused — yard secured');
  }
}

export function throwGrenade(S, agent, kind) {
  if (!agent.grenades[kind] || S.phase !== 'live' || !agent.alive) return false;
  agent.grenades[kind]--;
  const pitch = agent.isPlayer ? agent.pitch + 0.18 : 0.22;
  const fx = -Math.sin(agent.yaw), fz = -Math.cos(agent.yaw);
  S.grenades.push({
    id: S.nextGrenade++, kind, phase: 'fly', age: 0, bounced: false, owner: agent,
    x: agent.x + fx * 0.45, y: eyeY(agent) - 0.1, z: agent.z + fz * 0.45,
    vx: fx * Math.cos(pitch) * 13, vy: Math.sin(pitch) * 13 + 2.6, vz: fz * Math.cos(pitch) * 13,
    radius: kind === 'he' ? 6 : 4.3,
  });
  S.events.push({ type: 'throw', agent });
  return true;
}
export function updateGrenades(S, dt) {
  for (const grenade of S.grenades) {
    grenade.age += dt;
    if (grenade.phase === 'fly') {
      grenade.vy -= 13 * dt;
      const length = Math.hypot(grenade.vx, grenade.vy, grenade.vz) * dt;
      const velocity = Math.hypot(grenade.vx, grenade.vy, grenade.vz) || 1;
      const hit = rayWorld(grenade.x, grenade.y, grenade.z, grenade.vx / velocity, grenade.vy / velocity, grenade.vz / velocity, length);
      if (hit < length || grenade.y + grenade.vy * dt < 0.15) {
        grenade.y = Math.max(0.15, grenade.y);
        if (!grenade.bounced) {
          if (grenade.y < 0.3) { grenade.y = 0.16; grenade.vy = Math.abs(grenade.vy) * 0.38; }
          else { grenade.vx *= -0.45; grenade.vz *= -0.45; grenade.vy = Math.abs(grenade.vy) * 0.3; }
          grenade.vx *= 0.65; grenade.vz *= 0.65;
          grenade.bounced = true;
          S.events.push({ type: 'bounce', x: grenade.x, z: grenade.z });
        } else { grenade.vx = 0; grenade.vy = 0; grenade.vz = 0; }
      } else {
        grenade.x += grenade.vx * dt; grenade.y += grenade.vy * dt; grenade.z += grenade.vz * dt;
      }
      if (grenade.age >= 1.8) {
        grenade.phase = 'burst'; grenade.age = 0;
        if (grenade.kind === 'he') {
          S.events.push({ type: 'explosion', x: grenade.x, y: grenade.y, z: grenade.z });
          for (const agent of S.agents) {
            const distance = Math.hypot(agent.x - grenade.x, agent.z - grenade.z);
            if (distance < 6 && losClear(grenade.x, grenade.y + 0.3, grenade.z, agent.x, eyeY(agent) - 0.3, agent.z)) {
              applyDamage(S, agent, 90 * (1 - distance / 6), grenade.owner);
            }
          }
        }
      }
    }
  }
  S.grenades = S.grenades.filter(g => g.phase === 'fly' || g.age < (g.kind === 'smoke' ? 14 : 0.8));
}
export function updateRoundClock(S, dt) {
  if (S.phase !== 'live') return;
  if (S.bomb.state === 'planted') {
    S.bomb.timer = Math.max(0, S.bomb.timer - dt);
    if (S.time >= S.bomb.beepAt) {
      S.bomb.beepAt = S.time + Math.max(0.15, S.bomb.timer / 35);
      S.events.push({ type: 'beep' });
    }
    if (S.bomb.timer === 0) {
      S.events.push({ type: 'explosion', x: S.bomb.x, y: 0.3, z: S.bomb.z });
      S.bomb.state = 'detonated';
      // Award detonation before the blast removes the last attacker.
      endRound(S, 'sable', `Site ${S.bomb.site} charge detonated`);
      for (const agent of S.agents) {
        if (agent.alive && Math.hypot(agent.x - S.bomb.x, agent.z - S.bomb.z) < 11) {
          agent.hp = 0; agent.alive = false; agent.deaths++; agent.diedAt = S.time;
        }
      }
    }
  } else {
    S.roundT = Math.max(0, S.roundT - dt);
    if (!S.roundT) endRound(S, 'harbor', 'Time expired — both sites held');
  }
}
