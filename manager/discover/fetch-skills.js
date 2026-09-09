#!/usr/bin/env node
/*
 * 发现页聚合抓取器 —— 多源、可降级。
 * 用法：node fetch-skills.js  （由 cron 每日调用，也可手动/接口触发）
 * 输出：discover/cache.json
 *
 * 各源策略：
 *  - github : 真实 Search API，稳定可靠（可一键安装）
 *  - youtube: 无 key 尽力解析搜索页 ytInitialData，失败则降级
 *  - twitter/xiaohongshu/jike : 无免费 API，主要靠 manual.json 补录 + 深链搜索
 * 任何单源失败都不会让整体崩溃（各自 try/catch + 超时 + 状态）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CACHE = path.join(DIR, 'cache.json');
const MANUAL = path.join(DIR, 'manual.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function loadManual() {
  try { return JSON.parse(fs.readFileSync(MANUAL, 'utf8')); } catch { return {}; }
}
async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function dedupBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// ---------- GitHub（真实，价值导向：高星 / 近期热度 / AI 创业相关） ----------
// AI 创业方向相关关键词（命中越多，相关性越高）
const STARTUP_KEYWORDS = /\b(agent|agentic|automation|automate|workflow|mcp|rag|marketing|growth|sales|seo|content|copywriting|social|outreach|email|lead|crm|saas|startup|product|customer|support|research|scrap(e|ing)|data|analytics|finance|pitch|deck|ecommerce|ad|ads|landing|funnel|chatbot|assistant|coding|code|developer|productivity)\b/gi;

function scoreRepo(it) {
  const stars = it.stars;
  const daysSince = (Date.now() - new Date(it.pushed || it.updated).getTime()) / 86400000;
  const starScore = Math.log10(stars + 1) * 4;               // 星标（对数，避免头部碾压）
  const recency = Math.max(0, 1 - daysSince / 90) * 3;       // 90 天内线性衰减
  const hay = `${it.title} ${it.description} ${(it.topics || []).join(' ')}`;
  const hits = (hay.match(STARTUP_KEYWORDS) || []).length;
  const relevance = Math.min(hits, 5) * 1.2;                 // AI 创业相关性
  return starScore + recency + relevance;
}

async function github() {
  // 精选 查询×排序 组合（共 6 个请求，控制在未登录 10/分钟 限速内）
  const pairs = [
    ['topic:claude-skill', 'stars'],
    ['topic:claude-skill', 'updated'],
    ['topic:claude-skills', 'stars'],
    ['claude skill in:name,description', 'stars'],
    ['claude agent skill in:name,description,readme', 'updated'],
    ['anthropic skill SKILL.md in:readme', 'updated'],
  ];
  const hasToken = !!process.env.GITHUB_TOKEN;
  const gap = hasToken ? 250 : 6500;   // 有 token 几乎不限速；无 token 间隔 6.5s
  const all = [];
  let rateLimited = false;
  for (let i = 0; i < pairs.length; i++) {
    const [q, sort] = pairs[i];
    try {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=${sort}&order=desc&per_page=25`;
      const headers = { 'Accept': 'application/vnd.github+json' };
      if (hasToken) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
      const r = await fetchWithTimeout(url, { headers }, 15000);
      if (r.status === 403 || r.status === 429) { rateLimited = true; break; }  // 触发限速：保留已拿到的，停止
      if (!r.ok) continue;
      const j = await r.json();
      for (const it of (j.items || [])) {
        all.push({
          source: 'github',
          title: it.name,
          fullName: it.full_name,
          description: it.description || '',
          author: it.owner ? it.owner.login : '',
          url: it.html_url,
          installUrl: it.html_url,
          stars: it.stargazers_count || 0,
          language: it.language || '',
          topics: it.topics || [],
          updated: it.updated_at,
          pushed: it.pushed_at,
          canInstall: true,
        });
      }
    } catch (e) { /* 单条查询失败忽略 */ }
    if (i < pairs.length - 1) await sleep(gap);
  }
  let items = dedupBy(all, x => x.fullName);

  // 质量过滤：要有描述；且（星标达标 或 近 30 天有推送=有热度）
  const now = Date.now();
  items = items.filter(it => {
    const recentlyActive = (now - new Date(it.pushed || it.updated).getTime()) < 30 * 86400000;
    const valuable = it.stars >= 5;
    return it.description && (valuable || recentlyActive);
  });

  // 打分排序，打标
  for (const it of items) {
    it.score = scoreRepo(it);
    const daysSince = (now - new Date(it.pushed || it.updated).getTime()) / 86400000;
    it.hot = daysSince <= 14;                                       // 🔥 近两周活跃
    it.startupRelevant = STARTUP_KEYWORDS.test(`${it.title} ${it.description} ${it.topics.join(' ')}`);
    STARTUP_KEYWORDS.lastIndex = 0;                                 // 重置全局正则
  }
  items.sort((a, b) => b.score - a.score);
  items = items.slice(0, 40);

  let note = items.length ? '按 高星·热度·AI创业相关 打分排序' : '抓取失败或无结果';
  if (rateLimited) note += '（触发 GitHub 限速，仅部分结果；配 GITHUB_TOKEN 可消除）';
  return { source: 'github', label: 'GitHub', status: items.length ? 'ok' : 'error', note, items };
}

