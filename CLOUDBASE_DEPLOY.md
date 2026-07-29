# 招投标大赛模拟平台 · 腾讯云 CloudBase 云托管部署手册

适用场景：Railway 默认域名 `*.up.railway.app` 在中国大陆被墙，参赛选手普通浏览器打不开。
改用腾讯云 CloudBase 云托管（服务器在境内），普通浏览器即可秒开。

## 部署包

项目已打包为 `bidding-platform.zip`（含 Dockerfile、server.js、public/、package.json 等）。
如重新打包：`python -c "import os,zipfile; ..."`（或用 7-Zip 选中除 node_modules/.git/data 外的文件压缩）。

## 步骤一：开通腾讯云 CloudBase

1. 打开 https://console.cloud.tencent.com/tcb （云开发控制台）
2. 用微信扫码或 QQ/邮箱登录。**首次需实名认证**（按提示填身份证+刷脸，几分钟完成）
3. 点 **新建环境**
   - 环境名称：`bidding-dasai`（自定义）
   - 计费方式：选 **按量计费**（新用户有免费额度，超出才收费）
   - 地域：选离选手最近的，如 **上海** 或 **广州**
4. 等待环境创建完成（约 1 分钟）

## 步骤二：开通云托管并新建服务

1. 左侧菜单点 **云托管**（CloudBase Run）
2. 首次会提示"开通云托管"，点 **开通**（仍选上面的环境）
3. 点 **新建服务**
   - 服务名称：`bidding-platform`
   - 备注：招投标大赛模拟平台
4. 服务创建后，点进该服务，点 **新建版本**

## 步骤三：上传部署包并配置

1. 版本来源选择 **本地代码 / 代码包**
2. 上传 `bidding-platform.zip`
3. 构建方式：选 **Dockerfile**（项目里已带，最稳）
4. 服务端口填 **3000**
5. 展开"环境变量"，添加以下三条：
   - `ADMIN_KEY` = 你自己设的强密码（如 `bidding2026admin`，招标方后台要用）
   - `DATA_DIR` = `/data`
   - `NODE_ENV` = `production`
   - （`PORT` 平台会自动注入，可不填）
6. 展开"数据卷 / 文件存储"，把持久化目录挂载到 `/data`
   （这样重启实例后项目/投标数据不丢）
7. 点 **新建版本**，等待构建（约 1~3 分钟）

## 步骤四：获取公网地址并验证

1. 版本状态变 **正常 / 运行中** 后，在服务详情页找 **公网访问地址**
   - 类似 `https://bidding-platform-xxxx.ap-shanghai.run.tcloudbase.com`
2. 验证两个入口：
   - 参赛方门户：`https://你的域名/`
   - 招标方后台：`https://你的域名/admin.html?key=你设的ADMIN_KEY`

## 注意事项

- 免费额度用完后按量计费（流量+算力），正式比赛前建议充值少量余额避免被停。
- `ADMIN_KEY` 务必改成自己的强密码，别用默认值 `change-me-admin-key`。
- 国内访问走腾讯云域名，微信里直接点链接也能打开。
- 如想用自己买的域名（如 bidding.xxx.com），在云托管"自定义域名"里添加并配置 CNAME 即可。
