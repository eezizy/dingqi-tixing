# 定时提醒（Node.js 版）

给自己发定时提醒：支持**按天 / 月 / 年**重复、可设提醒时间、推送内容可编辑，推送到**企业微信**（自建应用）和**邮箱**（Resend）。

> 这是原 Cloudflare Workers + D1 版的**纯 Node.js 重写版**——逻辑、界面、推送完全不变，只是把运行时换成标准 Node.js，零外部依赖，部署到 VPS 更省心。

## 功能

- 提醒列表（下次 / 上次时间、通道徽章、异常标红）
- 添加 / 编辑 / 停用 / 启用 / 删除提醒
- 重复单位：天 / 月 / 年，可设间隔（每 N 个周期）、每月几号、月份
- 提醒时间（时:分，按指定时区计算）
- 双通道推送：企业微信应用 + Resend 邮箱
- 每条提醒可点「测试」立即推送
- 进程内每 30 秒扫描一次到期提醒并自动推送
- ⚙ 设置弹窗填凭证，挂 ❓ 悬停配置指南
- 网页登录（Form 登录 + cookie session）保护管理页

## 技术栈

- **零依赖**：仅用 Node.js 内置模块（`http` / `fs` / `Buffer` / `Intl` / 全局 `fetch`）
- **存储**：JSON 文件（`data/reminders.json` + `data/settings.json`），无需数据库
- **运行**：Node.js ≥ 18（已测 22.x）

## 本地运行

```bash
cd server
node server.js              # 默认监听 8080
# 浏览器打开 http://localhost:8080
```

不设 `AUTH_USER` 则管理页任何人可访问；生产务必设 `AUTH_USER` / `AUTH_PASS`（命令行环境变量，或启动后在网页「⚙ 设置 → 🔐 管理登录」里填——**网页改密码即时生效、无需重启**）。优先级：**网页设置的 `settings.json` > 启动环境变量**（已在网页设过账号，改启动命令的 `AUTH_USER` 会被忽略）。

---

## 部署到 VPS（手动 SSH 路线 · 已实战验证）

> 适用：任意 Linux VPS（Debian/Ubuntu/CentOS 等）。**不需要 1Panel 的"Node 项目"功能**，纯 SSH 即可跑。下面路径以 `/opt/dingqi-tixing` 为例，可换成任意目录。

### 1. 安装 Node（官方二进制，不用 apt 老版本）

```bash
cd /tmp
curl -fsSL https://nodejs.org/dist/v22.22.2/node-v22.22.2-linux-x64.tar.xz -o node.tar.xz
tar -xf node.tar.xz
cp -r node-v22.22.2-linux-x64/{bin,include,lib,share} /usr/local/
hash -r
node -v     # 应输出 v22.22.2
# ⚠️ 下载文件名是 node-v22.22.2-linux-x64.tar.xz（末尾 .tar.xz 两个点），别漏成 .tarx 否则 404
```

### 2. 上传代码

把 `server/` 整个文件夹传到 VPS（任选其一）：

- **1Panel 文件管理**：直接拖拽 `server/` 文件夹到 `/opt/dingqi-tixing`
- **scp**：`scp -r server/ root@<VPS_IP>:/opt/dingqi-tixing`
- **git clone（推荐，公开库免认证）**：`git clone https://github.com/eezizy/dingqi-tixing.git dingqi-tixing && cd dingqi-tixing`（仓库根即服务代码，`cd dingqi-tixing` 即可，**不要再加 `/server`**）。**注意 `data/` 已被 gitignore，clone 下来是空的，提醒需网页重建或从旧机迁移**（见下「迁移到新服务器」）

### 3. 放行防火墙（关键！否则外网 502）

```bash
ufw allow 8080/tcp
ufw reload
ufw status    # 确认 8080/tcp 在 ALLOW 列表里
```

