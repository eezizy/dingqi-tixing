// lib/schedule.js — 时间计算（纯函数，无外部依赖）
// 从 Cloudflare Workers 版原样搬运，去掉 CF 运行时依赖。

export function cleanInt(v, def){ const n = parseInt(v,10); return Number.isFinite(n) ? n : def; }
export function daysInMonth(y,m){ return new Date(Date.UTC(y,m,0)).getUTCDate(); }

export function getLocalParts(date, tz){
  const fmt = new Intl.DateTimeFormat('en-US', {timeZone:tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false});
  const o = {}; fmt.formatToParts(date).forEach(p => o[p.type] = p.value);
  let h = parseInt(o.hour,10); if(h === 24) h = 0;
  return {y:+o.year, m:+o.month, d:+o.day, h, min:+o.minute, s:+o.second};
}

export function tzOffsetMs(tz){
  const now = new Date();
  const p = getLocalParts(now, tz);
  return Date.UTC(p.y, p.m-1, p.d, p.h, p.min, p.s) - now.getTime();
}

export function localToEpoch(y,m,d,h,min,tz){
  return Date.UTC(y, m-1, d, h, min, 0) - tzOffsetMs(tz);
}

// 返回严格大于 afterEpoch 的下一个发生时刻（UTC ms）
export function nextOccurrence(r, afterEpoch, tz){
  if(r.unit === 'day'){
    const base = r.anchor_epoch; const period = r.interval_num * 86400000;
    if(!base) return null;
    let k = Math.floor((afterEpoch - base) / period);
    let cand = base + (k + 1) * period;
    while(cand <= afterEpoch) cand += period;
    return cand;
  }
  if(r.unit === 'month'){
    const p = getLocalParts(new Date(r.anchor_epoch), tz);
    let y = p.y, m = p.m; const dom = r.day_of_month;
    for(let i=0;i<1200; i++){
      const yy = y + Math.floor((m-1)/12);
      const mm = ((m-1)%12) + 1;
      const d = Math.min(dom, daysInMonth(yy, mm));
      const cand = localToEpoch(yy, mm, d, r.hour, r.minute, tz);
      if(cand > afterEpoch) return cand;
      m += r.interval_num;
    }
    return null;
  }
  if(r.unit === 'year'){
    const p = getLocalParts(new Date(r.anchor_epoch), tz);
    const startY = p.y; const mm = r.month; const dom = r.day_of_month;
    for(let i=0;i<200;i++){
      const yy = startY + i * r.interval_num;
      const d = Math.min(dom, daysInMonth(yy, mm));
      const cand = localToEpoch(yy, mm, d, r.hour, r.minute, tz);
      if(cand > afterEpoch) return cand;
    }
    return null;
  }
  return null;
}

// 由表单输入构建完整规则（含 anchor_epoch 与首个 next_run）
export function buildRule(input, tz){
  const now = new Date();
  const lp = getLocalParts(now, tz);
  let anchor_epoch;
  if(input.unit === 'day'){
    anchor_epoch = localToEpoch(lp.y, lp.m, lp.d, input.hour, input.minute, tz);
  } else if(input.unit === 'month'){
    anchor_epoch = localToEpoch(lp.y, lp.m, input.day_of_month, input.hour, input.minute, tz);
  } else {
    anchor_epoch = localToEpoch(lp.y, input.month, input.day_of_month, input.hour, input.minute, tz);
  }
  const rule = Object.assign({}, input, {anchor_epoch});
  rule.next_run = nextOccurrence(rule, Date.now(), tz);
  return rule;
}

export function validateAndBuild(b, tz){
  const title = (b.title || '').trim();
  if(!title) return {error:'标题不能为空'};
  const unit = b.unit;
  if(!['day','month','year'].includes(unit)) return {error:'重复单位无效'};
  const interval_num = Math.max(1, cleanInt(b.interval_num, 1));
  const hour = cleanInt(b.hour, 9);
  const minute = cleanInt(b.minute, 0);
  if(hour < 0 || hour > 23 || minute < 0 || minute > 59) return {error:'提醒时间无效'};
  let day_of_month = cleanInt(b.day_of_month, 1);
  let month = cleanInt(b.month, 1);
  if(unit === 'month' && (day_of_month < 1 || day_of_month > 31)) return {error:'每月几号需在 1-31'};
  if(unit === 'year'){
    if(month < 1 || month > 12) return {error:'月份需在 1-12'};
    if(day_of_month < 1 || day_of_month > 31) return {error:'日期需在 1-31'};
  }
  const rule = buildRule({
    unit, interval_num, hour, minute, day_of_month, month,
    channel_wechat: b.channel_wechat ? 1 : 0,
    channel_email: b.channel_email ? 1 : 0,
    content: (b.content || '').toString(),
    title
  }, tz);
  rule.title = title;
  rule.content = (b.content || '').toString();
  rule.channel_wechat = b.channel_wechat ? 1 : 0;
  rule.channel_email = b.channel_email ? 1 : 0;
  return rule;
}
