<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), use CodeGraph before grep/find or reading code to understand or locate symbols:

- MCP: `codegraph_explore`, passing the actual project root as `projectPath`.
- Shell: `codegraph explore "<symbols or question>"`.

If there is no `.codegraph/`, skip CodeGraph. Do not initialize or refresh an index without the user's request or confirmation.
<!-- CODEGRAPH_END -->

# NoteGen 开发与 AI 交接说明

更新于 2026-10-30。新对话先读本文件及 [HTML Embed 模块说明](src/extensions/html-embed/README.md)，再检查实际 Git 状态；不要仅凭交接文字假定功能已经发布或平台已验收。

## 仓库与工作方式

- 项目是 NoteGen：本地 Markdown 笔记、信息记录、AI 辅助整理，前端 Next.js 15 / React 19 / TypeScript，桌面与手机基于 Tauri 2。
- fork：<https://github.com/TheFBplus/note-gen>，远端 `origin`。
- 上游：<https://github.com/codexu/note-gen>，远端 `upstream`。
- 本机目录：`/Volumes/Projects/Projects/Typescript/note-gen`；其他机器应以实际仓库根目录为准。这与 Unity TitanGame 无关。
- 当前功能分支：`codex/html-embed`，开发基线是上游 `dev` 的 `d0c382a5`（NoteGen 0.39.1）。提交、推送及领先/落后情况以实际 Git 为准。
- `dev` 用于同步上游；功能分支保存扩展。升级时先更新 `dev`，再合并到功能分支，解决冲突并验证。不要用覆盖目录、强制重置或强制推送替代正常合并。
- 开工必查 `git status --short --branch`、`git branch -vv`、`git remote -v`，保留现有改动。用户已授权本次实现的提交与推送，不代表未来可以自动提交、推送、合并或发布。
- `AGENTS.md` 已作为项目交接文件纳入版本控制；更新关键设计、实现和验证结果时同步维护。不要写入凭据或完整个人设置。

## 已确认的产品要求

1. 在笔记正文的段落之间显示可操作的 HTML，包括按钮、输入框、表单交互和图表；不是静态图片或单独插件面板。
2. 尽量通过独立模块扩展，减少上游源码改动和升级冲突。
3. 桌面、iOS、Android 共用功能实现；手机需适配触摸、布局、软键盘并单独验收。
4. 支持把长 HTML 放到独立文件，笔记只保存相对路径引用，使源码模式保持清爽。

## 当前实现

功能集中在 `src/extensions/html-embed/`，是随应用编译的扩展，不是可安装的社区插件。

- `htmlEmbed` 是 Tiptap 块级原子节点，Node View 使用 `sandbox="allow-scripts"` 的 iframe 和 `srcDoc`。
- 桌面 `/html` 插入；手机写作工具栏 → 块级 → HTML 嵌入。
- 编辑界面支持内联 HTML 或引用 HTML 文件，以及标题、高度、运行、停止、重新加载、展开、删除和返回正文。
- 笔记重新打开默认暂停；点击运行后执行。按钮、输入值、JavaScript 变量及 Canvas 等运行状态不写入 Markdown。
- 普通正文输入、选区、高度变化及展开不会重建 iframe；应用源码或显式重新运行会重置状态。
- 文件读取异步结果绑定当前节点与文档上下文，停止、切换笔记/工作区、销毁节点后丢弃过期结果。
- v1 内联、v2 文件引用均支持 Markdown 往返及惰性 HTML 剪贴板恢复。未知版本、错误元数据或 v2 混入非空正文时回退普通代码块，避免丢失原文。

### 存储格式

v1 内联（元数据可省略）：

````markdown
```html-embed {"version":1,"height":360,"title":"示例"}
<button onclick="this.textContent='Clicked'">Click</button>
```
````

v2 文件引用（围栏正文为空）：

````markdown
```html-embed {"version":2,"file":"./embeds/demo.html","height":360,"title":"示例"}

```
````

- 文件路径相对当前 Markdown 笔记的目录，必须仍在当前工作区内。支持中文文件名、`.html` 和 `.htm`；不接受绝对路径、URL、查询参数和片段。
- 文件必须已在本机同步且可读取，为自包含 UTF-8 HTML，最多 512 KiB 且不超过 262,144 字符；高度 120–1200 像素。
- 宿主复用原有原生命令 `plugin_read_preview_chunk` 有界读取；它已在桌面、iOS、Android 注册，检查 canonical 工作区边界并拒绝符号链接。不依赖社区插件运行时。
- 加载结果仅存内存，不把文件源码塞回笔记。文件外部修改后需要点击重新加载。
- 手机需同步 HTML 文件本体及相对目录结构。现有同步有静态资源入口，但不能假定只同步一篇 Markdown 就包含引用文件。本扩展不自动下载或改变同步策略。

