#!/usr/bin/env node
/*
 * Skill Manager — 零依赖本地 skill 管理面板后端
 * 扫描 ~/.claude/skills 与库目录，按功能分类，支持从 GitHub 安装。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const HOME = os.homedir();
const CLAUDE_SKILLS = path.join(HOME, '.claude', 'skills');           // Claude 实际读取处（软链/目录）
// 库根 = manager/ 的上一级，自动定位，clone 到任何位置都能跑
const REPO = path.resolve(__dirname, '..');
const LIB_MY = path.join(REPO, 'my-skills');                          // 我自己的 skill 源头
const LIB_OFFICIAL = path.join(REPO, 'anthropic-official');           // 官方留档
const DISCOVER_DIR = path.join(__dirname, 'discover');                // 发现页聚合
const DISCOVER_CACHE = path.join(DISCOVER_DIR, 'cache.json');
const DISCOVER_SCRIPT = path.join(DISCOVER_DIR, 'fetch-skills.js');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4317;

// ---------- 工具 ----------
function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}
function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }
function isDirEntry(d) {
  // d 可能是软链指向目录
  if (d.isDirectory()) return true;
  if (d.isSymbolicLink()) {
    try { return fs.statSync(path.join(d.parentPath || d.path || '', d.name)).isDirectory(); } catch { return false; }
  }
  return false;
}

// 找到一个 skill 目录里的 SKILL.md（根目录或一层子目录）
function findSkillFile(dir) {
  const root = path.join(dir, 'SKILL.md');
  if (exists(root)) return root;
  for (const e of safeReaddir(dir)) {
    if (e.isDirectory()) {
      const nested = path.join(dir, e.name, 'SKILL.md');
      if (exists(nested)) return nested;
    }
  }
  return null;
}

// 解析 SKILL.md frontmatter 的 name / description
function parseFrontmatter(skillFile) {
  let text = '';
  try { text = fs.readFileSync(skillFile, 'utf8'); } catch { return {}; }
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1];
  const lines = body.split('\n');
  const out = {};
  let curKey = null;
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (kv) {
      curKey = kv[1].toLowerCase();
      out[curKey] = kv[2].trim();
    } else if (curKey && line.trim()) {
      // 续行（多行 description）
      out[curKey] += ' ' + line.trim();
    }
  }
  // 去掉包裹引号
  for (const k of Object.keys(out)) out[k] = out[k].replace(/^["']|["']$/g, '');
  return out;
}

// 按功能关键词推断分类
const CATEGORY_RULES = [
  ['演示 / 幻灯', /\b(ppt|pptx|slide|slides|deck|presentation|keynote)\b|幻灯|演示|杂志风/i],
  ['设计 / 视觉', /\b(design|brand|theme|canvas|art|ui|css|figma|color|palette|frontend|style)\b|设计|视觉|配色|风格/i],
  ['文档处理', /\b(pdf|docx?|word|xlsx?|excel|spreadsheet|sheet|csv)\b|表格/i],
  ['开发 / 工具', /\b(api|sdk|code|mcp|debug|lint|git|build|test|webapp|backend|server|cli|deploy)\b|代码|调试|接口/i],
  ['沟通 / 协作', /\b(slack|email|mail|comms|gif|message|notion|calendar)\b|沟通|邮件|协作/i],
  ['元能力 / 管理', /\b(skill-creator|consolidate|memory|setup|cowork|manager|meta)\b|技能|记忆|管理/i],
];
function inferCategory(name, desc, declared) {
  if (declared) return declared;
  const hay = `${name} ${desc}`;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(hay)) return cat;
  return '其他';
}

// 已安装 = 在 ~/.claude/skills 中存在同名条目
function installedSet() {
  const set = new Set();
  for (const e of safeReaddir(CLAUDE_SKILLS)) {
    if (e.name.startsWith('.')) continue;
    if (isDirEntry(e)) set.add(e.name);
  }
  return set;
}

// 收集一个来源目录下的 skill
function collectFrom(dir, source) {
  const items = [];
  for (const e of safeReaddir(dir)) {
    if (e.name.startsWith('.')) continue;
    if (!isDirEntry(e)) continue;
    const full = path.join(dir, e.name);
    const skillFile = findSkillFile(full);
    const fm = skillFile ? parseFrontmatter(skillFile) : {};
    items.push({
      key: e.name,
      name: fm.name || e.name,
      description: fm.description || '(无 SKILL.md 描述)',
      category: inferCategory(fm.name || e.name, fm.description || '', fm.category),
      source,
      hasSkillFile: !!skillFile,
    });
  }
  return items;
}

function listSkills() {
  const installed = installedSet();
  const byKey = new Map();

  // 库内来源
  for (const it of collectFrom(LIB_MY, 'my')) byKey.set(it.key, it);
  for (const it of collectFrom(LIB_OFFICIAL, 'official')) {
    if (!byKey.has(it.key)) byKey.set(it.key, it);
  }
  // ~/.claude/skills 里、库中没有的（手动放进去的）
  for (const it of collectFrom(CLAUDE_SKILLS, 'claude')) {
    if (!byKey.has(it.key)) byKey.set(it.key, it);
  }

  const arr = [];
  for (const it of byKey.values()) {
    it.installed = installed.has(it.key);
    // 官方 skill 即使没软链，也由插件市场提供
    it.pluginProvided = it.source === 'official';
    arr.push(it);
  }
  arr.sort((a, b) => a.category.localeCompare(b.category, 'zh') || a.name.localeCompare(b.name, 'zh'));
  return arr;
}

// ---------- 安装/链接操作 ----------
function findLibDir(key) {
  for (const base of [LIB_MY, LIB_OFFICIAL]) {
    const p = path.join(base, key);
    if (exists(p)) return p;
  }
  return null;
}

function linkSkill(key, cb) {
  const libDir = findLibDir(key);
  if (!libDir) return cb(new Error('库中找不到该 skill: ' + key));
  // 软链到 SKILL.md 所在目录（根或一层子目录）
  const skillFile = findSkillFile(libDir);
  const target = skillFile ? path.dirname(skillFile) : libDir;
  const linkPath = path.join(CLAUDE_SKILLS, key);
  if (exists(linkPath)) return cb(null, { already: true });
  try {
    fs.mkdirSync(CLAUDE_SKILLS, { recursive: true });
    fs.symlinkSync(target, linkPath);
    cb(null, { linked: true });
  } catch (e) { cb(e); }
}

function unlinkSkill(key, cb) {
  const linkPath = path.join(CLAUDE_SKILLS, key);
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink()) { fs.unlinkSync(linkPath); return cb(null, { unlinked: true }); }
    return cb(new Error('该条目不是软链（可能是手动放入的真实目录），为安全起见不自动删除'));
  } catch (e) { cb(new Error('未找到已安装的链接: ' + key)); }
}

function installFromGit(url, cb) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url.trim())) {
    return cb(new Error('仅支持 https://github.com/<owner>/<repo> 形式的地址'));
  }
  const clean = url.trim().replace(/\/$/, '');
  const repoName = clean.split('/').pop().replace(/\.git$/, '');
  const dest = path.join(LIB_MY, repoName);
  if (exists(dest)) {
    // 已在库里，直接尝试链接
    return linkSkill(repoName, (e, r) => e ? cb(e) : cb(null, { name: repoName, ...r, note: '已存在于库，已确保链接' }));
  }
  fs.mkdirSync(LIB_MY, { recursive: true });
  execFile('git', ['clone', '--depth', '1', clean, dest], { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) return cb(new Error('git clone 失败: ' + (stderr || err.message)));
    const skillFile = findSkillFile(dest);
    if (!skillFile) {
      return cb(null, { name: repoName, cloned: true, warning: '仓库内未找到 SKILL.md，已存入库但未链接' });
    }
    linkSkill(repoName, (e2, r2) => {
      if (e2) return cb(null, { name: repoName, cloned: true, warning: '克隆成功但链接失败: ' + e2.message });
      cb(null, { name: repoName, cloned: true, ...r2 });
    });
  });
}

// ---------- HTTP ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cb) {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(null, b ? JSON.parse(b) : {}); } catch (e) { cb(e); } });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/api/skills' && req.method === 'GET') {
    try { return sendJSON(res, 200, { skills: listSkills(), repo: REPO, claudeSkills: CLAUDE_SKILLS }); }
    catch (e) { return sendJSON(res, 500, { error: e.message }); }
  }

  if (u.pathname === '/api/install' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err || !body.url) return sendJSON(res, 400, { error: '缺少 url' });
      installFromGit(body.url, (e, r) => e ? sendJSON(res, 400, { error: e.message }) : sendJSON(res, 200, { ok: true, ...r }));
    });
  }

  // 发现页：读缓存
  if (u.pathname === '/api/discover' && req.method === 'GET') {
    fs.readFile(DISCOVER_CACHE, 'utf8', (e, data) => {
      if (e) return sendJSON(res, 200, { updatedAt: null, total: 0, sources: [], note: '尚未抓取，点刷新或等每日 cron' });
      try { sendJSON(res, 200, JSON.parse(data)); } catch { sendJSON(res, 500, { error: 'cache 解析失败' }); }
    });
    return;
  }

  // 发现页：手动触发重抓
  if (u.pathname === '/api/discover/refresh' && req.method === 'POST') {
    execFile('node', [DISCOVER_SCRIPT], { timeout: 90000 }, (err, stdout, stderr) => {
      if (err) return sendJSON(res, 500, { error: '抓取失败: ' + (stderr || err.message) });
      fs.readFile(DISCOVER_CACHE, 'utf8', (e, data) => {
        if (e) return sendJSON(res, 500, { error: '抓取后读缓存失败' });
        try { sendJSON(res, 200, { ok: true, ...JSON.parse(data) }); } catch { sendJSON(res, 500, { error: 'cache 解析失败' }); }
      });
    });
    return;
  }

  if (u.pathname === '/api/link' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err || !body.name) return sendJSON(res, 400, { error: '缺少 name' });
      linkSkill(body.name, (e, r) => e ? sendJSON(res, 400, { error: e.message }) : sendJSON(res, 200, { ok: true, ...r }));
    });
  }

  if (u.pathname === '/api/unlink' && req.method === 'POST') {
    return readBody(req, (err, body) => {
      if (err || !body.name) return sendJSON(res, 400, { error: '缺少 name' });
      unlinkSkill(body.name, (e, r) => e ? sendJSON(res, 400, { error: e.message }) : sendJSON(res, 200, { ok: true, ...r }));
    });
  }

  // 静态：index.html
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    const html = path.join(__dirname, 'index.html');
    return fs.readFile(html, (e, data) => {
      if (e) { res.writeHead(500); return res.end('index.html missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Skill Manager 运行于 http://localhost:${PORT}`);
  console.log(`库: ${REPO}`);
  console.log(`Claude skills: ${CLAUDE_SKILLS}`);
});
