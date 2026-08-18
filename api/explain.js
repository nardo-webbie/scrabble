const UA = 'scrabble-checker-nl/1.0 (+https://vercel.com; contact via project owner)';

const POS_HEADERS = new Set([
  'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk naamwoord', 'bijwoord',
  'voornaamwoord', 'telwoord', 'voegwoord', 'voorzetsel', 'tussenwerpsel',
  'lidwoord', 'eigennaam', 'achtervoegsel', 'voorvoegsel',
]);

function normHeading(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*\d+$/, ''); // "zelfstandig naamwoord 2" -> "zelfstandig naamwoord"
}

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

// Zoek de eerste woordsoort-sectie die bij het Nederlandse taalblok hoort (niet bij een
// eventueel ander-talig blok verderop op dezelfde pagina).
async function findPosSectionIndex(candidate) {
  const data = await fetchJson('https://nl.wiktionary.org/w/api.php?action=parse&page='
    + encodeURIComponent(candidate) + '&prop=sections&format=json&redirects=1');
  const sections = data && data.parse && data.parse.sections;
  if (!sections || !sections.length) return null;

  const nlIdx = sections.findIndex(s => normHeading(s.line) === 'nederlands' && s.toclevel === 1);
  const searchFrom = nlIdx === -1 ? 0 : nlIdx + 1;
  const searchTo = sections.findIndex((s, i) => i > searchFrom && s.toclevel === 1);
  const slice = sections.slice(searchFrom, searchTo === -1 ? undefined : searchTo);

  const match = (nlIdx === -1 ? sections : slice).find(s => POS_HEADERS.has(normHeading(s.line)));
  if (!match) return null;

  return { index: match.index, heading: match.line, pageTitle: data.parse.title };
}

async function extractDefinitionFromSection(candidate, sectionIndex) {
  // Gerenderde HTML van alleen deze sectie ophalen — templates, audiospelers, etc. zijn dan al
  // door Wiktionary zelf omgezet, dus we hoeven alleen de eerste <li> van de definitielijst te lezen.
  const data = await fetchJson('https://nl.wiktionary.org/w/api.php?action=parse&page='
    + encodeURIComponent(candidate) + '&section=' + encodeURIComponent(sectionIndex)
    + '&prop=text&format=json&redirects=1');
  const html = data && data.parse && data.parse.text && data.parse.text['*'];
  if (!html) return null;

  const match = html.match(/<ol[^>]*>[\s\S]*?<li[^>]*>([\s\S]*?)(?:<li[^>]*>|<\/ol>|<ol[^>]*>)/);
  if (!match) return null;

  const cleaned = stripTags(match[1]).replace(/\[\d+\]/g, '').trim();
  return (cleaned && cleaned.length >= 3) ? cleaned : null;
}

async function tryStructuredLookup(candidate) {
  const section = await findPosSectionIndex(candidate);
  if (!section) return null;
  const defText = await extractDefinitionFromSection(candidate, section.index);
  if (!defText) return null;
  return {
    found: true,
    title: section.pageTitle || candidate,
    extract: '(' + section.heading + ') ' + defText,
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