### 隔离、导出与未实现范围

- CSP 在用户源码之前建立，限制外部脚本、子资源、fetch、子 frame、worker、表单目标；允许内联脚本/事件、CSS、data/blob 图片。
- 不给 iframe 同源、Tauri、本地文件、插件权限桥、弹窗或顶层导航能力；就绪/错误消息检查 frame 来源及运行 token。
- 沙箱不是进程隔离或 CPU 配额，也不保证完整网络隔离；恶意脚本仍可能耗尽 CPU 或尝试导航自身 frame。只运行可信内容。
- HTML/PDF 导出保持上游清理规则：v1 显示源码，v2 经独立 remark 插件显示引用文本。不会运行、读取或打包引用 HTML。
- 未实现：外部网页 `src`、HTML 内的多文件本地资源映射、远程脚本加载、运行状态持久化、自动刷新、移动/重命名后自动修复引用、自动将内联内容写入 HTML 文件、附件打包导出。
- 移动笔记、HTML 或把引用粘贴到其他目录后，需要手动调整路径。

## 模块入口与升级检查点

| 文件 | 职责 |
| --- | --- |
| `src/extensions/html-embed/node.ts` | 节点 Schema、Markdown/剪贴板持久化 |
| `src/extensions/html-embed/markdown.ts` | v1/v2 tokenizer、序列化、动态围栏长度 |
| `src/extensions/html-embed/extension.tsx` | Node View、编辑界面、异步生命周期及宿主选项 |
| `src/extensions/html-embed/file-path.ts` | 相对路径验证、工作区解析、选择器路径转换 |
| `src/extensions/html-embed/file-source.ts` | 有界原生读取、UTF-8/大小检查 |
| `src/extensions/html-embed/sandbox.ts` | CSP、iframe 文档、就绪/错误桥 |
| `src/extensions/html-embed/remark.ts` | 只读视图及 HTML/PDF 的文件引用降级 |
| `src/app/core/main/editor/markdown/tiptap-editor.tsx` | 注册扩展、提供笔记路径/来源上下文、手机插入动作 |
| `src/app/core/main/editor/markdown/markdown-tokenizers.ts` | 主线程及后台 lexer 的相同 tokenizer 注册顺序 |
| `src/app/core/main/editor/markdown/markdown-lexer-protocol.ts` | worker 缓存协议版本，目前为 4 |
| `src/app/core/main/editor/markdown/slash-command/` | 插入菜单及翻译接入 |
| `src/app/core/main/editor/markdown/mobile-writing-toolbar.tsx` | 手机触屏插入入口 |
| `src/components/markdown/streamdown-renderer.tsx` | 注册惰性的文件引用 remark 插件 |
| `messages/*.json` | `editor.htmlEmbed` 和斜杠菜单文案 |

后续修改优先留在独立模块。没有为本功能修改 Rust、能力配置、全局导出清理、同步模块、依赖版本或锁文件。

### 必须保留的实现约束

- Markdown 是持久化来源。主编辑器通过 `getMarkdown()` 保存，不能只修改可视化 DOM。
- 项目使用 Tiptap 3（锁文件为 3.19.0），不能直接套用依赖 Tiptap 2 的 iframe 插件。
- Tiptap 的 options getter 每次生成对象，更新时 extension 代理也可能变化。Node View 必须固定初始选项引用，不能以这些对象身份变化触发文件重读；已有 React 回归测试覆盖首次高度更新。
- 新增 tokenizer 必须兼顾主线程、后台 lexer 及注册顺序，并在协议变化时提升 worker 版本。
- 现有插件沙箱可参考，但不能将插件权限桥暴露给正文。现有代码块渲染协议仅 SVG/PNG，不应为此改成任意活动 HTML。
- 继续使用 pnpm，不混入其他锁文件或无关升级。复杂逻辑补充简体中文说明，沿用现有组件、样式和国际化约定。

## 开发与验证命令

本机验证环境为 Node 22.16.0、pnpm 10.33.0、Rust 1.88.0。仓库 `rust-toolchain.toml` 固定 1.88.0。本机已安装的 `stable` 恰好是 1.88.0，可用 `RUSTUP_TOOLCHAIN=stable` 避免重复下载；其他机器先检查版本，不要修改仓库工具链约定来绕过环境问题。

