// CHRONOVERSE game entry point (render.html). Wires the unified GameState to
// the 3D world, input, ChronoLens HUD and the in-world device/inventory UI.
// All gameplay goes through the shared modules in src/; this file only
// orchestrates them.

import { createSaveManager, AUTOSAVE, MANUAL_SLOTS } from './core/SaveManager.js';
import { createGameState, biologicalAge, validateGameState } from './core/GameState.js';
import { advanceReal, passHours, TIME_SCALE } from './core/GameClock.js';
import { recordEvent } from './core/EventBus.js';
import { formatDate, formatYear, HOURS_PER_YEAR } from './core/time.js';
import { createWorld, terrainHeight } from './world/WorldModel.js';
import { localToLatLon, latLonToLocal } from './world/geo.js';
import { createNPCManager } from './characters/NPCManager.js';
import { planJump, applyJump, deviceTier, errorFactor, energyCost, anchorStatus, ANCHOR_ERROR_MULTIPLIER } from './navigation/ChronoNavigation.js';
import { placeAnchor, touchableObject, refreshAnchorDestruction } from './navigation/ChronoAnchor.js';
import { handleFatalState } from './navigation/EmergencyRecall.js';
import { consume, drinkFrom, ITEMS } from './survival/Survival.js';
import { WorldRenderer, WEATHER, weatherFor } from './rendering/WorldRenderer.js';

const $ = id => document.getElementById(id);
const saves = createSaveManager(localStorage);
const params = new URLSearchParams(location.search);
const AUTOSAVE_SECONDS = 30;
const SHOP = { ration: 350, water: 120 }; // decimal pence, 2032 prices (calibration values)

let state;
let message = '';
try {
  const slot = params.get('slot');
  if (slot && MANUAL_SLOTS.includes(slot)) state = saves.load(slot);
  if (!state) {
    const r = saves.loadOrMigrate();
    state = r.state;
    if (r.migrated) message = 'A régi, külön kulcsokon tárolt 3D mentést átalakítottam egységes mentéssé.';
  }
} catch (e) { message = 'A mentés nem tölthető be: ' + e.message + ' – új játék indult.'; }
if (!state) { state = createGameState(); saves.save(state, AUTOSAVE, 'new'); }

const world = createWorld({ getEvents: () => state.events, getTimelineId: () => state.timelineId });
let archetypes = [];
try { archetypes = (await (await fetch('data/npc_social_archetypes.json')).json()).records; } catch (e) { message = 'NPC-adatbázis nem tölthető be: ' + e.message; }
const npcs = createNPCManager({ archetypes, world });
const renderer = new WorldRenderer($('view'), world);

// ------------------------------------------------------------------ input
const keys = new Set();
let thirdPerson = false, saveTimer = 0, npcTimer = 0, npcSnapshot = [], toastUntil = 0, lastFrame = performance.now();
const canvas = renderer.renderer.domElement;
const dialogs = ['deviceDialog', 'invDialog', 'menuDialog', 'helpDialog', 'deathDialog', 'shopDialog'];
const anyDialog = () => dialogs.some(id => $(id).open);

