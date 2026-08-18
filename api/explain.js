const UA = 'scrabble-checker-nl/1.0 (+https://vercel.com; contact via project owner)';

// Wiktionary-ankers gebruiken underscores i.p.v. spaties, en zijn de HTML-id's van de
// woordsoort-koppen zoals ze op elke pagina voorkomen (zie WikiWoordenboek:Zelfstandig_naamwoord,
// WikiWoordenboek:Werkwoord, etc.).
const POS_ANCHORS = [
  'Zelfstandig_naamwoord', 'Werkwoord', 'Bijvoeglijk_naamwoord', 'Bijwoord',
  'Voornaamwoord', 'Telwoord', 'Voegwoord', 'Voorzetsel', 'Tussenwerpsel',
  'Lidwoord', 'Eigennaam', 'Achtervoegsel', 'Voorvoegsel',
];

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  return r.json();
}

// De sectie-index van de Action API is niet bruikbaar voor sjabloon-gegenereerde koppen
// (die krijgen allemaal dezelfde placeholder-index "T-1"). Daarom: één keer de volledige
// gerenderde pagina ophalen en daarin zelf op het HTML-anker zoeken.
async function tryStructuredLookup(candidate) {
  const data = await fetchJson('https://nl.wiktionary.org/w/api.php?action=parse&page='
    + encodeURIComponent(candidate) + '&prop=text&format=json&redirects=1');
  const html = data && data.parse && data.parse.text && data.parse.text['*'];
  if (!html) return null;

  // Alleen binnen het Nederlandse taalblok zoeken, niet in een eventueel ander-talig blok
  // verderop op dezelfde pagina.
  const nlIdx = html.indexOf('id="Nederlands"');
  if (nlIdx === -1) return null;
  const nextLangIdx = html.indexOf('mw-heading2', nlIdx + 1);
  const dutchBlock = html.slice(nlIdx, nextLangIdx === -1 ? undefined : nextLangIdx);

  let best = null;
  for (const anchor of POS_ANCHORS) {
    const i = dutchBlock.indexOf('id="' + anchor + '"');
    if (i !== -1 && (best === null || i < best.pos)) best = { pos: i, anchor };
  }
  if (!best) return null;

  const afterHeading = dutchBlock.slice(best.pos);
  const nextHeadingIdx = afterHeading.indexOf('mw-heading', 20);
  const sectionHtml = afterHeading.slice(0, nextHeadingIdx === -1 ? undefined : nextHeadingIdx);

  const match = sectionHtml.match(/<ol[^>]*>[\s\S]*?<li[^>]*>([\s\S]*?)(?:<li[^>]*>|<\/ol>|<ol[^>]*>)/);
  if (!match) return null;

  const cleaned = stripTags(match[1]).replace(/\[\d+\]/g, '').trim();
  if (!cleaned || cleaned.length < 3) return null;

  return {
    found: true,
    title: (data.parse && data.parse.title) || candidate,
    extract: '(' + best.anchor.replace(/_/g, ' ') + ') ' + cleaned,
    source: 'wiktionary-section',
    sourceUrl: 'https://nl.wiktionary.org/wiki/' + encodeURIComponent(candidate),
  };
}

module.exports = async (req, res) => {
  const word = (req.query.word || '').toString().trim();

  if (!word || word.length > 30 || !/^[a-zA-Z\u00C0-\u017F]+$/.test(word)) {
    res.status(400).json({ found: false, error: 'Ongeldig woord' });
    return;
  }

  const candidates = [
    word.toLowerCase(),
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  ];

  for (const candidate of candidates) {
    try {
      const result = await tryStructuredLookup(candidate);
      if (result) { res.status(200).json(result); return; }
    } catch (e) { /* volgende kandidaat proberen */ }
  }

  res.status(200).json({ found: false });
};
