# HTML Embed 扩展

本模块随应用编译，桌面和手机共用，不经过目前仅限桌面执行的社区插件运行时。新 AI 或新对话请先阅读根目录的 [开发交接说明](../../../AGENTS.md)，其中记录当前分支、构建环境、可复现验证命令和待验收平台。

## 使用

- 桌面：输入 `/html`，选择 HTML 嵌入。
- 手机：写作工具栏 → 块级 → HTML 嵌入。
- 内容来源可选“内联 HTML”或“引用 HTML 文件”。输入源码，或选择工作区内已存在的 `.html` / `.htm` 文件，应用并运行。重新打开笔记时默认暂停。
- 引用文件请单独编辑，再点击“重新加载文件”。不会自动刷新、下载、创建或修改引用文件，也不会自动把内联源码迁移到文件。
- 编辑面板、展开/收起不卸载 iframe；应用源码或重新运行会重置内部状态。
- 返回正文会在组件附近建立可编辑段落。组件支持整体选择、删除及撤销重做。
- 手机容器自适应宽度；嵌入内容需要自己使用响应式 CSS。不要依赖 hover 或固定桌面宽度。

## 持久化协议 v1

````markdown
```html-embed {"version":1,"height":360,"title":"交互示例"}
<button onclick="this.textContent='Clicked'">Click</button>
```
````

元数据可省略。高度限制为 120–1200 像素。正文保持为不透明 HTML，序列化时动态选择围栏长度，避免嵌套围栏截断。未知版本、未知属性和错误元数据按普通代码块处理，保留源文。未关闭的围栏按 CommonMark 延续至文末，保存时补上结束围栏。

v1 保存内容仅包含源码、标题和高度。输入值、JavaScript 变量、Canvas 和其他运行状态不写入 Markdown。代码超过 262,144 字符仍可保存，但不能在预览内执行。

没有此扩展的 Markdown 客户端通常显示为代码块；仍需验证具体客户端编辑保存的兼容性。手机必须安装包含本扩展的构建，单独同步笔记不会升级官方客户端。

## 文件引用协议 v2

例如目录结构：

```text
工作区/
├── notes/测试.md
└── embeds/demo.html
```

笔记只保存一个短引用，正文为空：

````markdown
```html-embed {"version":2,"file":"../embeds/demo.html","height":360,"title":"交互示例"}

```
````

- 路径相对当前 Markdown 笔记所在目录解析，必须仍在工作区内。支持中文文件名；使用 `/` 分隔，不接受绝对路径、URL、查询参数或文件片段。保存前需要有真实的笔记路径。
- 原生端复用 `plugin_read_preview_chunk` 的有界读取能力；该命令在桌面、iOS、Android 均注册，检查 canonical 工作区边界并拒绝符号链接。不依赖仅限桌面的社区插件运行时，无需改动 Rust 或能力配置。
- 文件必须为有效 UTF-8，最多 512 KiB 且不超过 262,144 字符。读取内容仅保留在 NodeView 内存，不写回 Markdown；iframe 仍通过原有 `srcDoc` 沙箱运行。
- 改变尺寸、展开、正文编辑不重读文件；显式运行、重新加载或修改引用时才读取。停止、切换笔记/工作区或销毁节点会丢弃未完成请求的结果。
- 文件不存在、未同步到本机、无权限、路径不安全、编码错误或超限时显示错误并保留引用。选择器不可用或返回工作区外的手机文件 URI 时，可直接填写已同步到当前工作区的相对路径。
- 手机必须获得相同工作区相对路径的 HTML 文件。现有资料库同步有包含静态资源的入口，但不能假定单独同步一篇 Markdown 就会传输其 HTML；本扩展不改变同步配置，也不从网络补取文件。
- 移动或重命名笔记、HTML 文件，以及把引用粘贴到不同目录后，需要手动更新路径。首版不实现自动修复引用或文件监听。
- v1 内联格式继续支持；未知版本、错误元数据，以及同时包含文件引用和非空 HTML 正文的混合格式回退为普通代码块，避免丢弃源码。

## 隔离边界

- iframe 仅设置 `sandbox="allow-scripts"`，不授予同源、弹窗、顶层导航、表单提交或宿主能力。
- CSP 位于用户源码之前，限制外部脚本、子资源、fetch、子 frame、worker 和表单目标。允许内联脚本、事件处理器、CSS，以及 data/blob 图片，以支持自包含交互。
- 不复用插件的权限桥，不提供文件、笔记、剪贴板和 Tauri API。消息仅报告就绪或错误，严格检查 frame 来源及每次运行的 token。
- 这不是进程隔离、CPU 配额或完整网络隔离。任意 JavaScript 仍可能耗尽 CPU，或者尝试导航自身 frame；因此不应把网络限制描述为绝对离线保证。只运行自己信任的内容。
- 不支持外部网页、远程脚本加载、HTML 内的本地 CSS/JS/图片资源映射或运行状态持久化。文件引用模式仍要求单个自包含 HTML。

## 导出和复制

Markdown 保留专用围栏。HTML/PDF 导出继续走上游 Streamdown 流程，不运行组件、不修改清理规则；v1 显示 HTML 源码，v2 经一个独立 remark 插件显示引用源码，避免空围栏丢失路径。导出不会读取或打包引用文件，分享时需另带 HTML。剪贴板 HTML 为带标记的惰性 `<pre><code>`，本应用粘贴时恢复节点，其他应用可读取源码或引用文本。

