const UA = 'scrabble-checker-nl/1.0 (+https://vercel.com; contact via project owner)';

// De woordsoort-koppen zoals ze op nl.wiktionary voorkomen (zie WikiWoordenboek:Zelfstandig_naamwoord,
// WikiWoordenboek:Werkwoord, etc.) — dit is de structuur waarin elk woord wordt beschreven.
const POS_HEADERS = [
  'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk naamwoord', 'bijwoord',
  'voornaamwoord', 'telwoord', 'voegwoord', 'voorzetsel', 'tussenwerpsel',
  'lidwoord', 'eigennaam', 'achtervoegsel', 'voorvoegsel',
];

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Zet Wikitekst-opmaak (templates, links, vet/cursief) om naar leesbare platte tekst.
function cleanWikitext(line) {
  let s = line;

  // {{context|natuurkunde|...}} of {{contekst|...}} -> "(natuurkunde)"
  s = s.replace(/\{\{\s*(?:context|contekst)\s*\|([^}]+)\}\}/gi, (_, args) => {
    const parts = args.split('|').filter(a => a && !/^(nld|nl)$/i.test(a.trim()));
    return parts.length ? '(' + parts.join(', ') + ')' : '';
  });

  // Overige templates: verwijder.
  s = s.replace(/\{\{[^{}]*\}\}/g, '');

  // [[doel|weergave]] -> weergave, [[doel]] -> doel
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');

  // ''cursief'' / '''vet''' -> gewone tekst
  s = s.replace(/'{2,3}/g, '');

  return s.replace(/\s+/g, ' ').trim();
}

async function findPosSectionIndex(candidate) {
  const url = 'https://nl.wiktionary.org/w/api.php?action=parse&page=' + encodeURIComponent(candidate)
    + '&prop=sections&format=json&redirects=1';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const data = await r.json();
  const sections = data.parse && data.parse.sections;
  if (!sections || !sections.length) return null;

  const match = sections.find(s => POS_HEADERS.includes((s.line || '').trim().toLowerCase()));
  if (!match) return null;

  return { index: match.index, heading: match.line, pageTitle: data.parse.title };
}

async function extractDefinitionFromSection(candidate, sectionIndex) {
  const url = 'https://nl.wiktionary.org/w/api.php?action=parse&page=' + encodeURIComponent(candidate)
    + '&section=' + encodeURIComponent(sectionIndex) + '&prop=wikitext&format=json&redirects=1';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const data = await r.json();
  const wikitext = data.parse && data.parse.wikitext && data.parse.wikitext['*'];
  if (!wikitext) return null;

  const lines = wikitext.split('\n');
  // Definitieregels beginnen met precies een "#" (geen "#*" citaat, geen "#:" toelichting).
  const defLine = lines.find(l => /^#(?![#:*])\s*\S/.test(l.trim()));
  if (!defLine) return null;

  const cleaned = cleanWikitext(defLine.replace(/^#\s*/, ''));
  if (!cleaned || cleaned.length < 3) return null;

  return cleaned;
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
  const url = 'https://nl.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(candidate);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const data = await r.json();

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
    // 1. Meest betrouwbaar: pak de sectie die exact bij een woordsoort-kop hoort en lees de wikitekst-lijst.
    try {
      const result = await tryStructuredLookup(candidate);
      if (result) { res.status(200).json(result); return; }
    } catch (e) { /* probeer volgende bron */ }

    // 2. Terugval: de structured REST-endpoint (werkt niet voor elk woord).
    try {
      const result = await tryDefinitionEndpoint(candidate);
      if (result) { res.status(200).json(result); return; }
    } catch (e) { /* probeer volgende kandidaat */ }
  }

  res.status(200).json({ found: false });
};
