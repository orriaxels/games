# Leikir

Barnvænir leikir á íslensku sem eru settir upp á síma sem vefapp (PWA). Engin app-verslun nauðsynleg.

Upphafssíðan býður upp á tvo leiki:

**Námuleit** (`namuleit/`)
- **Ýttu** til að grafa, **haltu inni** til að flagga (eða skiptu stóra takkanum yfir í *Flagga*)
- Fyrsta ýtingin er alltaf örugg
- Ýttu á tölu til að sjá hvaða 8 reiti hún telur

**Sudoku** (`sudoku/`)
- Veldu reit og ýttu svo á tölu, ⌫ strokar út
- Rangar tölur verða rauðar og eru taldar sem villur
- Þraut sem er ekki búin vistast, svo það má loka appinu og halda áfram seinna

Báðir leikir eru með Létt / Miðlungs / Erfitt og 🏆 takka sem sýnir metið á hverju stigi og síðustu leiki.
Metin eru geymd í vafranum á hverjum síma fyrir sig (ekki á netinu), svo hvert barn á sín eigin met.
Ef vafragögnum (website data) er eytt í stillingum símans hverfa metin líka.

## Setja upp á símunum

Slóðin er `https://orriaxels.github.io/leikir/`

- **iPhone:** opnaðu hlekkinn í **Safari** → Deila-takkinn → **Add to Home Screen** (*Bæta á heimaskjá*).
- **Android:** opnaðu hlekkinn í **Chrome** → ⋮ valmynd → **Install app** (eða *Add to Home screen*).

Opnaðu appið einu sinni með nettengingu. Eftir það virkar það án nets.

## Uppfærslur

Ýttu breytingum á GitHub og hækkaðu `CACHE` í `sw.js` (t.d. `leikir-v2`).
Ný skrá þarf líka að fara í `ASSETS` listann í `sw.js` svo hún virki án nets.
Símarnir ná í nýju útgáfuna næst þegar appið er opnað, eða þar á eftir.

## Skipulag

- `index.html`: upphafssíðan
- `common.css`, `common.js`: útlit og hjálparföll sem allar síðurnar nota (met, sprettigluggar, geymsla)
- `namuleit/`, `sudoku/`: leikirnir
- `sw.js`, `manifest.json`: uppsetning og offline-virkni

## Keyra á eigin tölvu

Hvaða einfaldi vefþjónn sem er dugar, t.d. `npx serve .`, og opnaðu svo slóðina sem birtist.
