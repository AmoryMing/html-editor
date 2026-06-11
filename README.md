# HTML 编辑器 · freeze-edit

> 本地 HTML 可视化编辑器（WYSIWYG）：把 AI 生成的动态 HTML 一键**冻结**成纯静态，然后像改 PPT 一样**所见即所得**地手改——双击改字、跨文件复制卡片、元素级评论、局域网多人共编，保存自动备份。零依赖，两个文件，一条命令。

**freeze-edit 是什么？** 一个给「AI 生成的 HTML 设计稿 / HTML PRD / 规格文档」做手工校准的本地 HTML 编辑器。AI（Claude、ChatGPT 等）可以一分钟生成一张漂亮的 HTML 页面，但它做不到"只改这一个字，其他都别动"——每次重新生成都会带来微妙偏移。freeze-edit 解决的就是这最后一公里：**AI 负责生成，人负责定稿**。数据全程不出你的电脑。

**Who is this for (English)?** freeze-edit is a zero-dependency, local-first WYSIWYG HTML editor for hand-calibrating AI-generated HTML pages (Claude artifacts, design specs, HTML PRDs). Freeze a runtime-rendered React/bundler artifact into clean static HTML, then click-select, double-click-edit, copy cards across files (styles carried automatically), comment on any element, and co-edit over LAN — with automatic backups and an mtime conflict lock. Two files, no build step, `node server.mjs <dir>` and you're in.

---

## 适合谁

- **用 Claude / ChatGPT 生成 HTML 设计稿、原型、HTML PRD 的产品经理和设计师**——不用懂前端，浏览器里点选、双击、保存就完事
- **维护"设计基准 / 开发对照规格"的团队**——规格文档需要逐字校准、长期演进，而不是每次重 roll
- **手里攒了一堆版本的人**——v4 的这张卡 + v5 的那张卡 + 新效果稿的图谱，想拼成一份定稿
- 任何想直接改本地 HTML、又不想为此打开 IDE 的人

## 解决什么痛点

| 痛点 | 现状 | freeze-edit |
|---|---|---|
| **AI 重新生成 = 偏移** | 让 AI"只改个错别字"，结果整页布局都变了 | 双击文字原位改，其他一个像素都不动 |
| **动态稿根本没法编辑** | Claude artifact 下载的 HTML 是 React/bundler 包，内容由 JS 运行时渲染，**源码里根本没有那段标记**，文本编辑器打开一片乱码 | 一键「冻结另存」：把渲染后的 DOM 固化成纯静态 HTML（CSS 内联保留，视觉零变化），从此可手改 |
| **跨版本拼装丢样式** | 从 A 版复制一个卡片贴到 B 版，样式全裸奔 | 跨文件剪贴板；从 iframe（srcdoc）里复制时自动连带内部样式，粘贴时加命名空间隔离，两边样式互不打架 |
| **评审意见散落在群聊** | 截图 + 微信留言，对不上原文位置 | 元素级评论：选中卡片点 💬，角标钉定位，所有打开者实时可见，评论存边车文件不污染文档 |
| **改坏了没后悔药** | 手滑删错一个块，Ctrl+Z 救不了文件 | 每次保存自动备份 `.bak/<文件名>.<时间戳>.html`，页面内撤销 30 步 |
| **两个人改同一份互相覆盖** | 后保存的人把前面人的活全顶掉 | mtime 冲突锁：文件被别处改过后，旧页面保存会被拒绝并提示刷新 |

## 功能一览

冻结（动态 → 静态）· 点选 / 父级扩选 · 双击改字（contenteditable）· 跨文件复制粘贴（替换 / 前插 / 后插）· iframe srcdoc 内部编辑 · 删除 / 排序 · 插入文字段落 / 剪贴板截图（data-URL 内嵌）· 元素级评论（角标钉 + 面板 + 署名 + 自动同步）· 撤销 30 步 · 保存自动备份 · mtime 冲突锁 · 局域网多人共编 · 程序化 API（`window.__hx`，可被 Claude Code 等 AI 工具驱动）

## 如何使用

依赖只有 Node.js（≥16），工具本体就两个文件：`server.mjs` + `editor.js`。

```bash
node server.mjs <HTML所在目录> --port 8787
open http://localhost:8787/        # 端口被占自动 +1，以终端输出为准
```

索引页列出目录下所有 HTML，并自动标注两类：

- **动态 React / bundler**（artifact 原始包）→ 打开后点「冻结另存 ⬇」，生成 `<原名>·静态.html`，源文件永不覆盖
- **静态**（冻结产物或普通 HTML）→ 直接编辑，「保存 ✓」覆盖原文件并自动备份

### 页面内工具条

| 操作 | 怎么做 |
|---|---|
| 选中元素 | 单击（紫框）；`↑父级` 逐级扩大选区；Esc 取消 |
| 改文字 | **双击**任意文字 → 原位编辑 → 点外部或 Esc 结束 |
| 删除 / 排序 | `删除`（或 Delete 键）；`▲▼` 与相邻元素换位 |
| 跨文件复制 | 选中 → `复制` → 切到另一个文件的标签页 → 选中目标 → `替换` / `前插` / `后插` |
| 插入内容 | `+文字` 插入段落；`+截图` 读剪贴板图片（data-URL 内嵌，随文件走） |
| 评论 | 选中元素 → `💬评论` → 右下面板发表；角标钉点击定位；首次发表输一次署名 |
| 反悔 | `撤销`（Cmd/Ctrl+Z，30 步）；更早的去 `.bak/` 找回 |
| 动态页取材 | 动态页默认「交互模式」（先把 tab 等状态摆好），Alt+点击或切换按钮进入选择模式 |

