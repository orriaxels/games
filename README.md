# Leikir

Barnvænir leikir á íslensku sem eru settir upp á síma sem vefapp (PWA). Engin app-verslun nauðsynleg.

Upphafssíðan býður upp á þrjá leiki:

**Minesweeper** (`namuleit/`)
- **Ýttu** til að grafa, **haltu inni** til að flagga (eða skiptu stóra takkanum yfir í *Flagga*)
- Fyrsta ýtingin er alltaf örugg
- Ýttu á tölu til að sjá hvaða 8 reiti hún telur

**Sudoku** (`sudoku/`)
- Veldu reit og ýttu svo á tölu, ⌫ strokar út
- Rangar tölur verða rauðar og eru taldar sem villur
- Þraut sem er ekki búin vistast, svo það má loka appinu og halda áfram seinna

**Reiknigáta** (`reiknigata/`)
- Krossgáta með tölum þar sem jöfnurnar krossast, fylltu í auðu reitina
- Veldu hvaða merki eru með: + − × ÷ (a.m.k. eitt)
- Þegar jafna er fyllt verða merkin græn ef hún er rétt en rauð ef hún er röng
- Hægt er að leysa hverja gátu eina jöfnu í einu og hún hefur bara eina lausn
- Létt: 3×3 ferningur (6 jöfnur), tölur upp í 20, 3 auðir reitir
- Miðlungs: ný krossgáta í hvert sinn, 7 jöfnur, tölur upp í 50, 7 auðir reitir
- Erfitt: ný krossgáta í hvert sinn, 10 jöfnur, tölur upp í 100, 10 auðir reitir

Allir leikirnir eru með Létt / Miðlungs / Erfitt og 🏆 takka sem sýnir metið á hverju stigi og síðustu leiki.
Metin eru geymd í vafranum á hverjum síma fyrir sig (ekki á netinu), svo hvert barn á sín eigin met.
Ef vafragögnum (website data) er eytt í stillingum símans hverfa metin líka.

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
- `namuleit/` (Minesweeper), `sudoku/`, `reiknigata/`: leikirnir
- `sw.js`, `manifest.json`: uppsetning og offline-virkni

## Keyra á eigin tölvu

Hvaða einfaldi vefþjónn sem er dugar, t.d. `npx serve .`, og opnaðu svo slóðina sem birtist.
