// ====== 通用工具（参赛方与招标方共用）======
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// 记住本机已购记录：projectId -> purchaseId
function getMyPurchases() {
  try { return JSON.parse(localStorage.getItem('myPurchases') || '{}'); }
  catch { return {}; }
}
function rememberPurchase(projectId, purchaseId) {
  const m = getMyPurchases();
  m[projectId] = purchaseId;
  localStorage.setItem('myPurchases', JSON.stringify(m));
}

// 伪二维码（仅装饰，仿扫码支付样式）
function qrSVG(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = (h ^ c.charCodeAt(0)) >>> 0, h = (h * 16777619) >>> 0;
  const n = 21; let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    h = (h * 1103515245 + 12345) >>> 0;
    if ((h >> 16) & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  }
  const finder = (ox, oy) => {
    let s = '';
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const mid = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (edge || mid) s += `<rect x="${ox + x}" y="${oy + y}" width="1" height="1"/>`;
    }
    return s;
  };
  return `<svg viewBox="0 0 21 21" width="154" height="154" shape-rendering="crispEdges" fill="#111827">${cells}${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}</svg>`;
}

// 分片上传：把大文件切成 5MB 小片逐片上传，绕过云托管网关对单次请求体的 ~20MB 限制
async function uploadInChunks(file, onProgress) {
  const CHUNK = 5 * 1024 * 1024;
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  const initRes = await fetch('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, fileSize: file.size, totalChunks: total }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || '初始化上传失败');
  const uploadId = initData.uploadId;
  for (let i = 0; i < total; i++) {
    const blob = file.slice(i * CHUNK, Math.min((i + 1) * CHUNK, file.size));
    const fd = new FormData();
    fd.append('chunk', blob, 'chunk-' + i);
    const r = await fetch('/api/upload/chunk?uploadId=' + encodeURIComponent(uploadId) + '&index=' + i, { method: 'POST', body: fd });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || '分片上传失败');
    }
    if (onProgress) onProgress((i + 1) / total);
  }
  const compRes = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  const compData = await compRes.json();
  if (!compRes.ok) throw new Error(compData.error || '合并失败');
  return compData.file;
}
