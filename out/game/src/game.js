import { mulberry32, clamp, eyeY, yawTo } from './util.js';
import { COLLIDERS, SPAWNS, SITES, siteAt } from './world.js';
import { WEAPONS, GRENADES, ECON, ARMOR, loadWeapon, weaponOf, ammoOf } from './weapons.js';
import { makeAgent, assignRoles, collideAgent, updateBot } from './bots.js';
import { shoot, reload, updateWeapon, dropCharge, interactCharge, updateGrenades, updateRoundClock, checkRoundEnd, endRound, throwGrenade } from './combat.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';

const STEP = 1 / 60;
const $ = id => document.getElementById(id);
const names = { sable: ['You', 'Rook', 'Flint', 'Moth', 'Vale'], harbor: ['Lock', 'Drift', 'Reef', 'Wake', 'Kestrel'] };
const shopItems = [
  ...['rifle', 'smg', 'shotgun', 'sniper'].map((id, i) => ({ ...WEAPONS[id], kind: 'weapon', key: i + 1 })),
  { id: 'armor', name: 'Field vest', category: 'PROTECTION', price: ARMOR.price, description: '100 armor · absorbs half of incoming damage', kind: 'armor', key: 5 },
  ...Object.entries(GRENADES).map(([id, item], i) => ({ ...item, id, category: 'UTILITY', kind: 'grenade', key: i + 6 })),
];

