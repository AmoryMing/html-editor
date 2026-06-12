#!/usr/bin/env node
/* html-edit · 本地可视化 HTML 编辑服务（零依赖）
 * 用法: node server.mjs <目录或文件> [--port 8787]
 * 路由:
 *   GET  /                  文件索引（标注 动态/静态）
 *   GET  /<path>.html?hx=1  注入编辑覆盖层后返回
 *   GET  /<path>            原样静态服务
 *   GET  /__editor.js       覆盖层脚本（每次请求重读，便于迭代）
 *   POST /__save            {path, html, mode:"edit"|"freeze"}
 *        edit   → 覆盖原文件，旧版备份到 <root>/.bak/<名>.<时间戳>.html
 *        freeze → 另存为 <原名>·静态.html，绝不覆盖动态源文件
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
let root = process.cwd(), port = 8787;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') port = +argv[++i];
  else root = path.resolve(argv[i]);
}
if (fs.existsSync(root) && fs.statSync(root).isFile()) root = path.dirname(root);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const EDITOR_FILE = new URL('./editor.js', import.meta.url);

function safe(rel) {
  const p = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('path escapes root');
  return p;
}

/* 评论存 <root>/.comments/<文件名>.json —— 与文档分离，不进文档、不受 mtime 锁影响 */
function commentsFile(rel) {
  const dir = path.join(root, '.comments');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, path.basename(safe(rel)) + '.json');
}
function readComments(rel) {
  try { return JSON.parse(fs.readFileSync(commentsFile(rel), 'utf8')); } catch { return []; }
}

/* 区块扫描：文件顶层 <section> 列表（供跨文件区块面板取卡） */
function scanBlocks(html) {
  const blocks = [];
  const re = /<section\b[^>]*>|<\/section>/g;
  let m, depth = 0, start = -1, openTag = '';
  while ((m = re.exec(html))) {
    if (m[0][1] !== '/') {
      if (depth === 0) { start = m.index; openTag = m[0]; }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        const end = m.index + '</section>'.length;
        const seg = html.slice(start, end);
        const id = (openTag.match(/id="([^"]+)"/) || [])[1] || '';
        const title = ((seg.match(/class="tool__cn"[^>]*>([^<]+)/) || seg.match(/<h[1-4][^>]*>([^<]+)/) || [, ''])[1] || '').trim();
        blocks.push({ i: blocks.length, id, title: title || id || ('区块 ' + (blocks.length + 1)), chars: seg.length, start, end });
        start = -1;
      }
    }
  }
  return blocks;
}
function listFiles() {
  const out = walk(root).map(p => path.relative(root, p));
  const bdir = path.join(root, '.bak');
  if (fs.existsSync(bdir)) {
    for (const f of fs.readdirSync(bdir).filter(f => /\.html?$/i.test(f)).sort().reverse().slice(0, 30)) {
      out.push('.bak/' + f);
    }
  }
  return out;
}
const ts = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(e.name)) out.push(p);
  }
  return out;
}
const isDynamic = html => /__bundler\/template|text\/babel/.test(html);

