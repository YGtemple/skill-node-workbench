/* 本机单元测试：技能解析、序列化、模板渲染、ZIP 读取
 * 运行：node tests/test-skill-format.js */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const F = require('../lib/skill-format.js');

const ROOT = path.join(__dirname, '..');

/* 1. 解析内置技能 */
const source = fs.readFileSync(path.join(ROOT, 'skills/builtin.js'), 'utf8');
assert.ok(source.includes('window.BUILTIN_SKILL_MD'), '内置技能文件结构变化');
const mdList = [];
const re = /`---\n([\s\S]*?)\n`/g;
let m;
while ((m = re.exec(source))) mdList.push('---\n' + m[1] + '\n');

assert.ok(mdList.length >= 9, `内置技能数量不足：${mdList.length}`);
const parsed = mdList.map((md, i) => F.parseSkillMd(md, '内置' + i));
for (const s of parsed) {
  assert.ok(s.id, `技能缺少 id：${s.name}`);
  assert.ok(s.name, `技能缺少名称：${s.id}`);
  assert.ok(['analysis', 'script', 'artPrompts', 'assets', 'storyboard', 'shotPrompts', 'pack', 'final'].includes(s.node), `${s.id} 的 node 不合法：${s.node}`);
  assert.ok(s.template, `${s.id} 没有模板`);
}
const ids = new Set(parsed.map((s) => s.id));
assert.strictEqual(ids.size, parsed.length, '内置技能 id 有重复');

/* 2. 序列化可往返 */
for (const s of parsed) {
  const round = F.parseSkillMd(F.serializeSkill(s), s.name);
  assert.strictEqual(round.id, s.id, '序列化后 id 不一致');
  assert.strictEqual(round.node, s.node, '序列化后 node 不一致');
  assert.strictEqual(round.template.trim(), s.template.trim(), '序列化后模板不一致');
}

/* 3. 模板渲染与缺省值 */
const vars = {brief: '门机穿越', style: '工业史诗', ratio: '16:9', duration: 60, sceneCount: 7, analysis: {theme: '穿越'}};
assert.strictEqual(F.renderTemplate('创意：{{brief}} / {{ratio}}', vars), '创意：门机穿越 / 16:9');
assert.strictEqual(F.renderTemplate('主题：{{analysis.theme}}', vars), '主题：穿越');
assert.strictEqual(F.renderTemplate('缺：{{nothing}}', vars), '缺：［未提供 nothing］');
assert.strictEqual(F.renderTemplate('{{duration}}', vars), '60');
assert.deepStrictEqual(F.placeholdersOf('{{a}} {{b}} {{a}}'), ['a', 'b']);

/* 4. 内置技能模板里的占位符都能被运行时变量覆盖，或只是下游节点键 */
const KNOWN = ['brief', 'style', 'ratio', 'duration', 'sceneCount',
  'analysis', 'script', 'artPrompts', 'assets', 'storyboard', 'shotPrompts', 'pack', 'final'];
for (const s of parsed) {
  for (const ph of F.placeholdersOf(s.template)) {
    const head = ph.split('.')[0];
    assert.ok(KNOWN.includes(head), `${s.id} 使用了未知占位符：${ph}`);
  }
}

/* 5. ZIP 读取（store 与 deflate 都要能解） */
const zipPath = path.join(ROOT, 'tests', 'fixtures', 'sample.zip');
if (fs.existsSync(zipPath)) {
  const buf = new Uint8Array(fs.readFileSync(zipPath));
  const entries = F.readZip(buf, (raw) => zlib.inflateRawSync(Buffer.from(raw)));
  assert.ok(entries.length >= 1, 'ZIP 未读出文件');
  const md = entries.find((e) => /\.md$/.test(e.name));
  assert.ok(md, 'ZIP 里没有 md 文件');
  assert.ok(md.text.includes('## 模板') || md.text.includes('## 系统提示词'), 'ZIP 内 md 内容不完整');
  const bundle = F.skillsFromFiles(entries);
  assert.ok(bundle.skills.length >= 1, 'ZIP 未解析出技能');
} else {
  console.log('· 跳过 ZIP 用例（未找到 fixtures/sample.zip）');
}

/* 6. 只有说明没有模板的文件应被跳过 */
const bundle2 = F.skillsFromFiles([{name: 'readme.md', text: '# 说明\n没有技能头'}]);
assert.strictEqual(bundle2.skills.length, 0, '无技能头的文件不应被解析');

console.log(`通过：${parsed.length} 个内置技能 · 解析/序列化/渲染/ZIP 用例全部通过`);