export class Game {
  constructor() {
    const query = new URLSearchParams(location.search);
    this.seed = Number(query.get('seed') || 1) >>> 0;
    this.shot = ['start', 'play', 'buy', 'end'].includes(query.get('shot')) ? query.get('shot') : null;
    this.audio = new Audio();
    this.renderer = new Renderer($('viewport'), this.seed);
    this.S = {
      rng: mulberry32(this.seed), time: 0, phase: 'menu', round: 1,
      agents: [], score: { sable: 0, harbor: 0 }, lossStreak: { sable: 0, harbor: 0 },
      roundT: 100, buyT: 12, bomb: { state: 'carried', x: 0, z: 0, timer: 0 },
      attackSite: 'A', grenades: [], nextGrenade: 1, events: [], feed: [],
      stats: { shots: 0, hits: 0, damage: 0, plants: 0 }, matchOver: false,
      winner: null, reason: '', endAt: 0, bannerUntil: 0, camera: null,
    };
    for (const team of ['sable', 'harbor']) names[team].forEach((name, i) => {
      this.S.agents.push(makeAgent(this.S.agents.length, team, name, SPAWNS[team][i], this.S.rng, team === 'sable' && i === 0));
    });
    this.S.player = this.S.agents[0];
    this.keys = new Set(); this.mouse = { x: 0, y: 0 }; this.fireHeld = false; this.fireEdge = false; this.adsHeld = false;
    this.buyOpen = false; this.cache = {}; this.accumulator = 0; this.lastFrame = null;
    this.hitUntil = 0; this.hurtUntil = 0; this.running = false; this.hudTick = 0;
    this.bindInput(); this.buildShop();
    this.S.camera = { position: [20, 7, 20], target: [-2, 1.5, -8], fov: 62 };
    this.updateHud();
  }
  lockMouse() {
    const promise = this.renderer.renderer.domElement.requestPointerLock();
    if (promise?.catch) promise.catch(() => { $('resume').hidden = false; });
  }
  clearInput() {
    this.keys.clear(); this.fireHeld = false; this.fireEdge = false; this.adsHeld = false;
    this.mouse.x = this.mouse.y = 0;
  }
  bindInput() {
    $('play').addEventListener('click', () => { this.audio.unlock(); this.startMatch(); });
    $('again').addEventListener('click', () => { this.audio.unlock(); this.startMatch(); });
    $('resume').addEventListener('click', () => this.lockMouse());
    $('close-buy').addEventListener('click', () => { this.closeBuy(); this.lockMouse(); });
    $('viewport').addEventListener('mousedown', event => {
      if (this.shot || this.buyOpen || !['live', 'buy', 'roundEnd'].includes(this.S.phase)) return;
      if (!document.pointerLockElement) { this.lockMouse(); return; }
      if (event.button === 0) { this.fireHeld = true; this.fireEdge = true; }
      if (event.button === 2) this.adsHeld = true;
    });
    addEventListener('mouseup', event => { if (!event.button) this.fireHeld = false; if (event.button === 2) this.adsHeld = false; });
    addEventListener('mousemove', event => {
      if (!document.pointerLockElement || this.shot) return;
      this.mouse.x += event.movementX; this.mouse.y += event.movementY;
    });
    addEventListener('keydown', event => {
      if (this.shot) return;
      if (['Space', 'Tab', 'ControlLeft', 'ControlRight'].includes(event.code)) event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'KeyB') { this.toggleBuy(); return; }
      if (this.buyOpen) {
        const item = shopItems.find(item => `Digit${item.key}` === event.code);
        if (item) this.buy(item.id);
        if (event.code === 'Escape') this.closeBuy();
        return;
      }
      if (this.S.phase === 'menu' || this.S.phase === 'matchEnd') return;
      this.keys.add(event.code);
      if (event.code === 'KeyR' && this.S.player.slot <= 2) reload(this.S, this.S.player);
      if (event.code === 'KeyG') this.throwSelected();
      if (event.code === 'KeyX' && this.S.phase === 'live') dropCharge(this.S, this.S.player);
      if (event.code.startsWith('Digit')) this.selectSlot(Number(event.code.slice(-1)));
      if (event.code === 'Space' && this.S.player.y <= 0.01 && this.S.phase === 'live') this.S.player.vy = 5.2;
      if (event.code === 'KeyM') { this.audio.muted = !this.audio.muted; this.message(this.audio.muted ? 'Audio muted' : 'Audio enabled'); }
    });
    addEventListener('keyup', event => this.keys.delete(event.code));
    addEventListener('blur', () => this.clearInput());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement) this.clearInput();
      $('resume').hidden = !!document.pointerLockElement || this.buyOpen || !['live', 'buy', 'roundEnd'].includes(this.S.phase) || !!this.shot;
    });
    document.addEventListener('contextmenu', event => event.preventDefault());
    addEventListener('resize', () => this.renderer.resize());
  }
  startMatch() {
    const S = this.S;
    S.rng = mulberry32(this.seed); S.time = 0; S.round = 1;
    S.score = { sable: 0, harbor: 0 }; S.lossStreak = { sable: 0, harbor: 0 };
    S.stats = { shots: 0, hits: 0, damage: 0, plants: 0 }; S.matchOver = false;
    S.feed = []; S.events = []; S.nextGrenade = 1;
    for (const agent of S.agents) {
      agent.inventory = { 2: loadWeapon('pistol') }; agent.slot = 2;
      agent.armor = 0; agent.money = ECON.start; agent.kills = agent.deaths = 0;
      agent.grenades = { he: 0, smoke: 0 }; agent.alive = true;
    }
    $('start').hidden = true; $('match').hidden = true; $('hud').hidden = false;
    this.startRound();
  }
  startRound() {
    const S = this.S;
    this.renderer.clearRound(); this.clearInput();
    S.phase = 'buy'; S.buyT = 12; S.roundT = 100; S.grenades = []; S.camera = null;
    S.winner = null; S.reason = ''; S.bannerUntil = 0;
    S.bomb = { state: 'carried', carrier: S.player, x: 0, z: 0, timer: 0, site: null };
    const indexes = { sable: 0, harbor: 0 };
    for (const agent of S.agents) {
      const survived = agent.alive;
      if (!survived) { agent.inventory = { 2: loadWeapon('pistol') }; agent.armor = 0; agent.grenades = { he: 0, smoke: 0 }; }
      for (const [slot, ammo] of Object.entries(agent.inventory)) agent.inventory[slot] = loadWeapon(ammo.id);
      Object.assign(agent, SPAWNS[agent.team][indexes[agent.team]++], {
        y: 0, vy: 0, vx: 0, vz: 0, pitch: 0, alive: true, hp: 100, slot: agent.inventory[1] ? 1 : 2,
        hasBomb: agent.isPlayer, interact: 0, reloading: 0, recoil: 0, bloom: 0, nextShot: -1,
        lastShot: -10, lastHurt: -10, lastAttacker: null, target: null, memory: null,
        path: [], goal: -1, pathIndex: 0, recalcAt: 0, scanAt: 0, burst: 0, pauseUntil: 0,
        crouched: false, ads: false, walk: 0, state: 'advance',
      });
    }
    assignRoles(S);
    this.hitUntil = this.hurtUntil = 0;
    this.openBuy(); this.updateHud();
  }
  beginLive() {
    this.S.phase = 'live'; this.S.camera = null; this.closeBuy();
    this.message(`ROUND ${this.S.round} · Take a site. Hold your ground.`, 2.4);
  }
  message(text, duration = 2) { this.S.notice = text; this.S.noticeUntil = this.S.time + duration; }
  selectSlot(slot) {
    const p = this.S.player;
    if (!p.alive || ![1, 2, 3, 4].includes(slot)) return;
    if (slot <= 2 && !p.inventory[slot]) { this.audio.denied(); return; }
    p.slot = slot; p.reloading = 0; p.ads = false; this.fireHeld = this.fireEdge = false;
  }
  throwSelected() {
    const p = this.S.player;
    const kind = p.slot === 4 ? 'smoke' : p.slot === 3 ? 'he' : p.grenades.he ? 'he' : 'smoke';
    if (!throwGrenade(this.S, p, kind)) this.audio.denied();
  }
  updatePlayer(dt) {
    const S = this.S, p = S.player;
    if (!p.alive || this.buyOpen) return;
    p.yaw -= this.mouse.x * (p.ads ? 0.0014 : 0.0021);
    p.pitch = clamp(p.pitch - this.mouse.y * (p.ads ? 0.0014 : 0.0021), -1.45, 1.45);
    this.mouse.x = this.mouse.y = 0;
    p.crouched = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    p.ads = this.adsHeld && p.slot <= 2 && !p.reloading;
    if (S.phase !== 'live') { p.vx = p.vz = 0; return; }
    const active = !!document.pointerLockElement || this.debugInput;
    const forward = active ? Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')) : 0;
    const side = active ? Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')) : 0;
    const magnitude = Math.hypot(forward, side) || 1;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = p.crouched ? 2.1 : p.ads ? 2.6 : sprint ? 6 : 4.4;
    const planting = active && this.keys.has('KeyE') && ((p.hasBomb && siteAt(p.x, p.z)) || p.team === 'harbor' && S.bomb.state === 'planted');
    const velocityX = (side * Math.cos(p.yaw) - forward * Math.sin(p.yaw)) / magnitude * speed;
    const velocityZ = (-side * Math.sin(p.yaw) - forward * Math.cos(p.yaw)) / magnitude * speed;
    const response = Math.min(1, dt * (p.y > 0.04 ? 10 : 40));
    p.vx += ((planting ? 0 : velocityX) - p.vx) * response;
    p.vz += ((planting ? 0 : velocityZ) - p.vz) * response;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.vy -= dt * 14; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0;
    collideAgent(p); p.walk += Math.hypot(p.vx, p.vz) * dt * 2.3;
    if (p.y === 0 && Math.hypot(p.vx, p.vz) > 1.8 && S.time >= p.stepAt) {
      p.stepAt = S.time + (sprint ? 0.26 : 0.38); this.audio.step();
    }
    if (active && this.fireHeld && !planting) {
      if (p.slot >= 3) { if (this.fireEdge) this.throwSelected(); }
      else if (weaponOf(p).auto || this.fireEdge) {
        const pitch = p.pitch + p.recoil;
        shoot(S, p, -Math.sin(p.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(p.yaw) * Math.cos(pitch));
      }
    }
    this.fireEdge = false;
    interactCharge(S, p, active && this.keys.has('KeyE'), dt);
  }
  buildShop() {
    for (const item of shopItems) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `item ${item.kind}`; button.id = `item-${item.id}`;
      const silhouette = item.kind === 'weapon' ? `<svg viewBox="0 0 200 64" aria-hidden="true"><path d="M18 27h${item.id === 'sniper' ? 140 : 110}v7H76l-9 17H52l4-17H36l-9 9H9V27zM80 22h40v6H80z"/><path d="M70 33l12 3-4 23H65z"/>${item.id === 'sniper' ? '<rect x="70" y="10" width="38" height="9" rx="3"/>' : ''}</svg>` : `<span class="gear-symbol">${item.id === 'armor' ? '◇' : item.id === 'he' ? '✳' : '◉'}</span>`;
      button.innerHTML = `<span class="item-category">${item.category} <kbd>${item.key}</kbd></span>${silhouette}<span class="item-name">${item.name}</span><span class="item-desc">${item.description}</span><span class="item-price">$${item.price.toLocaleString('en-US')}</span>`;
      button.addEventListener('click', () => this.buy(item.id)); $('shop').append(button);
    }
  }
  buy(id) {
    const S = this.S, p = S.player, item = shopItems.find(item => item.id === id);
    if (!item || S.phase !== 'buy' || !p.alive) return false;
    const owned = item.kind === 'weapon' ? p.inventory[1]?.id === id : item.kind === 'armor' ? p.armor === 100 : p.grenades[id] >= 2;
    if (owned || p.money < item.price) { this.audio.denied(); return false; }
    p.money -= item.price;
    if (item.kind === 'weapon') { p.inventory[1] = loadWeapon(id); p.slot = 1; }
    else if (item.kind === 'armor') p.armor = 100;
    else p.grenades[id]++;
    this.audio.buy(); this.refreshShop(); this.updateHud();
    return true;
  }
  refreshShop() {
    const p = this.S.player;
    $('buy-money').textContent = `$${p.money.toLocaleString('en-US')}`;
    for (const item of shopItems) {
      const owned = item.kind === 'weapon' ? p.inventory[1]?.id === item.id : item.kind === 'armor' ? p.armor === 100 : p.grenades[item.id] >= 2;
      const button = $(`item-${item.id}`); button.classList.toggle('owned', owned); button.disabled = owned || item.price > p.money;
    }
  }
  openBuy() {
    if (this.S.phase !== 'buy') return;
    this.buyOpen = true; this.clearInput(); this.refreshShop();
    $('buy').hidden = false; $('resume').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  closeBuy() {
    this.buyOpen = false; $('buy').hidden = true;
    $('resume').hidden = !!document.pointerLockElement || !!this.shot || !['live', 'buy'].includes(this.S.phase);
  }
  toggleBuy() {
    if (this.S.phase !== 'buy') { this.message('Requisition opens between rounds'); return; }
    if (this.buyOpen) { this.closeBuy(); this.lockMouse(); } else this.openBuy();
  }
  showMatch() {
    const S = this.S, p = S.player;
    S.phase = 'matchEnd'; this.closeBuy(); this.clearInput();
    if (document.pointerLockElement) document.exitPointerLock();
    $('resume').hidden = true;
    $('match').hidden = false;
    $('match-title').textContent = S.score.sable > S.score.harbor ? 'YARD SECURED.' : 'YARD LOST.';
    $('match-title').className = S.score.sable > S.score.harbor ? 'sable' : 'harbor';
    $('match-score').textContent = `${S.score.sable} — ${S.score.harbor}`;
    $('match-sub').textContent = `${S.round} rounds in Yard 9 · ${S.score.sable > S.score.harbor ? 'SABLE takes the freight line.' : 'HARBOR holds the freight line.'}`;
    $('match-stats').innerHTML = `<div><b>${p.kills}</b><span>KILLS</span></div><div><b>${p.deaths}</b><span>DEATHS</span></div><div><b>${Math.round(S.stats.damage)}</b><span>DAMAGE</span></div><div><b>${S.stats.shots ? Math.round(S.stats.hits / S.stats.shots * 100) : 0}%</b><span>ACCURACY</span></div>`;
  }
  consumeEvents() {
    const S = this.S;
    for (const event of S.events.splice(0)) {
      this.renderer.event(event, S);
      switch (event.type) {
        case 'shot': this.audio.shot(event.weapon, event.agent.isPlayer ? 0 : Math.hypot(event.agent.x - S.player.x, event.agent.z - S.player.z)); break;
        case 'reload': this.audio.reload(); break;
        case 'dry': this.audio.dry(); break;
        case 'hurt': this.hurtUntil = S.time + 0.22; this.audio.hurt(); break;
        case 'hit': this.hitUntil = S.time + 0.14; $('hitmarker').classList.toggle('kill', event.kill); this.audio.hit(event.kill); break;
        case 'bounce': this.audio.bounce(); break;
        case 'explosion': this.audio.explosion(Math.hypot(event.x - S.player.x, event.z - S.player.z)); break;
        case 'beep': this.audio.beep(); break;
        case 'plant': this.audio.plant(); S.stats.plants++; this.message(`CHARGE PLANTED · SITE ${event.site} · HOLD FOR 35 SECONDS`, 3); break;
        case 'pickup': if (event.agent.isPlayer) this.message('Charge retrieved'); break;
        case 'round': this.audio.round(event.winner === 'sable'); this.closeBuy(); break;
      }
    }
  }
  step(dt = STEP) {
    const S = this.S;
    if (S.phase === 'menu' || S.phase === 'matchEnd') return;
    S.time += dt;
    if (S.phase === 'buy') {
      this.updatePlayer(dt); S.buyT = Math.max(0, S.buyT - dt);
      if (!S.buyT) this.beginLive();
    } else if (S.phase === 'live') {
      S.agents.forEach(agent => updateWeapon(agent, dt));
      this.updatePlayer(dt);
      for (const agent of S.agents) if (!agent.isPlayer) updateBot(S, agent, dt);
      this.separateAgents(); updateGrenades(S, dt); checkRoundEnd(S); updateRoundClock(S, dt);
    } else if (S.phase === 'roundEnd' && S.time - S.endAt >= 4) {
      if (S.matchOver) this.showMatch(); else { S.round++; this.startRound(); }
    }
    this.consumeEvents();
  }
  separateAgents() {
    const agents = this.S.agents.filter(a => a.alive);
    agents.forEach((a, i) => {
      for (const b of agents.slice(i + 1)) {
        const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
        if (distance >= 0.67 || distance < 0.0001 || a.interact || b.interact) continue;
        const push = (0.67 - distance) * 0.5;
        a.x -= dx / distance * push; a.z -= dz / distance * push;
        b.x += dx / distance * push; b.z += dz / distance * push;
      }
      collideAgent(a);
    });
  }
  text(id, value) {
    if (this.cache[id] === value) return;
    $(id).textContent = value; this.cache[id] = value;
  }
  updateHud() {
    const S = this.S, p = S.player, ammo = ammoOf(p), weapon = weaponOf(p);
    this.text('health', Math.ceil(p.hp)); this.text('armor', Math.ceil(p.armor));
    $('health-fill').style.width = `${p.hp}%`;
    this.text('money', `$${p.money.toLocaleString('en-US')}`);
    this.text('weapon', p.slot > 2 ? GRENADES[p.slot === 3 ? 'he' : 'smoke'].name : weapon.name);
    this.text('mag', p.slot > 2 ? p.grenades[p.slot === 3 ? 'he' : 'smoke'] : ammo.mag);
    this.text('reserve', p.slot > 2 ? 'UTILITY' : `/ ${ammo.reserve}`);
    this.text('ammo-note', p.reloading ? 'RELOADING' : '1 PRIMARY   2 SIDEARM   3 HE   4 SMOKE');
    this.text('score-sable', S.score.sable); this.text('score-harbor', S.score.harbor);
    this.text('round-label', `ROUND ${String(S.round).padStart(2, '0')} / 15 · FIRST TO 8`);
    const planted = S.bomb.state === 'planted';
    const time = Math.ceil(planted ? S.bomb.timer : S.phase === 'buy' ? S.buyT : S.roundT);
    this.text('timer', `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`);
    $('timer').classList.toggle('urgent', time <= 10);
    this.text('phase-label', planted ? 'CHARGE LIVE' : S.phase === 'buy' ? 'REQUISITION' : S.phase === 'roundEnd' || S.phase === 'matchEnd' ? 'ROUND COMPLETE' : 'ATTACK');
    for (const team of ['sable', 'harbor']) {
      this.text(`alive-${team}`, S.agents.filter(a => a.team === team && a.alive).length + ' ALIVE');
    }
    this.text('objective', S.phase === 'matchEnd' ? 'OPERATION COMPLETE' : S.phase === 'roundEnd' ? 'NEXT REQUISITION INCOMING' : planted ? `SITE ${S.bomb.site} · HOLD THE CHARGE` : p.hasBomb ? 'YOU CARRY THE CHARGE · PLANT AT A OR B' : S.bomb.state === 'dropped' ? 'CHARGE DROPPED · RETRIEVE IT' : 'COVER YOUR CARRIER');
    $('bomb-bar').hidden = !planted; $('bomb-fill').style.width = `${S.bomb.timer / 35 * 100}%`;
    $('interaction').hidden = !p.interact;
    this.text('interaction-label', p.interactKind === 'defuse' ? 'DEFUSING CHARGE' : 'PLANTING CHARGE');
    $('interaction-fill').style.width = `${p.interact / (p.interactKind === 'defuse' ? 5 : 3) * 100}%`;
    $('crosshair').style.setProperty('--gap', `${5 + p.bloom * 230 + Math.hypot(p.vx, p.vz) * 0.7}px`);
    $('crosshair').hidden = !p.alive || this.buyOpen || S.phase === 'menu' || S.phase === 'matchEnd';
    $('hitmarker').style.opacity = S.time < this.hitUntil ? '1' : '0';
    $('damage').style.opacity = S.time < this.hurtUntil ? '1' : '0';
    $('banner').hidden = !['roundEnd', 'matchEnd'].includes(S.phase);
    this.text('banner-title', S.winner === 'sable' ? 'SABLE WINS THE ROUND' : 'HARBOR WINS THE ROUND');
    this.text('banner-sub', S.reason);
    $('banner').className = S.winner || '';
    $('notice').hidden = S.time >= (S.noticeUntil || 0); this.text('notice', S.notice || '');
    $('death-note').hidden = p.alive || S.phase !== 'live';
    $('buy-clock').textContent = `${Math.ceil(S.buyT)}s UNTIL DEPLOYMENT`;
    this.text('location', siteAt(p.x, p.z) ? `SITE ${siteAt(p.x, p.z)} / ${SITES[siteAt(p.x, p.z)].name.toUpperCase()}` : p.z > 12 ? 'SOUTH FREIGHT / SABLE SPAWN' : Math.abs(p.x) < 9 ? 'MID / TRANSFER LANE' : p.x < 0 ? 'WEST / WAREHOUSE APPROACH' : 'EAST / CONTAINER APPROACH');
    const context = p.hasBomb && siteAt(p.x, p.z) && !planted ? '[ E ] HOLD TO PLANT · 3 SECONDS' : !p.alive ? 'SQUAD CONTINUES · NEXT ROUND INCOMING' : S.phase === 'buy' ? '[ B ] REQUISITION · SPEND BEFORE DEPLOYMENT' : '[ R ] RELOAD   [ RMB ] AIM   [ E ] PLANT   [ G ] GRENADE';
    this.text('context', context);
    const feed = S.feed.filter(entry => S.time - entry.time < 7);
    const feedKey = JSON.stringify(feed);
    if (this.cache.feed !== feedKey) {
      $('killfeed').innerHTML = feed.map(e => `<div><span class="${e.team}">${e.killer}</span><em>${e.head ? '⌖' : '›'}</em><span class="${e.victimTeam}">${e.victim}</span></div>`).join('');
      this.cache.feed = feedKey;
    }
    $('scoreboard').hidden = !this.keys.has('Tab');
    if (this.keys.has('Tab')) $('score-table').innerHTML = S.agents.map(a => `<tr class="${a.team}"><td>${a.name}${a.alive ? '' : ' †'}</td><td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td></tr>`).join('');
    this.drawRadar();
  }
  drawRadar() {
    const ctx = $('radar').getContext('2d'), scale = 2.1;
    ctx.clearRect(0, 0, 154, 112);
    const x = value => 77 + value * scale, z = value => 56 + value * scale;
    ctx.fillStyle = '#839293';
    COLLIDERS.forEach(c => ctx.fillRect(x(c.x1), z(c.z1), (c.x2 - c.x1) * scale, (c.z2 - c.z1) * scale));
    ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    Object.entries(SITES).forEach(([key, site]) => { ctx.fillStyle = '#ffbd59'; ctx.fillText(key, x(site.x), z(site.z) + 4); });
    for (const a of this.S.agents) {
      if (!a.alive || a.team !== 'sable') continue;
      ctx.fillStyle = a.isPlayer ? '#ffffff' : '#ffbd59';
      ctx.beginPath(); ctx.arc(x(a.x), z(a.z), a.isPlayer ? 3.2 : 2, 0, 7); ctx.fill();
    }
    const p = this.S.player;
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x(p.x), z(p.z)); ctx.lineTo(x(p.x - Math.sin(p.yaw) * 4), z(p.z - Math.cos(p.yaw) * 4)); ctx.stroke();
    if (['planted', 'dropped'].includes(this.S.bomb.state)) { ctx.fillStyle = '#ed7658'; ctx.fillRect(x(this.S.bomb.x) - 2, z(this.S.bomb.z) - 2, 4, 4); }
  }
  stageShot() {
    this.startMatch(); this.closeBuy();
    const S = this.S, p = S.player;
    S.time = 21; S.roundT = 79;
    // Pose the actual game objects and UI. No timers advance in capture mode.
    S.agents.forEach((a, i) => { a.walk = S.rng() * 6; a.vx = 0; a.vz = 0; });
    if (this.shot === 'start') {
      S.phase = 'menu'; S.camera = { position: [20, 7, 20], target: [-2, 1.6, -8], fov: 62 };
      const a = S.agents[1]; Object.assign(a, { x: 17, z: 3, yaw: 0 });
      Object.assign(S.agents[2], { x: 9, z: 4, yaw: -0.3 });
      $('start').hidden = false; $('hud').hidden = true;
    } else if (this.shot === 'buy') {
      S.phase = 'buy'; S.buyT = 9; S.round = 4; S.score = { sable: 2, harbor: 1 };
      p.money = 5400; p.inventory[1] = loadWeapon('rifle'); p.slot = 1; p.armor = 100;
      S.camera = { position: [20, 6, 20], target: [2, 1, -7], fov: 64 };
      this.openBuy();
    } else {
      S.phase = 'live'; S.round = 6; S.score = { sable: 3, harbor: 2 };
      Object.assign(p, { x: 7.5, z: 5.4, yaw: -0.24, pitch: -0.015, hp: 87, armor: 72, money: 4200, slot: 1, hasBomb: false });
      p.inventory[1] = loadWeapon('rifle'); p.inventory[1].mag = 21;
      S.bomb = { state: 'planted', site: 'B', x: 20.3, z: -9.2, timer: 24, carrier: null };
      const positions = [[-18, -4], [4, 1], [-21, -9], [19, -3], [10.3, -3.1], [13.1, -7.4], [-23, -10], [25, -10], [0, -10.5]];
      S.agents.slice(1).forEach((a, i) => Object.assign(a, { x: positions[i][0], z: positions[i][1], yaw: a.team === 'harbor' ? Math.PI : 0, crouched: i === 3, alive: true }));
      S.feed = [{ time: 20, killer: 'You', team: 'sable', victim: 'Wake', victimTeam: 'harbor', head: true }, { time: 18, killer: 'Flint', team: 'sable', victim: 'Reef', victimTeam: 'harbor', head: false }];
      S.agents[8].alive = false; S.agents[8].diedAt = 19;
      this.renderer.event({ type: 'tracer', start: { x: 10.3, y: 1.4, z: -3.1 }, end: { x: 5.5, y: 1.1, z: 4 } }, S);
      if (this.shot === 'end') {
        S.round = 13; S.score = { sable: 7, harbor: 5 }; S.stats = { shots: 116, hits: 48, damage: 2380, plants: 3 }; p.kills = 18; p.deaths = 6;
        endRound(S, 'sable', 'Site B charge detonated · freight line secured');
        S.bomb.state = 'detonated';
        S.camera = { position: [24, 4.5, 4], target: [17, 1, -11], fov: 62 };
        this.showMatch();
      }
    }
    this.consumeEvents(); this.updateHud(); $('resume').hidden = true;
    this.renderer.draw(S, 0);
    // Readiness means the full scene and its overlays have reached a rendered frame.
    requestAnimationFrame(() => { this.renderer.draw(S, 0); window.__shotReady = true; });
  }
  frame = timestamp => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.lastFrame === null ? 0 : Math.min(0.15, (timestamp - this.lastFrame) / 1000);
    this.lastFrame = timestamp;
    if (this.shot) return;
    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= STEP && ticks++ < 9) { this.step(); this.accumulator -= STEP; }
    if (ticks >= 9) this.accumulator = 0;
    this.renderer.draw(this.S, dt);
    this.hudTick += dt;
    if (this.hudTick >= 0.05) { this.updateHud(); this.hudTick = 0; }
  };
  start() {
    this.running = true;
    if (this.shot) this.stageShot();
    this.raf = requestAnimationFrame(this.frame);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.audio.stop(); this.renderer.stop(); }
}
