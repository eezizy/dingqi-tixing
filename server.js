// server.js — 定时提醒 Node 版服务入口（零依赖：原生 http + JSON 存储）
// 1Panel 部署：上传本文件夹 → Node 环境 → 启动命令 `node server.js` → 端口映射（默认 8080）

import http from 'http';
import { readFileSync } from 'fs';
import { dirname, join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import {
  getSettings, saveSettings,
  listReminders, getReminder, createReminder, updateReminder, deleteReminder
} from './lib/store.js';
import { validateAndBuild, nextOccurrence } from './lib/schedule.js';
import { fireReminder } from './lib/push.js';

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
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'});
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
function unauthorized(res){
  res.writeHead(401, {'WWW-Authenticate':'Basic realm="reminders"'});
  res.end('Unauthorized');
}
function checkAuth(req){
  if(!process.env.AUTH_USER) return true; // 未设置则开放（务必设置 AUTH_USER/AUTH_PASS）
  const h = req.headers['authorization'] || '';
  const exp = 'Basic ' + Buffer.from(process.env.AUTH_USER + ':' + (process.env.AUTH_PASS||'')).toString('base64');
  return h === exp;
}
function serveStatic(req, res, pathname){
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(PUBLIC_DIR, rel));
  if(!filePath.startsWith(PUBLIC_DIR)){ res.writeHead(403); res.end('forbidden'); return; }
  try{
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname === '/health'){ res.writeHead(200); res.end('ok'); return; }
  if(!checkAuth(req)){ return unauthorized(res); }
  if(url.pathname.startsWith('/api/')){
    try { await handleApi(req, res, url); }
    catch(e){ console.error('API error:', e); sendJson(res, 500, {error:'server error'}); }
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`定时提醒服务已启动: http://localhost:${PORT}`);
  if(!process.env.AUTH_USER) console.log('⚠️  未设置 AUTH_USER/AUTH_PASS，管理页任何人可访问！请在 .env 里配置。');
  checkAndSend();                       // 启动即扫描一次
  setInterval(checkAndSend, SCAN_INTERVAL_MS); // 之后每 30 秒扫描
});