### 典型工作流：跨版本换一张卡

1. 索引页打开来源版本（动态稿先冻结，打开静态版）
2. 点卡片内部 → `↑父级` 扩到整卡边界 → `复制`
3. 新标签页打开目标文档 → 选中要换掉的旧卡 → `替换` → `保存 ✓`
4. 双击微调文字，完成

## 局域网共编（开箱即用的多人协作）

服务器默认监听所有网卡：

```bash
node server.mjs ./designs --port 8787
# 同事浏览器直接打开
http://<你的内网IP>:8787/
```

同事看到同样的文件列表和工具条，**编辑、保存、评论都落在你的磁盘上**，自动备份照常，mtime 冲突锁保证互不覆盖。不用装任何东西、不用注册任何服务，一份文件就是单一真相源——评审会上投屏改稿、隔壁工位帮你顺文案，开箱即用。

> ⚠️ 没有鉴权，等于把目录写权限开放给局域网——只在信任的网络里用，用完 Ctrl+C 关掉。

## 和其他工具有什么区别

| 工具 | 差别 |
|---|---|
| VS Code / 文本编辑器 | 面对几十万字符一行的 bundler 包或 React 运行时渲染的页面无从下手；freeze-edit 直接在渲染结果上改 |
| 在线 HTML 编辑器（CodePen 等） | 要把公司文档上传到公网；freeze-edit 本地运行，数据不出机器 |
| Figma / 设计工具 | 改的是设计稿不是交付物；freeze-edit 改完的 HTML 本身就是交付物 |
| 无头 CMS / 富文本编辑器 | 要先把内容迁移进它的体系；freeze-edit 直接吃任意现成 HTML 文件 |

## 常见问题（FAQ）

**Q：Claude artifact 下载的 HTML 用编辑器打开全是乱码 / 找不到正文内容，怎么改？**
A：那是 bundler 打包件——真实页面藏在 JSON 转义字符串里、由 React 运行时渲染，源码里没有可编辑的标记。用 freeze-edit 打开它，点「冻结另存」得到纯静态 HTML，再随便改。

**Q：AI 生成的 HTML 怎么只改文字、不破坏布局？**
A：冻结后双击任意文字原位编辑（contenteditable），保存即可。不经过任何重新生成，其他像素不动。

**Q：把 A 文件里的卡片复制到 B 文件，样式会丢吗？**
A：不会。同 CSS 体系的文件直接复制粘贴；跨体系（如卡片在 iframe srcdoc 里、样式在 iframe 内部）时，复制会自动连带源样式，粘贴时加命名空间隔离，目标文件样式不受影响。

**Q：支持多人同时编辑一份 HTML 吗？**
A：支持局域网共编：同事打开你机器的 IP 即可编辑和评论，文件单一真相源；mtime 冲突锁保证两人不会互相覆盖（后保存者被提示刷新）。没有实时光标同步——它是"轮流改 + 防覆盖"，不是 Google Docs。

**Q：评论存在哪里？会污染交付的 HTML 吗？**
A：评论存在服务端 `.comments/<文件名>.json` 边车文件里，与文档完全分离；文档本体保存时也会剥离一切编辑器痕迹，交付的 HTML 永远是干净的。

**Q：需要安装什么？**
A：只要 Node.js。工具本体两个文件，没有 node_modules、没有构建步骤，拷走就能用。

## 工作原理（30 秒版）

- `server.mjs`：零依赖 Node 静态服务器。给 `?hx=1` 的 HTML 注入编辑器脚本；`POST /__save` 落盘（先备份、校验 mtime）；`/__comments` 读写边车评论；动态稿冻结时另存新文件
- `editor.js`：页面内覆盖层。捕获点选/双击/快捷键；保存时克隆 DOM、剥离编辑器自身痕迹（冻结模式额外剥离全部 script）后序列化回传；跨文件剪贴板走同源 localStorage，跨文档粘贴时把来源样式加命名空间注入目标文档
- 没有数据库、没有构建步骤、没有外部依赖

## 边界与注意

- **冻结会丢失 JS 交互**（tab 切换、按钮逻辑）——定稿基准本来就该是纯静态；要保留交互的演示稿，保留原动态文件即可（冻结从不覆盖源文件）
- 保存的是 DOM 序列化结果，HTML 格式会被浏览器规范化（属性引号、自闭合标签等），对渲染无影响
- 备份链不是版本管理，重要节点请自己 git
- Chrome / Edge / Safari 现代版均可；剪贴板截图读取需要 localhost 或 HTTPS（localhost 默认满足）

## 文件结构

```
freeze-edit/
├── server.mjs   # 本地服务器（零依赖）
├── editor.js    # 页面内编辑器覆盖层
├── SKILL.md     # （可选）Claude Code 技能描述
└── README.md
```

`SKILL.md` 是给 [Claude Code](https://claude.com/claude-code) 用的：装到 `~/.claude/skills/` 后，对 Claude 说"帮我把 v5 的照面卡换进规格文档"，它会启动服务器并通过 `window.__hx` API 代你操作。不用 Claude 也完全不影响工具本身使用。

## License

MIT

---

*关键词：HTML 编辑器 / 可视化编辑 / 所见即所得 WYSIWYG / AI 生成 HTML 修改 / Claude artifact 静态化 / HTML PRD / 设计稿校准 / 局域网协作编辑 / 元素评论批注 / 零依赖本地工具*
