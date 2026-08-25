// lib/push.js — 推送（企业微信自建应用 + Resend 邮箱）
// 从 Cloudflare Workers 版原样搬运，仅把错误提示改为不绑定特定平台。

export async function sendWeChat(text, cfg){
  const t = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.wx_corpid)}&corpsecret=${encodeURIComponent(cfg.wx_corpsecret)}`).then(x => x.json());
  if(!t.access_token) throw new Error('wx token ' + JSON.stringify(t));
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${t.access_token}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({touser: cfg.wx_touser, msgtype:'text', agentid: +cfg.wx_agentid, text:{content: text}})
  }).then(x => x.json());
  if(res.errcode !== 0) throw new Error('wx send ' + JSON.stringify(res));
  return true;
}

export async function sendEmail(subject, text, cfg){
  const res = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer ' + cfg.resend_key},
    body: JSON.stringify({from: cfg.email_from, to: cfg.email_to, subject: subject || '提醒', text})
  });
  if(!res.ok) throw new Error('mail ' + res.status + ' ' + (await res.text()).slice(0,200));
  return true;
}

export async function fireReminder(r, cfg){
  const text = `${r.title}\n${r.content || ''}`.trim();
  let wxOk = false, mailOk = false, errs = [];
  if(r.channel_wechat){
    if(!cfg.wx_corpid)     errs.push('wx: Corpid 未配置（在「⚙ 设置」填，或用环境变量 WX_CORPID）');
    else if(!cfg.wx_corpsecret) errs.push('wx: 应用 Secret 未配置');
    else if(!cfg.wx_agentid)     errs.push('wx: AgentId 未配置');
    else if(!cfg.wx_touser)      errs.push('wx: 接收人 UserID 未配置');
    else try { wxOk = await sendWeChat(text, cfg); } catch(e){ errs.push('wx:' + (e.message || 'unknown')); }
  }
  if(r.channel_email){
    if(!cfg.resend_key) errs.push('mail: Resend API Key 未配置（在「⚙ 设置」填，或用环境变量 RESEND_API_KEY）');
    else if(!cfg.email_from) errs.push('mail: 发件地址 未配置');
    else if(!cfg.email_to)   errs.push('mail: 收件地址 未配置');
    else try { mailOk = await sendEmail(r.title, text, cfg); } catch(e){ errs.push('mail:' + (e.message || 'unknown')); }
  }
  return {ok: wxOk || mailOk, errs};
}
