# Námuleit

Barnvænn námuleitarleikur sem er settur upp á síma sem vefapp (PWA). Engin app-verslun nauðsynleg.

- **Ýttu** til að grafa, **haltu inni** til að flagga (eða skiptu stóra takkanum yfir í *Flagga* og ýttu til að flagga)
- Fyrsta ýtingin er alltaf örugg
- Ýttu á tölu til að sjá hvaða 8 reiti hún telur
- Létt / Miðlungs / Erfitt, besti tími vistaður fyrir hvert stig
- Virkar án nettengingar eftir uppsetningu

## Birta (GitHub Pages, ókeypis)

1. Búðu til nýtt opinbert (public) repository á GitHub, t.d. `minesweeper`.
2. Ýttu þessari möppu þangað:
   ```
   git init
   git add .
   git commit -m "Námuleit"
   git branch -M main
   git remote add origin https://github.com/<þú>/minesweeper.git
   git push -u origin main
   ```
3. Á GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save**.
4. Eftir um mínútu er leikurinn kominn á `https://<þú>.github.io/minesweeper/`.

## Setja upp á símunum

- **iPhone:** opnaðu hlekkinn í **Safari** → Deila-takkinn → **Add to Home Screen** (*Bæta á heimaskjá*).
- **Android:** opnaðu hlekkinn í **Chrome** → ⋮ valmynd → **Install app** (eða *Add to Home screen*).

Opnaðu leikinn einu sinni með nettengingu. Eftir það virkar hann án nets.

## Uppfærslur

Ýttu breytingum á GitHub og hækkaðu `CACHE` í `sw.js` (t.d. `minesweeper-v2`).
Símarnir ná í nýju útgáfuna næst þegar appið er opnað, eða þar á eftir.

## Keyra á eigin tölvu

Hvaða einfaldi vefþjónn sem er dugar, t.d. `npx serve .`, og opnaðu svo slóðina sem birtist.
Það er hægt að spila með því að opna `index.html` beint, en uppsetning og offline-virkni virka þá ekki.
