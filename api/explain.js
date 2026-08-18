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

function cleanWikitext(line) {
  let s = line;
  s = s.replace(/\{\{\s*(?:context|contekst)\s*\|([^}]+)\}\}/gi, (_, args) => {
    const parts = args.split('|').filter(a => a && !/^(nld|nl)$/i.test(a.trim()));
    return parts.length ? '(' + parts.join(', ') + ')' : '';
  });
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'{2,3}/g, '');
  return s.replace(/\s+/g, ' ').trim();
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
  const data = await fetchJson('https://nl.wiktionary.org/w/api.php?action=parse&page='
    + encodeURIComponent(candidate) + '&section=' + encodeURIComponent(sectionIndex)
    + '&prop=wikitext&format=json&redirects=1');
  const wikitext = data && data.parse && data.parse.wikitext && data.parse.wikitext['*'];
  if (!wikitext) return null;

  const lines = wikitext.split('\n');
  const defLine = lines.find(l => /^#(?![#:*])\s*\S/.test(l.trim()));
  if (!defLine) return null;

  const cleaned = cleanWikitext(defLine.replace(/^#\s*/, ''));
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

async function tryDefinitionEndpoint(candidate) {
  const data = await fetchJson('https://nl.wiktionary.org/api/rest_v1/page/definition/'
    + encodeURIComponent(candidate));
  if (!data) return null;

  const langKey = ['nl', 'Nederlands', 'Dutch'].find(k => data[k] && data[k].length) || Object.keys(data)[0];
  const block = data[langKey];
  if (!block || !block.length) return null;

  const entry = block[0];
  const def = entry.definitions && entry.definitions[0];
  if (!def || !def.definition) return null;

  const defText = stripTags(def.definition);
  if (!defText || defText.length < 3) return null;

  const parts = [];
  if (entry.partOfSpeech) parts.push('(' + entry.partOfSpeech + ')');
  parts.push(defText);

  return {
    found: true,
    title: candidate,
    extract: parts.join(' '),
    source: 'wiktionary-definition',
    sourceUrl: 'https://nl.wiktionary.org/wiki/' + encodeURIComponent(candidate),
  };
}

// Laatste redmiddel: platte-tekst extract, met een genummerde regel als voorkeur en een
// blacklist van bekende kop-achtige regels zodat we niet weer "Nederlands" oppikken.
const HEADER_LIKE = new Set([
  'nederlands', 'engels', 'duits', 'frans', 'latijn', 'afrikaans',
  'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk naamwoord', 'bijwoord',
  'uitspraak', 'vertalingen', 'synoniemen', 'woordafbreking', 'etymologie', 'geluid',
]);

async function tryActionApiExtract(candidate) {
  const data = await fetchJson('https://nl.wiktionary.org/w/api.php?action=query&titles='
    + encodeURIComponent(candidate) + '&prop=extracts&explaintext=1&exsectionformat=plain&format=json&redirects=1');
  const pages = data && data.query && data.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined || !page.extract) return null;

  const lines = page.extract.split('\n').map(l => l.trim()).filter(Boolean);
  let pick = lines.find(l => /^\d+\.\s*\S/.test(l));
  if (!pick) pick = lines.find(l => !HEADER_LIKE.has(l.toLowerCase()) && l.length > 15);
  if (!pick) return null;

  return {
    found: true,
    title: page.title || candidate,
    extract: pick.replace(/^\d+\.\s*/, '').slice(0, 300),
    source: 'wiktionary-extract',
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
    for (const fn of [tryStructuredLookup, tryDefinitionEndpoint, tryActionApiExtract]) {
      try {
        const result = await fn(candidate);
        if (result) { res.status(200).json(result); return; }
      } catch (e) { /* volgende bron/kandidaat proberen */ }
    }
  }

  res.status(200).json({ found: false });
};
