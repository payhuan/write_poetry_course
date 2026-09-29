const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Meter = require('../meter-checker.js');

const project = path.resolve(__dirname, '..');
const context = { window: {} };
for (const file of ['data/pingshui-rhyme.js', 'data/poem-templates.js'])
  vm.runInNewContext(fs.readFileSync(path.join(project, file), 'utf8'), context);
const resources = Meter.createResources(context.window.POEM_TEMPLATES, context.window.PINGSHUI_RHYME);
const unique = { 平: null, 仄: null, rhyme: null, otherRhyme: null };
for (const section of Object.keys(context.window.PINGSHUI_RHYME)) {
  for (const [group, entries] of Object.entries(context.window.PINGSHUI_RHYME[section])) {
    for (const entry of entries) {
      const memberships = resources.lookup(entry.char);
      if (memberships.length !== 1) continue;
      const tone = memberships[0].tone;
      unique[tone] ??= entry.char;
      if (section === '上平声部' && group === '一东') unique.rhyme ??= entry.char;
      if (section === '上平声部' && group !== '一东') unique.otherRhyme ??= entry.char;
    }
  }
}
assert.ok(Object.values(unique).every(Boolean));
const group = '上平声部/一东';
function poem(template) {
  return template.grid.map((row, line) => row.map((tone, pos) =>
    pos === template.width - 1 && template.rhymePositions.includes(line + 1) ? unique.rhyme :
    tone === '仄' ? unique.仄 : unique.平).join(''));
}
function request(template, text, extra = {}) {
  return { text, templateId: template.id, rhymeSystem: '平水韵', rhymeGroup: group, ...extra };
}

test('four forms use their own complete project templates', () => {
  for (const type of Object.keys(Meter.FORMS)) {
    const templates = resources.templates.filter(t => t.type === type);
    assert.equal(templates.length, 4);
    for (const template of templates) {
      const result = Meter.inspect(request(template, poem(template).join('，')), resources);
      assert.equal(result.kind, 'checked', template.id);
      assert.equal(result.overall, '合', template.id);
      assert.equal(result.lines.length, template.lineCount);
      assert.deepEqual(result.lines.map(line => line.cells.length), Array(template.lineCount).fill(template.width));
    }
  }
});

test('punctuation and whitespace preserve original offsets and character positions', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const line = poem(template)[0];
  const text = '“' + line[0] + ' 、 ' + line.slice(1, 3) + ' ' + line.slice(3) + '。”';
  const result = Meter.inspect(request(template, text, { lineIndex: 1 }), resources);
  assert.equal(result.kind, 'checked');
  assert.equal(result.lines[0].cells.length, 5);
  assert.deepEqual(result.lines[0].cells.map(c => c.pos), [1, 2, 3, 4, 5]);
  assert.equal(text.slice(result.lines[0].cells[1].offset, result.lines[0].cells[1].end), line[1]);
  assert.ok(result.lines[0].cells[1].offset > result.lines[0].cells[0].offset + 1);
});

test('middle positions are marked usable while unknown characters remain pending', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const result = Meter.inspect(request(template, poem(template)[0], { lineIndex: 1 }), resources);
  assert.equal(template.grid[0][0], '中');
  assert.equal(result.lines[0].cells[0].toneStatus, '中位可用');
  const unknown = '〇' + poem(template)[0].slice(1);
  const pending = Meter.inspect(request(template, unknown, { lineIndex: 1 }), resources);
  if (resources.lookup('〇').length === 0) assert.equal(pending.lines[0].cells[0].status, '待判');
});

test('multiple memberships stay pending until the user selects one', () => {
  const poly = [...'行重长中得'].find(char => resources.lookup(char).length > 1);
  assert.ok(poly);
  const template = resources.templates.find(t => t.id === 'wj_z');
  const text = poem(template)[0].slice(0, 1) + poly + poem(template)[0].slice(2);
  const pending = Meter.inspect(request(template, text, { lineIndex: 1 }), resources);
  const cell = pending.lines[0].cells[1];
  assert.equal(cell.status, '待判');
  assert.equal(cell.options.length, resources.lookup(poly).length);
  const selected = cell.options[0];
  const reviewed = Meter.inspect(request(template, text, { lineIndex: 1,
    readings: { '1:2': selected.section + '/' + selected.group } }), resources);
  assert.notEqual(reviewed.lines[0].cells[1].toneStatus, '待判');
  assert.equal(reviewed.lines[0].cells[1].selected, selected.section + '/' + selected.group);
});

test('same-tone alternatives are decided automatically at non-rhyme positions', () => {
  const allChars = [...new Set(Object.values(context.window.PINGSHUI_RHYME).flatMap(parts =>
    Object.values(parts).flatMap(entries => entries.map(entry => entry.char))))];
  const char = allChars.find(x => {
    const options = resources.lookup(x);
    return options.length > 1 && new Set(options.map(r => r.tone)).size === 1;
  });
  assert.ok(char);
  const template = resources.templates.find(t => t.id === 'wj_z');
  const tone = resources.lookup(char)[0].tone;
  const matchingPos = tone === '平' ? 4 : 2;
  const line = poem(template)[0];
  const text = line.slice(0, matchingPos - 1) + char + line.slice(matchingPos);
  const result = Meter.inspect(request(template, text, { lineIndex: 1 }), resources);
  const cell = result.lines[0].cells[matchingPos - 1];
  assert.equal(cell.status, '合');
  assert.equal(cell.needsReadingSelection, false);
  assert.match(cell.sameToneHint, /平仄已自动判定/);
  const wrongPos = tone === '平' ? 2 : 4;
  const wrongText = line.slice(0, wrongPos - 1) + char + line.slice(wrongPos);
  const wrong = Meter.inspect(request(template, wrongText, { lineIndex: 1 }), resources);
  assert.equal(wrong.lines[0].cells[wrongPos - 1].status, '不合');
  const flatChar = allChars.find(x => {
    const options = resources.lookup(x);
    return options.length > 1 && options.every(r => r.tone === '平');
  });
  assert.ok(flatChar);
  const foot = poem(template)[1].slice(0, -1) + flatChar;
  const rhyme = Meter.inspect(request(template, foot, { lineIndex: 2 }), resources).lines[0].cells[4];
  assert.equal(rhyme.toneStatus, '合');
  assert.equal(rhyme.rhymeStatus, '待判');
  assert.equal(rhyme.needsReadingSelection, true);
});

