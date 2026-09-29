const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Search = require('../allusion-search.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../data/allusions.js'), 'utf8'), context);
const index = Search.createIndex(context.window.ALLUSIONS);

test('bundled allusion data resolves a unique exact alias offline', () => {
  const result = Search.search(index, '「王质观棋」');
  assert.equal(result.kind, 'exact');
  assert.equal(result.records[0].name, '柯烂忘归');
  assert.ok(result.records[0].sources.length);
});

test('substring matches stay suggestions and a local miss is not definitive', () => {
  assert.equal(Search.search(index, '王质').kind, 'suggestions');
  const missing = Search.search(index, '绝不可能存在的典故名称');
  assert.equal(missing.kind, 'suggestions');
  assert.equal(missing.records.length, 0);
  assert.equal(missing.partial, true);
});

test('ambiguous exact aliases are never selected automatically', () => {
  const records = [{ name: '甲典', raw_nav_name: '甲典', aliases: [{ word: '同名' }], sources: [], allusion_id: 1 },
    { name: '乙典', raw_nav_name: '乙典', aliases: [{ word: '同名' }], sources: [], allusion_id: 2 }];
  const result = Search.search(Search.createIndex(records), '同名');
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.records.length, 2);
});