```bash
COREPACK_ENABLE_AUTO_PIN=0 pnpm install --frozen-lockfile
node scripts/html-embed-fixture.mjs
node --experimental-strip-types scripts/round-trip-fixture.mjs
COREPACK_ENABLE_AUTO_PIN=0 pnpm exec tsc --noEmit --incremental false
COREPACK_ENABLE_AUTO_PIN=0 pnpm exec eslint src/extensions/html-embed scripts/html-embed-*.ts scripts/html-embed-view-cases.tsx
COREPACK_ENABLE_AUTO_PIN=0 pnpm build
COREPACK_ENABLE_AUTO_PIN=0 RUSTUP_TOOLCHAIN=stable pnpm tauri dev
COREPACK_ENABLE_AUTO_PIN=0 RUSTUP_TOOLCHAIN=stable pnpm tauri build --debug --bundles app --no-sign
```

- `COREPACK_ENABLE_AUTO_PIN=0` 防止 Corepack 自动给 `package.json` 添加无关版本字段。
- `pnpm dev` 自带插件 runtime 与 Markdown worker 生成步骤，端口 3456；不要绕过后误判运行失败。
- 普通 fixture 覆盖真实 MarkdownManager、后台 lexer、v1/v2、嵌套围栏、路径边界、编码、大小和读取失败。附加 DOM/React 检查需要 jsdom，可在仓库外安装，避免改变应用依赖：

```bash
embed_test_dir=$(mktemp -d)
COREPACK_ENABLE_AUTO_PIN=0 pnpm --dir "$embed_test_dir" add jsdom@26 --ignore-scripts
HTML_EMBED_DOM_MODULE="$embed_test_dir/node_modules/jsdom/lib/api.js" node scripts/html-embed-fixture.mjs
```

附加测试覆盖真实 Editor 插入、Markdown 重开、剪贴板恢复、删除、撤销重做，以及 Node View 状态保留、重载、读取失败、回到内联模式和取消旧请求。修改后按影响范围选择检查；通过后不要无故重复全量构建。

## 已验证结果与后续优先事项

2026-10-30 已验证：

- 类型检查、相关 ESLint、全部 HTML Embed fixture、原有普通代码块往返 fixture。
- 最新前端生产构建及 macOS 调试 `.app` 打包。
- 浏览器按钮/输入、图表、390 像素布局、正文/尺寸变化时状态保留、文件更新后手动重载、HTML 导出惰性源码/引用。
- macOS Tauri 真实读取接口：正常 HTML、符号链接拦截、缺失文件、无效 UTF-8、超限、路径越界共六项。
- 打包后的真实桌面应用打开独立文件引用笔记，名字输入和计数按钮可操作。

优先待验收：iOS/Android 真机的文件同步/读取、系统选择器、触摸/软键盘与切后台恢复；各平台 Tauri 内 iframe 的宿主权限隔离专项验证。浏览器窄屏和文件读取测试不能替代这些验收。后续功能范围需用户另行确认。

## 本机演示与构建产物

- 调试应用：`src-tauri/target/debug/bundle/macos/NoteGen.app`，是未签名的本地调试包，未发布或替换 `/Applications` 中的安装版。
- 示例笔记 `HTML文件引用演示.md` 引用工作区的 `embeds/灵感实验室.html`；另有旧的 `测试html.md`。这些属于用户笔记工作区，在代码仓库之外，不纳入 Git 提交。
- 如需定位用户工作区，只读取应用设置中必要的 `workspacePath` 等字段，不要输出或提交完整 `store.json`（其中可能有凭据）。不要假定其他机器存在本机演示文件。
- 已删除所有临时验证路由、临时原生测试入口和测试 HTML。生成的 worker、构建产物、截图、应用设置、个人笔记和测试用第三方依赖均不入库。


## 定制版云端构建（2026-10-30 配置）

2026-10-31 定制更新实现：`src/extensions/custom-updates/` 新增协议校验、检查/忽略/安装 store、桌面/手机卡片与全局更新进度阻挡层。定制构建启动查独立渠道；桌面复用现有 native updater 和 NSIS 安装检测，下载后刷盘、安装、重启，Android 打开确定版本 APK 由系统确认安装。普通构建仍走上游策略。CI 额外产出 macOS 更新归档，在独立可信任务中签名/验证 Windows/macOS 更新包；发布成功后独立 `promote-channel` 才更新 `codex/custom-update-channel/latest.json`，失败可重试该任务。签名私钥在仓库外、密码在钥匙串，两个 CUSTOM_UPDATER Secrets 已按用户确认配置；只有公钥提交。详见 `scripts/custom-release/README.md`，下方早期“仅手动下载/不生成 latest.json”描述为历史行为。旧包需一次手动过渡安装；本轮本地验证：19 项控制面、7 项桌面签名/渠道、7 项上游提醒回归及前端原生边界模拟更新测试、类型检查、相关 ESLint、actionlint、定制前端生产构建通过；真实固定私钥签名与 Ed25519 验签/篡改拒绝也通过。未进行真实跨版本自动安装验收，不应据模拟测试声称已通过各平台安装。