// ---------- YouTube（无 key 尽力解析） ----------
async function youtube(manual) {
  const items = [];
  try {
    const r = await fetchWithTimeout('https://www.youtube.com/results?search_query=' + encodeURIComponent('claude skill 教程'), {}, 15000);
    const html = await r.text();
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
    if (m) {
      const data = JSON.parse(m[1]);
      const stack = [data]; let guard = 0;
      while (stack.length && guard++ < 20000) {
        const node = stack.pop();
        if (node && typeof node === 'object') {
          if (node.videoRenderer) {
            const v = node.videoRenderer;
            const title = v.title && v.title.runs ? v.title.runs.map(x => x.text).join('') : '';
            const vid = v.videoId;
            const author = v.ownerText && v.ownerText.runs ? v.ownerText.runs[0].text : '';
            if (vid && title) items.push({ source: 'youtube', title, description: author ? '频道：' + author : '', author, url: 'https://www.youtube.com/watch?v=' + vid, canInstall: false });
          }
          for (const k in node) stack.push(node[k]);
        }
      }
    }
  } catch (e) { /* 降级 */ }
  const merged = dedupBy([...(manual.youtube || []).map(x => ({ source: 'youtube', canInstall: false, ...x })), ...items], x => x.url).slice(0, 20);
  const ok = merged.length > 0;
  return { source: 'youtube', label: 'YouTube', status: ok ? 'ok' : 'limited',
           note: items.length ? '尽力抓取（无官方 key，结构可能变动）' : '抓取受限，建议补录或配 API key',
           searchUrl: 'https://www.youtube.com/results?search_query=claude+skill',
           items: merged };
}

// ---------- 受限平台：X / 小红书 / 即刻（手动补录 + 深链） ----------
function limitedSource(source, label, searchUrl, manual) {
  const items = (manual[source] || []).map(x => ({ source, canInstall: false, ...x }));
  return { source, label, status: items.length ? 'ok' : 'limited',
           note: items.length ? `手动补录 ${items.length} 条` : '无免费 API，点“去搜索”浏览，或在 manual.json 补录',
           searchUrl, items };
}

async function main() {
  const manual = loadManual();
  const results = await Promise.allSettled([
    github(),
    youtube(manual),
    Promise.resolve(limitedSource('twitter', 'X / Twitter', 'https://x.com/search?q=claude%20skill&f=live', manual)),
    Promise.resolve(limitedSource('xiaohongshu', '小红书', 'https://www.xiaohongshu.com/search_result?keyword=claude%20skill', manual)),
    Promise.resolve(limitedSource('jike', '即刻', 'https://web.okjike.com/search?keyword=claude%20skill', manual)),
  ]);
  const sources = results.map(r => r.status === 'fulfilled' ? r.value
    : { source: 'unknown', label: '未知', status: 'error', note: String(r.reason), items: [] });
  const total = sources.reduce((n, s) => n + s.items.length, 0);
  const out = { updatedAt: new Date().toISOString(), total, sources };
  fs.writeFileSync(CACHE, JSON.stringify(out, null, 2));
  console.log(`[discover] 抓取完成 ${out.updatedAt} 共 ${total} 条`);
  for (const s of sources) console.log(`  - ${s.label}: ${s.items.length} 条 (${s.status}) ${s.note}`);
}

main().catch(e => { console.error('fetch-skills 失败:', e); process.exit(1); });
