# CHRONOVERSE – Phase 0 repository audit

**Dátum:** 2026-11-26 · **Kiinduló commit:** `301cf35` (ChronoAnchor 3D) · **Ág:** `phase0-audit`

Ez a dokumentum a repository tényleges állapotát rögzíti az átvételkor. Minden állítás
futtatott ellenőrzésen alapul (Node 22 unit/adat-tesztek, Chromium headless + SwiftShader
WebGL böngészőteszt), kivéve ahol kifejezetten „kódolvasás alapján” szerepel.

## 1. Leltár

| Fájl | Méret | Szerep | Állapot |
|---|---:|---|---|
| `index.html` | 54 KB | Főoldal: beágyazott 3D iframe + ~20 fejlesztői panel, minden logika inline `<script>`-ben | Fut, konzolhiba nélkül. Játékindítóként nem használható (dashboard). |
| `render.html` | 15 KB | Three.js 3D prototípus (ChronoRender/Immersion/Integration/Anchor 3D) egyetlen minifikált modulban | Fut, konzolhiba nélkül. Lásd hibák. |
| `terrain.html` | 4 KB | Régi Canvas raycast terep (ChronoTerrain) | Fut, konzolhiba nélkül. Elavult, nincs mentése. |
| `js/chrono-db.js` | 2.8 KB | ChronoCore: manifeszt + JSON betöltés, séma- és függőségellenőrzés | Működik (16/16 modul érvényes). |
| `js/chrono-persistence.js` | 1.2 KB | ChronoPersistence: dashboard mentés (`lat/lon`) | Működik, de csak a dashboard állapotát menti. |
| `js/chrono-timeline.js` | 1.2 KB | ChronoTimeline: ágak, beavatkozásnapló, összeomlási kockázat | Működik, a játékvilágra nincs hatása. |
| `js/chrono-world.js` | 1.3 KB | ChronoWorld: épület build/destroy eseménynapló | Működik, a 3D világ nem olvassa. |
| `js/chrono-npc.js` | 3.0 KB | ChronoNPC + ChronoGenealogy: NPC-k, napirend, emlékek, születés, leszármazottak | Működik, a 3D NPC-k nem ezek. |
| `js/chrono-social.js` | 1.3 KB | ChronoSocial: kapcsolatok bizalomértékkel | Működik, csak dashboard. |
| `js/chrono-economy.js` | 1.6 KB | ChronoEconomy: tranzakciónapló pennyben | Működik, csak dashboard; jövedelem kézzel generálható. |
| `js/chrono-production.js` | 1.5 KB | ChronoProduction: receptek, készlet, technológiafa | Működik, csak dashboard; nyersanyag kézzel adható. |
| `js/chrono-survival.js` | 1.6 KB | ChronoSurvival: éhség/szomjúság/fáradtság/egészség, ETR | Működik, csak dashboard; a 3D karakterre nincs hatása. |
| `data/*.json` | 392 KB | 16 adatbázismodul | Lásd 2. pont. |

**Rendszerek (18 a korábbi jelentés szerint):** mind megtalálható, de csak a 3D-s négy
(Render, Immersion, Integration, Anchor 3D) kapcsolódik a látható játékvilághoz; a többi
egymástól független dashboard-szimulátor.

**Függőségek:** egyetlen külső függőség a Three.js 0.170.0, amelyet a `render.html`
a jsDelivr CDN-ről töltött. Ez offline / CDN-kiesés / céges proxy mögött a 3D-t teljesen
leállítja (a tesztkörnyezetben is blokkolt volt). **Javítva:** helyi másolat a
`vendor/three/` alatt (MIT licenc mellékelve).

## 2. Adatbázisok

`ChronoDB.audit()` a böngészőben és a `tests/data/data-integrity.test.mjs` Node-ban:
**16/16 modul érvényes, 808 rekord, 3 pénzrendszer.** A korábbi jelentés 811 rekordot
említett – a tényleges szám 808, és ez egyezik a manifeszt `expected_records` összegével.

| Modul | Rekord | Megjegyzés |
|---|---:|---|
| historical_landmarks | 20 | valós helyek, forrás-URL-lel, `anchor_eligibility` mezővel |
| historical_events | 40 | évhez kötött események |
| historical_settlements | 40 | modern koordináták + `temporal_validity` |
| historical_landscape_corridors | 12 | sematikus folyók/utak |
| epoch_landscape_profiles | 32 | 8 régió × 4 referenciakorszak, szöveges |
| building_archetypes | 48 | 4 korszak × 12 típus, prototípus alapméretekkel |
| npc_social_archetypes | 60 | szerepkör-sablonok napirenddel |
| chronoeconomy | 80 | 3 pénzrendszer (£sd, decimális £, csere) |
| chronoindustry | 54 | receptek, körmentes függőségi gráf (ellenőrizve) |
| chronosurvival | 60 | szükségletek, veszélyek, sérülések – paraméterek kalibrálatlanok |
| chronotransport | 46 | sebesség/kapacitás |
| chronolaw | 66 | jogi kutatási sablonok |
| chronofamily | 40 | rokonsági/öröklési sablonok |
| chronoculture | 88 | nyelv, ruházat, étkezés… |
| chrononature | 92 | flóra/fauna/időjárás |
| chronocausality | 30 | beavatkozás/terjedés/paradoxon sablonok |