2026-10-31 macOS 产物修复：首次运行 attempt 2 的原生编译与 DMG 打包成功，但仅指定 dmg 导致 Tauri 清理中间 `.app`，后续架构校验报 `Expected exactly one artifact, found 0`。现改为 `bundle: app,dmg` 保留 app，仍校验主程序及 OCR helper 为 arm64，且只发布 DMG。新增保留配置/收集及错误架构拒绝的回归；本地 19 项控制面测试、7 项提醒测试与 actionlint 通过，云端修复结果需新建手动构建验证，旧任务重试仍用旧配置。

2026-10-31：macOS 构建 runner 切换为 `macos-15`，目标仍为 `aarch64-apple-darwin`。GitHub 将于 2026-11-02 停用 `macos-14`，退役前会缩容/阶段性停机；首次运行的 macOS 任务未取得 runner，Windows 和 Android 构建及 Android 签名已成功。配置变更只对新启动的运行生效，已有运行及其重试仍使用旧配置；不自动取消已有任务。

2026-10-31 调整：`custom-dev-build.yml` 已移除 schedule，仅手动构建最新 dev。新增 `upstream-release-watch.yml` 每日北京时间 11:17 或手动检查上游正式 Releases；首次建立历史基线，后续按 Release ID 创建一次提醒 Issue，不打包、不合并、不访问签名密钥。去重状态位于独立分支 `codex/upstream-release-state` 的 JSON 文件中，包含已关闭 Issue 的故障重试去重；不要删除状态分支。详见 `scripts/custom-release/README.md`。本地新增 7 项提醒回归及原 17 项控制面回归、两个工作流 actionlint 通过。下列 2026-10-30 的每日打包说明为历史配置，以本段为准。

新增 `.github/workflows/custom-dev-build.yml`，与上游 `release.yml` 独立。详情见 `scripts/custom-release/README.md`。

- 固定目标：Windows x64 NSIS、Apple Silicon DMG、Android ARM64 APK；公开仓库标准 runner，不使用付费大规格机器。
- 每日 UTC 03:17 或手动检查上游 dev，将其合并到功能分支来源的临时候选；不改写 dev/功能分支。相同来源已有已发布包时跳过，冲突或测试失败中止。
- 三平台全部成功后才公开定制 Prerelease，附来源及 SHA256。失败维护同一个 Issue，成功恢复后关闭；清理临时分支和已发布包的重复 Artifact。
- Android 使用固定的 CUSTOM_ANDROID_KEYSTORE_BASE64 / CUSTOM_ANDROID_KEYSTORE_PASSWORD / CUSTOM_ANDROID_KEY_PASSWORD Secrets，别名 Variable 可选；编译任务不接触私钥。已于 2026-10-30 在本机仓库外生成固定 PKCS12/RSA 3072 密钥（别名 notegen-custom，有效期 10000 天），密码存于 macOS 钥匙串 NoteGen Android signing password；三个 Secrets 已配置，不可每次生成临时签名替代。
- 定制 CI 设置 NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD=1：独立 custom-updates 模块停用官方渠道，查询本 fork 的定制签名更新清单，桌面按用户点击下载安装、Android 打开 APK 链接；普通本地构建不受影响，详见本节最新实现。
- 2026-10-30 已推送配置提交 f8788e80，将 GitHub 默认分支设为 codex/html-embed 并开启 Issues；Actions 页面已显示可手动运行的 Custom dev packages。Android 签名 Secrets 已配置，首次云端构建已启动，运行链接见下方。
- 配置文件与账号设置分开记录；提交、推送、云端启用状态以实际结果为准。首次三平台云端构建和安装仍需查看实际结果。
- 本轮本地验证已通过 actionlint、17 项云端控制面回归、定制/普通更新渠道回归、类型检查、相关 ESLint 和定制标志下的前端生产构建。三平台云端首轮已启动，最终产物及签名结果须查看 Actions。用户已明确授权并已完成本轮配置的提交推送、默认分支切换和 Issues 启用；命令行无 GitHub 凭据，推送通过已登录的 GitHub Desktop 完成，远端提交及仓库状态已核对。

- 首次运行：https://github.com/TheFBplus/note-gen/actions/runs/41078996240 。2026-10-30 启动后已确认 prepare 和 credentials 成功，validate 进行中；这不等于三平台打包或 APK 签名验证已通过。密钥文件与公钥证书信息保存在本机 `~/.config/notegen-signing/`（目录 700、文件 600），密码未写入仓库或明文文件。请通过钥匙串访问读取并备份密码，不要在聊天或日志中输出。
