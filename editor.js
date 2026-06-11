/* html-edit · 页面内可视化编辑覆盖层（由 server.mjs 注入；零依赖）
 * 能力：悬停高亮 → 点击选中 → 复制/粘贴(替换·前·后)/删除/上下移/双击改文字/+文字/+剪贴板截图/撤销/保存
 * 模式自动判定：
 *   freeze（动态页：bundler/React/babel）→ 保存=「冻结另存」为 <原名>·静态.html，剥离全部 <script>
 *   edit  （静态页）→ 保存=覆盖原文件（服务端自动备份 + mtime 防冲突：文件被别处改过会拒绝保存）
 * iframe srcdoc 支持：能点选/双击编辑 iframe 内部元素；保存时自动把内部改动写回 srcdoc 属性。
 * 跨文档复制：从 iframe（或另一份文件）复制时自动携带源文档样式；粘贴时加命名空间包装，目标文件样式不打架。
 * 程序化 API：window.__hx = { select, copy, paste, del, save, undo, serialize, state }
 */
(() => {
  if (window.__hxLoaded) return;
  window.__hxLoaded = true;

  const PATH = window.__HX_PATH || decodeURIComponent(location.pathname);
  const S = (window.__hxState = { sel: null, hov: null, editing: null, undo: [], mode: 'edit', interact: false });
  let lastMode = null;
  const WIRED = new WeakSet();

  const isUI = el => !!(el && el.closest && el.closest('#__hx, #__hx_toast, #__hx_cpanel, #__hx_pins'));
  const isRoot = el => !el || el === el.ownerDocument.documentElement || el === el.ownerDocument.body || el === el.ownerDocument.head;
  const inFrame = el => !!(el && el.ownerDocument !== document);
  const label = el => {
    if (!el) return '未选中（点击页面元素选中；iframe 内也能点）';
    let s = (inFrame(el) ? '[iframe] ' : '') + el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].filter(c => !c.startsWith('hx-')).slice(0, 3).join('.');
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    return s + (t ? ` “${t}…”` : '');
  };

  function detectMode() {
    const dyn = window.React || document.querySelector(
      'script[type="text/babel"], script[type^="__bundler"], script[src^="blob:"]');
    S.mode = dyn ? 'freeze' : 'edit';
    if (S.mode !== lastMode) { S.interact = S.mode === 'freeze'; lastMode = S.mode; }
  }

  /* ---------- CSS 作用域化（跨文档粘贴用） ---------- */
  function matchBrace(s, openIdx) {
    let d = 0;
    for (let j = openIdx; j < s.length; j++) {
      if (s[j] === '{') d++;
      else if (s[j] === '}') { d--; if (!d) return j; }
    }
    return s.length;
  }
  function scopeCss(css, ns) {
    let out = '', i = 0;
    while (i < css.length) {
      const rest = css.slice(i);
      const ws = rest.match(/^\s+/);
      if (ws) { out += ws[0]; i += ws[0].length; continue; }
      if (rest.startsWith('/*')) { const e = css.indexOf('*/', i) + 2; out += css.slice(i, e); i = e; continue; }
      if (rest.startsWith('@')) {
        const open = css.indexOf('{', i);
        if (open === -1) { out += rest; break; }
        const at = css.slice(i, open).trim();
        const end = matchBrace(css, open);
        const inner = css.slice(open + 1, end);
        out += /^@(media|supports)/.test(at) ? at + '{' + scopeCss(inner, ns) + '}' : at + '{' + inner + '}';
        i = end + 1; continue;
      }
      const open = css.indexOf('{', i);
      if (open === -1) { out += rest; break; }
      const end = css.indexOf('}', open);
      const sels = css.slice(i, open).split(',').map(s2 => {
        s2 = s2.trim();
        if (!s2) return s2;
        if (/^(body|html|:root)([\s:.[>+~]|$)/.test(s2)) return s2.replace(/^(body|html|:root)/, ns);
        return ns + ' ' + s2;
      }).join(', ');
      out += sels + css.slice(open, end + 1);
      i = end + 1;
    }
    return out;
  }
  const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return (h >>> 0).toString(36); };

  /* ---------- 序列化 / 快照 ---------- */
  function cleanInto(node) {
    node.querySelectorAll('#__hx, #__hx_toast, #__hx_style, #__hx_cpanel, #__hx_pins, [data-hx-editor]').forEach(n => n.remove());
    node.querySelectorAll('.hx-hov, .hx-sel').forEach(n => {
      n.classList.remove('hx-hov', 'hx-sel');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    node.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    return node;
  }
  function serialize() {
    const clone = document.documentElement.cloneNode(true);
    // iframe srcdoc 写回：内部 DOM 的改动序列化回 clone 的 srcdoc 属性
    const live = [...document.querySelectorAll('iframe')];
    const cl = [...clone.querySelectorAll('iframe')];
    live.forEach((f, i) => {
      if (!cl[i] || !f.hasAttribute('srcdoc')) return;
      let d = null;
      try { d = f.contentDocument; } catch (e) { /* 跨域不管 */ }
      if (!d || !d.documentElement) return;
      const inner = cleanInto(d.documentElement.cloneNode(true));
      cl[i].setAttribute('srcdoc', '<!doctype html>' + inner.outerHTML);
    });
    cleanInto(clone);
    if (S.mode === 'freeze') {
      clone.querySelectorAll('script, noscript').forEach(n => n.remove());
      clone.querySelectorAll('#__bundler_loading, #__bundler_thumbnail, #__bundler_placeholder').forEach(n => n.remove());
    }
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }
  function snapshot() {
    const body = (S.sel ? S.sel.ownerDocument : document).body;
    S.undo.push({ body, html: cleanInto(body.cloneNode(true)).innerHTML });
    if (S.undo.length > 30) S.undo.shift();
  }
  function undo() {
    if (!S.undo.length) return toast('没有可撤销的操作');
    const { body, html } = S.undo.pop();
    S.sel = null; S.editing = null;
    body.innerHTML = html;
    ensureUI();
    toast('已撤销 ↩');
  }

  /* ---------- 选择 ---------- */
  function setHover(el) {
    if (S.hov && S.hov !== el) S.hov.classList.remove('hx-hov');
    S.hov = el || null;
    if (el && el !== S.sel) el.classList.add('hx-hov');
  }
  function select(el) {
    if (S.sel) S.sel.classList.remove('hx-sel');
    S.sel = el || null;
    if (el) { el.classList.remove('hx-hov'); el.classList.add('hx-sel'); }
    updateBar();
  }

  /* ---------- 操作 ---------- */
  function copy() {
    if (!S.sel) return toast('先选中一个元素再复制');
    const srcDoc = S.sel.ownerDocument;
    const wrap = srcDoc.createElement('div');
    wrap.appendChild(S.sel.cloneNode(true));
    cleanInto(wrap);
    const html = wrap.innerHTML;
    let css = null;
    if (srcDoc !== document) {
      css = [...srcDoc.querySelectorAll('style')].filter(st => st.id !== '__hx_style').map(st => st.textContent).join('\n');
    }
    try {
      localStorage.setItem('__hx_clip', html);
      if (css) localStorage.setItem('__hx_clip_css', css); else localStorage.removeItem('__hx_clip_css');
      localStorage.setItem('__hx_clip_meta', JSON.stringify({ from: PATH, tag: S.sel.tagName, withCss: !!css }));
    } catch (e) { return toast('复制失败：' + e.message); }
    if (navigator.clipboard) navigator.clipboard.writeText(html).catch(() => {});
    toast(`已复制 ${label(S.sel)} （${(html.length / 1024).toFixed(1)} KB${css ? '，已连带 iframe 内样式' : ''}）— 可去另一个文件标签页粘贴`);
  }
  function paste(rel) {
    let clip = localStorage.getItem('__hx_clip');
    if (!clip) return toast('剪贴板为空：先在某个文件里「复制」一个元素');
    if (!S.sel) return toast('先选中目标位置的元素');
    snapshot();
    const css = localStorage.getItem('__hx_clip_css');
    if (css) {
      const tdoc = S.sel.ownerDocument;
      const ns = 'hxp-' + hashStr(css);
      if (!tdoc.querySelector(`style[data-hx-ns="${ns}"]`)) {
        const st = tdoc.createElement('style');
        st.setAttribute('data-hx-ns', ns);
        st.textContent = `/* html-edit 跨文档粘贴样式（作用域 .${ns}） */\n` + scopeCss(css, '.' + ns);
        tdoc.head.appendChild(st);
      }
      clip = `<div class="${ns}">` + clip + '</div>';
    }
    if (rel === 'replace') {
      S.sel.insertAdjacentHTML('beforebegin', clip);
      const nu = S.sel.previousElementSibling;
      S.sel.remove(); S.sel = null;
      select(nu);
      toast('已替换粘贴 ✓' + (css ? '（样式已随卡注入，作用域隔离）' : ''));
    } else if (rel === 'before') {
      S.sel.insertAdjacentHTML('beforebegin', clip); toast('已在前方插入 ✓');
    } else {
      S.sel.insertAdjacentHTML('afterend', clip); toast('已在后方插入 ✓');
    }
  }
  function del() {
    if (!S.sel) return toast('先选中要删除的元素');
    snapshot();
    const l = label(S.sel);
    S.sel.remove(); S.sel = null;
    updateBar();
    toast(`已删除 ${l} （撤销可恢复）`);
  }
  function move(dir) {
    if (!S.sel) return toast('先选中元素');
    const sib = dir < 0 ? S.sel.previousElementSibling : S.sel.nextElementSibling;
    if (!sib || isUI(sib)) return toast('已到边界');
    snapshot();
    dir < 0 ? sib.before(S.sel) : sib.after(S.sel);
    S.sel.scrollIntoView({ block: 'nearest' });
  }
  function parent() {
    if (S.sel && !isRoot(S.sel.parentElement)) select(S.sel.parentElement);
  }
  function addText() {
    snapshot();
    const html = '<p style="margin:8px 0;font-size:14px;line-height:1.7">（双击此处编辑文字）</p>';
    if (S.sel) S.sel.insertAdjacentHTML('afterend', html);
    else document.body.insertAdjacentHTML('beforeend', html);
    const nu = S.sel ? S.sel.nextElementSibling : document.body.lastElementChild;
    select(nu);
    toast('已插入文字段落，双击它开始编辑');
  }
  async function addImg() {
    const insert = src => {
      snapshot();
      const html = `<img src="${src}" style="max-width:100%;display:block;margin:8px 0;border:1px solid #e5e7eb;border-radius:6px">`;
      if (S.sel) S.sel.insertAdjacentHTML('afterend', html);
      else document.body.insertAdjacentHTML('beforeend', html);
      toast('已插入图片（以 data-URL 内嵌，保存后随文件走）');
    };
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const fr = new FileReader();
          fr.onload = () => insert(fr.result);
          fr.readAsDataURL(blob);
          return;
        }
      }
      throw new Error('剪贴板里没有图片');
    } catch (e) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => insert(fr.result);
        fr.readAsDataURL(f);
      };
      inp.click();
      toast('剪贴板读取不到截图（' + e.message + '），改用文件选择');
    }
  }

  /* ---------- 文字编辑 ---------- */
  function startEdit(el) {
    if (isUI(el) || isRoot(el)) return;
    snapshot();
    commitEdit();
    S.editing = el;
    el.setAttribute('contenteditable', 'true');
    select(el);
    el.focus();
    toast('文字编辑中 — 点击元素外或按 Esc 结束');
  }
  function commitEdit() {
    if (!S.editing) return;
    S.editing.removeAttribute('contenteditable');
    S.editing = null;
  }

  /* ---------- 保存 ---------- */
  async function save() {
    commitEdit();
    const body = JSON.stringify({ path: PATH, html: serialize(), mode: S.mode, mtime: window.__HX_MTIME });
    try {
      const r = await fetch('/__save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      if (S.mode !== 'freeze' && j.mtime) window.__HX_MTIME = j.mtime;   // 本标签页继续保存不受阻
      toast(S.mode === 'freeze'
        ? `已冻结另存 → ${j.savedTo} （${(j.bytes / 1024).toFixed(0)} KB）。回到文件列表打开它即可静态编辑`
        : `已保存 ✓ ${j.savedTo}${j.backup ? ' （备份: ' + j.backup + '）' : ''}`, 5000);
      return j;
    } catch (e) {
      toast('保存失败：' + e.message, 9000);
      return { ok: false, error: String(e) };
    }
  }

  /* ---------- UI ---------- */
  const CSS = `
#__hx{position:fixed;top:10px;right:10px;z-index:2147483600;background:#fff;border:1px solid #d1d5db;border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.16);padding:7px 10px;font:12px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  color:#111;display:flex;align-items:center;gap:5px;flex-wrap:wrap;max-width:780px}
#__hx button{font:12px/1.5 -apple-system,"PingFang SC",sans-serif;padding:2px 8px;border:1px solid #d1d5db;border-radius:5px;
  background:#fff;cursor:pointer;color:#111;white-space:nowrap}
#__hx button:hover{background:#eef2ff;border-color:#6366f1}
#__hx .hx-save{background:#4f46e5;color:#fff;border-color:#4f46e5;font-weight:600}
#__hx .hx-save:hover{background:#4338ca}
#__hx .hx-mode{padding:2px 8px;border-radius:5px;font-weight:600;white-space:nowrap}
#__hx .hx-crumb{color:#6b7280;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#__hx .hx-sep{width:1px;height:16px;background:#e5e7eb}
.hx-hov{outline:1px dashed #818cf8 !important;outline-offset:1px !important;cursor:default !important}
.hx-sel{outline:2px solid #4f46e5 !important;outline-offset:2px !important}
#__hx_toast{position:fixed;left:14px;bottom:14px;z-index:2147483600;background:#111827;color:#fff;padding:9px 14px;
  border-radius:8px;font:12.5px/1.6 -apple-system,"PingFang SC",sans-serif;max-width:62vw;box-shadow:0 4px 16px rgba(0,0,0,.3)}
#__hx_pins{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483500}
.hx-pin{position:absolute;width:20px;height:20px;border-radius:50% 50% 50% 4px;background:#d08838;color:#fff;font:600 11px/20px -apple-system,sans-serif;
  text-align:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.25);transform:translate(-4px,-10px)}
.hx-pin:hover{background:#b45309}
#__hx_cpanel{position:fixed;right:10px;bottom:10px;z-index:2147483590;width:320px;background:#fff;border:1px solid #d1d5db;border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.18);font:12.5px/1.6 -apple-system,"PingFang SC",sans-serif;color:#111;display:flex;flex-direction:column;max-height:52vh}
#__hx_cpanel.hx-folded{width:auto;max-height:none}
#__hx_cpanel.hx-folded .hx-cbody{display:none}
#__hx_cpanel .hx-chead{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer;font-weight:600}
#__hx_cpanel .hx-chead .hx-cref{margin-left:auto;font-weight:400;color:#6b7280;cursor:pointer}
#__hx_cpanel .hx-cbody{overflow-y:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px}
#__hx_cpanel textarea{width:100%;box-sizing:border-box;min-height:48px;border:1px solid #d1d5db;border-radius:6px;padding:6px 8px;
  font:12.5px/1.5 -apple-system,"PingFang SC",sans-serif;resize:vertical}
#__hx_cpanel .hx-csubmit{align-self:flex-end;padding:3px 12px;border:none;border-radius:5px;background:#d08838;color:#fff;font:600 12px -apple-system,sans-serif;cursor:pointer}
#__hx_cpanel .hx-csubmit:hover{background:#b45309}
#__hx_cpanel .hx-ctarget{font-size:11px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-citem{border:1px solid #f0f0f0;border-radius:8px;padding:8px 10px}
.hx-citem .hx-cmeta{display:flex;gap:6px;align-items:center;font-size:11px;color:#8c8c8c}
.hx-citem .hx-cmeta b{color:#303030;font-size:12px}
.hx-citem .hx-cmeta .hx-cdel{margin-left:auto;cursor:pointer;color:#bfbfbf}
.hx-citem .hx-cmeta .hx-cdel:hover{color:#ef4444}
.hx-citem .hx-cwhere{font-size:11px;color:#1d58d1;cursor:pointer;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-citem .hx-cwhere.hx-lost{color:#b45309;cursor:default}
.hx-citem .hx-ctext{margin-top:4px;white-space:pre-wrap;word-break:break-word}
.hx-flash{animation:hxflash 1.6s ease}
@keyframes hxflash{0%,60%{outline:3px solid #d08838;outline-offset:3px}100%{outline:0 solid transparent}}`;

  const BAR = `
<span class="hx-mode"></span>
<button data-act="interact"></button>
<span class="hx-sep"></span>
<span class="hx-crumb"></span>
<button data-act="parent" title="选中父级元素">↑父级</button>
<span class="hx-sep"></span>
<button data-act="copy" title="复制选中元素 HTML；从 iframe 复制会自动连带其内部样式">复制</button>
<button data-act="paste-replace" title="用剪贴板内容替换选中元素">替换</button>
<button data-act="paste-before" title="粘贴到选中元素前">前插</button>
<button data-act="paste-after" title="粘贴到选中元素后">后插</button>
<span class="hx-sep"></span>
<button data-act="del" title="删除选中元素（Delete）">删除</button>
<button data-act="up" title="与前一个兄弟元素交换位置">▲</button>
<button data-act="down" title="与后一个兄弟元素交换位置">▼</button>
<button data-act="addText" title="在选中元素后插入文字段落">+文字</button>
<button data-act="addImg" title="把剪贴板里的截图插到选中元素后">+截图</button>
<span class="hx-sep"></span>
<button data-act="comment" title="评论选中的元素（所有打开本页的人都能看到）">💬评论</button>
<button data-act="undo" title="撤销（Cmd/Ctrl+Z）">撤销</button>
<button data-act="save" class="hx-save"></button>`;

  function ensureUI() {
    detectMode();
    if (!document.head || !document.body) return;
    if (!document.getElementById('__hx_style')) {
      const st = document.createElement('style');
      st.id = '__hx_style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (!document.getElementById('__hx')) {
      const bar = document.createElement('div');
      bar.id = '__hx';
      bar.innerHTML = BAR;
      bar.addEventListener('click', e => {
        const b = e.target.closest('button');
        e.stopPropagation();
        if (!b) return;
        const act = b.dataset.act;
        if (act === 'interact') { S.interact = !S.interact; setHover(null); updateBar(); }
        else if (act === 'parent') parent();
        else if (act === 'copy') copy();
        else if (act === 'paste-replace') paste('replace');
        else if (act === 'paste-before') paste('before');
        else if (act === 'paste-after') paste('after');
        else if (act === 'del') del();
        else if (act === 'up') move(-1);
        else if (act === 'down') move(1);
        else if (act === 'addText') addText();
        else if (act === 'addImg') addImg();
        else if (act === 'comment') focusCompose();
        else if (act === 'undo') undo();
        else if (act === 'save') save();
      }, true);
      document.body.appendChild(bar);
    }
    wireDoc(document);
    // 同源 iframe（含 srcdoc）一并接管：内部可点选、可双击改字
    document.querySelectorAll('iframe').forEach(f => {
      let d = null;
      try { d = f.contentDocument; } catch (e) { /* 跨域跳过 */ }
      if (d && d.body && d.readyState !== 'loading') wireDoc(d);
    });
    ensureCPanel();
    repositionPins();
    updateBar();
  }
  function updateBar() {
    const bar = document.getElementById('__hx');
    if (!bar) return;
    const mode = bar.querySelector('.hx-mode');
    if (S.mode === 'freeze') {
      mode.textContent = '动态页 · 取材/冻结';
      mode.style.cssText = 'background:#fef3c7;color:#92400e';
    } else {
      mode.textContent = '静态页 · 可编辑';
      mode.style.cssText = 'background:#dcfce7;color:#166534';
    }
    bar.querySelector('[data-act=interact]').textContent = S.interact ? '🖱 交互中→切选择' : '⛶ 选择中→切交互';
    bar.querySelector('.hx-crumb').textContent = label(S.sel);
    bar.querySelector('[data-act=save]').textContent = S.mode === 'freeze' ? '冻结另存 ⬇' : '保存 ✓';
    updateComposeTarget();
  }

  let toastTimer = null;
  function toast(msg, ms = 3000) {
    let t = document.getElementById('__hx_toast');
    if (!t) {
      t = document.createElement('div');
      t.id = '__hx_toast';
      (document.body || document.documentElement).appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }

  /* ---------- 事件（每个文档都挂 capture 监听；iframe 重载后由轮询重新接管） ---------- */
  function wireDoc(doc) {
    if (WIRED.has(doc)) return;
    WIRED.add(doc);
    if (doc !== document && doc.head && !doc.getElementById('__hx_style')) {
      const st = doc.createElement('style');
      st.id = '__hx_style';
      st.textContent = CSS;
      doc.head.appendChild(st);
    }
    doc.addEventListener('mousemove', e => {
      if (S.interact && !e.altKey) return setHover(null);
      const t = e.target;
      if (isUI(t) || isRoot(t) || S.editing) return setHover(null);
      setHover(t);
    }, true);
    doc.addEventListener('click', e => {
      const t = e.target;
      if (isUI(t)) return;
      if (S.editing) {
        if (S.editing.contains(t)) return;       // 编辑中：元素内点击放行（移动光标）
        commitEdit(); updateBar();                // 点到外面：先结束编辑
      }
      if (S.interact && !e.altKey) return;        // 交互模式放行（Alt+点击强制选择）
      e.preventDefault(); e.stopPropagation();
      if (!isRoot(t)) select(t);
    }, true);
    doc.addEventListener('dblclick', e => {
      const t = e.target;
      if (isUI(t) || (S.interact && !e.altKey)) return;
      e.preventDefault(); e.stopPropagation();
      startEdit(t);
    }, true);
    doc.addEventListener('keydown', e => {
      if (S.editing) {
        if (e.key === 'Escape') { commitEdit(); updateBar(); toast('文字编辑结束'); }
        return;                                   // 编辑文字时不拦截其它按键
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); del(); }
      else if (e.key === 'Escape') select(null);
    }, true);
  }

  /* ---------- 评论（服务端 .comments/ 边车存储，所有打开者可见；不进文档本体） ---------- */
  S.comments = [];
  let lastCommentsJson = '';

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id && !el.id.startsWith('__hx')) { parts.unshift('#' + CSS.escape(el.id)); break; }
      let i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) i++;
      parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + i + ')');
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  const locateEl = c => { try { return c.sel ? document.querySelector(c.sel) : null; } catch (e) { return null; } };
  const fmtTs = ts => { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  async function loadComments() {
    try {
      const r = await fetch('/__comments?path=' + encodeURIComponent(PATH));
      const j = await r.json();
      if (!j.ok) return;
      const s = JSON.stringify(j.comments);
      if (s === lastCommentsJson) return;
      lastCommentsJson = s;
      S.comments = j.comments;
      renderComments();
    } catch (e) { /* 服务器没开评论接口就静默 */ }
  }
  async function postComment(payload) {
    const r = await fetch('/__comment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ path: PATH }, payload)) });
    const j = await r.json();
    if (!j.ok) { toast('评论保存失败：' + j.error, 6000); return false; }
    lastCommentsJson = JSON.stringify(j.comments);
    S.comments = j.comments;
    renderComments();
    return true;
  }

  function ensureCPanel() {
    if (document.getElementById('__hx_cpanel') || !document.body) return;
    const p = document.createElement('div');
    p.id = '__hx_cpanel';
    p.className = 'hx-folded';
    p.innerHTML = `
<div class="hx-chead"><span>💬 评论 <span class="hx-ccount">0</span></span><span class="hx-cref" title="手动刷新">↻</span></div>
<div class="hx-cbody">
  <div class="hx-ctarget"></div>
  <textarea placeholder="选中一个元素，在这里写评论…（所有打开本页的人都能看到）"></textarea>
  <button class="hx-csubmit">发表</button>
  <div class="hx-clist"></div>
</div>`;
    p.querySelector('.hx-chead').addEventListener('click', e => {
      if (e.target.classList.contains('hx-cref')) { e.stopPropagation(); lastCommentsJson = ''; loadComments(); toast('评论已刷新'); return; }
      p.classList.toggle('hx-folded');
    });
    p.querySelector('.hx-csubmit').addEventListener('click', async () => {
      const ta = p.querySelector('textarea');
      const text = ta.value.trim();
      if (!text) return toast('评论内容为空');
      if (!S.sel) return toast('先在页面里选中要评论的元素');
      if (inFrame(S.sel)) return toast('暂不支持评论 iframe 内部元素，请选它的外层容器');
      let author = localStorage.getItem('__hx_author');
      if (!author) {
        author = (prompt('你的名字（评论署名，本浏览器只问一次）') || '').trim();
        if (!author) return;
        localStorage.setItem('__hx_author', author);
      }
      const ok = await postComment({ action: 'add', comment: {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        ts: Date.now(), author, text, sel: cssPath(S.sel), label: label(S.sel),
      } });
      if (ok) { ta.value = ''; toast('评论已发表 ✓'); }
    });
    document.body.appendChild(p);
    loadComments();
  }

  function renderComments() {
    const p = document.getElementById('__hx_cpanel');
    if (!p) return;
    p.querySelector('.hx-ccount').textContent = S.comments.length;
    const list = p.querySelector('.hx-clist');
    list.innerHTML = '';
    [...S.comments].sort((a, b) => b.ts - a.ts).forEach(c => {
      const el = locateEl(c);
      const item = document.createElement('div');
      item.className = 'hx-citem';
      item.innerHTML = `
<div class="hx-cmeta"><b></b><span>${fmtTs(c.ts)}</span><span class="hx-cdel" title="删除这条评论">✕</span></div>
<div class="hx-cwhere${el ? '' : ' hx-lost'}"></div>
<div class="hx-ctext"></div>`;
      item.querySelector('b').textContent = c.author || '匿名';
      item.querySelector('.hx-cwhere').textContent = el ? '📍 ' + (c.label || c.sel) : '⚠ 原位置已被改动 · ' + (c.label || '');
      item.querySelector('.hx-ctext').textContent = c.text;
      if (el) item.querySelector('.hx-cwhere').addEventListener('click', () => {
        el.scrollIntoView({ block: 'center' });
        el.classList.remove('hx-flash'); void el.offsetWidth; el.classList.add('hx-flash');
        setTimeout(() => el.classList.remove('hx-flash'), 1700);
      });
      item.querySelector('.hx-cdel').addEventListener('click', () => {
        if (confirm('删除这条评论？（' + (c.author || '匿名') + '：' + c.text.slice(0, 20) + '…）')) postComment({ action: 'delete', id: c.id });
      });
      list.appendChild(item);
    });
    repositionPins();
  }

  function repositionPins() {
    if (!document.body) return;
    let root = document.getElementById('__hx_pins');
    if (!root) {
      root = document.createElement('div');
      root.id = '__hx_pins';
      document.body.appendChild(root);
    }
    root.innerHTML = '';
    const rootRect = root.getBoundingClientRect();
    const sorted = [...S.comments].sort((a, b) => a.ts - b.ts);
    sorted.forEach((c, i) => {
      const el = locateEl(c);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pin = document.createElement('div');
      pin.className = 'hx-pin';
      pin.textContent = i + 1;
      pin.title = (c.author || '匿名') + '：' + c.text.slice(0, 60);
      pin.style.left = (r.right - rootRect.left) + 'px';
      pin.style.top = (r.top - rootRect.top) + 'px';
      pin.addEventListener('click', () => {
        const p = document.getElementById('__hx_cpanel');
        if (p) p.classList.remove('hx-folded');
        el.classList.remove('hx-flash'); void el.offsetWidth; el.classList.add('hx-flash');
        setTimeout(() => el.classList.remove('hx-flash'), 1700);
      });
      root.appendChild(pin);
    });
  }

  function focusCompose() {
    if (!S.sel) return toast('先选中要评论的元素，再点 💬评论');
    const p = document.getElementById('__hx_cpanel');
    if (!p) return;
    p.classList.remove('hx-folded');
    updateComposeTarget();
    p.querySelector('textarea').focus();
  }
  function updateComposeTarget() {
    const p = document.getElementById('__hx_cpanel');
    if (!p) return;
    p.querySelector('.hx-ctarget').textContent = S.sel ? '评论对象：' + label(S.sel) : '评论对象：未选中（先点选页面元素）';
  }

  if (!window.__hxCommentPoll) {
    window.__hxCommentPoll = setInterval(() => { if (!document.hidden) loadComments(); }, 12000);
  }

  /* ---------- 程序化 API ---------- */
  window.__hx = {
    select: s => { const el = typeof s === 'string' ? document.querySelector(s) : s; select(el || null); return el; },
    copy, paste, del, save, undo, serialize, addText, addImg, scopeCss,
    comments: { load: loadComments, post: postComment, list: () => S.comments },
    state: S,
  };

  /* bundler 的 loader 会整体 replaceWith 文档；window 上的定时器存活，UI 丢了就重建；iframe 重载也靠它重新接管 */
  ensureUI();
  setInterval(ensureUI, 500);
})();
