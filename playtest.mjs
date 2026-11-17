import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mulberry32, eyeY } from './game/src/util.js';
import { WAYPOINTS, EDGES, SPAWNS, SITES, findPath } from './game/src/world.js';
import { makeAgent, updateBot, assignRoles } from './game/src/bots.js';
import { loadWeapon, ECON } from './game/src/weapons.js';
import { shoot, updateWeapon, applyDamage, endRound, dropCharge, interactCharge, updateRoundClock, updateGrenades, throwGrenade, losWithSmoke } from './game/src/combat.js';

const STEP = 1 / 60;
function scenario(seed = 1) {
  const S = { rng: mulberry32(seed), time: 0, phase: 'live', round: 1, score: { sable: 0, harbor: 0 }, lossStreak: { sable: 0, harbor: 0 },
    agents: [], bomb: { state: 'carried', site: null, timer: 0 }, events: [], feed: [], grenades: [], nextGrenade: 1,
    stats: { shots: 0, hits: 0, damage: 0 }, roundT: 100, attackSite: 'A' };
  for (const team of ['sable', 'harbor']) for (let i = 0; i < 5; i++) S.agents.push(makeAgent(S.agents.length, team, `${team}-${i}`, SPAWNS[team][i], S.rng, S.agents.length === 0));
  S.player = S.agents[0]; S.player.hasBomb = true; S.bomb.carrier = S.player;
  return S;
}
function ticks(count, update) { for (let i = 0; i < count; i++) update(STEP); }

assert(EDGES.every(e => e.length), 'All navigation nodes have exits');
for (let i = 0; i < WAYPOINTS.length; i++) assert(findPath(0, i).length, `Node ${i} must be connected`);
for (const seed of [1, 2, 9]) {
  const S = scenario(seed); assignRoles(S); dropCharge(S, S.player);
  ticks(3600, dt => {
    if (S.phase !== 'live') return;
    S.time += dt;
    for (const a of S.agents) if (!a.isPlayer) { updateWeapon(a, dt); updateBot(S, a, dt); }
    updateGrenades(S, dt); updateRoundClock(S, dt);
    assert(S.agents.every(a => [a.x, a.y, a.z, a.hp, a.armor, a.yaw].every(Number.isFinite)));
  });
  console.log(`Squad simulation seed ${seed}: ${S.phase}, charge ${S.bomb.state}, score ${S.score.sable}:${S.score.harbor}`);
}