Az ID-k a teljes adatkészletben egyediek, az ipari függőségek mind létező receptre mutatnak.
Az adatok többsége kifejezetten „sablon / ellenőrizendő” státuszú – ezt a mezők jelzik,
nem hiba.

## 3. Futásidejű teszt (headless Chromium, WebGL SwiftShader)

* `index.html`, `render.html`, `terrain.html`: **0 JavaScript-hiba**, 0 sikertelen kérés
  (a Three.js-t a teszt helyi fájlból szolgálta ki). Az `index.html` egy figyelmeztetést ad
  (`allow` + `allowfullscreen` együtt az iframe-en) – ártalmatlan.
* A 3D jelenet renderel, a HUD frissül, a nap/éjszaka és időjárás működik.

### Időugrás-mérés a kiinduló `render.html`-en (friss állapot, Mk0, cél: X=0, Z=0)

| Célév | Kísérlet | Sikeres | Elutasítva |
|---|---:|---:|---|
| 2002 | 20 | **0** | 20 × „Érvénytelen cél” – a 2002-es cél 30,0001 év (lásd B1) |
| 2003 | 30 | **1** | 22 × nincs biztonságos érkezés (B3), 7 × időbeli eltérés a hatótávon kívül (B2) |

Vagyis a kiinduló prototípusban **a tervezett első időugrás (2032 → 2002) gyakorlatilag
nem hajtható végre.**

## 4. Hibajegyzék

Súlyosság: **K** = kritikus (alapjáték nem működik), **M** = magas, **K-K** = közepes, **A** = alacsony.

