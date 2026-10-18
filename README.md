# Leikir

Barnvænir leikir á íslensku sem eru settir upp á síma sem vefapp (PWA). Engin app-verslun nauðsynleg.

Upphafssíðan býður upp á fimm leiki:

**Minesweeper** (`namuleit/`)
- **Ýttu** til að grafa, **haltu inni** til að flagga (eða skiptu stóra takkanum yfir í *Flagga*)
- Fyrsta ýtingin er alltaf örugg
- Ýttu á tölu til að sjá hvaða 8 reiti hún telur

**Sudoku** (`sudoku/`)
- Tvær stærðir: venjulegt 9×9, og lítið 6×6 (tölurnar 1 til 6, 2×3 kassar) fyrir yngri krakka
- Veldu reit og ýttu svo á tölu, ⌫ strokar út
- Rangar tölur sjást ekki strax: þegar allir reitir eru fylltir verða röngu tölurnar rauðar og eru taldar sem villur
- Þraut sem er ekki búin vistast, svo það má loka appinu og halda áfram seinna

**Reiknigáta** (`reiknigata/`)
- Krossgáta með tölum þar sem jöfnurnar krossast, fylltu í auðu reitina
- Veldu hvaða merki eru með: + − × ÷ (a.m.k. eitt)
- Þegar jafna er fyllt verða merkin græn ef hún er rétt en rauð ef hún er röng
- Hægt er að leysa hverja gátu eina jöfnu í einu og hún hefur bara eina lausn
- Létt: 3×3 ferningur (6 jöfnur), tölur upp í 20, 3 auðir reitir
- Miðlungs: ný krossgáta í hvert sinn, 7 jöfnur, tölur upp í 50, 7 auðir reitir
- Erfitt: ný krossgáta í hvert sinn, 10 jöfnur, tölur upp í 100, 10 auðir reitir

**Crowd Runner** (`crowd/`)
- Hópurinn hleypur af stað; dragðu hann til hliðar til að velja hlið (+10, ×2, −5, ÷2 …)
- Bláu hliðin stækka hópinn, rauðu minnka hann. Oft þarf að reikna hvort hliðið gefur meira
- Rauðir hópar á veginum berjast einn á móti einum, broddar skera af hópnum, og í lokin er kastali: komdu með fleiri en eru í honum
- 40 borð sem þyngjast smám saman (fleiri hlið og bardagar, svo −, ÷, broddar og broddar á ferð).
  Hvert borð er alltaf eins, að klára það opnar það næsta og gefur 1–3 stjörnur eftir því hversu margir eru eftir
- Stærð kastalans er fundin með því að spila borðið mörgum sinnum í tölvunni sem krakki sem velur oftast rétt

**Tetris** (`tetris/`)
- Kubbarnir detta í brunninn; full röð hverfur og gefur stig (fleiri raðir í einu gefa meira, 4 í einu er TETRIS)
- Takkarnir undir borðinu: færa til vinstri/hægri, hraðar niður, alla leið niður og snúa.
  Líka hægt að ýta á borðið til að snúa, draga til að færa og strjúka hratt niður til að sleppa.
  Á tölvu: örvar, upp eða X snýr, bil sleppir, P gerir hlé
- Létt / Miðlungs / Erfitt ræður byrjunarhraðanum (1, 4 eða 8) og hraðinn eykst um einn á hverjum 10 röðum
- Leikur sem er ekki búinn vistast, svo það má loka appinu og halda áfram seinna

Allir leikirnir eru með Létt / Miðlungs / Erfitt og 🏆 takka sem sýnir metið á hverju stigi og síðustu leiki.
Metin eru geymd í vafranum á hverjum síma fyrir sig (ekki á netinu), svo hvert barn á sín eigin met.
Ef vafragögnum (website data) er eytt í stillingum símans hverfa metin líka.

## Stigatafla (sameiginleg)

Krakkarnir geta keppt sín á milli: hver sigur sendir tímann (stjörnur í Crowd Runner, stig í Tetris) á sameiginlega stigatöflu
(🏅 takkinn á upphafssíðunni). Hún er geymd í ókeypis [Supabase](https://supabase.com) gagnagrunni.

Uppsetning (einu sinni):
1. Búðu til aðgang og nýtt verkefni (project) á supabase.com.
2. **SQL Editor** → límdu inn `leaderboard.sql` → **Run**.
3. **Project Settings → API Keys**: afritaðu slóðina (Project URL) og **publishable** lykilinn
   (eða eldri „anon public“ lykilinn) í `leaderboard-config.js`.
   Aldrei setja **secret** / **service_role** lykilinn þangað, skráin er opinber.

Lykillinn má sjást, en þá getur hver sem er lesið nöfnin og bætt við tímum. Notið gælunöfn.
Hægt er að eyða tímum í **Table Editor** í Supabase.

## Setja upp á símunum

Slóðin er `https://orriaxels.github.io/games/`

- **iPhone:** opnaðu hlekkinn í **Safari** → Deila-takkinn → **Add to Home Screen** (*Bæta á heimaskjá*).
- **Android:** opnaðu hlekkinn í **Chrome** → ⋮ valmynd → **Install app** (eða *Add to Home screen*).

Opnaðu appið einu sinni með nettengingu. Eftir það virkar það án nets.

## Uppfærslur

Ýttu breytingum á GitHub og hækkaðu `CACHE` í `sw.js` (t.d. `leikir-v6`).
Ný skrá þarf líka að fara í `ASSETS` listann í `sw.js` svo hún virki án nets.
Þegar síminn er á netinu sækir appið alltaf nýjustu skrárnar, og þegar það kemur
aftur á skjáinn athugar það hvort ný útgáfa sé komin og endurhleður sig þá sjálft.

## Skipulag

- `index.html`: upphafssíðan
- `common.css`, `common.js`: útlit og hjálparföll sem allar síðurnar nota (met, sprettigluggar, geymsla)
- `namuleit/` (Minesweeper), `sudoku/`, `reiknigata/`, `crowd/` (Crowd Runner), `tetris/`: leikirnir
- `sw.js`, `manifest.json`: uppsetning og offline-virkni

## Keyra á eigin tölvu

Hvaða einfaldi vefþjónn sem er dugar, t.d. `npx serve .`, og opnaðu svo slóðina sem birtist.