test('unselected rhyme group is inferred from the first unambiguous even-line foot', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const text = poem(template).join('。');
  const inferred = Meter.inspect(request(template, text, { rhymeGroup: '' }), resources);
  assert.equal(inferred.rhymeGroup.source, 'auto');
  assert.equal(inferred.rhymeGroup.line, 2);
  assert.equal(inferred.rhymeStatus, '合');
  assert.equal(inferred.overall, '合');
  const allChars = [...new Set(Object.values(context.window.PINGSHUI_RHYME).flatMap(parts =>
    Object.values(parts).flatMap(entries => entries.map(entry => entry.char))))];
  const poly = allChars.find(char => resources.lookup(char).length > 1 &&
    resources.lookup(char).every(record => record.tone === '平'));
  assert.ok(poly);
  const lines = poem(template);
  lines[1] = lines[1].slice(0, -1) + poly;
  const fallback = Meter.inspect(request(template, lines.join('。'), { rhymeGroup: '' }), resources);
  assert.equal(fallback.rhymeGroup.line, 4);
  assert.equal(fallback.lines[1].cells[4].rhymeStatus, '待判');
  lines[3] = lines[3].slice(0, -1) + poly;
  const unknown = Meter.inspect(request(template, lines.join('。'), { rhymeGroup: '' }), resources);
  assert.equal(unknown.rhymeGroup.status, 'missing');
  assert.equal(unknown.rhymeStatus, '待判');
  const law = resources.templates.find(t => t.id === 'wl_z');
  const longLines = poem(law);
  longLines[1] = longLines[1].slice(0, -1) + poly;
  longLines[3] = longLines[3].slice(0, -1) + poly;
  const sixth = Meter.inspect(request(law, longLines.join('。'), { rhymeGroup: '' }), resources);
  assert.equal(sixth.rhymeGroup.line, 6);
});

test('manual rhyme group takes precedence and definite mismatch fails', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const wrongLines = poem(template);
  wrongLines[1] = wrongLines[1].slice(0, -1) + unique.otherRhyme;
  const wrong = Meter.inspect(request(template, wrongLines.join('。')), resources);
  assert.equal(wrong.rhymeGroup.source, 'manual');
  assert.equal(wrong.rhymeStatus, '不合');
  assert.equal(wrong.overall, '不合');
});

test('ambiguous template selection, conflicts, unsupported forms and single-line position', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const line = poem(template)[0];
  assert.equal(Meter.inspect({ text: line }, resources).kind, 'needLinePosition');
  const ranked = Meter.inspect({ text: poem(template).join('。') }, resources);
  assert.equal(ranked.kind, 'ranked');
  assert.equal(ranked.compared, 4);
  assert.equal(ranked.leastErrors, 0);
  assert.ok(ranked.best.some(item => item.result.template.id === template.id));
  assert.equal(Meter.inspect(request(template, line), resources).kind, 'needLinePosition');
  assert.equal(Meter.inspect(request(template, line, { poemType: '七言绝句' }), resources).kind, 'templateConflict');
  assert.equal(Meter.inspect({ text: line, poemType: '词' }, resources).kind, 'unsupportedForm');
  assert.equal(Meter.inspect(request(template, line, { lineIndex: 1, rhymeSystem: '中华新韵' }), resources).kind, 'unsupportedSystem');
  assert.equal(Meter.inspect(request(template, line + '，' + line), resources).kind, 'unsupportedShape');
});

test('equal minimum-error templates are all retained and pending does not count as an error', () => {
  const unknown = String.fromCodePoint(0x2FA1F);
  assert.equal(resources.lookup(unknown).length, 0);
  const result = Meter.inspect({ text: unknown.repeat(5), poemType: '五言绝句', lineIndex: 1 }, resources);
  assert.equal(result.kind, 'ranked');
  assert.equal(result.best.length, 4);
  assert.equal(result.leastErrors, 0);
  assert.ok(result.best.every(item => item.result.pending > 0));
});

test('wrong character points back to its exact source position and no rescue is applied', () => {
  const template = resources.templates.find(t => t.id === 'wj_z');
  const original = poem(template)[0];
  const wrong = original.slice(0, 1) + unique.平 + original.slice(2);
  const result = Meter.inspect(request(template, wrong, { lineIndex: 1 }), resources);
  assert.equal(result.lines[0].cells[1].expected, '仄');
  assert.equal(result.lines[0].cells[1].status, '不合');
  assert.deepEqual(result.errors.map(x => [x.line, x.pos, x.offset]), [[1, 2, 1]]);
});
