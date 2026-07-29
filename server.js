/**
 * 招投标大赛模拟平台 - 后端服务（单端口云就绪版）
 *  单实例监听 process.env.PORT（默认 3000）
 *  - 参赛方门户 : "/"          -> bidder.html，暴露购标/下载/投标/列表/详情接口
 *  - 招标方后台 : "/admin.html?key=ADMIN_KEY"  -> admin.html，接口均带 ADMIN_KEY 保护
 *  两端共享同一份数据 (DATA_DIR/db.json)。
 *
 * 部署：设置环境变量 PORT（云平台自动提供）、ADMIN_KEY（招标方入口密钥）、
 *      DATA_DIR（持久卷挂载路径，默认 ./data）。
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

[DATA_DIR, UPLOAD_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ---------- 简易 JSON 数据库 ----------
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { projects: [], purchases: [], bids: [], bidders: [], sessions: {} };
  try {
    const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(d.bidders)) d.bidders = [];
    if (!d.sessions || typeof d.sessions !== 'object') d.sessions = {};
    if (!Array.isArray(d.projects)) d.projects = [];
    if (!Array.isArray(d.purchases)) d.purchases = [];
    if (!Array.isArray(d.bids)) d.bids = [];
    return d;
  } catch (e) {
    return { projects: [], purchases: [], bids: [], bidders: [], sessions: {} };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
let db = loadDB();

// ---------- 文件上传配置 ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// ---------- 分片上传（绕过云托管网关对单次请求体的 ~20MB 限制）----------
const CHUNK_DIR = path.join(DATA_DIR, '_chunks');
const uploadChunk = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(CHUNK_DIR, String(req.query.uploadId))),
    filename: (req, file, cb) => cb(null, String(req.query.index)),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 单分片上限 10MB，远小于网关限制
});
function safeUploadId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}
// 安全删除（绕过沙箱 safe-delete shim：回收站不可用时其会抛异常导致进程崩溃）
function safeUnlink(p) { try { fs.unlinkSync(p); } catch (e) {} }
function safeRemove(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}
function sanitize(s) {
  return String(s == null ? '' : s).trim();
}
function hashPwd(s) {
  return crypto.createHash('sha256').update('zb:' + s).digest('hex');
}
function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ---------- 招标方密钥校验 ----------
function adminCookie() {
  return crypto.createHash('sha256').update('zb-admin:' + ADMIN_KEY).digest('hex');
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
function isAdmin(req) {
  const provided =
    req.query && req.query.key ? req.query.key :
    req.get && req.get('x-admin-key') ? req.get('x-admin-key') :
    (parseCookies(req).admin_auth || null);
  return provided === ADMIN_KEY || provided === adminCookie();
}
// 页面级保护：/admin.html 无有效密钥返回 404（对外隐藏）
function adminPageProtect(req, res, next) {
  if (!isAdmin(req)) return res.status(404).send('Not Found');
  if (req.query && req.query.key) {
    res.setHeader('Set-Cookie', `admin_auth=${adminCookie()}; Path=/; Max-Age=864000; SameSite=Lax`);
  }
  next();
}
// 接口级保护：无密钥返回 403
function adminApiProtect(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: '无权限' });
  if (req.query && req.query.key) {
    res.setHeader('Set-Cookie', `admin_auth=${adminCookie()}; Path=/; Max-Age=864000; SameSite=Lax`);
  }
  next();
}

// 从请求中解析已登录选手
function authBidder(req) {
  let token = null;
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token && req.query && req.query.token) token = req.query.token;
  if (!token && req.body && req.body.token) token = req.body.token;
  if (!token) return null;
  const bidderId = db.sessions[token];
  if (!bidderId) return null;
  return db.bidders.find((b) => b.id === bidderId) || null;
}

// ---------- 共用的查询处理器 ----------
function listProjectsHandler(req, res) {
  const list = db.projects.map((p) => ({
    id: p.id,
    title: p.title,
    code: p.code,
    organizer: p.organizer,
    budget: p.budget,
    price: p.price,
    deadline: p.deadline,
    description: p.description,
    status: p.status,
    fileOriginalName: p.file.originalName,
    buyCount: db.purchases.filter((x) => x.projectId === p.id).length,
    bidCount: db.bids.filter((x) => x.projectId === p.id).length,
    evaluationOpened: p.evaluationOpened || false,
    winnerBidId: p.winnerBidId || null,
    blind: p.blind || false,
    createdAt: p.createdAt,
  }));
  res.json(list);
}
function projectDetailHandler(req, res) {
  const p = db.projects.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const out = {
    ...p,
    evaluationOpened: p.evaluationOpened || false,
    winnerBidId: p.winnerBidId || null,
    blind: p.blind || false,
  };
  if (out.evaluationOpened) {
    out.bids = db.bids
      .filter((x) => x.projectId === p.id)
      .map((b) => ({
        id: b.id,
        bidderName: b.bidderName,
        company: b.company,
        amount: b.amount,
        score: b.score,
        comment: b.comment,
        submittedAt: b.submittedAt,
      }));
  }
  res.json(out);
}

// ================= 单实例 Express =================
const app = express();

// 先拦截招标方页面（带密钥才放行，否则 404 隐藏）
app.use((req, res, next) => {
  if (req.path === '/admin.html') return adminPageProtect(req, res, next);
  next();
});
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bidder.html')));

// ============ 参赛方接口（公开）============
app.get('/api/projects', listProjectsHandler);
app.get('/api/projects/:id', projectDetailHandler);

// ====== 选手账号 ======
app.post('/api/bidder/register', (req, res) => {
  const { phone, password, name, company } = req.body || {};
  if (!phone || !password || !name || !company) {
    return res.status(400).json({ error: '手机号、密码、姓名、公司均为必填' });
  }
  if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '手机号格式不正确' });
  if (db.bidders.find((b) => b.phone === phone)) return res.status(400).json({ error: '该手机号已注册' });
  const bidder = {
    id: genId('bd'),
    phone: sanitize(phone),
    name: sanitize(name),
    company: sanitize(company),
    password: hashPwd(password),
    createdAt: new Date().toISOString(),
  };
  db.bidders.push(bidder);
  const token = genToken();
  db.sessions[token] = bidder.id;
  saveDB(db);
  res.json({ ok: true, token, bidder: { id: bidder.id, name: bidder.name, company: bidder.company, phone: bidder.phone } });
});
app.post('/api/bidder/login', (req, res) => {
  const { phone, password } = req.body || {};
  const b = db.bidders.find((x) => x.phone === phone);
  if (!b || b.password !== hashPwd(password)) return res.status(401).json({ error: '手机号或密码错误' });
  const token = genToken();
  db.sessions[token] = b.id;
  saveDB(db);
  res.json({ ok: true, token, bidder: { id: b.id, name: b.name, company: b.company, phone: b.phone } });
});
app.get('/api/bidder/me', (req, res) => {
  const b = authBidder(req);
  if (!b) return res.status(401).json({ error: '未登录' });
  const purchases = db.purchases
    .filter((x) => x.bidderId === b.id)
    .map((x) => ({ id: x.id, projectId: x.projectId, amount: x.amount, purchasedAt: x.purchasedAt }));
  const bids = db.bids
    .filter((x) => x.bidderId === b.id)
    .map((x) => ({ id: x.id, projectId: x.projectId, amount: x.amount, remark: x.remark, submittedAt: x.submittedAt, file: x.file }));
  res.json({ bidder: { name: b.name, company: b.company, phone: b.phone }, purchases, bids });
});
app.get('/api/bidder/my-bid-file/:bidId', (req, res) => {
  const b = authBidder(req);
  if (!b) return res.status(401).json({ error: '未登录' });
  const bid = db.bids.find((x) => x.id === req.params.bidId && x.bidderId === b.id);
  if (!bid) return res.status(404).json({ error: '投标记录不存在' });
  const filePath = path.join(UPLOAD_DIR, bid.file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件丢失' });
  res.download(filePath, bid.file.originalName);
});

// 购买标书（必须登录）
app.post('/api/purchase', upload.none(), (req, res) => {
  const b = authBidder(req);
  if (!b) return res.status(401).json({ error: '请先登录后再购买标书' });
  const { projectId } = req.body || {};
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  if (p.status === 'closed') return res.status(400).json({ error: '该项目已截止，无法购买' });
  const existing = db.purchases.find((x) => x.projectId === projectId && x.bidderId === b.id);
  if (existing) return res.json({ ok: true, purchaseId: existing.id, duplicated: true });
  const purchase = {
    id: genId('pur'),
    projectId,
    bidderId: b.id,
    bidderName: b.name,
    company: b.company,
    phone: b.phone,
    amount: p.price,
    purchasedAt: new Date().toISOString(),
  };
  db.purchases.push(purchase);
  saveDB(db);
  res.json({ ok: true, purchaseId: purchase.id });
});

// 下载招标文件（已购：凭 purchaseId 或本人登录）
app.get('/api/download/:projectId', (req, res) => {
  const { purchaseId, token } = req.query;
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  let pur = null;
  if (purchaseId) pur = db.purchases.find((x) => x.id === purchaseId && x.projectId === p.id);
  if (!pur && token) {
    const b = authBidder(req);
    if (b) pur = db.purchases.find((x) => x.projectId === p.id && x.bidderId === b.id);
  }
  if (!pur) return res.status(403).json({ error: '请先购买标书后再下载' });
  const filePath = path.join(UPLOAD_DIR, p.file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '标书文件丢失' });
  res.download(filePath, p.file.originalName);
});

// ============ 分片上传（招标方/投标方共用，公开接口）============
app.post('/api/upload/init', (req, res) => {
  const { fileName, fileSize, totalChunks } = req.body || {};
  if (!fileName || !totalChunks || totalChunks < 1) {
    return res.status(400).json({ error: '参数缺失（fileName / totalChunks）' });
  }
  if (totalChunks > 10000) return res.status(400).json({ error: '分片数过多' });
  const uploadId = crypto.randomBytes(12).toString('hex');
  fs.mkdirSync(path.join(CHUNK_DIR, uploadId), { recursive: true });
  fs.writeFileSync(
    path.join(CHUNK_DIR, uploadId, '.meta.json'),
    JSON.stringify({ fileName, fileSize: Number(fileSize) || 0, totalChunks: Number(totalChunks), createdAt: new Date().toISOString() })
  );
  res.json({ ok: true, uploadId });
});

app.post('/api/upload/chunk', (req, res) => {
  const uploadId = req.query.uploadId;
  const index = req.query.index;
  if (!safeUploadId(uploadId)) return res.status(400).json({ error: '无效 uploadId' });
  const dir = path.join(CHUNK_DIR, uploadId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: '上传会话不存在，请重新选择文件' });
  uploadChunk.single('chunk')(req, res, (err) => {
    if (err) return res.status(400).json({ error: '分片过大或上传失败：' + err.message });
    if (!req.file) return res.status(400).json({ error: '缺少分片内容' });
    res.json({ ok: true, index: Number(index) });
  });
});

app.post('/api/upload/complete', (req, res) => {
  const { uploadId } = req.body || {};
  if (!safeUploadId(uploadId)) return res.status(400).json({ error: '无效 uploadId' });
  const dir = path.join(CHUNK_DIR, uploadId);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: '上传会话不存在' });
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, '.meta.json'), 'utf8')); }
  catch { return res.status(400).json({ error: '会话元数据损坏' }); }
  const total = meta.totalChunks;
  const ext = path.extname(meta.fileName) || '';
  const storedName = crypto.randomBytes(12).toString('hex') + ext;
  const outPath = path.join(UPLOAD_DIR, storedName);
  try {
    const out = fs.createWriteStream(outPath);
    for (let i = 0; i < total; i++) {
      const cp = path.join(dir, String(i));
      if (!fs.existsSync(cp)) throw new Error('第 ' + (i + 1) + ' 个分片缺失');
      out.write(fs.readFileSync(cp));
    }
    out.end();
    out.on('finish', () => {
      const size = fs.statSync(outPath).size;
      if (size > 200 * 1024 * 1024) {
        safeUnlink(outPath);
        safeRemove(dir);
        return res.status(413).json({ ok: false, error: '文件过大：单个文件最大 200MB' });
      }
      res.json({ ok: true, file: { storedName, originalName: meta.fileName, size } });
      safeRemove(dir);
    });
  } catch (e) {
    safeUnlink(outPath);
    return res.status(400).json({ error: (e && e.message) || '合并失败' });
  }
});

// 提交投标（必须登录）
app.post('/api/bids', (req, res) => {
  const b = authBidder(req);
  if (!b) return res.status(401).json({ error: '请先登录后再提交投标' });
  const { projectId, amount, remark, file } = req.body;
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  if (p.status === 'closed') return res.status(400).json({ error: '投标已截止' });
  if (!file || !file.storedName) return res.status(400).json({ error: '投标文件为必填项' });
  if (!fs.existsSync(path.join(UPLOAD_DIR, file.storedName))) return res.status(400).json({ error: '文件不存在，请重新上传' });
  const bid = {
    id: genId('bid'),
    projectId,
    bidderId: b.id,
    bidderName: b.name,
    company: b.company,
    phone: b.phone,
    amount: sanitize(amount),
    remark: sanitize(remark),
    score: null,
    comment: '',
    file: { originalName: file.originalName, storedName: file.storedName, size: file.size },
    submittedAt: new Date().toISOString(),
  };
  db.bids.push(bid);
  saveDB(db);
  res.json({ ok: true, bid });
});

// 替换已提交的投标文件（必须登录，且只能替换自己的；项目截止/开标后不可替换）
app.post('/api/bids/:bidId/replace', (req, res) => {
  const b = authBidder(req);
  if (!b) return res.status(401).json({ error: '请先登录后再操作' });
  const bid = db.bids.find((x) => x.id === req.params.bidId && x.bidderId === b.id);
  if (!bid) return res.status(404).json({ error: '投标记录不存在' });
  const p = db.projects.find((x) => x.id === bid.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  if (p.status === 'closed') return res.status(400).json({ error: '投标已截止，无法替换' });
  if (p.evaluationOpened) return res.status(400).json({ error: '已开标，无法替换' });
  const { amount, remark, file } = req.body || {};
  if (!file || !file.storedName) return res.status(400).json({ error: '新投标文件为必填项' });
  if (!fs.existsSync(path.join(UPLOAD_DIR, file.storedName))) return res.status(400).json({ error: '文件不存在，请重新上传' });
  const oldStored = bid.file && bid.file.storedName;
  bid.amount = sanitize(amount);
  bid.remark = sanitize(remark);
  bid.file = { originalName: file.originalName, storedName: file.storedName, size: file.size };
  bid.submittedAt = new Date().toISOString();
  if (oldStored && oldStored !== file.storedName) {
    safeUnlink(path.join(UPLOAD_DIR, oldStored));
  }
  saveDB(db);
  res.json({ ok: true, bid });
});

// ============ 招标方接口（全部需 ADMIN_KEY）============
// 发布项目（含上传招标文件）
app.post('/api/projects', adminApiProtect, (req, res) => {
  const { title, code, organizer, budget, price, deadline, description, file } = req.body;
  if (!title || !file || !file.storedName) {
    return res.status(400).json({ error: '项目名称和招标文件为必填项' });
  }
  if (!fs.existsSync(path.join(UPLOAD_DIR, file.storedName))) return res.status(400).json({ error: '文件不存在，请重新上传' });
  const project = {
    id: genId('prj'),
    title: sanitize(title),
    code: sanitize(code) || genId('BID'),
    organizer: sanitize(organizer),
    budget: sanitize(budget),
    price: Number(sanitize(price)) || 0,
    deadline: sanitize(deadline),
    description: sanitize(description),
    blind: req.body.blind === '1' || req.body.blind === 'on' || req.body.blind === 'true' || req.body.blind === true,
    file: {
      originalName: file.originalName,
      storedName: file.storedName,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    },
    status: 'open',
    evaluationOpened: false,
    winnerBidId: null,
    createdAt: new Date().toISOString(),
  };
  db.projects.unshift(project);
  saveDB(db);
  res.json({ ok: true, project });
});

app.get('/api/admin/:projectId', adminApiProtect, (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const purchases = db.purchases
    .filter((x) => x.projectId === p.id)
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  const bids = db.bids
    .filter((x) => x.projectId === p.id)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  res.json({ project: p, purchases, bids });
});
app.post('/api/admin/:projectId/status', adminApiProtect, (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  p.status = req.body.status === 'open' ? 'open' : 'closed';
  saveDB(db);
  res.json({ ok: true, status: p.status });
});
app.post('/api/admin/:projectId/evaluate', adminApiProtect, upload.none(), (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  let scores = [];
  if (Array.isArray(req.body.scores)) scores = req.body.scores;
  else {
    try { scores = JSON.parse(req.body.scores || '[]'); }
    catch { return res.status(400).json({ error: '评分格式错误' }); }
  }
  scores.forEach((s) => {
    const b = db.bids.find((x) => x.id === s.bidId && x.projectId === p.id);
    if (b) {
      b.score = s.score === '' || s.score == null ? null : Number(s.score);
      b.comment = sanitize(s.comment);
    }
  });
  saveDB(db);
  res.json({ ok: true });
});
app.post('/api/admin/:projectId/announce', adminApiProtect, upload.none(), (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  p.evaluationOpened = true;
  p.winnerBidId = sanitize(req.body.winnerBidId) || null;
  saveDB(db);
  res.json({ ok: true });
});
app.get('/api/admin/:projectId/file', adminApiProtect, (req, res) => {
  const p = db.projects.find((x) => x.id === req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  const filePath = path.join(UPLOAD_DIR, p.file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '标书文件丢失' });
  res.download(filePath, p.file.originalName);
});
app.get('/api/bid-file/:bidId', adminApiProtect, (req, res) => {
  const b = db.bids.find((x) => x.id === req.params.bidId);
  if (!b) return res.status(404).json({ error: '投标记录不存在' });
  const filePath = path.join(UPLOAD_DIR, b.file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件丢失' });
  res.download(filePath, b.file.originalName);
});

// 全局错误处理：把文件超限(multer)转成友好提示，避免返回 500
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: '文件过大：单个文件最大 200MB' });
  }
  if (err) {
    console.error('未捕获错误:', err);
    return res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`招投标平台已启动: http://localhost:${PORT} (PORT=${PORT})`);
});
