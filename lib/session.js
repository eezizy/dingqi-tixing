// lib/session.js — 服务端 session（内存 + 文件持久化，零依赖）
// 设计：用户自用小工具，请求量小；每次读写文件足够。重启服务不丢登录。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function ensureDir(){ if(!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, {recursive:true}); }
function load(){
  try { return JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')); } catch(e){ return {}; }
}
function save(sessions){
  ensureDir();
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}
function purgeExpired(sessions){
  const now = Date.now();
  let changed = false;
  for(const sid of Object.keys(sessions)){
    if(!sessions[sid] || sessions[sid].expires < now){
      delete sessions[sid];
      changed = true;
    }
  }
  return changed;
}

// 创建新会话，返回 sid
export function create(user){
  const sid = randomBytes(32).toString('hex');
  const sessions = load();
  sessions[sid] = { user, expires: Date.now() + SESSION_TTL_MS, created_at: Date.now() };
  save(sessions);
  return sid;
}
// 查 sid 对应 user，过期返回 null 并自动清理
export function get(sid){
  if(!sid || typeof sid !== 'string') return null;
  const sessions = load();
  const s = sessions[sid];
  if(!s) return null;
  if(s.expires < Date.now()){
    delete sessions[sid];
    save(sessions);
    return null;
  }
  return s.user || null;
}
// 销毁 sid
export function destroy(sid){
  if(!sid) return false;
  const sessions = load();
  if(!sessions[sid]) return false;
  delete sessions[sid];
  save(sessions);
  return true;
}
// 启动时清理一次过期
export function cleanupAll(){
  const sessions = load();
  if(purgeExpired(sessions)) save(sessions);
}
