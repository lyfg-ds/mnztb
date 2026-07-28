// ====== 参赛方门户逻辑（含轻量登录）======
const TOKEN_KEY = 'zb_token';
let me = null;          // { bidder, purchases, bids }
let allProjects = [];   // 项目列表缓存（用于我的中心显示标题）

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setSession(token, bidder) {
  localStorage.setItem(TOKEN_KEY, token);
  me = { bidder, purchases: [], bids: [] };
  renderTopbar();
}
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  me = null;
  renderTopbar();
  toast('已退出登录');
}
async function loadMe() {
  const t = getToken();
  if (!t) { me = null; renderTopbar(); return; }
  try {
    const r = await fetch('/api/bidder/me', { headers: { Authorization: 'Bearer ' + t } });
    if (r.ok) me = await r.json();
    else logout();
  } catch (e) { me = null; }
  renderTopbar();
}

function renderTopbar() {
  const box = document.getElementById('topRight');
  if (me && me.bidder) {
    box.innerHTML = `<span class="who">${esc(me.bidder.name)} · ${esc(me.bidder.company)}</span>
      <button class="btn sm" onclick="openCenter()">我的中心</button>
      <button class="btn sm" onclick="logout()">退出</button>`;
  } else {
    box.innerHTML = `<button class="btn sm" onclick="openLogin('login')">登录 / 注册</button>`;
  }
}

// ---------- 登录 / 注册 ----------
function openLogin(tab) {
  tab = tab || 'login';
  document.getElementById('loginContent').innerHTML = `
    <h2>选手登录 / 注册</h2>
    <div class="login-tabs">
      <span class="${tab === 'login' ? 'active' : ''}" onclick="openLogin('login')">登录</span>
      <span class="${tab === 'register' ? 'active' : ''}" onclick="openLogin('register')">注册</span>
    </div>
    ${tab === 'register'
      ? `<form id="regForm">
          <div style="margin-bottom:10px"><label>手机号 *</label><input name="phone" placeholder="11位手机号" required></div>
          <div style="margin-bottom:10px"><label>密码 *</label><input name="password" type="password" placeholder="设置登录密码" required></div>
          <div style="margin-bottom:10px"><label>姓名 *</label><input name="name" required></div>
          <div style="margin-bottom:14px"><label>公司 / 团队 *</label><input name="company" required></div>
          <button class="btn green" type="submit" style="width:100%">注册并登录</button>
        </form>`
      : `<form id="loginForm">
          <div style="margin-bottom:10px"><label>手机号 *</label><input name="phone" required></div>
          <div style="margin-bottom:14px"><label>密码 *</label><input name="password" type="password" required></div>
          <button class="btn" type="submit" style="width:100%">登录</button>
        </form>`}
    <div class="hint" style="margin-top:10px">登录后，你购买的标书和提交的投标都会绑定在你的账号下，只有你能看到。</div>
  `;
  document.getElementById('loginModal').classList.add('show');

  const regForm = document.getElementById('regForm');
  if (regForm) regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(regForm);
    const data = {
      phone: (f.get('phone') || '').toString().trim(),
      password: (f.get('password') || '').toString(),
      name: (f.get('name') || '').toString().trim(),
      company: (f.get('company') || '').toString().trim(),
    };
    const btn = regForm.querySelector('button'); btn.disabled = true; btn.textContent = '注册中…';
    try {
      const r = await fetch('/api/bidder/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '注册失败');
      setSession(d.token, d.bidder);
      closeLogin();
      toast('注册成功，已登录 🎉');
      loadBidder();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '注册并登录'; }
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(loginForm);
    const data = {
      phone: (f.get('phone') || '').toString().trim(),
      password: (f.get('password') || '').toString(),
    };
    const btn = loginForm.querySelector('button'); btn.disabled = true; btn.textContent = '登录中…';
    try {
      const r = await fetch('/api/bidder/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '登录失败');
      setSession(d.token, d.bidder);
      closeLogin();
      toast('登录成功 👋');
      loadBidder();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = '登录'; }
  });
}
function closeLogin() { document.getElementById('loginModal').classList.remove('show'); }

// ---------- 我的中心 ----------
function openCenter() {
  if (!me) return;
  const purchases = me.purchases || [];
  const bids = me.bids || [];
  let html = `<h2>我的中心 · ${esc(me.bidder.name)}</h2>
    <div class="meta">${esc(me.bidder.company)} · ${esc(me.bidder.phone)}</div>`;
  html += `<div class="sec-title">我购买的标书（${purchases.length}）</div>`;
  if (!purchases.length) html += `<div class="hint">尚未购买任何标书</div>`;
  else html += purchases.map((p) => {
    const proj = allProjects.find((x) => x.id === p.projectId);
    const name = proj ? proj.title : '(项目)';
    return `<div class="center-row"><span>${esc(name)}</span>
      <a class="btn sm" href="/api/download/${p.projectId}?token=${getToken()}" target="_blank">⬇ 下载标书</a></div>`;
  }).join('');
  html += `<div class="sec-title">我提交的投标（${bids.length}）</div>`;
  if (!bids.length) html += `<div class="hint">尚未提交任何投标</div>`;
  else html += bids.map((b) => {
    const proj = allProjects.find((x) => x.id === b.projectId);
    const name = proj ? proj.title : '(项目)';
    return `<div class="center-row"><span>${esc(name)}${b.amount ? ' · 报价¥' + esc(b.amount) : ''}</span>
      <a class="btn sm" href="/api/bidder/my-bid-file/${b.id}?token=${getToken()}" target="_blank">⬇ 我的投标文件</a></div>`;
  }).join('');
  document.getElementById('centerContent').innerHTML = html;
  document.getElementById('centerModal').classList.add('show');
}
function closeCenter() { document.getElementById('centerModal').classList.remove('show'); }

