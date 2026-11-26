# Phase 1 – ChronoWorldSync

**Ág:** `phase1-worldsync` (a `phase0-audit`-ra épül) · **Dátum:** 2026-11-26

A cél: a széttagolt prototípusmotorok helyett **egyetlen játékállapot, egyetlen játékóra
és egyetlen mentés**, a 3D világ mint fő felhasználói felület.

## 1. Mi változott a játékos számára

| Oldal | Korábban | Most |
|---|---|---|
| `index.html` | ~20 fejlesztői panel + beágyazott 3D iframe | **Játékindító:** Folytatás, kézi mentések betöltése, új karakter (név, nem, életkor, magasság, testsúly, háttér → képzettség és nyelvtudás) |
| `render.html` | 3D prototípus, a dátumból 4 korszakot képez | **A játék:** teljes képernyős 3D világ, ChronoLens HUD, időgép, felszerelés, menü/mentés, súgó |
| `debug.html` | – | A régi dashboard változatlanul + egységes GameState-szerkesztő (szint, dátum, töltés, JSON le-/feltöltés, eseménynapló) |
| `terrain.html` | a főoldalra mutatott | csak a debug oldalról érhető el |

Irányítás: **WASD** mozgás, **Shift** futás, **egér** nézés (kattintás után), **E** beszélgetés /
ivás / vásárlás, **T** időgép, **H** időhorgony, **I** felszerelés és alvás, **V** első/harmadik
személyű nézet, **M** menü és mentés, **F1** súgó, **Esc** egér elengedése.

## 2. Architektúra

Build-lépés nélküli ES-modulok a `src/` alatt; ugyanazokat importálja a játék, az indító,
a debug oldal és a Node-os tesztek.

```text
src/
  core/        GameState, GameClock, SaveManager, EventBus, time, random
  navigation/  ChronoNavigation (Mk0–Mk3, hard cap), ChronoAnchor, EmergencyRecall
  world/       WorldModel (terep, folyó, utak, épületek, fák), geo (lat/lon, haversine)
  characters/  NPCManager (lakók, családok, napirend, emlékek)
  survival/    Survival (szükségletek, fogyasztás, ivóvíz-kockázat)
  rendering/   WorldRenderer (Three.js, világstreaming)
  game.js      a render.html belépési pontja: input, HUD, párbeszédablakok, főciklus
vendor/three/  Three.js 0.170.0 (MIT)
```

A szabályok (navigáció, óra, túlélés, világ, NPC) tiszta függvények, nem érintik a DOM-ot
vagy a tárolót – ezért Node-ban unit-tesztelhetők, és később UE5-re portolhatók.

## 3. Egységes GameState (`src/core/GameState.js`)

```text
schemaVersion, worldId, timelineId, timelines[]
character   { id, name, sex, ageYears (induló), heightCm, weightKg, background, attributes, languages, skills }
clock       { historicalDate (tizedes csillagászati év), experiencedHours, realPlaySeconds }
player      { x, z, yaw, pitch }            – helyi méter; -Z = észak; lat/lon a geo.js-ből
survival    { hunger, thirst, fatigue, health, injury, illness, dead, causeOfDeath }
inventory   { ration, water, … }
finances    { GBP_DECIMAL_PENCE }
properties  []
chronoDevice{ model, tier 0–3, charge 0–1, successfulJumps, lockedUntilHours (ETR), lastJump }
anchors     [{ id, objectId, name, timelineId, placedAt, placedExperiencedHours, destroyed }]
npcs        { memories: { npcId: [{ date, experiencedHours, timelineId, kind }] } }
events      [{ id, seq, type, timelineId, historicalDate, experiencedHours, affected[], causes[], data }]
```

A biológiai életkor nincs tárolva, hanem származtatott: `ageYears + experiencedHours / 8765.82`,
így nem kerülhet ellentmondásba. Egyetlen modul sem tart saját másolatot.

## 4. Időmodell (`src/core/GameClock.js`)

| Mennyiség | Hol | Szabály |
|---|---|---|
| Valós idő | `clock.realPlaySeconds` | csak statisztika |
| Megélt idő | `clock.experiencedHours` | `TIME_SCALE = 60` → 1 valós mp = 1 játékperc (kalibrálható); menük alatt áll |
| Történelmi dátum | `clock.historicalDate` | a megélt idővel együtt halad; ugrani csak a ChronoNavigation tud |
| Biológiai életkor | származtatott | csak a megélt idő növeli – a múltba utazás nem fiatalít |
| Időgép töltése | `chronoDevice.charge` | 24 megélt óra = teljes töltés (8 óra ≈ egy 10 éves Mk0-ugrás); ETR-zárolás alatt nem tölt |
| Szükségletek | `survival` | óránként léptetve (éhség +2, szomj +3, fáradtság +2 / alvás −8) |
| Napszak, időjárás | származtatott | a dátumból; az időjárás naponként determinisztikus |

