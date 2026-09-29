const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');

test('all page scripts resolve inside the portable project', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/gu)].map(match => match[1]);
  assert.ok(scripts.length >= 6);
  for (const script of scripts) {
    assert.equal(path.isAbsolute(script), false);
    const target = path.resolve(project, script);
    assert.ok(target.startsWith(project + path.sep));
    assert.ok(fs.existsSync(target), script);
  }
  new Function(html.split('<script>').at(-1).split('</script>')[0]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const chapters = [...html.matchAll(/<section class="slide(?: active)?" data-title="[^"]+"><div class="eyebrow">(\d+) ·/gu)]
    .map(match => Number(match[1]));
  assert.deepEqual(chapters, Array.from({ length: 15 }, (_, i) => i + 1));
});

test('page shortcuts leave text editing and controls alone', () => {
  const source = html.split('\n').find(line => line.includes("document.addEventListener('keydown'"));
  const handlerSource = source.trim().match(/document\.addEventListener\('keydown',(.+)\);$/u)?.[1];
  assert.ok(handlerSource);
  const visited = [];
  const handler = vm.runInNewContext('(' + handlerSource + ')', { page: 2, show: page => visited.push(page) });
  for (const key of [' ', 'ArrowRight', 'ArrowLeft']) {
    handler({ key, target: { closest: () => ({ tagName: 'TEXTAREA' }) }, preventDefault: () => assert.fail('editing was interrupted') });
  }
  assert.deepEqual(visited, []);
  let prevented = false;
  handler({ key: 'ArrowRight', target: { closest: () => null }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(visited, [3]);
});

test('default poem keeps its editable title outside the checked verse text', () => {
  assert.match(html, /<input id="check-title" class="poem-title" value="近体诗入门课毕示诸生"/u);
  const verse = html.match(/<textarea id="check-text"[^>]*>([^<]*)<\/textarea>/u)?.[1];
  assert.equal(verse.replace(/\r\n/gu, '\n'), '讲堂深静晚生凉，\n檐月斜侵半壁霜。\n熟诵自然音律稳，\n眼前风物尽成章。');
  assert.equal(verse.includes('近体诗入门课毕示诸生'), false);
  const tools = fs.readFileSync(path.join(project, 'lesson-tools.js'), 'utf8');
  assert.match(tools, /return \{ text: input\.value,/u);
  assert.match(tools, /showResultTitle\(\)/u);
});