// ---------- 项目列表 ----------
async function loadBidder() {
  const box = document.getElementById('bidList');
  try {
    const list = await (await fetch('/api/projects')).json();
    allProjects = list;
    const open = list.filter((p) => p.status === 'open' || p.evaluationOpened);
    if (!open.length) {
      box.innerHTML = '<div class="empty">当前没有进行中的项目，敬请期待～</div>';
      return;
    }
    box.innerHTML = open.map((p) => `
      <div class="proj-card">
        <div class="top">
          <div><h3>${esc(p.title)}</h3>
          <div class="meta">编号 ${esc(p.code)} · 招标方 ${esc(p.organizer || '—')}</div></div>
          ${p.evaluationOpened ? '<span class="status closed">已开标</span>' : '<span class="status open">进行中</span>'}
        </div>
        <div class="meta">
          ${p.budget ? '<span class="badge">预算 ¥' + esc(p.budget) + '</span>' : ''}
          ${p.price ? '<span class="badge">标书 ¥' + p.price + '</span>' : '<span class="badge">标书免费</span>'}
          ${p.buyCount ? '<span class="badge">' + p.buyCount + ' 人已购</span>' : ''}
          ${p.blind ? '<span class="badge">盲评</span>' : ''}
          ${p.deadline ? '<span class="badge">截止 ' + esc(p.deadline.replace('T', ' ')) + '</span>' : ''}
        </div>
        <div class="meta">${esc(p.description || '（无项目说明）')}</div>
        <div class="meta">招标文件：<b>${esc(p.fileOriginalName)}</b></div>
        <button class="btn" onclick="openBuy('${p.id}')">${p.evaluationOpened ? '查看详情 / 开标结果' : '查看 / 购买标书'}</button>
      </div>`).join('');
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败</div>';
  }
}

let pendingBuy = null;

async function openBuy(id) {
  const p = await (await fetch(`/api/projects/${id}`)).json();
  if (p.evaluationOpened) { closeModal(); openResult(id); return; }

  const hasBought = !!(me && me.purchases && me.purchases.some((x) => x.projectId === id));
  const loggedIn = !!me;

  document.getElementById('modalContent').innerHTML = `
    <h2>${esc(p.title)}</h2>
    <div class="meta">编号 ${esc(p.code)} · 招标方 ${esc(p.organizer || '—')}</div>
    ${p.description ? '<div class="meta">' + esc(p.description) + '</div>' : ''}
    <div class="meta">招标文件：<b>${esc(p.file.originalName)}</b>（${fmtSize(p.file.size)}）</div>
    ${p.price ? '<div class="meta">标书售价：<b>¥' + p.price + '</b>（模拟支付，无需真实付款）</div>' : '<div class="meta">标书免费</div>'}

    <div class="sec-title">第一步：购买标书</div>
    ${loggedIn
      ? (hasBought
          ? '<div class="hint" style="color:#16a34a">✅ 您已购买，可直接下载 / 投标</div>'
          : `<div class="hint">将以「${esc(me.bidder.name)} / ${esc(me.bidder.company)}」身份购买</div>
             <div style="margin-top:12px"><button class="btn green" id="payBtn">去支付并购买标书</button></div>`)
      : `<div class="hint">请先登录 / 注册后再购买标书</div>
         <div style="margin-top:12px"><button class="btn" onclick="closeModal();openLogin('login')">去登录 / 注册</button></div>`}

    <div class="sec-title">第二步：下载标书</div>
    ${hasBought
      ? `<a class="btn" href="/api/download/${p.id}?token=${getToken()}" target="_blank">⬇ 下载招标文件</a>`
      : '<div class="hint">请先完成第一步购买后下载</div>'}

    <div class="sec-title">第三步：提交投标</div>
    ${hasBought
      ? `<form id="bidForm">
          <div style="margin-top:10px"><label>投标报价（元）</label><input name="amount" placeholder="选填"></div>
          <div style="margin-top:10px"><label>投标说明</label><textarea name="remark" placeholder="选填"></textarea></div>
          <div style="margin-top:10px"><label>投标文件（方案/报价单等）*</label><input type="file" name="file" required></div>
          <div style="margin-top:14px"><button class="btn" type="submit">提交投标</button></div>
        </form>`
      : '<div class="hint">请先购买标书后再提交投标</div>'}
  `;
  document.getElementById('buyModal').classList.add('show');

  const payBtn = document.getElementById('payBtn');
  if (payBtn) payBtn.addEventListener('click', () => {
    document.getElementById('buyModal').classList.remove('show');
    openPayModal(p, { projectId: id, bidderName: me.bidder.name, company: me.bidder.company, phone: me.bidder.phone });
  });

  const bidForm = document.getElementById('bidForm');
  if (bidForm) {
    bidForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(bidForm);
      fd.append('projectId', id);
      fd.append('token', getToken());
      const btn = bidForm.querySelector('button');
      btn.disabled = true; btn.textContent = '提交中…';
      try {
        const r = await fetch('/api/bids', { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || '提交失败');
        toast('投标提交成功 ✅');
        await loadMe();
        setTimeout(() => closeModal(), 800);
      } catch (err) {
        toast(err.message);
        btn.disabled = false; btn.textContent = '提交投标';
      }
    });
  }
}

