# 招投标大赛模拟平台 · 云部署手册

本项目已改造为 **单端口、云就绪** 形态，可一键部署到任意支持 Node.js 的平台（Railway / Render / 你自己的服务器），得到**永久稳定的公网网址**，不再依赖你本机开机。

---

## 一、两个入口（核心设计）

部署后只有一个网址（例如 `https://bidding-platform.up.railway.app`），但分两个角色：

| 角色 | 链接 | 谁能进 |
|---|---|---|
| **参赛方门户** | `https://你的网址/` | 任何人都能进，浏览项目、模拟支付购标、下载、投标、看开标结果 |
| **招标方后台** | `https://你的网址/admin.html?key=你的密钥` | 只有**手握密钥**的你才能进（无密钥访问返回 404，对外隐藏） |

> 隔离原理：服务端对 `/admin.html` 和所有 `/api/admin/*` 接口做密钥校验（环境变量 `ADMIN_KEY`）。选手既看不到入口，也调不动后台接口。**把参赛方网址发选手，把后台网址（带 key）自己留着。**

---

## 二、环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `3000` | 云平台自动注入，无需手动设置 |
| `ADMIN_KEY` | **是（部署时务必改）** | `change-me-admin-key` | 招标方后台密钥，**请改成只有你知道的复杂字符串** |
| `DATA_DIR` | 否 | `./data` | 数据库与上传文件存放目录；挂载持久盘时指向挂载点（如 `/data`） |

---

## 三、部署方式 A：Railway（推荐，最省事）

1. 注册 https://railway.app （可用 GitHub 登录）。
2. 把整个 `bidding-platform` 文件夹推送到一个 **GitHub 私有仓库**（见文末「推送 Git」）。
3. Railway 控制台 → **New Project** → **Deploy from GitHub repo** → 选该仓库。
4. Railway 自动识别 `package.json`，`npm install` → `npm start`。
5. 进入项目 **Variables**，新增 `ADMIN_KEY`，值填你的密钥。
6. 等待部署完成，点击生成的域名即可访问：
   - 参赛方：`https://xxxx.up.railway.app/`
   - 招标方：`https://xxxx.up.railway.app/admin.html?key=你的密钥`
7. 数据持久化：Railway 的 Volume 为付费功能。短期比赛可**不挂盘**（容器存活期间数据都在）；若要长期/多次复赛，建议在 Railway 添加 1GB Volume 并设 `DATA_DIR` 指向它。

## 四、部署方式 B：Render（有免费额度）

1. 注册 https://render.com ，把项目推到 GitHub 仓库。
2. Render 控制台 → **New** → **Blueprint** → 选该仓库（会自动读取 `render.yaml`）。
3. 在创建页把 `ADMIN_KEY` 填成你的密钥（其余变量已预置）。
4. 免费版会分配一个 `xxx.onrender.com` 域名，并自动挂载 1GB 磁盘卷（`/data`，已配置 `DATA_DIR=/data`）。
5. 部署完成后访问：
   - 参赛方：`https://xxxx.onrender.com/`
   - 招标方：`https://xxxx.onrender.com/admin.html?key=你的密钥`

> Render 免费版在长时间无访问会休眠，首次访问需几秒唤醒，属正常现象。

## 五、部署方式 C：你自己的云服务器（阿里云/腾讯云 ECS 等）

```bash
# 1) 把 bidding-platform 目录传到服务器
# 2) 进入目录安装依赖
npm install
# 3) 设置环境变量并启动（建议用 pm2 守护进程）
export ADMIN_KEY="你的复杂密钥"
npm install -g pm2
pm2 start server.js --name bidding
pm2 save
# 4) 防火墙放行端口（默认 3000，或容器平台映射），用 Nginx 反代到 80/443 并配 HTTPS
```

---

## 六、本地运行（开发/自测）

```bash
# 依赖已安装到隔离环境，本地用以下方式启动单端口版本：
NODE_PATH="C:/Users/34259/.workbuddy/binaries/node/workspace/node_modules" \
  C:/Users/34259/.workbuddy/binaries/node/versions/22.22.2/node.exe server.js
# 默认 3000；可覆盖： PORT=4100 ADMIN_KEY=test123 node server.js
```
- 参赛方：`http://localhost:3000/`
- 招标方：`http://localhost:3000/admin.html?key=change-me-admin-key`（默认密钥）

> `tunnel.js` 仅用于本地内网穿透（把本机临时暴露到公网），部署到云后**不需要**它。

---

## 七、把项目推送到 GitHub（供 Railway/Render 拉取）

```bash
cd bidding-platform
git init
git add .
git commit -m "招投标大赛模拟平台 v2 - 云就绪单端口版"
git remote add origin https://github.com/你的用户名/bidding-platform.git
git push -u origin main
```

之后在 Railway/Render 连接这个仓库即可。

---

## 八、功能回顾

- 参赛方：手机号注册/登录 → 模拟支付购标 → 下载标书 → 提交投标 → 「我的中心」只看自己的记录 → 开标后看排名与中标。
- 招标方：发布项目+上传招标文件（可盲评）→ 查看购标/投标明细 → 开关报名 → 开标打分评语 → 公布中标。
- 数据隔离：开标前任何选手看不到他人投标；未登录不能购标/投标（服务端 401/403 拦截）。
