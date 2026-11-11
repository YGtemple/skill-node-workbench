/* 技能格式层：Markdown 技能解析、序列化、模板渲染、ZIP 读取
 * 纯函数，浏览器与 Node 共用；ZIP 解压通过注入 inflateRaw 实现，便于本机测试 */
(function (root) {
  'use strict';

  const SLUG_MAP = /[^a-z0-9\u4e00-\u9fa5]+/gi;

  function slugify(name, node) {
    const base = String(name || '')
      .trim()
      .toLowerCase()
      .replace(SLUG_MAP, '-')
      .replace(/^-+|-+$/g, '');
    const suffix = node && node !== 'any' ? '-' + node : '';
    return (base || 'skill') + suffix;
  }

  /* ---------- Front matter ---------- */
  function splitFrontMatter(text) {
    const t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!t.startsWith('---')) return {meta: {}, body: t};
    const end = t.indexOf('\n---', 3);
    if (end < 0) return {meta: {}, body: t};
    const header = t.slice(3, end).trim();
    const body = t.slice(end + 4).replace(/^\n/, '');
    const meta = {};
    for (const line of header.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*:\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim().replace(/^["']|["']$/g, '');
      if (v.startsWith('[') && v.endsWith(']')) {
        v = v.slice(1, -1).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
      }
      meta[m[1].trim()] = v;
    }
    return {meta, body};
  }

  function splitSections(body) {
    const buckets = {};
    let cur = '介绍';
    buckets[cur] = [];
    for (const line of String(body || '').split('\n')) {
      const m = line.match(/^##\s+(.+?)\s*$/);
      if (m) {cur = m[1].trim(); buckets[cur] = buckets[cur] || []; continue;}
      buckets[cur].push(line);
    }
    const out = {};
    for (const k of Object.keys(buckets)) out[k] = buckets[k].join('\n').trim();
    return out;
  }

  function asList(v) {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    return [];
  }

  /* ---------- 技能解析 ---------- */
  function parseSkillMd(text, fallbackName) {
    const {meta, body} = splitFrontMatter(text);
    const sec = splitSections(body);
    const name = String(meta.name || meta.title || fallbackName || '未命名技能').trim();
    const node = String(meta.node || (asList(meta.nodes)[0]) || 'any').trim();
    return {
      id: String(meta.id || slugify(name, node)).trim(),
      name: name,
      node: node,
      kind: String(meta.kind || 'text').trim(),
      version: String(meta.version || '1.0').trim(),
      order: Number(meta.order) || 1,
      tags: asList(meta.tags),
      summary: sec['说明'] || sec['描述'] || sec['介绍'] || '',
      system: sec['系统提示词'] || sec['角色'] || '',
      template: sec['模板'] || sec['提示词模板'] || '',
      check: sec['验收点'] || '',
      origin: meta.origin === 'builtin' ? 'builtin' : 'uploaded',
      raw: String(text || ''),
    };
  }

  function serializeSkill(skill) {
    const tags = asList(skill.tags).join(', ');
    const lines = [
      '---',
      'id: ' + (skill.id || ''),
      'name: ' + (skill.name || ''),
      'node: ' + (skill.node || 'any'),
      'kind: ' + (skill.kind || 'text'),
      'version: ' + (skill.version || '1.0'),
      'order: ' + (skill.order || 1),
      'tags: ' + tags,
      '---',
      '',
      '## 说明',
      skill.summary || '',
      '',
      '## 系统提示词',
      skill.system || '',
      '',
      '## 模板',
      skill.template || '',
    ];
    if (skill.check) lines.push('', '## 验收点', skill.check);
    return lines.join('\n');
  }

  /* ---------- 模板渲染 ---------- */
  function lookupVars(vars, path) {
    let cur = vars;
    for (const part of String(path).split('.')) {
      if (cur == null) return undefined;
      if (typeof cur !== 'object') return undefined;
      if (!(part in cur)) return undefined;
      cur = cur[part];
    }
    if (cur == null) return undefined;
    if (typeof cur === 'object') return JSON.stringify(cur, null, 2);
    return String(cur);
  }

  function renderTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, expr) => {
      const val = lookupVars(vars, expr);
      return val === undefined ? '［未提供 ' + expr + '］' : val;
    });
  }

  function placeholdersOf(tpl) {
    const out = [];
    const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    let m;
    while ((m = re.exec(String(tpl || '')))) if (!out.includes(m[1])) out.push(m[1]);
    return out;
  }

  /* ---------- ZIP（store / deflate-raw） ---------- */
  function readZip(bytes, inflateRaw) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const u16 = (p) => dv.getUint16(p, true);
    const u32 = (p) => dv.getUint32(p, true);

    let eocd = -1;
    const floor = Math.max(0, buf.length - 65558);
    for (let i = buf.length - 22; i >= floor; i -= 1) {
      if (u16(i) === 0x4b50 && u16(i + 2) === 0x0605) {eocd = i; break;}
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 文件');

    const total = u16(eocd + 10);
    const cdOffset = u32(eocd + 16);
    let p = cdOffset;
    const entries = [];
    for (let i = 0; i < total; i += 1) {
      if (u32(p) !== 0x02014b50) break;
      const method = u16(p + 10);
      const compSize = u32(p + 20);
      const nameLen = u16(p + 28);
      const extraLen = u16(p + 30);
      const commentLen = u16(p + 32);
      const localOff = u32(p + 42);
      const name = new TextDecoder('utf-8').decode(buf.subarray(p + 46, p + 46 + nameLen));
      entries.push({name, method, compSize, localOff});
      p += 46 + nameLen + extraLen + commentLen;
    }

    const out = [];
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const lo = e.localOff;
      const nl = u16(lo + 26);
      const el = u16(lo + 28);
      const dataStart = lo + 30 + nl + el;
      const raw = buf.subarray(dataStart, dataStart + e.compSize);
      if (e.method === 0) {
        out.push({name: e.name, text: new TextDecoder('utf-8').decode(raw)});
      } else if (e.method === 8) {
        out.push({name: e.name, text: new TextDecoder('utf-8').decode(inflateRaw(raw))});
      }
    }
    return out;
  }

  function skillsFromFiles(files) {
    const skills = [];
    const skipped = [];
    for (const f of files) {
      if (!/\.(md|markdown)$/i.test(f.name)) continue;
      if (/^(readme|license)/i.test(f.name.split('/').pop() || '')) continue;
      try {
        const parsed = parseSkillMd(f.text, (f.name.split('/').pop() || '').replace(/\.(md|markdown)$/i, ''));
        if (!parsed.template && !parsed.system) {skipped.push(f.name); continue;}
        skills.push(parsed);
      } catch (err) {
        skipped.push(f.name);
      }
    }
    return {skills, skipped};
  }

  const api = {
    slugify, splitFrontMatter, splitSections, parseSkillMd, serializeSkill,
    renderTemplate, placeholdersOf, lookupVars, readZip, skillsFromFiles,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SkillFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