canvas.addEventListener('click', () => { if (!anyDialog()) canvas.requestPointerLock?.(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  state.player.yaw -= e.movementX * 0.002;
  state.player.pitch = Math.max(-1.4, Math.min(1.4, state.player.pitch - e.movementY * 0.002));
});
addEventListener('blur', () => keys.clear());
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) keys.clear(); });
addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); e.preventDefault(); }
  if (e.repeat || anyDialog()) return;
  if (k === 'e') interact();
  else if (k === 't') openDevice();
  else if (k === 'h') anchorHere();
  else if (k === 'i') openInventory();
  else if (k === 'm') openMenu();
  else if (k === 'v') thirdPerson = !thirdPerson;
  else if (k === 'f1' || k === '?') { e.preventDefault(); openDialog('helpDialog'); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
for (const id of dialogs) $(id).addEventListener('close', () => canvas.focus());

function openDialog(id) { if (document.pointerLockElement) document.exitPointerLock(); keys.clear(); if (!$(id).open) $(id).showModal(); }
function toast(text, seconds = 5) { $('talk').textContent = text; toastUntil = performance.now() + seconds * 1000; }

// ------------------------------------------------------------- persistence
function save(slot = AUTOSAVE, label = '') {
  if (state.survival.dead && slot === AUTOSAVE) return false; // keep the pre-death autosave
  try { saves.save(state, slot, label); return true; } catch (e) { toast('Mentési hiba: ' + e.message); return false; }
}
addEventListener('pagehide', () => save());
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ----------------------------------------------------------------- actions
function date() { return state.clock.historicalDate; }

function nearestNPC(maxDist = 3) {
  let best = null;
  for (const n of npcSnapshot) {
    if (!n.visible) continue;
    const p = renderer.npcPosition(n.id) || n;
    const d = Math.hypot(p.x - state.player.x, p.z - state.player.z);
    if (d < maxDist && (!best || d < best.d)) best = { npc: n, d };
  }
  return best && best.npc;
}

function shopNear() {
  if (date() < 1971) return null; // decimal pounds (the player's 2032 money) only exist from 1971
  return world.buildingsAt(date()).find(b => b.id === 'supermarket' && Math.hypot(Math.max(0, Math.abs(state.player.x - b.x) - b.w / 2), Math.max(0, Math.abs(state.player.z - b.z) - b.d / 2)) < 3) || null;
}

function interact() {
  if (state.survival.dead) return;
  const n = nearestNPC();
  if (n) { const r = npcs.talk(state, n); toast(`${r.speaker}: ${r.line}  [ChronoLens: ${r.lens}]`, 7); return; }
  if (shopNear()) { openShop(); return; }
  const w = world.waterSourceNear(state.player.x, state.player.z, date());
  if (w) { const r = drinkFrom(state, w); toast(r.message, 6); return; }
  toast('Nincs semmi a közelben, amivel interakcióba léphetnél.', 3);
}

function anchorHere() {
  if (state.survival.dead) return;
  try {
    const { anchor, created } = placeAnchor(state, world);
    toast(created ? `Időhorgony rögzítve: ${anchor.name}, ${formatDate(anchor.placedAt)}.` : `Ezen az objektumon már van horgony (${formatDate(anchor.placedAt)} óta).`);
    save();
  } catch (e) { toast(e.message); }
}

function handleDeath(result) {
  if (!result || !result.died) return;
  const r = handleFatalState(state, result.cause);
  if (r.recalled) { toast(r.message, 10); save(); }
  else showDeath(r.message);
}

// ------------------------------------------------------------- ChronoDevice
function openDevice() {
  if (state.survival.dead) return;
  const t = deviceTier(state.chronoDevice);
  // First jump defaults to the design's first target (30 years back = 2002), later ones to 10 years back.
  $('jTarget').value = (date() - (state.chronoDevice.successfulJumps === 0 ? t.years : 10)).toFixed(3);
  const ll = localToLatLon(state.player.x, state.player.z);
  $('jLat').value = ll.lat.toFixed(5); $('jLon').value = ll.lon.toFixed(5);
  $('jAnchor').replaceChildren(new Option('Szabad célzás (koordináta)', ''));
  for (const a of state.anchors.filter(a => a.timelineId === state.timelineId)) {
    const st = anchorStatus(a, state, world);
    $('jAnchor').add(new Option(`${a.name} – ${formatDate(a.placedAt, false)} óta${a.destroyed ? ' (megsemmisült)' : ''}`, a.id));
  }
  $('jStatus').textContent = '';
  updateDevicePreview();
  openDialog('deviceDialog');
}

function deviceRequest() {
  const anchorId = $('jAnchor').value || null;
  const p = latLonToLocal(Number($('jLat').value), Number($('jLon').value));
  return { targetDate: Number($('jTarget').value), targetX: p.x, targetZ: p.z, anchorId };
}

function updateDevicePreview() {
  const d = state.chronoDevice, t = deviceTier(d), f = errorFactor(d.successfulJumps);
  const req = deviceRequest();
  const dy = Math.abs(req.targetDate - date());
  const anchored = !!req.anchorId;
  $('jInfo').innerHTML = '';
  const rows = [
    ['Eszköz', `${t.id} – ${t.years} év / ${t.km} km (végleges felső határ: 50 év / 500 km)`],
    ['Most', formatDate(date())],
    ['Cél', Number.isFinite(req.targetDate) ? formatDate(req.targetDate) + ` (${dy.toFixed(2)} év)` : '–'],
    ['Várható időhiba', `±${(t.timeErrorYears * f).toFixed(2)} év`],
    ['Várható helyhiba', `≤ ${(t.spaceErrorKm * f * (anchored ? ANCHOR_ERROR_MULTIPLIER : 1) * 1000).toFixed(0)} m${anchored ? ' (horgony: −95%)' : ''}`],
    ['Energia', `${Math.round(d.charge * 100)}% → ugrás: ${Number.isFinite(dy) ? Math.round(energyCost(Math.min(dy, t.years), t) * 100) : '–'}%`],
    ['Tapasztalat', `${d.successfulJumps} sikeres ugrás, hibaszorzó ${f.toFixed(3)}`],
  ];
  for (const [k, v] of rows) { const tr = document.createElement('tr'); tr.append(Object.assign(document.createElement('th'), { textContent: k }), Object.assign(document.createElement('td'), { textContent: v })); $('jInfo').append(tr); }
  if (req.anchorId) {
    const a = state.anchors.find(x => x.id === req.anchorId);
    const st = a && anchorStatus(a, state, world, req.targetDate);
    $('jAnchorNote').textContent = st ? (st.usable ? 'A horgony a célidőben érvényes.' : 'Figyelem: ' + st.reason + '.') : '';
  } else $('jAnchorNote').textContent = '';
}

function doJump() {
  const req = deviceRequest();
  recordEvent(state, 'TIME_JUMP_REQUESTED', { ...req });
  const plan = planJump(state, req, world);
  if (!plan.ok) {
    recordEvent(state, 'TIME_JUMP_REJECTED', { code: plan.code });
    $('jStatus').textContent = plan.message;
    return;
  }
  applyJump(state, plan);
  refreshAnchorDestruction(state, world);
  $('deviceDialog').close();
  $('flash').style.opacity = 1; setTimeout(() => { $('flash').style.opacity = 0; }, 450);
  npcTimer = 0;
  save();
  const off = Math.hypot(plan.arrival.x - plan.target.x, plan.arrival.z - plan.target.z);
  toast(`Érkezés: ${formatDate(plan.arrival.date)}. Eltérés a céltól: ${Math.abs(plan.arrival.date - plan.target.date).toFixed(2)} év, ${off < 1000 ? off.toFixed(0) + ' m' : (off / 1000).toFixed(2) + ' km'}${plan.snapped ? ' (a cél a hatótáv határára igazítva)' : ''}.`, 9);
}

$('jTarget').addEventListener('input', updateDevicePreview);
$('jLat').addEventListener('input', updateDevicePreview);
$('jLon').addEventListener('input', updateDevicePreview);
$('jAnchor').addEventListener('change', updateDevicePreview);
$('jHere').onclick = () => { const ll = localToLatLon(state.player.x, state.player.z); $('jLat').value = ll.lat.toFixed(5); $('jLon').value = ll.lon.toFixed(5); updateDevicePreview(); };
for (const b of document.querySelectorAll('[data-dy]')) b.onclick = () => { $('jTarget').value = (Number($('jTarget').value) + Number(b.dataset.dy)).toFixed(3); updateDevicePreview(); };
$('jJump').onclick = doJump;
$('jClose').onclick = () => $('deviceDialog').close();

// --------------------------------------------------------- inventory/status
function openInventory() { renderInventory(); openDialog('invDialog'); }
function renderInventory(note = '') {
  const list = $('invItems'); list.replaceChildren();
  for (const [id, n] of Object.entries(state.inventory)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = 'Elfogyaszt'; b.disabled = n <= 0 || state.survival.dead;
    b.onclick = () => { try { renderInventory(consume(state, id)); recordEvent(state, 'ITEM_CONSUMED', { item: id }); } catch (e) { renderInventory(e.message); } };
    li.append(`${(ITEMS[id] || { name: id }).name}: ${n} db `, b);
    list.append(li);
  }
  const money = state.finances.GBP_DECIMAL_PENCE || 0;
  $('invMoney').textContent = `Pénz: £${(money / 100).toFixed(2)} (2032-es decimális font – ${date() >= 1971 ? 'itt elfogadják' : 'ebben a korban értéktelen'})`;
  $('invNote').textContent = note;
}
function rest(hours, sleeping) {
  const r = passHours(state, hours, { sleeping });
  handleDeath(r);
  if (!state.survival.dead) { renderInventory(`${hours} óra telt el${sleeping ? ' alvással' : ''}.`); save(); }
}
$('invWait').onclick = () => rest(1, false);
$('invSleep').onclick = () => rest(8, true);
$('invClose').onclick = () => $('invDialog').close();

// ------------------------------------------------------------------- shop
function openShop() { renderShop(''); openDialog('shopDialog'); }
function renderShop(note) {
  const root = $('shopItems'); root.replaceChildren();
  for (const [id, price] of Object.entries(SHOP)) {
    const b = document.createElement('button');
    b.textContent = `${ITEMS[id].name} – £${(price / 100).toFixed(2)}`;
    b.onclick = () => {
      if ((state.finances.GBP_DECIMAL_PENCE || 0) < price) { renderShop('Nincs elég pénzed.'); return; }
      state.finances.GBP_DECIMAL_PENCE -= price; state.inventory[id] = (state.inventory[id] || 0) + 1;
      recordEvent(state, 'ITEM_TRADED', { item: id, pricePence: price, seller: 'supermarket' }, { affected: ['supermarket'] });
      renderShop(`Megvetted: ${ITEMS[id].name}.`);
    };
    root.append(b);
  }
  $('shopMoney').textContent = `Egyenleg: £${((state.finances.GBP_DECIMAL_PENCE || 0) / 100).toFixed(2)}. ${note}`;
}
$('shopClose').onclick = () => $('shopDialog').close();

// ------------------------------------------------------------------- menu
function openMenu() { renderSlots(); openDialog('menuDialog'); }
function renderSlots(note = '') {
  const root = $('slots'); root.replaceChildren();
  for (const slot of MANUAL_SLOTS) {
    const info = saves.info(slot);
    const row = document.createElement('div'); row.className = 'slot';
    const label = info && info.summary ? `${info.summary.name} – ${formatDate(info.summary.historicalDate)} – ${new Date(info.savedAt).toLocaleString('hu-HU')}` : 'üres';
    const sb = Object.assign(document.createElement('button'), { textContent: 'Mentés ide' });
    sb.onclick = () => { if (save(slot, 'manual')) renderSlots(`Mentve: ${slot}.`); };
    const lb = Object.assign(document.createElement('button'), { textContent: 'Betöltés', disabled: !info });
    lb.onclick = () => { save(); location.href = 'render.html?slot=' + slot; };
    row.append(`${slot.replace('slot', 'Hely ')}: ${label} `, sb, lb);
    root.append(row);
  }
  $('menuNote').textContent = note;
}
$('menuClose').onclick = () => $('menuDialog').close();
$('menuHome').onclick = () => { save(); location.href = 'index.html'; };
$('menuHelp').onclick = () => { $('menuDialog').close(); openDialog('helpDialog'); };
$('helpClose').onclick = () => $('helpDialog').close();

// ------------------------------------------------------------------ death
function showDeath(text) {
  $('deathText').textContent = text;
  openDialog('deathDialog');
}
$('deathLoad').onclick = () => { location.href = 'render.html'; };
$('deathNew').onclick = () => { location.href = 'index.html#new'; };

// --------------------------------------------------------------------- HUD
function bar(name, value, invert = false) {
  const pct = Math.round(value);
  const bad = invert ? pct < 30 : pct > 70;
  return `<div class="bar${bad ? ' bad' : ''}"><span>${name}</span><i style="width:${pct}%"></i><b>${pct}</b></div>`;
}
function renderHUD() {
  const d = state.chronoDevice, t = deviceTier(d), ll = localToLatLon(state.player.x, state.player.z), sv = state.survival;
  const locked = state.clock.experiencedHours < d.lockedUntilHours;
  const anchorsHere = state.anchors.filter(a => a.timelineId === state.timelineId).map(a => {
    const st = anchorStatus(a, state, world);
    return `<li class="${st.usable ? 'ok' : 'warn'}">⚓ ${a.name}: ${st.usable ? 'aktív' : st.reason.toLowerCase()} (${formatDate(a.placedAt, false)})</li>`;
  }).join('');
  $('lens').innerHTML = `<div class="date">${formatDate(date())}</div>
    <div>${ll.lat.toFixed(4)}° É, ${ll.lon.toFixed(4)}° K · ${WEATHER[weatherFor(date())]}</div>
    <div>Időgép ${t.id}: ${Math.round(d.charge * 100)}%${locked ? ` · ETR-zár ${Math.ceil(d.lockedUntilHours - state.clock.experiencedHours)} ó` : ''}</div>
    <div>${state.character.name} · ${biologicalAge(state).toFixed(2)} év · megélt idő ${state.clock.experiencedHours.toFixed(1)} ó</div>
    ${bar('Egészség', sv.health, true)}${bar('Éhség', sv.hunger)}${bar('Szomjúság', sv.thirst)}${bar('Fáradtság', sv.fatigue)}${sv.illness > 0 ? bar('Fertőzés', sv.illness) : ''}
    ${anchorsHere ? `<ul class="anchors">${anchorsHere}</ul>` : ''}`;
  if (performance.now() > toastUntil) {
    const n = nearestNPC();
    const obj = touchableObject(state, world);
    const w = world.waterSourceNear(state.player.x, state.player.z, date());
    $('talk').textContent = n ? `E – beszélgetés: ${n.name} (${n.activity.toLowerCase()})` : shopNear() ? 'E – vásárlás a szupermarketben' : w ? `E – ivás: ${w.name}${w.safe ? '' : ' (fertőzésveszély)'}` : obj ? `H – időhorgony elhelyezése: ${obj.name}` : '';
  }
}

// -------------------------------------------------------------------- loop
let frameError = null;
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  try {
    const paused = anyDialog() || state.survival.dead;
    if (!paused) {
      const p = state.player;
      const f = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
      const r = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      const inWater = world.isWater(p.x, p.z, date());
      const speed = (keys.has('shift') ? 9 : 5) * (inWater ? 0.4 : 1) * (state.survival.fatigue > 90 ? 0.6 : 1);
      const scale = (speed * dt) / Math.max(1, Math.hypot(f, r));
      const nx = p.x + (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * r) * scale;
      const nz = p.z + (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * r) * scale;
      if (!world.isBlocked(nx, p.z, date())) p.x = nx;
      if (!world.isBlocked(p.x, nz, date())) p.z = nz;
      handleDeath(advanceReal(state, dt));
      saveTimer += dt;
      if (saveTimer > AUTOSAVE_SECONDS) { saveTimer = 0; save(); }
    }
    npcTimer -= dt;
    if (npcTimer <= 0) { npcSnapshot = npcs.snapshot(date()); npcTimer = 0.5; }
    const anchors = state.anchors.filter(a => a.timelineId === state.timelineId).map(a => ({ id: a.id, objectId: a.objectId, usable: anchorStatus(a, state, world).usable, visible: world.objectExists(a.objectId, date()) }));
    renderer.update({ date: date(), player: state.player, npcs: npcSnapshot, anchors, thirdPerson, dt });
    renderHUD();
    frameError = null;
  } catch (e) {
    if (!frameError) console.error(e);
    frameError = e;
  }
  requestAnimationFrame(frame);
}

if (message) toast(message, 8);
else toast(`Üdv, ${state.character.name}! T – időgép, E – interakció, H – időhorgony, I – felszerelés, M – menü, F1 – súgó.`, 8);
if (state.survival.dead) showDeath(`A karakter halott (${state.survival.causeOfDeath || 'ismeretlen ok'}).`);
$('loading').remove();
requestAnimationFrame(frame);

// Inspection hook for automated tests; gameplay never uses it.
window.chronoverse = Object.freeze({
  get state() { return state; }, world, npcs, saves, timeScale: TIME_SCALE,
  validate: () => validateGameState(state),
  renderStats: () => ({ buildings: renderer.buildingCount, trees: renderer.treeCount, npcs: renderer.npcMeshes.size, center: renderer.center }),
});