A dashboard és a 3D eltérő időskálája (B6) így megszűnt: mindent ugyanaz az `advanceTime` léptet.

## 5. Mentés (`src/core/SaveManager.js`)

* Kulcsok: `chronoverse.game.v1.autosave`, `…slot1`, `…slot2`, `…slot3`.
* Dokumentum: `{ format: "chronoverse-save", savedAt, label, summary, state }`.
* Mentés előtt és betöltés után sémaellenőrzés; hibás állapotot nem ír ki, sérült mentést nem tölt be.
* Automatikus mentés: 30 mp-enként, időugrás, horgony, alvás után, és az oldal elhagyásakor.
  Halál után az automatikus mentés nem íródik felül, így a halál előtti állapot visszatölthető.
* **Migráció:** ha nincs egységes mentés, de vannak régi `chronoverse.render.navigation.v1` /
  `…render.anchors.v1` / `…survival.v1` kulcsok, ezekből egyszer létrejön a GameState.
  A többi régi kulcs a debug oldal próbatereié marad.

## 6. Időutazás (`src/navigation/`)

* Mk0–Mk3 tábla a tervdokumentum szerint; a `HARD_LIMIT` (50 év / 500 km) minden számításban
  `Math.min`-nel érvényesül, a fejlesztési szint a játékban nem választható (csak debugban).
* Térbeli hatótáv **geodéziai** (haversine) távolsággal, a helyi sík az 52,62° É, 1,73° K origó körül.
* Időbeli hiba: `±timeError × errorFactor`, majd a hatótávra szorítva – az érkezés soha nincs kívül.
* Ha a cél legfeljebb 1 évvel van a hatótávon túl, a hatótáv határára igazodik (B1).
* Energia: `ugrás évei / szint évei` (Mk0: 30 év = 100%, 10 év = 33%).
* Biztonságos érkezés: víz, fal, fa, objektum kizárva; 150 m-es spirálkeresés 10 m-es lépéssel;
  ha nincs hely, az ugrás megszakad, energia nem fogy. A keresés sem léphet ki a hatótávból.
* Időhorgony: tartós, horgonyozható objektumon (templom, torony) **H**-val; az objektum ID-jához,
  az idővonalhoz és az elhelyezés dátumához kötött; csak az elhelyezéstől érvényes, amíg az
  objektum létezik; −95% térbeli hiba; a ChronoLens listázza és jelzi az állapotát, a jelölő
  a 3D-ben látható (kék = aktív, narancs = ebben az időben nem használható).
* ETR: halálos állapotnál 90% eséllyel visszahív 2032-be (a „jelen” a megélt idővel halad),
  nem gyógyít (egészség 5), 48 megélt órára zárolja az időgépet, 0% töltés. 10% meghibásodás
  és a zárolás alatti újabb halálos állapot karakterhalált okoz. (Helyőrző értékek, §7.)

## 7. Világ (`src/world/WorldModel.js`, `src/rendering/WorldRenderer.js`)

* **Világstreaming:** a terep, folyó, út és növényzet 1,6 km-es ablakban generálódik a játékos
  körül, 200 m-enként újraközpontosítva. A determinisztikus világ így gyakorlatilag határtalan,
  és a 20 km-es Mk0 helyhiba sem szakítja meg az ugrásokat (B3).
* **Épületek egyedi ID-val és érvényességi intervallummal** (`from`/`to`), mindegyik a
  `data/building_archetypes.json` egy rekordjára hivatkozik. 12 telek háromszor épül újra
  (parasztház → sor-/farmház → családi ház) eltérő, hash-alapú években; templom 1120-tól,
  torony 1350-től, udvarház → villa, fogadó → kocsma → közösségi ház, kovácsműhely → műhely →
  javítóműhely, szélmalom, vízimalom, gyár → logisztikai csarnok, kút, szivattyúház, iskola,
  szupermarket, híd (1300-tól). 1100 és 2032 között évtizedenként >25 különböző faluállapot (B8).
* **Építés/bontás eseményként:** `BUILDING_CONSTRUCTED` / `BUILDING_DESTROYED` az aktív
  idővonalon; a világ ezekből számolja az állapotot (tesztelve, UI még nincs hozzá).