| # | Súly | Hely | Hiba | Állapot |
|---|---|---|---|---|
| B1 | K | render.html | A megélt idő a történelmi dátumot folyamatosan növeli (2032,0001…), ezért a 2002-es cél 30 évnél távolabb van, és az Mk0 elutasítja. A tervezett első ugrás nem indítható. | **Javítva (PR #1):** 1 éven belüli túllépésnél a cél a hatótáv határára igazodik. Phase 1-ben az új ChronoNavigation kezeli. |
| B2 | M | render.html, index.html | Az időbeli pontatlanság a hatótávon kívüli érkezést eredményezhet; a render ilyenkor megszakítja az ugrást (≈23%), a dashboard pedig **végrehajtja** (szabálysértés: >30 év). | **Javítva (PR #1):** az érkezés a hatótávra van szorítva mindkét helyen. |
| B3 | K | render.html | 20 km-es Mk0 helyhiba vs. 4 × 4 km-es pálya: az ugrások ≈73%-a „nincs biztonságos érkezés” miatt megszakad. (Ismert probléma 27.3.) | **Javítva (PR #2):** világstreaming, határtalan determinisztikus terep; 200/200 sikeres első ugrás. |
| B4 | M | render.html | A fejlesztési szint (Mk0–Mk3) a játékos számára szabadon választható a játékban → az Mk3 azonnal elérhető. | **Javítva (PR #2):** a szint a GameState része, csak a debug oldalon állítható. |
| B5 | M | mind | 10 különálló localStorage-kulcs (`chronoverse.save.v1`, `…render.navigation.v1`, `…render.anchors.v1`, `…survival.v1`, `…economy.v1`, `…production.v1`, `…npcs.v1`, `…social.v1`, `…world.v1`, `…timelines.v1`); a 3D és a dashboard két külön játékost/időgépet kezel (x/z méter vs. lat/lon). | **Javítva (PR #2):** egységes GameState + SaveManager + migráció. |
| B6 | M | render.html | Eltérő időskálák: 3D-ben 1 valós mp = 1 játékperc, a dashboardon 1 valós mp = 1 játékóra (auto) vagy gombnyomásra 8 óra; a 3D a túlélési állapotot nem frissíti. | **Javítva (PR #2):** egységes GameClock. |
| B7 | M | render.html | A 3D NPC-k 8 fix nevű dísz-objektum szinuszpályán; nincs kapcsolat a ChronoNPC adatokkal, emlékkel, korral, szereppel. | **Javítva (PR #2):** determinisztikus, perzisztens lakók, emlékek a GameState-ben. |
| B8 | K-K | render.html | Az épületek a dátumból 4 korszakra képzett indexből épülnek (`epoch()`), nincs egyedi azonosítójuk és érvényességi intervallumuk; 1435 és 1750 között semmi sem változik. (27.2) | **Javítva (PR #2):** épületek egyedi ID-val, `from/to` évvel, archetípus-hivatkozással. |
| B9 | K-K | render.html | Az időhorgony nincs idővonalhoz kötve, csak a `church` ID-t fogadja el, a koordinátái (65, −28) beégetettek, és a mentésből csak ezt az egyet tölti vissza. | **Javítva (PR #2).** |
| B10 | K-K | render.html | Az ETR, a karakterhalál és a túlélés a 3D-ben nem létezik; a dashboard ETR-je a 3D állapotot nem érinti. | **Javítva (PR #2).** |
| B11 | K-K | index.html | A főoldal fejlesztői dashboard; a játék egy iframe-ben fut, amely a billentyűzetet/egérzárolást rosszul kapja. (Követelmény: játékindító + külön debug felület.) | **Javítva (PR #2).** |
| B12 | A | index.html | A szintnevek eltértek a tervtől („Alapgép, Mk II, Mk III, Mk IV”). | **Javítva (PR #1):** Mk0–Mk3. |
| B13 | A | render.html | Az út doboza (0,08 m) részben a terep alá lóg (z-fighting / eltűnő út). | **Javítva (PR #1).** |
| B14 | A | render.html | Kétszer van `#night` kezelő regisztrálva (az első felülíródik); `#era` rejtett select a valós állapot hordozója. | **Megszűnt (PR #2).** |
| B15 | A | js/chrono-npc.js | Az NPC csak a létrehozási évétől (`created`) létezik, így egy 1400-ban született, 1435-ben létrehozott NPC 1420-ban nem látható. | Dokumentálva; a 3D NPC-modell (PR #2) a születési dátumot használja, a régi modul változatlan. |
| B16 | A | render.html | A térbeli távolság lokális euklideszi; a terv geodéziai távolságot ír elő. | **Javítva (PR #2):** haversine. |
| B17 | A | render.html | A Three.js CDN-függőség (lásd 1. pont). | **Javítva (PR #1):** `vendor/three/`. |

## 5. Mentési formátumok (kiinduló állapot)

| Kulcs | Író | Tartalom |
|---|---|---|
| `chronoverse.save.v1` | index.html (ChronoPersistence) | `{version:1, timeline:"local-main", savedAt, state:{year,lat,lon,charge,jumps,anchors:[{year,lat,lon}]}, tier}` |
| `chronoverse.render.navigation.v1` | render.html | `{year, charge, jumps, tier, x, z}` – 5 mp-enként |
| `chronoverse.render.anchors.v1` | render.html | `[{id:"church", year, x:65, z:-28}]` |
| `chronoverse.survival.v1` | ChronoSurvival | `{version:1, players:{<branch>:{hours,hunger,thirst,fatigue,health,injury,illness,recallUntil,dead}}}` |
| `chronoverse.economy.v1` | ChronoEconomy | `{version:1, events:[{branch,year,owner,kind,cash,item,quantity}]}` |
| `chronoverse.production.v1` | ChronoProduction | `{version:1, sites:{"[branch,year]":{stock,unlocked,hours}}}` |
| `chronoverse.npcs.v1` | ChronoNPC | `{version:1, people:[{id,branch,label,born,created,death,role,roleId,home,work,parents?,memories}]}` |
| `chronoverse.social.v1` | ChronoSocial | `{version:1, events:[{branch,year,a,b,kind,delta}]}` |
| `chronoverse.world.v1` | ChronoWorld | `{version:1, events:[{branch,year,type,id,name,x,y}]}` |
| `chronoverse.timelines.v1` | ChronoTimeline | `{version:1, branches:[{id,parent,state,tier,events,collapsed}]}` |

## 6. Tesztalap

* `npm test` – Node beépített tesztfuttató, függőség nélkül (`tests/unit`, `tests/data`).
* `npm run test:browser` – Playwright + Chromium füstteszt (`tests/browser/smoke.mjs`):
  betölti az oldalakat egy helyi szerverről, gyűjti a konzolhibákat, és végigjátssza az
  alapfolyamatot.
* GitHub Actions: `.github/workflows/test.yml` mindkettőt futtatja.

## 7. Futtatás helyben

```bash
python3 -m http.server 8123   # a repo gyökerében
# böngésző: http://localhost:8123/
npm test                      # unit + adat
npm run test:browser          # böngészős füstteszt (Playwright szükséges)
```

A `file://` megnyitás nem működik (a JSON-ok `fetch`-csel töltődnek, az ES-modulok CORS-t igényelnek).
