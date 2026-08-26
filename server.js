// server.js — 定时提醒 Node 版服务入口（零依赖：原生 http + JSON 存储）
// 1Panel 部署：上传本文件夹 → Node 环境 → 启动命令 `node server.js` → 端口映射（默认 8080）

import http from 'http';
import { readFileSync } from 'fs';
import { dirname, join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import {
  getSettings, saveSettings, getAuth, saveAuth,
  listReminders, getReminder, createReminder, updateReminder, deleteReminder
} from './lib/store.js';
import { validateAndBuild, nextOccurrence } from './lib/schedule.js';
import { fireReminder } from './lib/push.js';
import * as session from './lib/session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.PORT || 8080;
const SCAN_INTERVAL_MS = 30000; // 每 30 秒扫描一次到期提醒（比 CF 的 5 分钟更及时）

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon'
};

// ---------- 工具 ----------
function sendJson(res, status, obj){
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    // 防止任何浏览器/中间代理缓存 API 响应，避免下次访问看到陈旧的 401 JSON
    'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma':'no-cache',
    'Expires':'0'
  });
  res.end(JSON.stringify(obj));
}
function readBody(req){
  return new Promise((resolve)=>{
    let buf = '';
    req.on('data', c => { buf += c; if(buf.length > 1e6) req.destroy(); });
    req.on('end', ()=>{ try { resolve(buf ? JSON.parse(buf) : {}); } catch(e){ resolve({}); } });
    req.on('error', ()=> resolve({}));
  });
}
// ---------- cookie / session helpers ----------
function parseCookies(req){
  const out = {};
  const h = req.headers['cookie'] || '';
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if(i < 0) return;
    const k = p.slice(0, i).trim();
    if(!k) return;
    const v = decodeURIComponent(p.slice(i+1).trim());
    out[k] = v;
  });
  return out;
}
function setSessionCookie(res, sid){
  const maxAge = 7 * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearSessionCookie(res){
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function unauthorized(res){
  // 返回 JSON + 不发送 WWW-Authenticate 头，避免现代浏览器（尤其手机端）
  // 对 HTTP Basic Auth 不弹登录框而直接把 401 文本渲染出来的坑。
  // 前端检测到 {needLogin:true} 自动跳登录页。
  res.writeHead(401, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error: 'unauthorized', needLogin: true}));
}
function checkAuth(req){
  const {user, pass} = getAuth();
  if(!user) return true; // 未设置则开放（务必设置登录账号/密码）
  // 1) 优先：cookie session（任何浏览器、任何协议都能用，治本 HTTP Basic Auth 手机端弹框问题）
  const cookies = parseCookies(req);
  if(cookies.sid && session.get(cookies.sid) === user) return true;
  // 2) 兼容：HTTP Basic Auth（curl / 旧电脑）
  const h = req.headers['authorization'] || '';
  const exp = 'Basic ' + Buffer.from(user + ':' + (pass||'')).toString('base64');
  if(h === exp) return true;
  return false;
}
function serveStatic(req, res, pathname){
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if(!filePath.startsWith(PUBLIC_DIR)){ res.writeHead(403); res.end('forbidden'); return; }
  try{
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    // HTML 必须 no-store：避免 Edge/360 等浏览器把上次的 401 JSON 当首页缓存复用
    const isHtml = ext === '.html' || ext === '';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHtml
        ? 'no-store, no-cache, must-revalidate, max-age=0'
        : 'public, max-age=3600'
    };
    res.writeHead(200, headers);
    res.end(content);
  }catch(e){
    res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('Not found');
  }
}