* Rétegek: a statikus falu `layer: "reconstructed"`, a játékos változtatásai `layer: "simulated"`.
* Fák: 30 m-es cellánként determinisztikusak; az ősi erdő 900 és 2000 között fokozatosan kivágódik.
* Folyó: kanyargó meder; vízbe nem lehet érkezni, gázolni lassan lehet; a híd 1300-tól.

## 8. NPC-k (`src/characters/NPCManager.js`)

* A lakók determinisztikus „születési slotokból” jönnek létre (6 évente egy), így bármely dátum
  igény szerint rekonstruálható, tárolás nélkül. ID, név, nem, születés, halál, szülők
  (korábbi slot), háztartás, szerep a `npc_social_archetypes.json`-ból, napirend, otthon és
  munkahely (létező épületek).
* A vezetéknév apáról fiúra öröklődik (1300 után), így évszázadokkal később ugyanazok a
  családok élnek a faluban. Kr. e. 9000-ben a vadásztábor lakói láthatók, a lakatlan
  korokban (Kr. e. 8600 – Kr. u. 1120) nincs senki.
* A 3D figurák ezeket a rekordokat jelenítik meg (gyerekek kisebbek, korszakfüggő ruhaszín),
  alvás közben nem láthatók (B7).
* **Emlékezet:** az NPC emlékszik a korábbi beszélgetésekre (GameState-ben), felejt
  (`exp(−évek/30)`), észreveszi, ha a játékos nem öregedett; a múltjában még nem ismeri a játékost.
* A ChronoLens fordítást jelez (középangol / angol → magyar; őskori nyelvnél nincs fordítás).

## 9. Túlélés és gazdaság a 3D-ben

* Éhség, szomjúság, fáradtság, egészség, fertőzés a HUD-on, a közös órával változik.
* Felszerelés (**I**): tápláléktabletta, palackos víz, várakozás 1 óra, alvás 8 óra.
* Ivás (**E**) kútnál, szivattyúháznál, ivókútnál vagy a folyónál; 1900 előtt 25% fertőzésveszély,
  amelyet a ChronoSuit lassan kezel.
* Vásárlás (**E**) a szupermarketben 1985-től – a játékos 2032-es decimális fontja 1971 előtt
  értéktelen. Ez a gazdasági rendszer első, szándékosan kicsi 3D-bekötése.

## 10. Tesztek

| Parancs | Tartalom | Eredmény (2026-11-26) |
|---|---|---|
| `npm test` | 46 Node-teszt: adatintegritás (16 modul), GameState, óra, mentés/migráció, navigáció (200 seed: az első 2032 → 2002 ugrás mindig sikeres), horgonyok, ETR, világ, NPC-k, régi modulok | **46/46** |
| `npm run test:browser` | Headless Chromium: debug/terrain oldalak, majd a §40 elfogadási feltételek 1–16 végigjátszva a valós UI-val és billentyűzettel, horgonyos visszatérés, ETR, mentés/visszatöltés, régi mentés migrációja, konzolhibák | **34/34 ellenőrzés** |

A GitHub Actions mindkettőt futtatja.

## 11. Ismert hibák és korlátozások

* **Teljesítmény nincs valós GPU-n mérve.** SwiftShaderrel (CPU-raszter) ~9 FPS; ez nem
  reprezentatív. A fák instancingot használnak, az épületek viszont külön mesh-ek.
* A grafika továbbra is egyszerű geometria (§27.7 változatlan).
* Az épülettörténet a szintetikus faluhoz készült rekonstrukció, nem felmért történeti adat.
* Az NPC-k nem kereskednek, nem házasodnak a játékossal; a családfa csak a slotokból adódik.
  A régi `js/chrono-npc.js` / `chrono-social.js` próbaterek még nincsenek egyesítve ezzel.
* A termelés (`chrono-production`) és a régi gazdasági napló nincs a GameState-be kötve; a 3D-ben
  csak a szupermarket és a 2032-es pénz működik. Munkavállalás még nincs.
* Építési UI nincs; az építés/bontás csak eseményként (és tesztben) működik.
* Idővonal-elágazás nincs a játékban (a GameState és az események már idővonal-azonosítót hordoznak).
* Az ETR energiafeltételei és meghibásodási modellje helyőrző.
* `TIME_SCALE`, szükségleti ráták, árak: kalibrációs értékek.
* A régi dashboard (`debug.html`) próbaterei továbbra is a saját régi kulcsaikat használják.

## 12. Futtatás

```bash
git checkout phase1-worldsync
python3 -m http.server 8123        # vagy: npm run serve
# böngésző: http://localhost:8123/  → Új karakter → Indulás
npm test                           # Node 22
npm run test:browser               # Playwright + Chromium
```

GitHub Pages-en a merge után: `https://scarab0793.github.io/chronoverse/`.