function indexPage() {
  const files = walk(root)
    .map(p => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const rows = files.map(({ p }) => {
    const rel = path.relative(root, p);
    const dyn = isDynamic(fs.readFileSync(p, 'utf8'));
    const kb = (fs.statSync(p).size / 1024).toFixed(0);
    const url = '/' + rel.split(path.sep).map(encodeURIComponent).join('/');
    const badge = dyn
      ? '<span style="color:#b45309;background:#fef3c7;padding:1px 8px;border-radius:4px">动态 React · 打开后点「冻结另存」转静态</span>'
      : '<span style="color:#166534;background:#dcfce7;padding:1px 8px;border-radius:4px">静态 · 可直接编辑保存</span>';
    return `<tr><td><a href="${url}?hx=1"><b>${rel}</b></a></td><td style="text-align:right">${kb} KB</td><td>${badge}</td><td><a href="${url}" style="color:#6b7280">原始预览</a></td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html><meta charset="utf-8"><title>html-edit · ${path.basename(root)}</title>
<style>body{font:14px/1.7 -apple-system,"PingFang SC",sans-serif;margin:40px auto;max-width:1080px;color:#1f2937;padding:0 20px}
td{padding:7px 16px 7px 0;border-bottom:1px solid #eee}a{color:#1d4ed8;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f3f4f6;padding:1px 6px;border-radius:4px}</style>
<h2>html-edit 可视化编辑器</h2>
<p>根目录 <code>${root}</code> · 点文件名进入编辑模式 · 保存自动备份到 <code>.bak/</code> · 跨文件复制粘贴走同源剪贴板，可多标签页互拷</p>
<table>${rows}</table>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let urlPath;
  try { urlPath = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end('bad path'); }

  if (req.method === 'GET' && urlPath === '/') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(indexPage());
  }
  if (req.method === 'GET' && urlPath === '/__editor.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(fs.readFileSync(EDITOR_FILE, 'utf8'));
  }

  if (req.method === 'GET' && urlPath === '/__files') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    return res.end(JSON.stringify({ ok: true, files: listFiles() }));
  }
  if (req.method === 'GET' && (urlPath === '/__blocks' || urlPath === '/__block')) {
    try {
      const rel = u.searchParams.get('path') || '';
      const html = fs.readFileSync(safe(rel), 'utf8');
      const blocks = scanBlocks(html);
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      if (urlPath === '/__blocks') {
        return res.end(JSON.stringify({ ok: true, blocks: blocks.map(({ i, id, title, chars }) => ({ i, id, title, chars })) }));
      }
      const b = blocks[+u.searchParams.get('i')];
      if (!b) throw new Error('区块不存在');
      const css = [...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(m2 => m2[1]).join('\n');
      return res.end(JSON.stringify({ ok: true, html: html.slice(b.start, b.end), css }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  }
  if (req.method === 'GET' && urlPath === '/__comments') {
    try {
      const rel = u.searchParams.get('path') || '';
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, comments: readComments(rel) }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  }
  if (req.method === 'POST' && urlPath === '/__comment') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { path: rel, action, comment, id } = JSON.parse(body);
        let list = readComments(rel);
        if (action === 'add' && comment && comment.text) list.push(comment);
        else if (action === 'delete') list = list.filter(c => c.id !== id);
        fs.writeFileSync(commentsFile(rel), JSON.stringify(list, null, 1));
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: true, comments: list }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/__save') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { path: rel, html, mode, mtime } = JSON.parse(body);
        const src = safe(rel);
        let target = src, backup = null;
        if (mode === 'freeze') target = src.replace(/\.html?$/i, '') + '·静态.html';
        else if (mode === 'deliver') target = src.replace(/\.html?$/i, '').replace(/·静态$/, '') + '·交付.html';
        // 编辑模式必须带加载时的 mtime 且与磁盘一致，否则拒绝——防止旧标签页把别人（或 Claude）的改动顶掉
        if (mode === 'edit' && fs.existsSync(target)) {
          const cur = fs.statSync(target).mtimeMs;
          if (typeof mtime !== 'number' || Math.abs(cur - mtime) > 0.5) {
            res.writeHead(409, { 'Content-Type': MIME['.json'] });
            return res.end(JSON.stringify({
              ok: false, conflict: true,
              error: '本页加载后，文件已被别处改过（另一个标签页或 Claude）。本次保存未写入——请刷新本页（⌘R）拿到最新版再编辑；刚才被改的内容都在 .bak/ 里可找回。',
            }));
          }
        }
        if (fs.existsSync(target)) {
          const bdir = path.join(root, '.bak');
          fs.mkdirSync(bdir, { recursive: true });
          backup = path.join(bdir, path.basename(target).replace(/\.html?$/i, '') + '.' + ts() + '.html');
          fs.copyFileSync(target, backup);
        }
        fs.writeFileSync(target, html);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({
          ok: true,
          savedTo: path.relative(root, target),
          backup: backup && path.relative(root, backup),
          bytes: Buffer.byteLength(html),
          mtime: fs.statSync(target).mtimeMs,
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  try {
    const p = safe(urlPath);
    let buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    if (/^\.html?$/.test(ext) && u.searchParams.has('hx')) {
      let html = buf.toString('utf8');
      const relUrl = '/' + path.relative(root, p).split(path.sep).join('/');
      const mt = fs.statSync(p).mtimeMs;
      const inject = `<script data-hx-editor>window.__HX_PATH=${JSON.stringify(relUrl)};window.__HX_MTIME=${mt};</script><script data-hx-editor src="/__editor.js"></script>`;
      // 注意：必须找最后一个 </body> —— srcdoc 属性里可能含有原样的 </body> 文本
      const bi = html.lastIndexOf('</body>');
      html = bi === -1 ? html + inject : html.slice(0, bi) + inject + html.slice(bi);
      buf = Buffer.from(html);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + urlPath);
  }
});

function listen(p, tries) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(p + 1, tries - 1);
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(p, () => console.log(`html-edit ▶ http://localhost:${p}/   （根目录 ${root}）`));
}
listen(port, 20);