// ====== 模拟支付页 ======
function openPayModal(project, data) {
  pendingBuy = data;
  const amount = project.price || 0;
  document.getElementById('payContent').innerHTML = `
    <h2>模拟支付标书费</h2>
    <div class="meta">项目：${esc(project.title)}</div>
    <div style="text-align:center;margin:16px 0">
      <div class="pay-tabs">
        <span class="pay-tab active" data-m="wechat">微信支付</span>
        <span class="pay-tab" data-m="alipay">支付宝</span>
      </div>
      <div class="qr">${qrSVG(project.id + amount)}</div>
      <div style="font-size:24px;font-weight:800;margin-top:12px;color:#111827">¥ ${amount}</div>
      <div class="hint">（模拟支付，不会产生任何真实扣款）</div>
    </div>
    <button class="btn green" id="payBtn2" style="width:100%" onclick="doPay()">立即支付 ¥${amount}</button>
  `;
  document.getElementById('payModal').classList.add('show');
  document.querySelectorAll('.pay-tab').forEach((t) => {
    t.onclick = () => { document.querySelectorAll('.pay-tab').forEach((x) => x.classList.remove('active')); t.classList.add('active'); };
  });
}
function closePay() { document.getElementById('payModal').classList.remove('show'); }
async function doPay() {
  const btn = document.getElementById('payBtn2');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>支付处理中…';
  await new Promise((r) => setTimeout(r, 1300));
  try {
    const fd = new FormData();
    fd.append('projectId', pendingBuy.projectId);
    fd.append('token', getToken());
    const r = await fetch('/api/purchase', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '购买失败');
    await loadMe();
    toast('支付成功，标书已购 🎉');
    closePay();
    openBuy(pendingBuy.projectId);
  } catch (e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = '立即支付';
  }
}

// ====== 开标结果 ======
async function openResult(id) {
  const p = await (await fetch(`/api/projects/${id}`)).json();
  let html = `<h2>开标结果 · ${esc(p.title)}</h2>`;
  if (!p.evaluationOpened) {
    html += '<div class="empty">尚未开标，请耐心等待招标方公布。</div>';
  } else {
    const bids = (p.bids || []).slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const winner = bids.find((b) => b.id === p.winnerBidId) || bids[0];
    html += `<div class="result-win">🏆 中标方：${esc(winner ? winner.bidderName : '—')}（${esc(winner ? winner.company : '—')}）${winner && winner.amount ? ' · 报价 ¥' + esc(winner.amount) : ''}</div>`;
    html += '<div class="sec-title">评分排名</div>';
    html += '<table><thead><tr><th>排名</th><th>投标人</th><th>公司</th><th>报价</th><th>评分</th></tr></thead><tbody>';
    html += bids.map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.bidderName)}</td><td>${esc(b.company)}</td><td>${b.amount ? '¥' + esc(b.amount) : '—'}</td><td>${b.score != null ? esc(String(b.score)) : '—'}</td></tr>`).join('');
    html += '</tbody></table>';
  }
  document.getElementById('resultContent').innerHTML = html;
  document.getElementById('resultModal').classList.add('show');
}
function closeResult() { document.getElementById('resultModal').classList.remove('show'); }
function closeModal() { document.getElementById('buyModal').classList.remove('show'); }

document.getElementById('buyModal').addEventListener('click', (e) => { if (e.target.id === 'buyModal') closeModal(); });
document.getElementById('payModal').addEventListener('click', (e) => { if (e.target.id === 'payModal') closePay(); });
document.getElementById('resultModal').addEventListener('click', (e) => { if (e.target.id === 'resultModal') closeResult(); });
document.getElementById('loginModal').addEventListener('click', (e) => { if (e.target.id === 'loginModal') closeLogin(); });
document.getElementById('centerModal').addEventListener('click', (e) => { if (e.target.id === 'centerModal') closeCenter(); });

loadMe().then(loadBidder);
