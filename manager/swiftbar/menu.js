#!/usr/bin/env node
/*
 * SwiftBar 菜单生成器 —— 由 claude-skills.30s.sh 调用。
 * 读取常驻面板的 /api/skills 与 /api/discover，输出 SwiftBar 菜单。
 * 后端没起时优雅降级，并给出「启动后端」动作。
 */
'use strict';
const PORT = process.env.PORT || 4317;
const BASE = `http://localhost:${PORT}`;
const LABEL = 'com.claude-skills.panel';
const UID = process.getuid();
const NODE = process.execPath;
const MENU = __filename;

async function get(path, ms = 2000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(BASE + path, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return '刚刚';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  if (s < 86400) return Math.round(s / 3600) + ' 小时前';
  return Math.round(s / 86400) + ' 天前';
}

const out = [];
const p = (text, params) => out.push(params ? `${text} | ${params}` : text);

(async () => {
  let skills, discover;
  try { skills = await get('/api/skills'); }
  catch (e) {
    // 后端未运行：降级
    p('Skills ⚠︎');
    p('---');
    p('Skill 面板未运行', 'color=#c0392b size=13');
    p(`启动后端 | bash="/bin/launchctl" param1="kickstart" param2="gui/${UID}/${LABEL}" terminal=false refresh=true`);
    p('打开面板（启动后）', `href=${BASE}`);
    console.log(out.join('\n'));
    return;
  }
  try { discover = await get('/api/discover'); } catch (e) { discover = null; }

  const list = Array.isArray(skills) ? skills : (skills.skills || []);
  const installed = list.filter(s => s.installed);
  // 菜单栏标题（用文字，满栏也好认）
  p(`Skills ${installed.length}`);
  p('---');
  p('Claude Skills 工作台', 'size=13 color=#888888');
  p('打开面板', `href=${BASE} sfimage=square.grid.2x2`);
  p('---');

  // 发现页
  if (discover) {
    const total = discover.total || 0;
    p(`发现 · ${total} 个最新 skill`, `href=${BASE} sfimage=sparkles`);
    if (discover.updatedAt) p(`更新于 ${ago(discover.updatedAt)}`, 'size=12 color=#999999');
    p(`立即刷新发现页 | bash="/usr/bin/curl" param1="-s" param2="-X" param3="POST" param4="${BASE}/api/discover/refresh" terminal=false refresh=true sfimage=arrow.clockwise`);
    p('---');
  }

  // 我的技能：按分类汇总
  p(`我的技能 · ${installed.length} 个`, `href=${BASE} sfimage=cube.box`);
  const byCat = {};
  for (const s of installed) (byCat[s.category || '未分类'] ||= []).push(s);
  for (const cat of Object.keys(byCat).sort()) {
    const items = byCat[cat];
    p(`${cat} · ${items.length}`, `href=${BASE} size=12`);
    for (const s of items) p(`--${s.name}`, `href=${BASE} size=12 color=#888888`);
  }
  p('---');

  // 维护
  p(`重启后端 | bash="/bin/launchctl" param1="kickstart" param2="-k" param3="gui/${UID}/${LABEL}" terminal=false refresh=true sfimage=arrow.triangle.2.circlepath`);
  p(`刷新此菜单 | refresh=true sfimage=arrow.clockwise`);

  console.log(out.join('\n'));
})().catch(e => {
  console.log('Skills ⚠︎\n---\n菜单出错: ' + e.message + ' | color=#c0392b');
});