// ---------- API ----------
async function handleApi(req, res, url){
  const cfg = getSettings();
  const tz = cfg.tz;
  const method = req.method;

  // ---- 登录相关（免鉴权） ----
  if(url.pathname === '/api/login' && method === 'POST'){
    const b = await readBody(req);
    const {user, pass} = getAuth();
    const u = (b.user || '').trim();
    const p = String(b.pass || '');
    if(!user) return sendJson(res, 400, {error: '未设置登录账号/密码，请先在「⚙ 设置」里配置'});
    if(u !== user || p !== (pass || '')) return sendJson(res, 401, {error: '账号或密码错误'});
    const sid = session.create(user);
    setSessionCookie(res, sid);
    return sendJson(res, 200, {ok: true, user});
  }
  if(url.pathname === '/api/logout' && method === 'POST'){
    const cookies = parseCookies(req);
    if(cookies.sid) session.destroy(cookies.sid);
    clearSessionCookie(res);
    return sendJson(res, 200, {ok: true});
  }
  if(url.pathname === '/api/me' && method === 'GET'){
    const {user} = getAuth();
    if(!user) return sendJson(res, 200, {logged: false, authRequired: false});
    const cookies = parseCookies(req);
    const u = cookies.sid ? session.get(cookies.sid) : null;
    if(u && u === user) return sendJson(res, 200, {logged: true, user: u});
    return sendJson(res, 200, {logged: false, authRequired: true});
  }
  // ---- 业务接口 ----
  if(url.pathname === '/api/config' && method === 'GET'){
    return sendJson(res, 200, {tz, serverNow: Date.now()});
  }
  if(url.pathname === '/api/settings' && method === 'GET'){
    return sendJson(res, 200, cfg);
  }
  if(url.pathname === '/api/settings' && method === 'PUT'){
    const b = await readBody(req);
    const tz2 = (b.tz || cfg.tz || 'Asia/Shanghai');
    saveSettings({
      wx_corpid:     b.wx_corpid     || '',
      wx_corpsecret: b.wx_corpsecret || '',
      wx_agentid:    b.wx_agentid    || '',
      wx_touser:     b.wx_touser     || '',
      resend_key:    b.resend_key    || '',
      email_from:    b.email_from    || '',
      email_to:      b.email_to      || '',
    tz:            tz2
  });
  // 登录凭证：网页直接改，立即生效（密码留空则不覆盖原密码）
  if(b.auth_user !== undefined || b.auth_pass !== undefined){
    saveAuth((b.auth_user||'').trim(), (b.auth_pass||'').trim());
  }
  return sendJson(res, 200, {ok:true});
  }
  if(url.pathname === '/api/reminders' && method === 'GET'){
    const items = listReminders().slice().sort((a,b)=>(a.next_run||0)-(b.next_run||0));
    return sendJson(res, 200, items);
  }
  if(url.pathname === '/api/reminders' && method === 'POST'){
    const b = await readBody(req);
    const rule = validateAndBuild(b, tz);
    if(rule.error) return sendJson(res, 400, {error: rule.error});
    const id = createReminder(rule);
    return sendJson(res, 201, {ok:true, id});
  }

  // 导出全部提醒为 JSON 文件（备份用，触发浏览器下载）
  if(url.pathname === '/api/reminders/export' && method === 'GET'){
    const items = listReminders();
    const payload = { app:'dingqi-tixing', version:1, exportedAt:new Date().toISOString(), count:items.length, reminders:items };
    const fname = 'reminders-backup-' + new Date().toISOString().slice(0,10) + '.json';
    res.writeHead(200, {
      'Content-Type':'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + fname + '"',
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0'
    });
    return res.end(JSON.stringify(payload, null, 2));
  }

  // 从备份文件批量导入提醒（迁移用：追加不覆盖，原 id 丢弃、按当前时区重算排期，保留启用/停用状态）
  if(url.pathname === '/api/reminders/import' && method === 'POST'){
    const b = await readBody(req);
    const arr = Array.isArray(b) ? b : (b && Array.isArray(b.reminders) ? b.reminders : null);
    if(!arr) return sendJson(res, 400, {error:'格式错误：期望提醒数组或 {"reminders":[...]}'});
    let added = 0, skipped = 0;
    for(const item of arr){
      const rule = validateAndBuild({
        title:item.title, content:item.content, unit:item.unit,
        interval_num:item.interval_num, day_of_month:item.day_of_month,
        month:item.month, hour:item.hour, minute:item.minute,
        channel_wechat:item.channel_wechat, channel_email:item.channel_email
      }, tz);
      if(rule.error){ skipped++; continue; }
      const newId = createReminder(rule);
      updateReminder(newId, { active: item.active ? 1 : 0 });
      added++;
    }
    return sendJson(res, 200, {ok:true, added, skipped, total:arr.length});
  }

  const m = url.pathname.match(/^\/api\/reminders\/(\d+)(?:\/test)?$/);
  if(m){
    const id = +m[1];
    const isTest = /\/test$/.test(url.pathname);
    if(method === 'POST' && isTest){
      const r = getReminder(id);
      if(!r) return sendJson(res, 404, {error:'not found'});
      const {ok, errs} = await fireReminder(r, cfg);
      updateReminder(id, {last_sent: Date.now(), last_error: ok ? null : (errs.join('; ') || 'unknown')});
      return sendJson(res, 200, {ok, errs});
    }
    if(method === 'GET'){
      const r = getReminder(id);
      return r ? sendJson(res, 200, r) : sendJson(res, 404, {error:'not found'});
    }
    if(method === 'PUT'){
      const b = await readBody(req);
      const existing = getReminder(id);
      if(!existing) return sendJson(res, 404, {error:'not found'});
      const scheduleChanged =
        existing.unit !== b.unit ||
        +existing.interval_num !== +b.interval_num ||
        +existing.day_of_month !== +b.day_of_month ||
        +existing.month !== +b.month ||
        +existing.hour !== +b.hour ||
        +existing.minute !== +b.minute;
      if(scheduleChanged){
        const rule = validateAndBuild(b, tz);
        if(rule.error) return sendJson(res, 400, {error: rule.error});
        updateReminder(id, {
          title: rule.title, content: rule.content, unit: rule.unit,
          interval_num: rule.interval_num, day_of_month: rule.day_of_month,
          month: rule.month, hour: rule.hour, minute: rule.minute,
          channel_wechat: rule.channel_wechat, channel_email: rule.channel_email,
          anchor_epoch: rule.anchor_epoch, next_run: rule.next_run
        });
        return sendJson(res, 200, {ok:true});
      }
      // 仅改了标题/内容/通道/启停：保留原排期，不重算下一次时间
      const title = (b.title || '').trim() || existing.title;
      const content = (b.content != null) ? String(b.content) : existing.content;
      const cw = (b.channel_wechat != null) ? (b.channel_wechat ? 1 : 0) : existing.channel_wechat;
      const ce = (b.channel_email != null) ? (b.channel_email ? 1 : 0) : existing.channel_email;
      updateReminder(id, {title, content, channel_wechat: cw, channel_email: ce});
      return sendJson(res, 200, {ok:true});
    }
    if(method === 'DELETE'){
      deleteReminder(id);
      return sendJson(res, 200, {ok:true});
    }
  }
  return sendJson(res, 404, {error:'not found'});
}

