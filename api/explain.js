const UA = 'scrabble-checker-nl/1.0 (https://github.com/; contact via project owner)';

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tryDefinitionEndpoint(candidate) {
  const url = 'https://nl.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(candidate);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const data = await r.json();

  // De taalsleutel verschilt per editie: soms ISO-code ("nl"), soms de volle naam ("Nederlands").
  const langKey = ['nl', 'Nederlands', 'Dutch'].find(k => data[k] && data[k].length) || Object.keys(data)[0];
  const block = data[langKey];
  if (!block || !block.length) return null;

  const entry = block[0];
  const def = entry.definitions && entry.definitions[0];
  if (!def || !def.definition) return null;

  const defText = stripTags(def.definition);
  if (!defText || defText.length < 3) return null; // lege of te korte "definitie" is waarschijnlijk ruis

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

// Regels die alleen een sectiekop of woordsoort-label zijn (geen echte definitie), om over te slaan.
const HEADER_LIKE = new Set([
  'nederlands', 'engels', 'duits', 'frans', 'latijn',
  'zelfstandig naamwoord', 'werkwoord', 'bijvoeglijk naamwoord', 'bijwoord',
  'uitspraak', 'vertalingen', 'synoniemen', 'woordafbreking', 'etymologie',
]);

async function tryActionApiExtract(candidate) {
  const url = 'https://nl.wiktionary.org/w/api.php?action=query&titles=' + encodeURIComponent(candidate)
    + '&prop=extracts&explaintext=1&exsectionformat=plain&format=json&redirects=1';
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const data = await r.json();
  const pages = data.query && data.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined || !page.extract) return null;

  const lines = page.extract.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Geef de voorkeur aan een genummerde definitieregel ("1. ...", "2. ...").
  let pick = lines.find(l => /^\d+\.\s*\S/.test(l));

  // 2. Anders: de eerste regel die geen bekende sectiekop/woordsoort-label is.
  if (!pick) {
    pick = lines.find(l => !HEADER_LIKE.has(l.toLowerCase()) && l.length > 15);
  }

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
    try {
      const result = await tryDefinitionEndpoint(candidate);
      if (result) { res.status(200).json(result); return; }
    } catch (e) { /* probeer volgende bron */ }

    try {
      const result = await tryActionApiExtract(candidate);
      if (result) { res.status(200).json(result); return; }
    } catch (e) { /* probeer volgende kandidaat */ }
  }

  res.status(200).json({ found: false });
};
