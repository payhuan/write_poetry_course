(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AllusionSearch = api;
})(globalThis, function () {
  'use strict';
  const OUTER = /^[\s“”‘’'"「」『』《》〈〉【】〔〕\[\]（）()]+|[\s“”‘’'"「」『』《》〈〉【】〔〕\[\]（）()]+$/gu;
  const normalize = value => typeof value === 'string' ? value.normalize('NFKC').replace(OUTER, '').trim().replace(/\s+/gu, ' ') : '';

  function createIndex(records) {
    if (!Array.isArray(records)) throw new Error('典故资料未载入');
    const exact = new Map(), fields = [];
    records.forEach((record, index) => {
      if (!record || !record.name || !Array.isArray(record.aliases) || !Array.isArray(record.sources))
        throw new Error('典故记录无效');
      const terms = [record.name, record.raw_nav_name, ...record.aliases.map(a => a.word)];
      for (const term of terms) {
        const key = normalize(term);
        if (!key) continue;
        if (!exact.has(key)) exact.set(key, new Set());
        exact.get(key).add(index);
      }
      fields[index] = [...terms, ...(record.persons || []), ...(record.head_persons || []),
        ...(record.refs || []).map(x => x.name), record.gloss || '',
        ...record.sources.flatMap(x => [x.book, x.text])].map(normalize).filter(Boolean);
    });
    return { records, exact, fields };
  }

  function search(index, query, limit = 5) {
    const value = normalize(query);
    if (!value) return { kind: 'empty', records: [], partial: true };
    const exact = [...(index.exact.get(value) || [])];
    if (exact.length) return { kind: exact.length === 1 ? 'exact' : 'ambiguous',
      records: exact.map(i => index.records[i]).sort((a, b) => a.allusion_id - b.allusion_id), partial: true };
    const found = [];
    index.fields.forEach((terms, i) => { if (terms.some(term => term.includes(value))) found.push(index.records[i]); });
    found.sort((a, b) => a.page_no - b.page_no || a.seq_in_page - b.seq_in_page || a.allusion_id - b.allusion_id);
    return { kind: 'suggestions', records: found.slice(0, limit), partial: true };
  }

  return { normalize, createIndex, search };
});