// ---------- 定时扫描 ----------
async function checkAndSend(){
  const cfg = getSettings();
  const tz = cfg.tz;
  const items = listReminders().filter(r => r.active && r.next_run != null);
  const now = Date.now();
  let sent = 0, failed = 0;
  for(const r of items){
    if(now < r.next_run) continue;
    const {ok, errs} = await fireReminder(r, cfg);
    if(ok){
      const next = nextOccurrence(r, now, tz);
      updateReminder(r.id, {last_sent: now, next_run: next, last_error: errs.length ? errs.join('; ') : null});
      sent++;
    } else {
      updateReminder(r.id, {last_error: errs.join('; ')});
      failed++;
    }
  }
  if(sent || failed) console.log(`[scan] ${new Date().toISOString()} sent=${sent} failed=${failed}`);
}

// ---------- 主服务 ----------
// 免鉴权的路径：登录相关 + 健康检查 + 时区查询 + 根路径/静态资源
// 根路径和静态资源必须免鉴权，否则会死锁（没登录→拿不到 HTML→看不到登录页→无法登录）
const PUBLIC_API = new Set(['/api/login', '/api/logout', '/api/me', '/api/config', '/api/health']);
// 静态资源也算公开（让 HTML/CSS/JS 任意访问，业务 API 才鉴权）
function isPublicPath(p){
  if(PUBLIC_API.has(p)) return true;
  if(p === '/' || p === '/index.html') return true;
  // 静态资源（/favicon.ico、/assets/xxx、/public/xxx 等）免鉴权
  if(!p.startsWith('/api/')) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname === '/api/health'){ res.writeHead(200); res.end('ok'); return; }
  if(!isPublicPath(url.pathname) && !checkAuth(req)){ return unauthorized(res); }
  if(url.pathname.startsWith('/api/')){
    try { await handleApi(req, res, url); }
    catch(e){ console.error('API error:', e); sendJson(res, 500, {error:'server error'}); }
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`定时提醒服务已启动: http://localhost:${PORT}`);
  if(!getAuth().user) console.log('⚠️  未设置登录账号/密码，管理页任何人可访问！请在「⚙ 设置」里配置，或在 .env 配置 AUTH_USER/AUTH_PASS。');
  session.cleanupAll();                     // 启动时清理过期 session
  checkAndSend();                           // 启动即扫描一次
  setInterval(checkAndSend, SCAN_INTERVAL_MS); // 之后每 30 秒扫描
});
