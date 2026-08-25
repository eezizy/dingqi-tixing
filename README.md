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
- Basic Auth 保护管理页

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

不设 `AUTH_USER` 则管理页任何人可访问；生产务必设 `AUTH_USER` / `AUTH_PASS`（命令行环境变量，或启动后在网页「⚙ 设置 → 🔐 管理登录」里填——**网页改密码即时生效、无需重启**）。

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
- **git clone（推荐，公开库免认证）**：`git clone https://github.com/eezizy/dingqi-tixing.git && cd dingqi-tixing/server`。**注意 `data/` 已被 gitignore，clone 下来是空的，提醒需网页重建或从旧机迁移**（见下「迁移到新服务器」）

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

## 迁移到新服务器（例如从旧 VPS 迁到当前 netcup）

`data/` 不进 git，换机器不会自动带过来。两种迁法：

- **网页重建**：新机部署后，登录网页手动加提醒（适合提醒少）
- **文件迁移**：把旧机的 `server/data/reminders.json` + `settings.json` 复制（或发给我，我帮您在新机生成），新机覆盖到 `data/` 后重启服务即可

> 迁移前先确认旧机提醒已导出，避免关旧机后丢数据。

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
