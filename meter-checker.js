(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeterChecker = api;
})(globalThis, function () {
  'use strict';

  const FORMS = {
    五言绝句: { lineCount: 4, width: 5 }, 七言绝句: { lineCount: 4, width: 7 },
    五言律诗: { lineCount: 8, width: 5 }, 七言律诗: { lineCount: 8, width: 7 }
  };
  const TONES = { 上平声部: '平', 下平声部: '平', 上声部: '仄', 去声部: '仄', 入声部: '仄' };
  const BOUNDARIES = new Set(Array.from('，。！？；,.!?;\n\r'));
  const IGNORED = new Set(Array.from('：、:「」『』“”‘’（）()《》〈〉【】〔〕[]'));

  function isHan(char) {
    const n = char.codePointAt(0);
    return (n >= 0x3400 && n <= 0x4DBF) || (n >= 0x4E00 && n <= 0x9FFF) ||
      (n >= 0xF900 && n <= 0xFAFF) || (n >= 0x20000 && n <= 0x2FA1F) ||
      (n >= 0x30000 && n <= 0x3347F) || char === '〇';
  }

  function parseText(text) {
    const lines = [];
    let cells = [], segmentStart = 0;
    const flush = end => {
      if (cells.length) lines.push({ original: text.slice(segmentStart, end), cells });
      cells = [];
    };
    for (let offset = 0; offset < text.length;) {
      const char = String.fromCodePoint(text.codePointAt(offset));
      const next = offset + char.length;
      if (BOUNDARIES.has(char)) { flush(offset); segmentStart = next; }
      else if (!/\s/u.test(char) && !IGNORED.has(char)) {
        cells.push({ char, pos: cells.length + 1, offset, end: next, isHan: isHan(char) });
      }
      offset = next;
    }
    flush(text.length);
    return lines;
  }

  function createResources(templateData, rhymeData) {
    if (!templateData || !rhymeData) throw new Error('模板或平水韵资源未载入');
    const templates = [], ids = new Set();
    for (const [type, group] of Object.entries(templateData)) {
      const form = FORMS[type];
      if (!form || !Array.isArray(group.formats)) throw new Error('不支持的诗体模板');
      for (const source of group.formats) {
        if (ids.has(source.id) || source.type !== type || source.line_count !== form.lineCount ||
            source.char_count !== form.lineCount * form.width) throw new Error('诗体模板结构冲突');
        ids.add(source.id);
        const grid = Array.from({ length: form.lineCount }, () => Array(form.width).fill(null));
        for (const cell of source.tunes) {
          if (!Number.isInteger(cell.line) || !Number.isInteger(cell.pos) ||
              cell.line < 1 || cell.line > form.lineCount || cell.pos < 1 || cell.pos > form.width ||
              grid[cell.line - 1][cell.pos - 1] !== null || !['平', '仄', '中'].includes(cell.tune)) {
            throw new Error('诗体模板格位无效');
          }
          grid[cell.line - 1][cell.pos - 1] = cell.tune;
        }
        if (grid.some(row => row.includes(null)) || !Array.isArray(source.rhyme.positions) ||
            source.rhyme.positions.some(line => !Number.isInteger(line) || line < 1 || line > form.lineCount)) {
          throw new Error('诗体模板格位或韵位缺失');
        }
        for (let line = 1; line <= form.lineCount; line++) {
          const rhyme = source.rhyme.positions.includes(line);
          if (grid[line - 1][form.width - 1] !== (rhyme ? '平' : '仄')) throw new Error('模板句尾与韵位冲突');
        }
        templates.push({ id: source.id, type, pattern: source.pattern,
          start: source.pattern.startsWith('平起') ? '平起' : '仄起',
          firstLineRhyme: source.rhyme.first_line_rhyme, ...form,
          grid, rhymePositions: source.rhyme.positions.slice() });
      }
    }
    const index = new Map(), groups = [];
    for (const [section, parts] of Object.entries(rhymeData)) {
      if (!TONES[section]) throw new Error('未知平水韵声部');
      for (const [group, entries] of Object.entries(parts)) {
        groups.push({ section, group, id: section + '/' + group });
        for (const entry of entries) {
          if (!entry || typeof entry.char !== 'string' || !Array.isArray(entry.senses)) throw new Error('韵表记录无效');
          if (!index.has(entry.char)) index.set(entry.char, new Map());
          const key = section + '/' + group;
          if (!index.get(entry.char).has(key)) index.get(entry.char).set(key, { section, group, tone: TONES[section], senses: [] });
          const record = index.get(entry.char).get(key);
          for (const sense of entry.senses) if (!record.senses.includes(sense)) record.senses.push(sense);
        }
      }
    }
    return { templates, groups, lookup: char => [...(index.get(char)?.values() || [])] };
  }

  function matchGroup(resources, value) {
    if (!value) return { status: 'missing', choices: [] };
    const exact = resources.groups.filter(item => item.id === value || item.group === value);
    const choices = exact.length ? exact : resources.groups.filter(item =>
      item.group.replace(/^[一二三四五六七八九十百]+/u, '') === value);
    return { status: choices.length === 1 ? 'unique' : choices.length ? 'ambiguous' : 'unavailable', choices };
  }

  function chooseRhymeGroup(resources, template, parsed, input) {
    if (input.rhymeGroup) return { ...matchGroup(resources, input.rhymeGroup), source: 'manual' };
    for (let line = 2; line <= template.lineCount; line += 2) {
      const source = parsed.length === 1 ? (input.lineIndex === line ? parsed[0] : null) : parsed[line - 1];
      if (!source || source.cells.length !== template.width) continue;
      const foot = source.cells[template.width - 1];
      if (!foot.isHan) continue;
      const options = resources.lookup(foot.char);
      if (options.length !== 1) continue;
      const record = options[0];
      return { ...matchGroup(resources, record.section + '/' + record.group), source: 'auto', line, char: foot.char };
    }
    return { status: 'missing', choices: [], source: 'unresolved' };
  }

  function inspect(input, resources) {
    if (!resources || !Array.isArray(resources.templates)) throw new Error('检测资源未初始化');
    const text = typeof input.text === 'string' ? input.text : '';
    const parsed = parseText(text);
    if (!parsed.length) return { kind: 'needInput', message: '请输入单句或整首诗。' };
    if (input.rhymeSystem && input.rhymeSystem !== '平水韵')
      return { kind: 'unsupportedSystem', message: '当前只支持平水韵；其他韵书暂不检测。' };
    if (input.poemType && !FORMS[input.poemType])
      return { kind: 'unsupportedForm', message: '当前只支持五绝、七绝、五律、七律。' };
    if (input.start && !['平起', '仄起'].includes(input.start))
      return { kind: 'invalidSelection', message: '起式只能选平起或仄起。' };
    if (input.firstLineRhyme != null && typeof input.firstLineRhyme !== 'boolean')
      return { kind: 'invalidSelection', message: '首句入韵选项无效。' };
    if (input.templateId && !resources.templates.some(t => t.id === input.templateId))
      return { kind: 'unsupportedTemplate', message: '未找到指定模板。' };
    if (![1, 4, 8].includes(parsed.length))
      return { kind: 'unsupportedShape', message: '目前只检测单句，或完整的四句绝句、八句律诗。', actualLines: parsed.length };
    let candidates = resources.templates.filter(t =>
      (!input.templateId || t.id === input.templateId) && (!input.poemType || t.type === input.poemType) &&
      (!input.start || t.start === input.start) &&
      (input.firstLineRhyme == null || t.firstLineRhyme === input.firstLineRhyme));
    if (!input.poemType && !input.templateId) {
      if (parsed.length > 1) candidates = candidates.filter(t => t.lineCount === parsed.length);
      const widths = parsed.map(line => line.cells.length);
      if (widths.every(width => width === widths[0]) && [5, 7].includes(widths[0]))
        candidates = candidates.filter(t => t.width === widths[0]);
    }
    if (!candidates.length) return { kind: 'templateConflict', message: '模板与诗体、起式或首句入韵选择冲突；请调整条件。' };
    if (candidates.length > 1) {
      if (parsed.length === 1 && (!Number.isInteger(input.lineIndex) || input.lineIndex < 1 || input.lineIndex > 8))
        return { kind: 'needLinePosition', message: '单句检测须先指定它在诗中的句位，再比较兼容模板。' };
      const checked = candidates.map(template => inspect({ ...input, templateId: template.id }, resources))
        .filter(result => result.kind === 'checked');
      if (!checked.length) return { kind: 'needLinePosition', message: '所选句位不适用于当前兼容诗体，请重新选择。' };
      const scored = checked.map(result => ({ result, errors: result.errors.length +
        result.shapeIssues.filter(issue => issue.code !== 'MISSING_RHYME_FOOT').length }));
      const leastErrors = Math.min(...scored.map(item => item.errors));
      return { kind: 'ranked', leastErrors, compared: scored.length,
        best: scored.filter(item => item.errors === leastErrors),
        message: '已比较 ' + scored.length + ' 个兼容模板；最少确定错误 ' + leastErrors + ' 处。待判项未计入错误。' };
    }
    const template = candidates[0];
    if (parsed.length !== 1 && parsed.length !== template.lineCount)
      return { kind: 'unsupportedShape', message: '请输入单句，或完整的' + template.lineCount + '句诗；目前不检测残缺的多句诗。',
        actualLines: parsed.length, expectedLines: template.lineCount };
    if (parsed.length === 1 && (!Number.isInteger(input.lineIndex) || input.lineIndex < 1 || input.lineIndex > template.lineCount))
      return { kind: 'needLinePosition', message: '单句检测必须指定它在全诗中的句位（第 1 至 ' + template.lineCount + ' 句）。',
        lineCount: template.lineCount };
    const group = chooseRhymeGroup(resources, template, parsed, input);
    const readings = input.readings || {};
    const shapeIssues = [], lines = [];
    for (let i = 0; i < parsed.length; i++) {
      const line = parsed.length === 1 ? input.lineIndex : i + 1;
      const source = parsed[i], cells = [];
      if (source.cells.length !== template.width) shapeIssues.push({ line, code: 'LINE_LENGTH', expected: template.width, actual: source.cells.length });
      for (const cell of source.cells) {
        if (!cell.isHan) shapeIssues.push({ line, pos: cell.pos, offset: cell.offset, code: 'INVALID_CHARACTER' });
        const expected = template.grid[line - 1][cell.pos - 1] || '—';
        const rhymeFoot = cell.pos === template.width && template.rhymePositions.includes(line);
        const options = cell.isHan ? resources.lookup(cell.char) : [];
        const coordinate = line + ':' + cell.pos;
        const selected = readings[coordinate];
        const chosen = selected ? options.find(r => r.section + '/' + r.group === selected) : null;
        const unresolved = options.length > 1 && !chosen;
        const sameTone = unresolved && new Set(options.map(r => r.tone)).size === 1;
        const record = chosen || (options.length === 1 ? options[0] : null);
        const tone = record?.tone || (sameTone ? options[0].tone : null);
        let toneStatus = '待判';
        if (tone && expected !== '—') toneStatus = expected === '中' ? '中位可用' : tone === expected ? '合' : '不合';
        let rhymeStatus = rhymeFoot ? '待判' : '不适用', rhymeReason = '';
        if (rhymeFoot) {
          if (group.status !== 'unique') rhymeReason = { missing: '偶数句韵脚均未能确定韵部', ambiguous: '韵部名称有歧义', unavailable: '韵部未收录' }[group.status];
          else if (!record) rhymeReason = unresolved ? '读音归属未选' : '字音资料不足';
          else rhymeStatus = record.section + '/' + record.group === group.choices[0].id ? '合' : '不合';
        }
        const status = toneStatus === '不合' || rhymeStatus === '不合' ? '不合' :
          toneStatus === '待判' || rhymeStatus === '待判' ? '待判' : toneStatus;
        cells.push({ ...cell, line, expected, rhymeFoot, toneStatus, rhymeStatus, rhymeReason, status,
          options, selected: chosen ? selected : null,
          sameToneHint: sameTone ? '候选均为' + tone + '声，平仄已自动判定' + (rhymeFoot ? '；韵部仍须辨明' : '，无需选读音') : '',
          needsReadingSelection: unresolved && (!sameTone || rhymeFoot) });
      }
      if (template.rhymePositions.includes(line) && source.cells.length < template.width)
        shapeIssues.push({ line, pos: template.width, code: 'MISSING_RHYME_FOOT' });
      lines.push({ line, original: source.original, cells });
    }
    const all = lines.flatMap(line => line.cells);
    const errors = all.filter(cell => cell.status === '不合').map(cell => ({ line: cell.line, pos: cell.pos, char: cell.char, offset: cell.offset }));
    const pending = all.filter(cell => cell.status === '待判').length;
    const rhymeFeet = all.filter(cell => cell.rhymeFoot);
    const rhymeStatus = rhymeFeet.length ? rhymeFeet.some(cell => cell.rhymeStatus === '不合') ? '不合' :
      rhymeFeet.some(cell => cell.rhymeStatus === '待判') ? '待判' : '合' : '待判';
    const overall = shapeIssues.length || errors.length ? '不合' :
      parsed.length === 1 || pending || rhymeStatus !== '合' ? '待判' : '合';
    return { kind: 'checked', template, lines, shapeIssues, errors, pending, rhymeStatus, overall,
      scope: parsed.length === 1 ? '单句' : '全诗', rhymeGroup: group };
  }

  return { FORMS, TONES, parseText, createResources, matchGroup, chooseRhymeGroup, inspect };
});