## 最小宿主接入清单

1. `tiptap-editor.tsx`：注册 `HtmlEmbed`，处理手机插入动作，提供当前笔记路径和文档/工作区切换通知（复用现有来源上下文订阅）。
2. `markdown-tokenizers.ts`：注册同一个 tokenizer，兼顾主线程与后台 lexer；`markdown-lexer-protocol.ts` 版本号用于拒绝旧缓存。
3. `slash-command/suggestion.tsx` 和 `slash-menu.tsx`：插入入口及文案。
4. `mobile-writing-toolbar.tsx`：触屏入口。
5. `messages/*.json`：新增 `editor.htmlEmbed` 与斜杠菜单文案。
6. `streamdown-renderer.tsx`：注册 `remarkHtmlEmbedFiles`，只读视图和导出显示文件引用文本。

升级上游时优先检查这些接入点。`dev` 用于跟踪上游，本功能在 `codex/html-embed`；将更新后的 `dev` 合并到功能分支，保留独立模块，不覆盖整个目录或重置功能分支。

## 验证

自动化：`node scripts/html-embed-fixture.mjs`，覆盖真实 MarkdownManager 的往返、后台 lexer、一致性、嵌套围栏及不支持格式回退。原有 `scripts/round-trip-fixture.mjs` 用于普通代码块回归。

可选 DOM 验证不新增应用依赖：在仓库外安装 jsdom 26，将 `HTML_EMBED_DOM_MODULE` 指向其 `lib/api.js` 绝对路径后执行同一 fixture，附加真实 Editor 的插入、惰性 HTML 剪贴板恢复、Markdown 重开、删除及撤销重做检查。

内联首期（v1）已通过上述自动化、TypeScript、相关文件 ESLint 和前端生产构建。Chrome 中验证了按钮与输入、展开/正文输入/高度变更时状态保留、390 像素宽度无横向溢出、错误显示、宿主 DOM 访问被拒绝、fetch 被阻止，以及实际 HTML 导出保留源码且没有活动 iframe/script。测试使用临时验证页面，已移除。

桌面及 iOS/Android 真机需分别检查：插入、按钮和输入、图表触摸、键盘遮挡、正文滚动、返回正文、保存重开、源码切换、撤销重做、复制粘贴、删除和导出。验证正文输入、高度变更及展开不重置计数器；停止、重新运行和应用新源码应重置。切后台后运行状态不保证保留。

隔离检查需在 Tauri 构建中进行：访问 `parent.document` 应失败；不应获得宿主 Tauri 能力；fetch/远程脚本/图片应被 CSP 阻止。脚本错误显示为文本，加载异常可停止或重运行。浏览器测试不能代替移动端 WebView 和 Tauri 隔离验证。

### 文件引用验证补充

v2 已通过类型检查、相关 ESLint、Markdown/后台 lexer 往返、路径边界、编码与大小限制、剪贴板恢复及真实 React NodeView 测试。React 回归覆盖首次属性更新不重读、手动重新加载、读取失败、切换笔记后取消旧请求。浏览器临时验证页通过了独立 HTML 文件读取（注入测试读取器）、修改后手动重载、390 像素布局、简短 Markdown 保存和实际 HTML 导出；验证页与临时 HTML 已移除。

已按用户请求执行 `RUSTUP_TOOLCHAIN=stable pnpm tauri build --debug --bundles app --no-sign`，最新前端生产构建及 macOS 调试 `.app` 打包通过。已在正在运行的 macOS Tauri 开发版中，用临时目录调用真实文件读取接口，验证成功读取、符号链接拦截、缺失文件、错误编码、超限及路径越界六项均通过；临时开发入口和文件已移除。iOS/Android 真机仍待验证，浏览器和 jsdom 不能替代手机平台验收。

2026-10-30 桌面演示：已打开打包后的应用，创建 `HTML文件引用演示.md` 引用工作区内独立的 `embeds/灵感实验室.html`，并在实际 Tauri 界面验证名字输入和计数按钮正常。笔记未包含 HTML 正文。

## 接续开发

- 从 `codex/html-embed` 继续，先核对工作区和远端；`dev` 跟踪上游。提交与推送状态以 Git 为准。
- 核心回归入口是 `node scripts/html-embed-fixture.mjs`；设置 `HTML_EMBED_DOM_MODULE` 后会同时执行 DOM 和 React NodeView 回归，不要遗漏首次属性更新导致 iframe 重载的测试。
- 原有代码块可用 `node --experimental-strip-types scripts/round-trip-fixture.mjs` 检查。可选 jsdom 依赖的仓库外安装方式见根目录说明。
- 升级 Tiptap、解析器或上游编辑器后，重点复核本文的宿主接入点、worker 版本/注册顺序及复制、导出路径。
- 当前首要工作是 iOS/Android 真机验收及 Tauri iframe 隔离专项检查；不要将 macOS 文件读取通过理解为所有平台已完成验收。
- 演示笔记、独立 HTML 和打包应用属于本机运行数据，不随仓库提交；其他机器需自行生成演示数据并重新构建。
