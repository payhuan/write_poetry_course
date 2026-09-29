(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };

  const allusionOutput = byId('allusion-results');
  let allusions;
  try { allusions = AllusionSearch.createIndex(window.ALLUSIONS); }
  catch (error) { allusionOutput.textContent = '典故资料未能载入：' + error.message; }
  function showAllusions() {
    if (!allusions) return;
    const result = AllusionSearch.search(allusions, byId('allusion-input').value);
    allusionOutput.replaceChildren();
    if (result.kind === 'empty') { allusionOutput.textContent = '输入典故名、别名或人物后查询。'; return; }
    const lead = result.kind === 'exact' ? '唯一精确命中：' : result.kind === 'ambiguous' ?
      '多个典故精确命中，请自行辨别：' : '没有唯一精确命中。以下仅是包含匹配的候选：';
    allusionOutput.appendChild(node('p', result.records.length ? lead : '这份部分资料中未找到候选；不能据此断定典故不存在。'));
    for (const record of result.records) {
      const article = node('article');
      article.appendChild(node('h4', record.name));
      if (record.gloss) article.appendChild(node('p', record.gloss));
      if (record.head_persons.length) article.appendChild(node('p', '人物：' + record.head_persons.join('、')));
      if (record.aliases.length) article.appendChild(node('p', '别名：' + record.aliases.slice(0, 12).map(x => x.word).join('、') +
        (record.aliases.length > 12 ? '……（共 ' + record.aliases.length + ' 个）' : '')));
      const details = node('details'), summary = node('summary', '查看资料出处');
      details.appendChild(summary);
      for (const source of record.sources) {
        details.appendChild(node('strong', source.book));
        details.appendChild(node('p', source.text));
      }
      article.appendChild(details);
      allusionOutput.appendChild(article);
    }
  }
  byId('allusion-search').onclick = showAllusions;
  byId('allusion-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); showAllusions(); } };
  document.querySelectorAll('.allusion-example').forEach(button => button.onclick = () => {
    byId('allusion-input').value = button.dataset.query;
    showAllusions();
  });

  const output = byId('check-results'), summary = byId('check-summary'), input = byId('check-text');
  const titleInput = byId('check-title');
  let activePreview = null;
  let resources;
  try { resources = MeterChecker.createResources(window.POEM_TEMPLATES, window.PINGSHUI_RHYME); }
  catch (error) { summary.textContent = '检测资源未能载入：' + error.message; }
  const readings = {};
  if (resources) {
    const templateSelect = byId('check-template');
    for (const form of Object.keys(MeterChecker.FORMS)) {
      const group = node('optgroup'); group.label = form;
      for (const template of resources.templates.filter(t => t.type === form)) {
        const option = node('option', template.pattern); option.value = template.id; group.appendChild(option);
      }
      templateSelect.appendChild(group);
    }
    const groupSelect = byId('check-group');
    for (const section of Object.keys(MeterChecker.TONES)) {
      if (MeterChecker.TONES[section] !== '平') continue;
      const group = node('optgroup'); group.label = section.replace(/部$/, '');
      for (const rhyme of resources.groups.filter(item => item.section === section)) {
        const option = node('option', rhyme.group); option.value = rhyme.id; group.appendChild(option);
      }
      groupSelect.appendChild(group);
    }
  }
  function syncLineOptions() {
    const chosen = resources?.templates.find(t => t.id === byId('check-template').value);
    const form = MeterChecker.FORMS[byId('check-type').value];
    const count = chosen?.lineCount || form?.lineCount || 8;
    const select = byId('check-line'), old = select.value;
    select.replaceChildren(node('option', '单句请选择句位'));
    for (let i = 1; i <= count; i++) { const option = node('option', '第 ' + i + ' 句'); option.value = String(i); select.appendChild(option); }
    if (+old >= 1 && +old <= count) select.value = old;
  }
  syncLineOptions();

  function getRequest() {
    const first = byId('check-first').value;
    return { text: input.value, poemType: byId('check-type').value, start: byId('check-start').value,
      firstLineRhyme: first === '' ? null : first === 'yes', templateId: byId('check-template').value,
      rhymeSystem: byId('check-system').value, rhymeGroup: byId('check-group').value,
      lineIndex: +byId('check-line').value || null, readings };
  }
  function readingLabel(record) {
    return record.section.replace(/部$/, '') + ' · ' + record.group + '｜' + record.tone +
      (record.senses.length ? '｜义项：' + record.senses.join('、') : '｜韵表未附义项');
  }
  function showChecked(result, target = output, showTop = true) {
    const rhymeNote = result.rhymeGroup.status === 'unique' ?
      (result.rhymeGroup.source === 'auto' ? '韵部取自第 ' + result.rhymeGroup.line + ' 句“' + result.rhymeGroup.char + '”：' : '手选韵部：') +
      result.rhymeGroup.choices[0].id : '韵部待判';
    const lineVerdict = result.shapeIssues.length || result.errors.length ? '不合' : result.pending ? '待判' : '合';
    const scopeNote = result.scope === '单句' ? '本句字位：' + lineVerdict + '（整首尚未检测）' : '全诗检测：' + result.overall;
    const parts = [scopeNote, result.template.type + ' · ' + result.template.pattern,
      rhymeNote, '韵脚：' + result.rhymeStatus, '不合字位 ' + result.errors.length + ' 处', '待判字位 ' + result.pending + ' 处'];
    if (result.shapeIssues.length) parts.push('结构问题 ' + result.shapeIssues.length + ' 处');
    if (showTop) {
      summary.textContent = parts.join('｜');
      summary.className = 'tool-status ' + (result.overall === '不合' ? 'bad' : result.overall === '合' ? 'good' : '');
    } else target.appendChild(node('p', parts.join('｜')));
    if (result.errors.length) target.appendChild(node('p', '不合位置：' + result.errors.map(x =>
      '第 ' + x.line + ' 句第 ' + x.pos + ' 字“' + x.char + '”').join('；')));
    for (const issue of result.shapeIssues) target.appendChild(node('p', issue.code === 'LINE_LENGTH' ?
      '第 ' + issue.line + ' 句字数不合：应为 ' + issue.expected + ' 字，实际 ' + issue.actual + ' 字。' :
      issue.code === 'MISSING_RHYME_FOOT' ? '第 ' + issue.line + ' 句缺少预定的韵脚字位。' :
      '第 ' + issue.line + ' 句第 ' + issue.pos + ' 字含非汉字；可点击对应字块定位原文。'));
    for (const line of result.lines) {
      const section = node('div', null, 'meter-line');
      section.appendChild(node('h4', '第 ' + line.line + ' 句｜' + line.cells.map(c => c.char).join('')));
      const cells = node('div', null, 'meter-cells');
      for (const cell of line.cells) {
        const card = node('button', null, 'meter-cell ' + (cell.status === '不合' ? 'fail' : cell.status === '待判' ? 'pending' : 'pass'));
        card.type = 'button';
        card.title = '点击定位原文中的这个字';
        card.append(node('b', cell.char), node('small', '第 ' + cell.line + ' 句 · 第 ' + cell.pos + ' 字'),
          node('small', '模板：' + cell.expected + (cell.rhymeFoot ? '｜韵脚' : '')),
          node('small', '平仄：' + cell.toneStatus),
          node('small', cell.rhymeFoot ? '押韵：' + cell.rhymeStatus + (cell.rhymeReason ? '（' + cell.rhymeReason + '）' : '') : '押韵：非韵位'),
          node('small', '结果：' + cell.status));
        card.onclick = () => { input.focus(); input.setSelectionRange(cell.offset, cell.end); };
        cells.appendChild(card);
      }
      section.appendChild(cells);
      for (const cell of line.cells.filter(x => x.options.length > 1)) {
        const panel = node('div', null, 'reading-panel');
        panel.appendChild(node('strong', '第 ' + cell.line + ' 句第 ' + cell.pos + ' 字“' + cell.char + '”：' +
          (cell.sameToneHint ? '平仄由程序判定' : '请自行选读音归属')));
        panel.appendChild(node('p', '韵表未提供拼音；以下列出全部声韵归属' + (cell.sameToneHint ? '。' + cell.sameToneHint : '。')));
        const list = node('ul');
        for (const option of cell.options) list.appendChild(node('li', readingLabel(option)));
        panel.appendChild(list);
        if (cell.needsReadingSelection) {
          const label = node('label', cell.sameToneHint ? '只为辨明韵脚归属而选择' : '选择该处读音归属');
          const select = node('select', null, 'reading-select');
          const blank = node('option', '未选择：保持待判'); blank.value = ''; select.appendChild(blank);
          for (const option of cell.options) {
            const item = node('option', readingLabel(option)); item.value = option.section + '/' + option.group;
            select.appendChild(item);
          }
          select.value = cell.selected || '';
          select.onchange = () => { const key = cell.line + ':' + cell.pos; if (select.value) readings[key] = select.value; else delete readings[key]; runCheck(); };
          label.appendChild(select); panel.appendChild(label);
        }
        section.appendChild(panel);
      }
      for (const cell of line.cells.filter(x => !x.options.length)) section.appendChild(node('p',
        '第 ' + cell.line + ' 句第 ' + cell.pos + ' 字“' + cell.char + '”：韵表未收录或字形无效，保留待判。'));
      target.appendChild(section);
    }
  }
  function showResultTitle() {
    const title = titleInput.value.trim();
    const heading = output.querySelector('.checked-title');
    if (!title) { heading?.remove(); return; }
    if (heading) heading.textContent = title;
    else output.prepend(node('h4', title, 'checked-title'));
  }
  function runCheck() {
    if (!resources) return;
    const result = MeterChecker.inspect(getRequest(), resources);
    output.replaceChildren();
    if (result.kind === 'checked') { showChecked(result); showResultTitle(); return; }
    if (result.kind === 'ranked') {
      summary.className = 'tool-status';
      summary.textContent = result.message + (result.best.length > 1 ? '其中 ' + result.best.length + ' 个模板并列；下方逐一展示，不判定唯一诗格。' : '下方展示错误最少的模板。');
      if (!result.best.some(item => item.result.template.id === activePreview)) activePreview = result.best[0].result.template.id;
      result.best.forEach(item => {
        const details = node('details', null, 'card lesson-notes');
        details.open = item.result.template.id === activePreview;
        details.ontoggle = () => { if (details.open) activePreview = item.result.template.id; };
        details.appendChild(node('summary', item.result.template.type + ' · ' + item.result.template.pattern +
          '｜确定错误 ' + item.errors + ' 处｜待判字位 ' + item.result.pending + ' 处'));
        const body = node('div'); showChecked(item.result, body, false); details.appendChild(body);
        output.appendChild(details);
      });
      showResultTitle();
      return;
    }
    summary.className = 'tool-status'; summary.textContent = result.message;
    if (result.kind === 'needLinePosition') byId('check-line').focus();
  }
  byId('check-run').onclick = runCheck;
  titleInput.oninput = () => { if (output.childElementCount) showResultTitle(); };
  input.oninput = () => { for (const key of Object.keys(readings)) delete readings[key];
    activePreview = null;
    output.replaceChildren(); summary.className = 'tool-status'; summary.textContent = '原文已修改，请重新检测。'; };
  for (const id of ['check-type', 'check-template']) byId(id).onchange = () => { syncLineOptions(); runCheck(); };
  for (const id of ['check-start', 'check-first', 'check-system', 'check-group', 'check-line'])
    byId(id).onchange = runCheck;
})();
