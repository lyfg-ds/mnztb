// ====== 招标方后台逻辑（单端口 + ADMIN_KEY 暗链接）======
// 入口：通过 /admin.html?key=你的密钥 访问（由服务端校验后写入 localStorage）
const ADMIN_KEY = new URLSearchParams(location.search).get('key') || localStorage.getItem('adminKey') || '';
if (ADMIN_KEY) localStorage.setItem('adminKey', ADMIN_KEY);

// 统一带密钥的 fetch 封装（cookie 自动携带，再加 header 兜底）
function apiFetch(url, opts = {}) {
  opts.headers = Object.assign({}, opts.headers, { 'x-admin-key': ADMIN_KEY });
  return fetch(url, opts);
}
function keyParam() {
  return ADMIN_KEY ? '?key=' + encodeURIComponent(ADMIN_KEY) : '';
}

if (!ADMIN_KEY) {
  document.body.insertAdjacentHTML('afterbegin',
    '<div style="background:#fef2f2;color:#b91c1c;padding:14px 16px;font-size:14px;text-align:center">'
    + '未检测到管理密钥。请通过带密钥的链接访问后台：<code>/admin.html?key=你的密钥</code>（该链接仅你自己掌握）。'
    + '</div>');
}

document.getElementById('pubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = '发布中…';
  try {
    const r = await apiFetch('/api/projects', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '发布失败');
    toast('项目已发布 ✅');
    e.target.reset();
    loadOrganizer();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false; btn.textContent = '发布项目';
  }
});

