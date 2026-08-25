// lib/store.js — JSON 文件存储（零依赖，单用户低频场景足够）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const REMINDERS_FILE = join(DATA_DIR, 'reminders.json');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

function ensureDir(){ if(!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, {recursive:true}); }
function readJson(file, def){
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch(e){ return def; }
}
function writeJson(file, obj){
  ensureDir();
  writeFileSync(file, JSON.stringify(obj, null, 2));
}

// ---------- settings ----------
// 优先级：settings.json（前端填写）> 环境变量（.env / 1Panel 配置）
export function getSettings(){
  const s = readJson(SETTINGS_FILE, {});
  return {
    wx_corpid:     s.wx_corpid     || process.env.WX_CORPID     || '',
    wx_corpsecret: s.wx_corpsecret || process.env.WX_CORPSECRET || '',
    wx_agentid:    s.wx_agentid    || process.env.WX_AGENTID    || '',
    wx_touser:     s.wx_touser     || process.env.WX_TOUSER     || '',
    resend_key:    s.resend_key    || process.env.RESEND_API_KEY || '',
    email_from:    s.email_from    || process.env.EMAIL_FROM    || '',
    email_to:      s.email_to      || process.env.EMAIL_TO      || '',
    tz:            s.tz            || process.env.TZ            || 'Asia/Shanghai'
  };
}
export function saveSettings(partial){
  const s = readJson(SETTINGS_FILE, {});
  const merged = Object.assign({}, s, partial, {updated_at: Date.now()});
  writeJson(SETTINGS_FILE, merged);
  return merged;
}

// ---------- reminders ----------
function readReminders(){ return readJson(REMINDERS_FILE, {seq:1, items:[]}); }
function writeReminders(data){ writeJson(REMINDERS_FILE, data); }

export function listReminders(){
  return readReminders().items;
}
export function getReminder(id){
  return readReminders().items.find(r => r.id === id) || null;
}
export function createReminder(rule){
  const data = readReminders();
  const id = data.seq++;
  const record = Object.assign({}, rule, {
    id,
    active: 1,
    last_sent: null,
    last_error: null,
    created_at: Date.now(),
    updated_at: Date.now()
  });
  data.items.push(record);
  writeReminders(data);
  return id;
}
export function updateReminder(id, fields){
  const data = readReminders();
  const idx = data.items.findIndex(r => r.id === id);
  if(idx < 0) return null;
  data.items[idx] = Object.assign({}, data.items[idx], fields, {updated_at: Date.now()});
  writeReminders(data);
  return data.items[idx];
}
export function deleteReminder(id){
  const data = readReminders();
  const before = data.items.length;
  data.items = data.items.filter(r => r.id !== id);
  writeReminders(data);
  return data.items.length < before;
}
