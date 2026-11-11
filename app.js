/* 技能节点工作台 · 主程序
 * 九节点流水线 + 可上传技能 + 节点绑定 + 提示词装配 + 可选模型通道
 * 全部数据留在本机浏览器，不上传、不写入任何文件 */
(function () {
  'use strict';

  const F = window.SkillFormat;
  const LS_KEY = 'skill-node-workbench.v1';

  const NODES = [
    {id: 'input', name: '一句话创意', desc: '流程起点，只接收一句创意与参数，不绑定技能。'},
    {id: 'analysis', name: '创意分析', desc: '把一句话创意拆成主题、受众、钩子、核心信息与视觉基调，作为后面所有节点的依据。'},
    {id: 'script', name: '剧本脚本', desc: '按分析结果写出镜头级剧本，每场带旁白、字幕与画面描述。'},
    {id: 'artPrompts', name: '美术提示词', desc: '把剧本场景翻译成可投喂生图模型的提示词，统一机位、光线、材质与负向词。'},
    {id: 'assets', name: '美术资产', desc: '把提示词整理成批量生图任务单，支持单张重试、超时与落盘路径。'},
    {id: 'storyboard', name: '拆解分镜', desc: '剧本与美术资产对齐成镜头表：镜号、时长、机位、画面、字幕。'},
    {id: 'shotPrompts', name: '每镜视频提示词', desc: '把每一镜写成可提交的视频提示词，一镜一段，互不引用。'},
    {id: 'pack', name: '视频任务包', desc: '把逐镜提示词与素材路径打包成可交付、可复用的任务包。'},
    {id: 'final', name: '最终成片', desc: '成片验收：时长、字幕、画面、事实表述与 AI 生成声明。'},
  ];
  const NODE_MAP = {};
  NODES.forEach((n) => {NODE_MAP[n.id] = n;});
  const SKILL_NODES = NODES.filter((n) => n.id !== 'input');

  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  const state = {
    view: 'pipeline',
    selectedNode: 'analysis',
    skills: [],
    bindings: {},
    brief: '用名场面穿越的方式，让 3800 吨门机与愚公移山同框，收尾落到新中式起重机的真实参数。',
    params: {style: '工业史诗', ratio: '16:9', duration: 60, sceneCount: 7},
    channel: {base_url: '', model: '', api_key: ''},
    run: null,
    editing: null,
    busy: false,
  };

  /* ---------------- 持久化 ---------------- */
  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        skills: state.skills, bindings: state.bindings, brief: state.brief,
        params: state.params, channel: state.channel,
      }));
    } catch (e) { /* 本机存储不可用时仅保留在内存 */ }
  }

  function loadState() {
    const builtin = (window.BUILTIN_SKILL_MD || []).map((md, i) => {
      const s = F.parseSkillMd(md, '内置技能' + (i + 1));
      s.origin = 'builtin';
      return s;
    });
    let saved = null;
    try {saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');} catch (e) {saved = null;}
    state.skills = builtin.concat([]);
    if (saved && Array.isArray(saved.skills)) {
      const merged = builtin.slice();
      for (const s of saved.skills) {
        const idx = merged.findIndex((x) => x.id === s.id);
        if (idx >= 0) merged[idx] = Object.assign({}, merged[idx], s);
        else merged.push(s);
      }
      state.skills = merged;
      if (saved.bindings) state.bindings = saved.bindings;
      if (typeof saved.brief === 'string' && saved.brief) state.brief = saved.brief;
      if (saved.params) state.params = Object.assign(state.params, saved.params);
      if (saved.channel) state.channel = Object.assign(state.channel, saved.channel);
    }
    if (!Object.keys(state.bindings).length) defaultBindings();
    // 清理指向已删除技能的绑定
    for (const n of SKILL_NODES) {
      const list = (state.bindings[n.id] || []).filter((id) => state.skills.some((s) => s.id === id));
      state.bindings[n.id] = list;
    }
  }

  function defaultBindings() {
    const out = {};
    for (const n of SKILL_NODES) {
      const cands = state.skills.filter((s) => s.node === n.id).sort((a, b) => a.order - b.order);
      out[n.id] = cands.slice(0, 1).map((s) => s.id);
    }
    state.bindings = out;
  }

  /* ---------------- 绑定查询 ---------------- */
  const skillById = (id) => state.skills.find((s) => s.id === id) || null;
  const boundSkills = (nodeId) => (state.bindings[nodeId] || []).map(skillById).filter(Boolean);
  const primarySkill = (nodeId) => boundSkills(nodeId)[0] || null;

  function candidatesFor(nodeId) {
    return state.skills
      .filter((s) => s.node === nodeId || s.node === 'any')
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  /* ---------------- 视图 ---------------- */
  function showView(name) {
    state.view = name;
    for (const v of ['pipeline', 'library', 'run']) {
      const el = $('#view-' + v);
      if (el) el.classList.toggle('hidden', v !== name);
    }
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'pipeline') {
      $('#bannerTitle').textContent = '技能已就绪';
      $('#bannerText').textContent = '每个节点当前绑定的技能在画布上直接可见，点击节点即可更换、排序或解绑。';
    }
    if (name === 'library') renderLibrary();
    if (name === 'run') renderRun();
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  function askConfirm(text, okText) {
    return new Promise((resolve) => {
      const dlg = $('#confirmDialog');
      $('#confirmText').textContent = text;
      $('#confirmYes').textContent = okText || '确定';
      const finish = (v) => {
        $('#confirmYes').onclick = null;
        $('#confirmNo').onclick = null;
        dlg.oncancel = null;
        if (dlg.open) dlg.close();
        resolve(v);
      };
      $('#confirmYes').onclick = () => finish(true);
      $('#confirmNo').onclick = () => finish(false);
      dlg.oncancel = (e) => {e.preventDefault(); finish(false);};
      dlg.showModal();
    });
  }

  /* ---------------- 画布 ---------------- */
  function renderPipeline() {
    const boundCount = SKILL_NODES.filter((n) => boundSkills(n.id).length).length;
    $('#bannerMeta').textContent = `${state.skills.length} 个技能 · ${boundCount}/${SKILL_NODES.length} 个节点已绑定`;
    $('#modeHint').textContent = channelReady() ? '模型通道已配置，一键拆解会真实调用' : '未配置模型通道，按技能模板在本地装配';
    $('#flowMeta').textContent = `${state.params.sceneCount} 镜 · ${state.params.duration} 秒 · ${state.params.ratio}`;

    $('#flowNodes').innerHTML = NODES.map((n, i) => {
      const bound = boundSkills(n.id);
      const isInput = n.id === 'input';
      const skills = isInput ? '流程起点' : (bound.length ? bound[0].name + (bound.length > 1 ? ` +${bound.length - 1}` : '') : '未绑定技能');
      const cls = isInput ? '' : (bound.length ? 'ok' : 'empty warn');
      const active = state.selectedNode === n.id ? 'active' : '';
      return `${i ? '<span class="flow-arrow">→</span>' : ''}<button class="flow-node ${cls} ${active}" data-node="${n.id}">
        <div class="node-top"><span class="node-index">${String(i).padStart(2, '0')}</span><span class="node-dot"></span></div>
        <div class="node-name">${esc(n.name)}</div>
        <div class="node-meta">${esc(skills)}</div></button>`;
    }).join('');

    document.querySelectorAll('.flow-node').forEach((el) => {
      el.onclick = () => {state.selectedNode = el.dataset.node; renderNodePanel(); renderPipeline();};
    });
    renderNodePanel();
  }

  function varsFor(nodeId) {
    const vars = {
      brief: state.brief,
      style: state.params.style,
      ratio: state.params.ratio,
      duration: state.params.duration,
      sceneCount: state.params.sceneCount,
    };
    for (const n of SKILL_NODES) {
      const out = state.run && state.run.outputs ? state.run.outputs[n.id] : '';
      vars[n.id] = out || `［${n.name}产出］`;
    }
    return vars;
  }

  function renderNodePanel() {
    const node = NODE_MAP[state.selectedNode] || NODE_MAP.analysis;
    const bound = boundSkills(node.id);
    const opts = candidatesFor(node.id).filter((s) => !(state.bindings[node.id] || []).includes(s.id));

    if (node.id === 'input') {
      $('#nodePanel').innerHTML = `<div class="node-panel-head"><div><h2>${esc(node.name)}</h2><div class="sub">${esc(node.desc)}</div></div></div>
        <pre>${esc(state.brief)}</pre>`;
      return;
    }

    const rows = bound.length ? bound.map((s, i) => `
      <div class="bind-row ${i === 0 ? '' : 'off'}">
        <span class="ord">${i + 1}</span>
        <div><div class="nm">${esc(s.name)}</div><div class="meta">${esc(s.kind)} · v${esc(s.version)} · ${esc(s.summary ? s.summary.slice(0, 46) : '无说明')}</div></div>
        <div class="spacer"></div>
        <div class="ops">
          <button class="mini" data-act="up" data-id="${esc(s.id)}">上移</button>
          <button class="mini" data-act="down" data-id="${esc(s.id)}">下移</button>
          <button class="mini danger" data-act="unbind" data-id="${esc(s.id)}">解绑</button>
          <button class="mini" data-act="edit" data-id="${esc(s.id)}">编辑</button>
        </div>
      </div>`).join('') : `<div class="bind-row off"><div class="nm">未绑定技能</div><div class="meta">这个节点不会产出内容，先添加一个技能</div></div>`;

    const preview = bound[0]
      ? F.renderTemplate([bound[0].system, bound[0].template].filter(Boolean).join('\n\n'), varsFor(node.id))
      : '先在上方选择技能，这里会显示装配后的完整提示词。';

    $('#nodePanel').innerHTML = `
      <div class="node-panel-head">
        <div><h2>${esc(node.name)}</h2><div class="sub">${esc(node.desc)}</div></div>
        <div class="hint">第 ${NODES.findIndex((n) => n.id === node.id)} 步 · 已绑定 ${bound.length} 个技能</div>
      </div>
      <b style="font-size:12px;color:var(--muted)">节点技能（第一个为当前生效）</b>
      <div class="bind-list">${rows}</div>
      <div class="add-row">
        <select id="addSkill">${opts.length ? opts.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · v${esc(s.version)}</option>`).join('') : '<option value="">该节点暂无可添加技能</option>'}</select>
        <button class="btn small" id="addBindBtn" ${opts.length ? '' : 'disabled'}>添加到此节点</button>
        <button class="btn small" id="goLibraryBtn">去技能库上传</button>
      </div>
      <div class="preview-head"><b style="font-size:12px;color:var(--muted)">装配预览（含当前参数）</b><button class="btn small" id="copyPreview">复制提示词</button></div>
      <pre id="previewBox">${esc(preview)}</pre>`;

    document.querySelectorAll('#nodePanel [data-act]').forEach((el) => {
      el.onclick = () => nodeAction(el.dataset.act, el.dataset.id);
    });
    const addBtn = $('#addBindBtn');
    if (addBtn) addBtn.onclick = () => {
      const id = $('#addSkill').value;
      if (!id) return;
      state.bindings[node.id] = (state.bindings[node.id] || []).concat([id]);
      saveState(); renderPipeline(); toast('已绑定到「' + node.name + '」');
    };
    $('#goLibraryBtn').onclick = () => showView('library');
    $('#copyPreview').onclick = () => copyText($('#previewBox').textContent, '提示词已复制');
  }

  function nodeAction(act, id) {
    const nodeId = state.selectedNode;
    const list = state.bindings[nodeId] || [];
    const idx = list.indexOf(id);
    if (act === 'unbind') {
      state.bindings[nodeId] = list.filter((x) => x !== id);
      toast('已解绑');
    } else if (act === 'up' && idx > 0) {
      list.splice(idx - 1, 0, list.splice(idx, 1)[0]);
      toast('顺序已调整');
    } else if (act === 'down' && idx >= 0 && idx < list.length - 1) {
      list.splice(idx + 1, 0, list.splice(idx, 1)[0]);
      toast('顺序已调整');
    } else if (act === 'edit') {
      openEditor(skillById(id));
      return;
    }
    saveState();
    renderPipeline();
  }

  /* ---------------- 技能库 ---------------- */
  function renderLibrary() {
    const filterNode = $('#libNodeFilter').value;
    const keyword = ($('#libSearch').value || '').trim().toLowerCase();
    const list = state.skills.filter((s) => {
      if (filterNode && s.node !== filterNode) return false;
      if (!keyword) return true;
      return [s.name, s.id, s.summary, (s.tags || []).join(' '), s.node].join(' ').toLowerCase().includes(keyword);
    });

    const total = state.skills.length;
    $('#bannerTitle').textContent = '技能库';
    $('#bannerText').textContent = `共 ${total} 个技能，可用 .md 单文件或 .zip 技能包上传；skills/ 目录里的格式示例可直接改。`;
    $('#bannerMeta').textContent = `${total} 个技能`;

    $('#skillGrid').innerHTML = list.length ? list.map((s) => {
      const boundHere = (state.bindings[s.node] || []).includes(s.id);
      const nodeLabel = s.node === 'any' ? '任意节点' : (NODE_MAP[s.node] ? NODE_MAP[s.node].name : s.node);
      return `<div class="skill-card">
        <div class="top"><h3>${esc(s.name)}</h3><div class="badges">
          <span class="badge node">${esc(nodeLabel)}</span>
          <span class="badge kind">${esc(s.kind)}</span>
          <span class="badge ${s.origin === 'builtin' ? 'builtin' : 'custom'}">${s.origin === 'builtin' ? '内置' : '上传'}</span>
        </div></div>
        <div class="sum">${esc(s.summary || '暂无说明')}</div>
        <div class="tagline">v${esc(s.version)} · ${esc(s.id)}${(s.tags || []).length ? ' · ' + esc(s.tags.join(' / ')) : ''}</div>
        <div class="ops">
          <button class="mini" data-lib="bind" data-id="${esc(s.id)}">${boundHere ? '取消绑定' : '绑定到节点'}</button>
          <button class="mini" data-lib="preview" data-id="${esc(s.id)}">查看</button>
          <button class="mini" data-lib="edit" data-id="${esc(s.id)}">编辑</button>
          <button class="mini" data-lib="export" data-id="${esc(s.id)}">导出</button>
          <button class="mini danger" data-lib="del" data-id="${esc(s.id)}">删除</button>
        </div>
      </div>`;
    }).join('') : `<div class="empty-box">没有匹配的技能。上传一个 .md 技能，或换一个筛选条件。</div>`;

    document.querySelectorAll('[data-lib]').forEach((el) => {
      el.onclick = () => libraryAction(el.dataset.lib, el.dataset.id);
    });
  }

  async function libraryAction(act, id) {
    const s = skillById(id);
    if (!s) return;
    if (act === 'bind') {
      if (s.node === 'any') {toast('这个技能适用于任意节点，请在节点面板里添加'); showView('pipeline'); return;}
      const list = state.bindings[s.node] || [];
      state.bindings[s.node] = list.includes(id) ? list.filter((x) => x !== id) : list.concat([id]);
      saveState(); renderLibrary(); renderPipeline();
      toast(list.includes(id) ? '已取消绑定' : `已绑定到「${NODE_MAP[s.node].name}」`);
      return;
    }
    if (act === 'preview') {
      state.selectedNode = s.node === 'any' ? 'analysis' : s.node;
      showView('pipeline');
      toast('已在节点面板显示装配预览');
      return;
    }
    if (act === 'edit') {openEditor(s); return;}
    if (act === 'export') {exportSkill(s); return;}
    if (act === 'del') {
      const yes = await askConfirm(`删除技能「${s.name}」？内置技能可以用“恢复内置技能”找回来。`, '删除');
      if (!yes) return;
      state.skills = state.skills.filter((x) => x.id !== id);
      for (const k of Object.keys(state.bindings)) state.bindings[k] = state.bindings[k].filter((x) => x !== id);
      saveState(); renderLibrary(); renderPipeline(); toast('已删除');
    }
  }

  /* ---------------- 上传 ---------------- */
  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const entries = F.readZip(bytes, inflateRaw);
          const parsed = F.skillsFromFiles(entries);
          added += await adoptSkills(parsed.skills);
          if (parsed.skipped.length) toast(`已跳过 ${parsed.skipped.length} 个不带技能头的文件`);
        } else if (/\.json$/i.test(file.name)) {
          const data = JSON.parse(await file.text());
          const arr = Array.isArray(data) ? data : data.skills;
          if (!Array.isArray(arr)) throw new Error('JSON 里没有 skills 数组');
          added += await adoptSkills(arr.map(normalizeSkill));
        } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
          const text = await file.text();
          const skill = F.parseSkillMd(text, file.name.replace(/\.(md|markdown|txt)$/i, ''));
          if (!skill.template && !skill.system) throw new Error('这份 Markdown 里没有「## 模板」或「## 系统提示词」段落');
          added += await adoptSkills([skill]);
        } else {
          throw new Error('只支持 .md / .zip / .json');
        }
      } catch (err) {
        toast(`${file.name}：${err.message}`);
      }
    }
    if (added) {
      saveState();
      renderLibrary(); renderPipeline();
      toast(`已载入 ${added} 个技能`);
    }
  }

  function normalizeSkill(raw) {
    const base = F.parseSkillMd(typeof raw.raw === 'string' ? raw.raw : F.serializeSkill(raw), raw.name);
    return Object.assign(base, {
      id: raw.id || base.id, name: raw.name || base.name, node: raw.node || base.node,
      kind: raw.kind || base.kind, version: String(raw.version || base.version),
      summary: raw.summary || base.summary, system: raw.system || base.system,
      template: raw.template || base.template, tags: raw.tags || base.tags, origin: 'uploaded',
    });
  }

  async function adoptSkills(skills) {
    let added = 0;
    for (const s of skills) {
      if (!s.template && !s.system) continue;
      const exist = state.skills.find((x) => x.id === s.id);
      if (exist) {
        const yes = await askConfirm(`已存在同 id 技能「${exist.name}」，用上传的版本替换？`, '替换');
        if (!yes) continue;
        state.skills = state.skills.map((x) => (x.id === s.id ? Object.assign(s, {origin: s.origin || 'uploaded'}) : x));
        added += 1;
        continue;
      }
      s.origin = s.origin || 'uploaded';
      state.skills.push(s);
      added += 1;
      if (s.node !== 'any' && NODE_MAP[s.node] && !(state.bindings[s.node] || []).length) {
        state.bindings[s.node] = [s.id];
      }
    }
    return added;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 zip 解压，请改为上传 .md 文件');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function exportSkill(s) {
    download(F.serializeSkill(s), `${s.id || 'skill'}.md`, 'text/markdown;charset=utf-8');
    toast('技能已导出为 .md');
  }

  function exportAll() {
    download(JSON.stringify({version: '1.0', exportedAt: new Date().toISOString(), skills: state.skills, bindings: state.bindings}, null, 2),
      '技能集合.json', 'application/json;charset=utf-8');
    toast('全部技能与绑定关系已导出');
  }

  function download(text, filename, mime) {
    const blob = new Blob([text], {type: mime || 'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {URL.revokeObjectURL(a.href); a.remove();}, 1200);
  }

  function copyText(text, okMsg) {
    const done = () => toast(okMsg || '已复制');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try {document.execCommand('copy');} catch (e) {toast('复制失败，请手动选择文本');}
    ta.remove(); done();
  }

  /* ---------------- 编辑 ---------------- */
  function openEditor(skill) {
    if (!skill) return;
    state.editing = skill;
    $('#editTitle').textContent = '编辑技能 · ' + skill.name;
    $('#editText').value = F.serializeSkill(skill);
    $('#editDialog').showModal();
  }

  function saveEditor() {
    const text = $('#editText').value;
    const parsed = F.parseSkillMd(text, state.editing ? state.editing.name : '未命名技能');
    if (!parsed.template && !parsed.system) {toast('保存失败：至少要有一段「## 模板」或「## 系统提示词」'); return;}
    parsed.id = state.editing.id;
    parsed.origin = state.editing.origin || 'uploaded';
    state.skills = state.skills.map((x) => (x.id === parsed.id ? parsed : x));
    saveState(); $('#editDialog').close(); renderLibrary(); renderPipeline();
    toast('技能已保存');
  }

  /* ---------------- 模型通道 ---------------- */
  const channelReady = () => Boolean(state.channel.base_url && state.channel.model && state.channel.api_key);

  async function callModel(system, user) {
    const base = String(state.channel.base_url).replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${state.channel.api_key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: state.channel.model,
        messages: [
          {role: 'system', content: system || '你是资深内容策划，只输出结构化结果。'},
          {role: 'user', content: user},
        ],
        temperature: 0.7,
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`接口返回 ${res.status}：${raw.slice(0, 160)}`);
    let data;
    try {data = JSON.parse(raw);} catch (e) {throw new Error('接口返回不是合法 JSON');}
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error('接口没有返回内容');
    return String(out).trim();
  }

  /* ---------------- 运行 ---------------- */
  function collectInputs() {
    return {
      brief: ($('#brief').value || '').trim(),
      style: $('#pStyle').value,
      ratio: $('#pRatio').value,
      duration: Number($('#pDuration').value) || 60,
      sceneCount: Number($('#pScenes').value) || 7,
    };
  }

  async function runPipeline(forceAssemble) {
    if (state.busy) return;
    const inputs = collectInputs();
    if (!inputs.brief) {toast('先写一句创意，再开始拆解'); $('#brief').focus(); return;}

    state.brief = inputs.brief;
    state.params = {style: inputs.style, ratio: inputs.ratio, duration: inputs.duration, sceneCount: inputs.sceneCount};
    saveState();

    const mode = forceAssemble || !channelReady() ? 'assemble' : 'live';
    state.busy = true;
    $('#runBtn').disabled = true;
    state.run = {
      mode, brief: inputs.brief, params: state.params, startedAt: new Date().toISOString(),
      steps: [], outputs: {},
    };
    showView('run');
    renderRun();

    for (const node of SKILL_NODES) {
      const skill = primarySkill(node.id);
      if (!skill) {
        state.run.steps.push({node: node.id, nodeName: node.name, skill: null, prompt: '', output: '', error: '该节点未绑定技能'});
        renderRun();
        continue;
      }
      const vars = varsFor(node.id);
      const system = F.renderTemplate(skill.system, vars);
      const prompt = F.renderTemplate(skill.template, vars);
      const step = {node: node.id, nodeName: node.name, skill: {id: skill.id, name: skill.name, version: skill.version}, system, prompt, output: '', error: ''};
      state.run.steps.push(step);
      renderRun();

      if (mode === 'live') {
        try {
          step.output = await callModel(system, prompt);
          state.run.outputs[node.id] = step.output;
        } catch (err) {
          step.error = err.message;
          state.run.outputs[node.id] = `［${node.name} 调用失败］`;
        }
      } else {
        state.run.outputs[node.id] = `［${node.name} 产出］`;
      }
      renderRun();
    }

    state.busy = false;
    $('#runBtn').disabled = false;
    renderPipeline();
    renderRun();
    toast(mode === 'live' ? '全流程已跑完' : '提示词已按节点装配完成');
  }

  function renderRun() {
    const run = state.run;
    if (!run) {
      $('#runSummary').textContent = '还没有运行记录。回到流水线编排，写一句创意后点「一键拆解」。';
      $('#runSteps').innerHTML = `<div class="empty-box">还没有拆解记录</div>`;
      return;
    }
    const done = run.steps.filter((s) => s.prompt).length;
    const ok = run.steps.filter((s) => s.output).length;
    const failed = run.steps.filter((s) => s.error).length;
    $('#runSummary').textContent = `${run.mode === 'live' ? '模型通道执行' : '本地装配'} · 节点 ${run.steps.length}/${SKILL_NODES.length} · ${run.mode === 'live' ? `有产出 ${ok}` : `提示词已装配 ${done}`} · 异常 ${failed} · ${run.brief.slice(0, 40)}`;

    $('#runSteps').innerHTML = run.steps.map((s, i) => {
      const stateText = s.error ? '异常' : (s.output ? '已完成' : (s.prompt ? (run.mode === 'live' ? '待执行' : '已装配') : '未执行'));
      return `<div class="step ${s.error ? 'warn' : ''}">
        <div class="step-head"><span class="idx">${String(i + 1).padStart(2, '0')}</span>
          <strong>${esc(s.nodeName)}</strong>
          <span class="chip">${esc(s.skill ? s.skill.name + ' · v' + s.skill.version : '未绑定技能')}</span>
          <span class="state">${stateText}</span></div>
        <div class="step-body ${s.output ? '' : 'single'}">
          <div class="col"><b>装配后的提示词</b><pre>${esc(s.system ? s.system + '\n\n' : '')}${esc(s.prompt || '（无模板）')}</pre></div>
          ${s.output ? `<div class="col"><b>节点产出</b><pre>${esc(s.output)}</pre></div>` : (s.error ? `<div class="col"><b>异常</b><pre>${esc(s.error)}</pre></div>` : '')}
        </div></div>`;
    }).join('');
  }

  function buildTaskPack() {
    const run = state.run;
    const pack = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      brief: state.brief,
      params: state.params,
      mode: run ? run.mode : 'assemble',
      steps: (run ? run.steps : SKILL_NODES.map((n) => ({node: n.id, nodeName: n.name, skill: primarySkill(n.id) ? {id: primarySkill(n.id).id, name: primarySkill(n.id).name} : null, prompt: '', output: ''}))).map((s) => ({
        node: s.node, nodeName: s.nodeName, skill: s.skill,
        prompt: (s.system ? s.system + '\n\n' : '') + (s.prompt || ''),
        output: s.output || '',
      })),
      notes: '每一步的技能与提示词都在 steps 里，替换技能只需换对应节点的 skill，不影响其他环节。',
    };
    download(JSON.stringify(pack, null, 2), `任务包-${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');
    toast('任务包已导出');
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents() {
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => {b.onclick = () => showView(b.dataset.view);});

    $('#brief').value = state.brief;
    $('#pStyle').value = state.params.style;
    $('#pRatio').value = state.params.ratio;
    $('#pDuration').value = state.params.duration;
    $('#pScenes').value = state.params.sceneCount;

    $('#brief').oninput = (e) => {state.brief = e.target.value; saveState(); renderPipeline();};
    $('#pStyle').onchange = (e) => {state.params.style = e.target.value; saveState(); renderPipeline();};
    $('#pRatio').onchange = (e) => {state.params.ratio = e.target.value; saveState(); renderPipeline();};
    $('#pDuration').oninput = (e) => {state.params.duration = Number(e.target.value) || 60; saveState(); renderPipeline();};
    $('#pScenes').oninput = (e) => {state.params.sceneCount = Number(e.target.value) || 7; saveState(); renderPipeline();};

    $('#runBtn').onclick = () => runPipeline(false);
    $('#assembleBtn').onclick = () => runPipeline(true);
    $('#packBtn').onclick = () => buildTaskPack();
    $('#copyAllBtn').onclick = () => {
      if (!state.run) return toast('还没有拆解结果');
      copyText(state.run.steps.map((s) => `【${s.nodeName}】\n${(s.system ? s.system + '\n\n' : '') + (s.prompt || '')}`).join('\n\n———\n\n'), '全部提示词已复制');
    };
    $('#downloadRunBtn').onclick = () => buildTaskPack();

    $('#restoreBtn').onclick = async () => {
      const yes = await askConfirm('恢复内置技能会重新载入全部内置技能，已上传的技能保留。继续？', '恢复');
      if (!yes) return;
      const builtin = (window.BUILTIN_SKILL_MD || []).map((md, i) => {
        const s = F.parseSkillMd(md, '内置技能' + (i + 1)); s.origin = 'builtin'; return s;
      });
      for (const s of builtin) {
        const idx = state.skills.findIndex((x) => x.id === s.id);
        if (idx >= 0) state.skills[idx] = s; else state.skills.push(s);
      }
      saveState(); renderLibrary(); renderPipeline(); toast('内置技能已恢复');
    };
    $('#exportAllBtn').onclick = exportAll;

    $('#libNodeFilter').onchange = renderLibrary;
    $('#libSearch').oninput = renderLibrary;
    $('#libNodeFilter').innerHTML = '<option value="">所有节点</option>' +
      SKILL_NODES.map((n) => `<option value="${n.id}">${n.name}</option>`).join('');

    const zone = $('#dropZone');
    const input = $('#fileInput');
    zone.onclick = () => input.click();
    input.onclick = (e) => e.stopPropagation();
    input.onchange = (e) => {handleFiles(e.target.files); input.value = '';};
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {e.preventDefault(); zone.classList.add('drag');}));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {e.preventDefault(); zone.classList.remove('drag');}));
    zone.addEventListener('drop', (e) => {if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);});

    $('#editSave').onclick = saveEditor;
    $('#editCancel').onclick = () => $('#editDialog').close();
    $('#editClose').onclick = () => $('#editDialog').close();

    $('#channelBtn').onclick = () => {
      $('#chBase').value = state.channel.base_url;
      $('#chModel').value = state.channel.model;
      $('#chKey').value = state.channel.api_key;
      $('#chNote').textContent = channelReady() ? '当前已配置，一键拆解会真实调用。' : '当前未配置，一键拆解按模板在本地装配。';
      $('#channelDialog').showModal();
    };
    $('#channelClose').onclick = () => $('#channelDialog').close();
    $('#chSave').onclick = () => {
      state.channel = {base_url: $('#chBase').value.trim(), model: $('#chModel').value.trim(), api_key: $('#chKey').value.trim()};
      saveState(); $('#channelDialog').close(); renderPipeline();
      toast(channelReady() ? '模型通道已保存' : '通道信息不完整，仍按本地装配');
    };
    $('#chClear').onclick = () => {
      state.channel = {base_url: '', model: '', api_key: ''};
      $('#chBase').value = ''; $('#chModel').value = ''; $('#chKey').value = '';
      saveState(); renderPipeline(); toast('通道已清除');
    };
    $('#chTest').onclick = async () => {
      const base = $('#chBase').value.trim().replace(/\/$/, '');
      const model = $('#chModel').value.trim();
      const key = $('#chKey').value.trim();
      if (!base || !model || !key) return toast('先填完整地址、模型名和 Key');
      $('#chNote').textContent = '正在测试…';
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({model, messages: [{role: 'user', content: '回复 ok'}], max_tokens: 8}),
        });
        const raw = await res.text();
        $('#chNote').textContent = res.ok ? '连接正常，可以真实调用。' : `失败 ${res.status}：${raw.slice(0, 120)}`;
      } catch (err) {
        $('#chNote').textContent = '请求失败：' + err.message;
      }
    };
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    loadState();
    bindEvents();
    renderPipeline();
    renderRun();
    renderLibrary();
    showView('pipeline');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