async function loadOrganizer() {
  const box = document.getElementById('orgList');
  try {
    const list = await (await apiFetch('/api/projects')).json();
    if (!list.length) {
      box.innerHTML = '<div class="empty">还没有发布项目，先在上方发布一个吧。</div>';
      return;
    }
    box.innerHTML = list.map((p) => `
      <div class="proj-card">
        <div class="top">
          <div>
            <h3>${esc(p.title)}</h3>
            <div class="meta">编号 ${esc(p.code)} · ${p.status === 'open' ? '<span class="status open">进行中</span>' : '<span class="status closed">已截止</span>'}${p.evaluationOpened ? ' · <span class="status closed">已开标</span>' : ''}${p.blind ? ' · <span class="badge">盲评</span>' : ''}</div>
          </div>
          <div class="row">
            <button class="btn small ghost" onclick="toggleStatus('${p.id}','${p.status === 'open' ? 'closed' : 'open'}')">
              ${p.status === 'open' ? '关闭报名' : '重新开启'}
            </button>
            <button class="btn small" onclick="openEval('${p.id}')">开标评标</button>
          </div>
        </div>
        <div class="meta">
          <span class="badge">购标 ${p.buyCount} 人</span>
          <span class="badge">投标 ${p.bidCount} 份</span>
          ${p.price ? '<span class="badge">售价 ¥' + p.price + '</span>' : '<span class="badge">免费</span>'}
          ${p.deadline ? '<span class="badge">截止 ' + esc(p.deadline.replace('T', ' ')) + '</span>' : ''}
          <a class="dl" href="/api/admin/${p.id}/file${keyParam()}" target="_blank">查看招标文件</a>
        </div>
        <div id="admin-${p.id}"></div>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败（可能被密钥拦截，请用带 ?key= 的链接访问）</div>';
  }
}

async function toggleStatus(id, status) {
  await apiFetch(`/api/admin/${id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  loadOrganizer();
}

async function loadAdmin(id) {
  const box = document.getElementById(`admin-${id}`);
  if (box.dataset.loaded) { box.innerHTML = ''; box.dataset.loaded = ''; return; }
  try {
    const d = await (await apiFetch(`/api/admin/${id}`)).json();
    const purRows = d.purchases.length
      ? d.purchases.map((x) => `<tr><td>${esc(x.bidderName)}</td><td>${esc(x.company)}</td><td>${esc(x.phone || '—')}</td><td>¥${x.amount}</td><td>${fmtTime(x.purchasedAt)}</td></tr>`).join('')
      : '<tr><td colspan="5" style="color:#6b7280">暂无购标记录</td></tr>';
    const bidRows = d.bids.length
      ? d.bids.map((x) => `<tr>
          <td>${esc(x.bidderName)}</td><td>${esc(x.company)}</td>
          <td>${x.amount ? '¥' + esc(x.amount) : '—'}</td>
          <td>${x.score != null ? esc(String(x.score)) : '—'}</td>
          <td><a class="dl" href="/api/bid-file/${x.id}${keyParam()}" target="_blank">${esc(x.file.originalName)}</a></td>
          <td>${fmtTime(x.submittedAt)}</td></tr>`).join('')
      : '<tr><td colspan="6" style="color:#6b7280">暂无投标</td></tr>';
    box.innerHTML = `
      <div class="sec-title" style="margin-top:14px">购标记录（${d.purchases.length}）</div>
      <table><thead><tr><th>投标人</th><th>公司</th><th>电话</th><th>金额</th><th>购买时间</th></tr></thead><tbody>${purRows}</tbody></table>
      <div class="sec-title">投标记录（${d.bids.length}）</div>
      <table><thead><tr><th>投标人</th><th>公司</th><th>报价</th><th>评分</th><th>投标文件</th><th>提交时间</th></tr></thead><tbody>${bidRows}</tbody></table>`;
    box.dataset.loaded = '1';
  } catch (e) {
    box.innerHTML = '<div class="empty">加载明细失败</div>';
  }
}

// ====== 开标评标 ======
async function openEval(id) {
  const d = await (await apiFetch(`/api/admin/${id}`)).json();
  const p = d.project;
  const blind = !!p.blind;
  const bids = d.bids;
  const winnerName = () => {
    const w = bids.find((b) => b.id === p.winnerBidId);
    return w ? (blind ? '中标方' : esc(w.bidderName) + ' / ' + esc(w.company)) : '—';
  };
  const rows = bids.length
    ? bids.map((b, i) => `
      <div class="bid-eval">
        <div class="meta"><b>${blind ? ('投标人' + String.fromCharCode(65 + i)) : esc(b.bidderName)}</b> · ${blind ? '—' : esc(b.company)} · ${b.amount ? ('报价 ¥' + esc(b.amount)) : '报价 —'}</div>
        <div class="grid2">
          <div><label>评分（0-100）</label><input type="number" min="0" max="100" value="${b.score != null ? b.score : ''}" data-bid="${b.id}" class="scoreInput" /></div>
          <div><label>评语</label><input type="text" value="${esc(b.comment || '')}" data-bid="${b.id}" class="commentInput" /></div>
        </div>
        <div class="hint" style="margin-top:6px"><a class="dl" href="/api/bid-file/${b.id}${keyParam()}" target="_blank">查看投标文件：${esc(b.file.originalName)}</a></div>
      </div>`).join('')
    : '<div class="empty">暂无投标，无法评标</div>';
  document.getElementById('evalContent').innerHTML = `
    <h2>开标评标 · ${esc(p.title)}</h2>
    ${p.evaluationOpened ? `<div class="result-win">✅ 结果已公布　中标：${winnerName()}</div>` : ''}
    <div class="sec-title">投标清单（${bids.length}）</div>
    ${rows}
    <div class="sec-title">公布中标</div>
    ${bids.length ? `<select id="winnerSel">${bids.map((b, i) => `<option value="${b.id}">${blind ? ('投标人' + String.fromCharCode(65 + i)) : esc(b.bidderName) + ' / ' + esc(b.company)}</option>`).join('')}</select>` : ''}
    <div style="margin-top:16px" class="row">
      <button class="btn ghost" onclick="saveScores('${id}')">保存评分</button>
      <button class="btn green" onclick="announce('${id}')">公布中标结果</button>
    </div>
    <div id="evalMsg" class="hint"></div>
  `;
  document.getElementById('evalModal').classList.add('show');
}
function closeEval() { document.getElementById('evalModal').classList.remove('show'); }

async function saveScores(id) {
  const scores = [];
  document.querySelectorAll('.scoreInput').forEach((inp) => {
    const bidId = inp.dataset.bid;
    const comment = document.querySelector('.commentInput[data-bid="' + bidId + '"]').value;
    scores.push({ bidId, score: inp.value, comment });
  });
  const r = await apiFetch(`/api/admin/${id}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores }),
  });
  const d = await r.json();
  if (!r.ok) return toast(d.error || '保存失败');
  toast('评分已保存 ✅');
  loadOrganizer();
  openEval(id);
}
async function announce(id) {
  const sel = document.getElementById('winnerSel');
  if (!sel) return toast('暂无投标可公布');
  const r = await apiFetch(`/api/admin/${id}/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerBidId: sel.value }),
  });
  const d = await r.json();
  if (!r.ok) return toast(d.error || '公布失败');
  toast('已公布中标结果 🏆');
  loadOrganizer();
  openEval(id);
}

document.getElementById('evalModal').addEventListener('click', (e) => { if (e.target.id === 'evalModal') closeEval(); });

loadOrganizer();