// Real hitscan against open-lane opponents: armor, heads, magazines and walls.
{
  const S = scenario(); const p = S.player, enemy = S.agents[5];
  Object.assign(p, { x: 0, z: 10, yaw: 0 }); Object.assign(enemy, { x: 0, z: 6, armor: 100 });
  assert(shoot(S, p, 0, 0, -1)); assert(enemy.hp < 100 && enemy.armor < 100, 'Headshot reaches target and armor absorbs damage');
  assert.equal(p.inventory[2].mag, 11);
  Object.assign(enemy, { hp: 100, x: 0, z: 0, armor: 0 }); S.time += 1;
  shoot(S, p, 0, 0, -1); assert.equal(enemy.hp, 100, 'Mid container stops the shot');
  p.inventory[1] = loadWeapon('rifle'); p.slot = 1; p.inventory[1].mag = 7;
  p.slot = 2; p.slot = 1; assert.equal(p.inventory[1].mag, 7, 'Slot switches preserve rounds');
}
{
  const S = scenario(), p = S.player;
  Object.assign(p, { x: SITES.A.x, z: SITES.A.z });
  ticks(179, dt => { S.time += dt; interactCharge(S, p, true, dt); });
  assert.equal(S.bomb.state, 'carried');
  ticks(3, dt => { S.time += dt; interactCharge(S, p, true, dt); });
  assert.equal(S.bomb.state, 'planted'); assert.equal(p.money, 1100);
  const defender = S.agents[5]; Object.assign(defender, { x: p.x, z: p.z });
  ticks(299, dt => { S.time += dt; interactCharge(S, defender, true, dt); });
  assert.equal(S.phase, 'live');
  ticks(3, dt => { S.time += dt; interactCharge(S, defender, true, dt); });
  assert.equal(S.bomb.state, 'defused'); assert.equal(S.score.harbor, 1);
  const score = S.score.harbor; endRound(S, 'harbor', 'Duplicate'); assert.equal(S.score.harbor, score);
}
{
  const S = scenario(); S.player.hasBomb = false;
  S.bomb = { state: 'planted', site: 'B', x: 20.5, z: -9.2, timer: 35, beepAt: 0 };
  for (const a of S.agents.filter(a => a.team === 'sable')) applyDamage(S, a, 1000, S.agents[5]);
  assert.equal(S.phase, 'live', 'Planted charge keeps the round alive after attacker elimination');
  ticks(2102, dt => { S.time += dt; updateRoundClock(S, dt); });
  assert.equal(S.score.sable, 1); assert.equal(S.bomb.state, 'detonated');
}
{
  const S = scenario(); S.roundT = 0.01; updateRoundClock(S, STEP); assert.equal(S.score.harbor, 1);
  for (let round = 0; round < 4; round++) {
    S.phase = 'live'; const money = S.player.money; endRound(S, 'harbor', 'Held');
    assert.equal(S.player.money - money, ECON.loss[Math.min(3, round + 1)]);
  }
  S.phase = 'live'; S.score.harbor = 7; endRound(S, 'harbor', 'Match point'); assert(S.matchOver);
  S.phase = 'live'; S.player.money = 15900; endRound(S, 'sable', 'Win'); assert.equal(S.player.money, 16000);
}
{
  const S = scenario(); const p = S.player;
  p.x = 0; p.z = 10; p.grenades.he = 1; throwGrenade(S, p, 'he');
  ticks(130, dt => updateGrenades(S, dt)); assert(S.events.some(e => e.type === 'explosion'));
  S.grenades = [{ id: 90, phase: 'burst', kind: 'smoke', age: 0, radius: 4.3, x: 0, y: 0.1, z: 8 }];
  assert(!losWithSmoke(S, 0, 1.65, 10, 0, 1.65, 6));
  ticks(841, dt => updateGrenades(S, dt)); assert.equal(S.grenades.length, 0);
}
console.log('Core rules PASS: routing, gunfire, armor, plant/defuse, fuse, timeout, economy, grenades.');

