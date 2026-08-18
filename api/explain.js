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
      const url = 'https://nl.wiktionary.org/api/rest_v1/page/summary/' + encodeURIComponent(candidate);
      const r = await fetch(url, { headers: { 'User-Agent': 'scrabble-checker/1.0' } });
      if (!r.ok) continue;
      const data = await r.json();
      if (data && data.extract) {
        res.status(200).json({
          found: true,
          title: data.title || candidate,
          extract: data.extract,
          source: 'wiktionary',
          sourceUrl: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)
            || ('https://nl.wiktionary.org/wiki/' + encodeURIComponent(candidate)),
        });
        return;
      }
    } catch (e) {
      // try next candidate
    }
  }

  res.status(200).json({ found: false });
};
