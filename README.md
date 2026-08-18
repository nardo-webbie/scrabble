# Scrabble Checker NL

Nederlandse Scrabble-woordchecker met live tegelwaarden en woorduitleg.

## Structuur
- `index.html` — de pagina (tegel-UI, laadt de woordenlijst via CDN, geen build nodig)
- `api/explain.js` — Vercel serverless functie die een korte uitleg van het woord ophaalt via de Wiktionary REST API (server-side, dus geen CORS-gedoe)

## Woordenlijst
Wordt client-side geladen vanaf jsDelivr (CDN voor het npm-pakket `an-array-of-dutch-words`, ~164.000 woorden, afgeleid van de OpenTaal-woordenlijst). Geen losse databestanden nodig in dit project.

## Lokaal deployen naar Vercel

```bash
npm i -g vercel
cd scrabble-checker-nl
vercel deploy --prod
```

Of: push deze map naar een nieuwe GitHub-repo en koppel die repo in het Vercel-dashboard (New Project → Import Git Repository). Vercel herkent de `api/`-map automatisch als serverless functions, geen extra configuratie nodig.

## Let op
- Geldigheidscheck is gebaseerd op een algemene woordenlijst, niet het officiële Van Dale Scrabble-woordenboek.
- Woorduitleg komt van Wiktionary (nl.wiktionary.org) — niet altijd aanwezig voor elk woord.