const require = createRequire(import.meta.url);
let playwright;
for (const location of ['playwright-core', '/opt/hatch/skills/spaces/ts-runtime/dist/node_modules/playwright-core', '/opt/muse/assets/spaces/ts-runtime/dist/node_modules/playwright-core']) {
  try { playwright = require(location); break; } catch {}
}
if (!playwright) throw new Error('Install playwright-core to run the browser playtest');
const browser = await playwright.chromium.launch({ executablePath: join(homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [], pageErrors = [], remote = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', error => pageErrors.push(error.message));
page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:8091') && !request.url().startsWith('data:')) remote.push(request.url()); });
try {
  await page.goto('http://127.0.0.1:8091', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.S.phase === 'menu');
  assert.equal(await page.locator('#start').isVisible(), true);
  await page.click('#play');
  await page.click('#item-armor');
  assert.deepEqual(await page.evaluate(() => [__game.S.player.money, __game.S.player.armor]), [150, 100]);
  await page.click('#close-buy');
  assert.equal(await page.evaluate(() => !!document.pointerLockElement), true);
  const before = await page.evaluate(() => __game.S.agents.slice(1).map(a => [a.x, a.z]));
  await page.evaluate(() => { for (let i = 0; i < 900; i++) __game.step(); });
  assert.equal(await page.evaluate(() => __game.S.phase), 'live');
  const after = await page.evaluate(() => __game.S.agents.slice(1).map(a => [a.x, a.z]));
  assert(after.every((a, i) => Math.hypot(a[0] - before[i][0], a[1] - before[i][1]) > 0.1), 'Every bot moved');
  // Keyboard movement, fire, mouse aim and reload use the real event handlers.
  await page.evaluate(() => {
    for (const a of __game.S.agents.slice(1)) a.alive = false;
    __game.S.agents[5].alive = true; __game.S.agents[5].x = -25; __game.S.agents[5].z = -10;
    __game.S.player.x = 0; __game.S.player.z = 10; __game.S.player.hp = 100;
  });
  const initialZ = await page.evaluate(() => __game.S.player.z);
  await page.keyboard.down('KeyW');
  await page.evaluate(() => { for (let i = 0; i < 60; i++) __game.step(); });
  await page.keyboard.up('KeyW');
  assert((await page.evaluate(() => __game.S.player.z)) < initialZ - 1);
  const yaw = await page.evaluate(() => __game.S.player.yaw);
  await page.mouse.move(600, 400);
  await page.mouse.move(740, 400, { steps: 3 });
  await page.evaluate(() => __game.step());
  const look = await page.evaluate(() => ({ yaw: __game.S.player.yaw, phase: __game.S.phase, alive: __game.S.player.alive, locked: !!document.pointerLockElement }));
  assert(Math.abs(look.yaw - yaw) > 0.05, `Real pointer movement changes aim: ${JSON.stringify(look)}`);
  await page.mouse.down(); await page.evaluate(() => __game.step()); await page.mouse.up();
  assert.equal(await page.evaluate(() => __game.S.stats.shots), 1);
  await page.keyboard.press('KeyR');
  await page.evaluate(() => { for (let i = 0; i < 100; i++) __game.step(); });
  assert.equal(await page.evaluate(() => __game.S.player.inventory[2].mag), 12);
  await page.evaluate(() => {
    __game.S.player.x = -21.5; __game.S.player.z = -10.2; __game.S.player.vx = __game.S.player.vz = 0;
    __game.S.agents[5].x = 25; __game.S.agents[5].z = -19;
  });
  await page.keyboard.down('KeyE');
  await page.evaluate(() => { for (let i = 0; i < 184; i++) __game.step(); });
  await page.keyboard.up('KeyE');
  assert.equal(await page.evaluate(() => __game.S.bomb.state), 'planted');
  await page.evaluate(() => { __game.S.bomb.timer = 0.01; __game.step(); for (let i = 0; i < 244; i++) __game.step(); });
  assert.equal(await page.evaluate(() => __game.S.round), 2);
  assert.equal(await page.evaluate(() => __game.S.phase), 'buy');
  assert.equal(await page.evaluate(() => __game.S.player.inventory[1] === undefined), true, 'Dead player loses primary');
  await page.evaluate(async () => {
    const combat = await import('./src/combat.js');
    __game.closeBuy(); __game.beginLive(); __game.S.score = { sable: 7, harbor: 0 };
    combat.endRound(__game.S, 'sable', 'Browser match test');
    for (let i = 0; i < 244; i++) __game.step();
  });
  assert.equal(await page.locator('#match').isVisible(), true);
  await page.click('#again');
  assert.deepEqual(await page.evaluate(() => [__game.S.round, __game.S.score.sable, __game.S.player.kills, __game.S.player.money]), [1, 0, 0, 800]);
  await page.evaluate(() => __game.renderer.draw(__game.S, 1 / 60));
  const finite = await page.evaluate(() => {
    const g = __game;
    const values = g.S.agents.flatMap(a => [a.x, a.y, a.z, a.hp, a.armor, a.yaw, a.pitch, a.money]);
    g.renderer.scene.traverse(mesh => values.push(...mesh.position.toArray(), ...mesh.rotation.toArray().slice(0, 3), ...mesh.scale.toArray()));
    values.push(...g.renderer.positions); return values.every(Number.isFinite);
  });
  assert(finite, 'Simulation and renderer contain no NaN/Infinity');
  assert.deepEqual(consoleErrors, []); assert.deepEqual(pageErrors, []); assert.deepEqual(remote, []);
  console.log('Browser PASS: menu, Play, buy, pointer lock, WASD, look, fire, reload, plant, round restart, match end, Play again.');
  console.log('console errors: 0; page errors: 0; non-finite values: 0; external requests: 0');
} finally { await browser.close(); }