> 如果 VPS 用的是 firewalld 而非 ufw：
> `firewall-cmd --permanent --add-port=8080/tcp && firewall-cmd --reload`
>
> ⚠️ **netcup 等部分套餐带外部硬件防火墙**：系统里 ufw 放行了、`ss` 也显示监听，外网仍可能不通。这种情况要去 netcup 控制台（SCP/CCP）加一条 **TCP 8080 入站**规则才生效。

### 4. 后台启动（关 SSH 也活）

```bash
cd /opt/dingqi-tixing

# 先清掉可能残留的进程
pkill -f "node server.js" 2>/dev/null
sleep 1

# 后台启动，日志写 run.log
nohup env AUTH_USER=admin AUTH_PASS=你的密码 PORT=8080 \
  node server.js > run.log 2>&1 &

sleep 2
tail -n 5 run.log    # 应看到「定时提醒服务已启动: http://localhost:8080」
```

> ⚠️ 必须用 `nohup ... &` 后台跑。前台 `node server.js` 一旦 SSH 窗口关闭，进程会被杀掉，外网就 502 了。

### 5. 验证

```bash
curl -s -u admin:你的密码 http://localhost:8080/api/config
# 返回 {"tz":"Asia/Shanghai","serverNow":...} 即正常
```

### 6. 浏览器访问 + 配置推送

- 打开 `http://<VPS公网IP>:8080` → 输入账号密码
- 点「⚙ 设置」→ 填推送凭证（见下章）→ 保存 → 点「测试」

### 7.（可选）域名 + HTTPS（1Panel 反向代理）

- 1Panel → 网站 → 反向代理：`域名 <your-subdomain.your-domain>` → 目标 `127.0.0.1:8080`
- 反向代理里一键申请 Let's Encrypt 证书（自动 HTTPS）
- Cloudflare DNS 加 A 记录：`<your-subdomain.your-domain>` → `<VPS_IP>`
- 想走 CF 代理（橙色云）需加 Origin Rule 带 Host；否则用灰色云（DNS only）最简单

### 8.（可选）开机自启（systemd，比 nohup 更稳）

```ini
# /etc/systemd/system/dingqi.service
[Unit]
Description=定时提醒
After=network.target

[Service]
WorkingDirectory=/opt/dingqi-tixing
Environment=AUTH_USER=admin
Environment=AUTH_PASS=你的密码
Environment=PORT=8080
ExecStart=/usr/local/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now dingqi
```

---

## 配置推送（邮件通道 · Resend onboarding 偷懒方案）

> 只走邮件、不想搞企业微信时，用 Resend 的 `onboarding@resend.dev` 发件人，**免域名验证，30 秒跑通**。

