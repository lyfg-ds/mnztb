// 内网穿透：把本机 localhost:3000（参赛方门户）映射为公网网址
// 特性：固定/记忆子域名（重启后尽量保持同一网址）+ 断线自动重连
const fs = require('fs');
const path = require('path');
const localtunnel = require('localtunnel');

const PORT = 3000;
const PREFERRED = 'zhaobiao-dasai-2026'; // 想要的固定子域名，被占用会自动换并记住
const SUB_FILE = path.join(__dirname, '.tunnel-subdomain');

function loadSub() {
  try { return fs.readFileSync(SUB_FILE, 'utf8').trim(); } catch (e) { return null; }
}
function saveSub(s) {
  try { fs.writeFileSync(SUB_FILE, s); } catch (e) {}
}

function start() {
  const sub = loadSub() || PREFERRED;
  localtunnel({ port: PORT, subdomain: sub }, (err, tunnel) => {
    if (err) {
      // 子域名不可用：生成一个随机后缀并记住，下次重连用它，保持网址稳定
      const alt = 'zb-' + Math.random().toString(36).slice(2, 8);
      console.error('SUBDOMAIN ' + sub + ' 不可用，改用 ' + alt);
      saveSub(alt);
      return start();
    }
    saveSub(sub);
    console.log('PUBLIC_URL=' + tunnel.url);
    tunnel.on('close', () => {
      console.log('TUNNEL_CLOSED, reconnecting...');
      setTimeout(start, 2000);
    });
    tunnel.on('error', (e) => {
      console.log('TUNNEL_ERROR ' + (e && e.message ? e.message : e));
    });
  });
}

start();