1. 登录 [resend.com/api-keys](https://resend.com/api-keys) → Create API Key，复制 `re_xxxxx`
2. 在「⚙ 设置」填：
   - **Resend API Key**：`re_xxxxx`
   - **发件地址**：`onboarding@resend.dev`
   - **收件邮箱**：**必须填您 Resend 注册时用的邮箱**（onboarding 模式只许发到注册邮箱）
   - **时区**：`Asia/Shanghai`（别动）
   - 企业微信四框留空
3. 保存 → 点「测试」→ 收件箱看到信即 OK

### 常见报错

| 报错 | 原因 / 解法 |
|---|---|
| `API key invalid` | key 失效 / 复制多空格，重新签一个全选复制 |
| `Recipient not allowed` | 收件邮箱 ≠ Resend 注册邮箱，回去核对 |
| 没报错但没收到 | 看垃圾箱；`.xyz` 等便宜域名可能被收件方反垃圾拦掉 |

### 正式方案（不被反垃圾拦）

Resend → Domains 加您的域名（如 `your-domain.com`）→ 配 DKIM/CNAME 到您的 DNS 服务商 → 发件地址改 `noreply@<your-subdomain.your-domain>`，收件邮箱即可填任意地址。

---

## 数据备份

数据在 `server/data/` 目录（`reminders.json` + `settings.json`）。备份时复制这个目录即可。**注意 `settings.json` 含凭证明文，勿公开分享。**

### 网页内导出 / 导入（推荐，零命令行）

- **导出备份**：登录后点顶部「📤 导出」，浏览器下载 `reminders-backup-YYYYMMDD.json`（含全部提醒，**不含密码**）。
- **导入恢复 / 迁移**：点「📥 导入」选该文件，把提醒追加回系统（原 id 丢弃、按当前时区重算排期，保留启用/停用状态）。导入为**追加不覆盖**——同机重复导入会生成重复项；迁移到新机（空数据）直接导入即可。

## 迁移到新服务器（例如从旧 VPS 迁到当前 netcup）

`data/` 不进 git，换机器不会自动带过来。两种迁法：

- **网页重建**：新机部署后，登录网页手动加提醒（适合提醒少）
- **文件迁移**：把旧机的 `server/data/reminders.json` + `settings.json` 复制（或发给我，我帮您在新机生成），新机覆盖到 `data/` 后重启服务即可

> 迁移前先确认旧机提醒已导出，避免关旧机后丢数据。

---

## 推送到 GitHub（代码备份 / 同步）

代码仓：`https://github.com/eezizy/dingqi-tixing`（公开，README 已脱敏，可放心公开）。本地改动先 `git commit`，再按下面推：

```bash
# 1) 加回远程（PAT 内嵌在 URL，用完即删，不留本地痕迹）
git remote add origin https://<PAT>@github.com/eezizy/dingqi-tixing.git

# 2) 推送 master（fast-forward，不覆盖远程已有历史）
git push -u origin master

# 3) 推完立刻移除 remote，清掉 token 残留
git remote remove origin
```

**要点**
- PAT 用 **classic**（前缀 `ghp_`），勾 `repo` 权限；GitHub 已不支持账号密码 push，必须用令牌。
- `<PAT>` 是一次性/复用令牌，**别写进任何文件**，只临时内嵌在 push 命令的 URL 里，推完即 `git remote remove origin`。
- 同个时段内可复用同一个 PAT（皇上授权）：可保留 `origin` 直到收工，期间直接 `git push` 即可，不用每次重加；收工时一句"清掉 remote"就移除。
- 若 push 被拒（非 fast-forward，比如曾在 GitHub 网页端改过 README）：先 `git pull --rebase` 合并再推，或确认无冲突后 `git push --force`（慎用）。
- `data/` 已被 gitignore，push 只带走代码，不会上传 `settings.json`（密码）/ `reminders.json`（提醒）——参见避坑 #7。

---

## 踩坑与排错（避坑指南）

部署和日常运维中真实踩过的坑，按出现频率排序，照着避即可。

### 1. 生产域名拼错（最常见）
- 正确前缀 `dsrw-nc`（**d-s-r-w**-nc，不是 dsw-nc）；完整访问地址按你自己的 netcup 域名拼接，如 `https://dsrw-nc.<你的域名>`。
- 现象：人脑默认写成 dsw-nc（漏了中间的 r），导致访问/文档全错。引用前务必核对。

### 2. Node 下载文件名 404
- 正确：`node-v22.22.2-linux-x64.tar.xz`（末尾 `.tar.xz` 两个点）
- 错写 `tarx`（漏点）→ 404。复制命令时别手滑。

### 3. 外网 502（防火墙没全开）
- 系统 `ufw allow 8080/tcp` 只开系统层；**netcup 等带外部硬件防火墙的套餐，还要去控制台（SCP/CCP）加 TCP 8080 入站规则**，否则 ufw 放行了、`ss` 也监听，外网仍不通。
- 排错四连：`curl http://127.0.0.1:8080/api/me`（本机）→ `ss -ltnp | grep 8080`（进程在听）→ `ufw status`（系统放行）→ 控制台硬件防火墙（外部放行）。

### 4. 浏览器登录死锁（已修：commit fb2c36a）
- **现象**：未登录时访问首页，浏览器渲染出一堆 JSON（如 `{"error":"unauthorized"}`）而非登录页；360/手机尤其明显，Chrome 因有旧 cookie 正常。
- **根因**：原来只对 `/api/*` 白名单免鉴权，`/` 不在内 → 未登录访问 `/` 返回 401 JSON → 拿不到 HTML → 看不到登录页 → 永远登不进，形成死锁。
- **修复**：新增 `isPublicPath()`，让 `/`、`/index.html`、静态资源免鉴权；业务 API 仍 401 受保护。所有响应加 `Cache-Control: no-store` 防 401 JSON 被缓存当首页。

### 5. 手机不弹登录框（已修：commit e079ba2）
- **现象**：手机（iOS Safari 裸 IP:8080）访问直接渲染 "Unauthorized" 纯文本，不弹登录框。
- **根因**：现代浏览器对 HTTP 明文站点的 Basic Auth 弹框策略收紧，手机端不弹框、直接把 401 body 当文本渲染；电脑 Chrome 宽松才弹框。
- **修复**：改成 Form 登录（网页输入账号密码）+ cookie session（`lib/session.js`，7 天 TTL，持久化 `data/sessions.json`，重启不丢），401 改为返回 JSON `{needLogin:true}` 且不发 `WWW-Authenticate` 头，前端自动跳登录页。

### 6. 登录凭证优先级（改用户名别改错地方）
- 优先级：**网页「⚙ 设置 → 🔐 管理登录」写的 `settings.json` > 启动命令的 `AUTH_USER`/`AUTH_PASS` 环境变量**。
- 若已在网页设过账号 → 启动命令里的 `AUTH_USER` 被忽略，改 env 重启也不变。想换用户名去网页改最稳（即时生效、无需重启）。
- 改用户名会让所有已登录浏览器掉线需重登（session 绑用户名，预期行为）。

### 7. 更新代码安全（git pull 不碰数据）
- `data/` 已被 `.gitignore` 排除，`git pull` 只更新代码，不会覆盖 `settings.json`（密码）和 `reminders.json`（提醒）。可放心 pull + 重启。
- 更新流程：`cd <目录> && git pull` → `pkill -f "node server.js"; sleep 2` → 重新 `nohup ... node server.js`。

### 8. 本地测试用 pkill 的坑（仅本机 Windows）
- Linux/netcup 上 `pkill -f "node server.js"` 可靠。
- **Windows Git Bash 下 pkill 不可靠**，会测到旧服务误判。本地测试改用 `netstat -ano | findstr :8080`（找 PID）→ `taskkill /F /PID <pid>`。

### 9. 必须 nohup 后台
- 前台 `node server.js` 一旦 SSH 窗口关闭，进程被杀，外网 502。务必 `nohup ... &` 或 systemd。

---

## 与 Cloudflare 版的区别

| | CF 版 | Node 版（本版） |
|---|---|---|
| 运行时 | Cloudflare Workers | 标准 Node.js |
| 存储 | D1 (SQLite) | JSON 文件 |
| 定时 | CF Cron Trigger | 进程内 setInterval（每 30s） |
| 部署 | 仪表盘粘贴（易踩坑） | 上传文件夹 + `node server.js` |
| 依赖 | 平台托管 | 零依赖 |
| 凭证 | 环境变量 / 库 | .env / 网页设置 / JSON 文件 |

逻辑、界面、推送、递归时间计算等**全部一致**。

## 目录结构

```
server/
├── server.js          # 入口：HTTP 服务 + API + 静态托管 + 定时扫描 + Basic Auth
├── lib/
│   ├── schedule.js    # 时间计算（天/月/年递归发生时刻）
│   ├── push.js        # 企业微信 + Resend 推送
│   └── store.js       # JSON 文件存储（零依赖）
├── public/
│   └── index.html     # 管理界面
├── data/              # 运行时生成（reminders.json / settings.json），已 gitignore
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## License

MIT
