# 定制版 dev 云端构建

此流程获取 `codexu/note-gen` 上游 `dev`，与本 fork 的 `codex/html-embed` 合并，检查通过后生成：

| 平台 | 架构 | 产物 |
| --- | --- | --- |
| Windows | x64 / x86_64-pc-windows-msvc | NSIS `.exe` 安装包，未做发行者代码签名 |
| macOS | Apple Silicon / aarch64-apple-darwin | `.dmg`，不依赖 Apple 证书，未公证 |
| Android | ARM64 / arm64-v8a | 使用你自己固定密钥签名的 `.apk` |

不构建 Intel Mac、Windows ARM、Android ARMv7/x86 或 iOS。不使用付费 Larger runners。标准 runner 对公开仓库的计算运行免费，Actions 产物和缓存仍有独立额度；请在 GitHub Billing 检查实际用量和预算。本流程仅缓存 Rust 下载与 pnpm 依赖；发布成功后清理重复的安装包 Artifact，失败时保留有限天数供排查。

## 首次启用

本配置需要提交并推送后才会出现在 GitHub；仅有本地文件不会运行云端任务。

1. 将本次配置提交并推送到 `TheFBplus/note-gen` 的 `codex/html-embed`。
2. 仓库 Settings → General → Default branch：设为 **`codex/html-embed`**。这使该分支上的工作流具备手动/定时入口；`dev` 仍保持同步上游的用途。不要为启用定时任务把功能文件覆盖到 `dev`。
3. Settings → General → Features：启用 **Issues**。fork 默认可能未启用，失败报告需要它。
4. Actions 页面：如果提示 fork 的工作流被禁用，启用工作流。确认仓库策略允许配置中固定 SHA 的 GitHub 官方及 Android/pnpm Actions。工作流会按任务申请最小必要权限，组织策略也必须允许这些写操作。
5. 按下方“受保护发布环境”配置审批、分支限制及五个 Environment Secrets。缺少保护规则时预检查停止；密钥缺失会在批准后的签名任务失败，不会生成临时密钥顶替。
6. Actions → **Custom dev packages** → **Run workflow**，选择 `codex/html-embed`。首次不勾选 force。
7. 在账号通知设置中启用 Actions 失败通知，并关注仓库中的失败 Issue。

当前源码分支和仓库名称固定在工作流中；以后更名时同步修改工作流、更新渠道链接及本文。


## 受保护发布环境（2026-11-03）

工作流保持仅手动启动。合并冲突、测试失败或任一平台构建失败即停止；三平台完成后，一个 `sign-packages` 任务等待 `custom-release` 环境批准，批准一次才签名 Android 和桌面更新包，随后发布并推进渠道。签名任务只检出本轮启动时的可信功能分支自动化，不检出或执行候选源码；私钥仅传给对应签名步骤，不传给工具安装或编译步骤。

在 Settings → Environments → `custom-release` 配置：

1. Required reviewers：添加 `TheFBplus`。个人仓库保留自我审阅能力，不勾选 Prevent self-review，否则你无法批准自己启动的运行。
2. 关闭 Allow administrators to bypass configured protection rules，保存保护规则。
3. Deployment branches and tags：Selected branches and tags，仅添加 Branch `codex/html-embed`，不要添加 Tag 或通配符。
4. Environment secrets：上传原有固定密钥和密码，使用 `RELEASE_ANDROID_KEYSTORE_BASE64`、`RELEASE_ANDROID_KEYSTORE_PASSWORD`、`RELEASE_ANDROID_KEY_PASSWORD`、`RELEASE_UPDATER_PRIVATE_KEY`、`RELEASE_UPDATER_KEY_PASSWORD`。值与原有五个 `CUSTOM_*` Secrets 相同，不能重新生成密钥。别名仍用非敏感 Variable `CUSTOM_ANDROID_KEY_ALIAS` 或默认值。
5. 核对五个新 Secrets 已存在，并保留本机备份后，删除原来的五个 Repository Secrets。新流程不读取旧名称，但旧 Secrets 只要留在仓库级别，其他获授权工作流仍可能读取它们，因此迁移前不能声称已完成密钥隔离。

配置不是只写 YAML 就会生效。`prepare` 会查询环境规则，缺少审阅者、允许管理员绕过、分支不匹配或禁止自审时直接停止，避免 GitHub 自动生成无保护环境后继续发布。环境审批会显示在 Actions 运行页的 Review deployments 中；审阅来源 SHA、构建验证结果和产物后批准。建议在七天内审阅，超过 Artifact 保留期重新构建。拒绝或取消不会发布新版本或推进更新渠道。已有 Release 不改写。

macOS 定制覆盖配置使用 `signingIdentity: "-"`，构建时不再传 `--no-sign`，由 Tauri 在打包 DMG 前做临时应用签名。收集阶段严格验证 `.app`，只读挂载 DMG、验证镜像内签名，并比较两份应用内容；验证失败时不上传安装包。Tauri 更新包签名另用固定私钥，不能替代 macOS 应用签名或 Apple 公证。

临时签名仍不是 Apple 认证，首次浏览器下载安装可能需要系统放行，不能承诺以后永远没有提示。不要关闭 Gatekeeper/SmartScreen/Defender。当前 Windows 仍未做发行者签名；Android 仍用固定密钥。应用维持自动检查、用户点击安装的行为，未增加静默安装；桌面在用户确认更新并安装后重启。跨版本安装需另做真实设备验收。

备份：将仓库外的固定密钥、对应密码和别名保存在加密的外置介质或可信密码管理器，确认能恢复后再迁移；同一电脑上另存一份不算离线备份。不要把笔记、应用设置或 AI API Key 放进构建仓库。

## Android 密钥：只生成一次

需要本机可用的 JDK/keytool。以下命令由你在本机终端执行，文件保存在代码仓库外；不要提交密钥或把密码写进 Issue、聊天或工作流。

```bash
mkdir -p "$HOME/.config/notegen-signing"
chmod 700 "$HOME/.config/notegen-signing"
keytool -genkeypair \
  -keystore "$HOME/.config/notegen-signing/notegen-custom.p12" \
  -storetype PKCS12 -alias notegen-custom \
  -keyalg RSA -keysize 3072 -validity 10000
chmod 600 "$HOME/.config/notegen-signing/notegen-custom.p12"
```

keytool 会交互询问密码。PKCS12 通常使用相同的存储和密钥密码。将密钥文件、别名和密码保存在你的密码管理器/可靠备份中；以后必须复用，不要在 CI 每次重新生成。

在 Mac 将文件的 Base64 编码复制到剪贴板（编码不是加密）：

```bash
base64 -i "$HOME/.config/notegen-signing/notegen-custom.p12" | tr -d '\n' | pbcopy
```

进入本 fork 的 Settings → Secrets and variables → Actions，在 `custom-release` 环境创建 Environment Secrets（不要创建为 Repository Secrets）：

| 名称 | 内容 |
| --- | --- |
| `RELEASE_ANDROID_KEYSTORE_BASE64` | 刚才复制的完整 Base64，不能含换行 |
| `RELEASE_ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `RELEASE_ANDROID_KEY_PASSWORD` | 该密钥的密码；PKCS12 通常与 keystore 相同 |

默认别名为 `notegen-custom`。如果使用别的别名，在同一页面的 Variables 创建 `CUSTOM_ANDROID_KEY_ALIAS`。使用前确认没有把 Base64 内容误放到公开 Variable。

Android 编译任务不接触私钥；单独签名任务只执行受控的自动化脚本，使用 `zipalign`、`apksigner` 并验证版本、签名和 ARM64 ABI，结束后删除临时私钥。

该签名不是官方签名，不能直接覆盖官方 Android 安装版。第一次切换至自签名版需要规划应用标识及数据迁移；不要为了安装新包直接卸载仍含重要本地数据的旧应用。后续相同签名的定制版可继续更新。

## 手动构建行为

macOS 使用 `macos-15`，显式指定 `--bundles app,dmg` 保留 `.app` 供主程序与 OCR helper 的 ARM64 架构校验；仅指定 dmg 时 Tauri 会在成功生成磁盘映像后清理中间 `.app`。手动安装使用 DMG；另将 `.app` 打包为保留符号链接/权限的 `.app.tar.gz`，供应用内更新使用，不直接发布裸 `.app`。

- 仅通过 Actions → Custom dev packages → Run workflow 手动启动，不设定时，不监听 push、PR 或上游发布事件；失败后也不会自动定时重试。
- 每次手动运行时主动 fetch 上游 `dev`，与最新 `codex/html-embed` 合并。
- 固定本次上游提交和自定义分支提交。完全相同的一对源码已有已发布版本时跳过；force 可以重新构建。修改我们自己的源码后，需手动启动新一轮构建。
- 从功能分支创建候选合并，只把候选提交推到本次专用的 `codex/ci-build-*` 临时分支。不改写 `dev` 或 `codex/html-embed`。
- 合并冲突记录文件名并退出；无冲突后还要执行类型检查、HTML Embed 的普通/DOM/React 回归及原有代码块回归。无文本冲突不代表必然兼容。
- 检查通过后并行编译三平台。包版本使用上游三段版本加 `-custom.<run_number>`；Android versionCode 为 `1000000000 + run_number`，Mac bundleVersion 为 run_number。请保留该工作流的运行序列，换工作流/仓库时先规划 versionCode 连续性。
- 所有平台成功后，先创建草稿 Release，上传三份安装包、macOS 更新归档、两份桌面签名、`build-info.json`、`SHA256SUMS.txt`，验证齐全后才公开为 Prerelease。部分失败不会发布半套包，也不覆盖已发布版本。
- Release 标签包含上游及自定义提交摘要。force 会生成新的运行标签，不覆盖已有版本。记录的来源提交对应候选代码；打包版本/更新端点覆盖配置是明确记录的构建阶段生成物。
- 发布成功后清理本轮重复的包 Artifact，并删除临时分支；来源仍可通过 Release 标签追溯。失败元数据、包产物和 Android 中间包最多保留 7 天，供人工审批及排查。

只有合并结果经你确认并合并回功能分支后，后续维护分支才会前进。本流程自动生成候选安装包，不替代源码审查。

## 每日上游正式发布提醒

独立工作流 **Upstream release reminder**（`upstream-release-watch.yml`）每天 UTC 03:17 / 北京时间 11:17 检查 `codexu/note-gen` 的 GitHub Releases，也支持 Run workflow 手动检查；仅在默认分支运行。它不检查 dev 提交，不合并、不打包、不访问 Android 密钥，也不启动构建工作流。

- 第一次成功运行只记录当前全部正式发布作为基线，不为历史版本创建 Issue。之后发现新的正式 Release ID 时，每个版本创建一个提醒 Issue，明确 @提及通知账号，包含版本、UTC 发布时间、Release 链接和手动构建入口。排除草稿和 Prerelease；预发布转正式后会提醒。
- 去重状态保存于独立分支 `codex/upstream-release-state` 的 `upstream-release-state.json`。该分支不作为代码合并或构建来源，不回写功能分支。请不要删除状态分支；丢失后会重新建立基线。
- Issue 创建后才保存状态；如果保存失败，重试会检查已有的机器人 Issue（包括已关闭的），避免对同一 Release 再次通知。没有变化不提交状态。多次运行串行执行。
- 第一次运行完成前发布的版本都会纳入基线，因此启用后应先手动运行一次，建立基线。
- 请关注本仓库 Issues 并配置 GitHub 邮件/手机通知。提醒检查自身失败会在 Actions 显示失败，需要开启 Actions 失败通知。
- 11:17 是计划时间，GitHub 调度与 runner 排队可能延迟；公开仓库长时间无活动可能自动停用定时工作流，需要重新启用。
- 提醒对应正式 Release；手动构建仍获取运行时最新 dev，可能包含该正式版之后的开发改动。收到提醒不会自动执行任何构建。

改变工作流配置不会影响已启动的构建或其重试；新触发的运行使用新配置。已有运行不会自动取消。

## 定制版应用内更新

定制 CI 覆盖配置内置本 fork 的更新公钥与固定端点，不使用上游更新公钥/地址；普通本地构建仍保留原版行为。`createUpdaterArtifacts` 保持关闭，可信控制面自行打包 macOS `.app.tar.gz`，在独立 Ubuntu 签名任务对 Windows NSIS 和 macOS 更新归档执行固定版本 Tauri CLI 签名，并通过 minisign 验证。编译任务不接触桌面/Android 私钥。Tauri `.sig` 是 Base64 包装的 minisign 文本，验证时需先解码；客户端清单使用原 `.sig` 内容。

在 `custom-release` 环境新增 Environment Secrets：

| 名称 | 内容 |
| --- | --- |
| `RELEASE_UPDATER_PRIVATE_KEY` | 固定 Tauri 更新私钥文件的完整文本，不是 Android keystore |
| `RELEASE_UPDATER_KEY_PASSWORD` | 该更新私钥的密码 |

公钥位于 `scripts/custom-release/updater-public-key.txt`，可以公开提交。私钥已在本机仓库外 `~/.config/notegen-signing/notegen-updater.key` 生成，密码存 macOS 钥匙串 **NoteGen updater signing password**（service `com.thefbplus.notegen.updater`、account `notegen-custom-updater`），两个 Secrets 已按用户确认配置。请备份固定私钥和密码；替换公钥需要安排旧版迁移，不可每次构建重新生成。

发布顺序：三平台与签名全部成功 → 草稿上传并校验所有文件 → 公开定制 Prerelease → 独立 `promote-channel` 任务将完整清单写入 `codex/custom-update-channel` 分支的 `latest.json`。更新渠道分支不是源码构建来源，不改变功能分支；文件通过 raw.githubusercontent.com 固定 HTTPS 地址读取，不依赖 `/releases/latest`。

- 渠道一次写入 Windows、macOS、Android 全部信息，下载 URL 固定到本次 Release。不完整/草稿 Release 不推进渠道；版本和 Android versionCode 必须递增，默认禁止降级。
- 渠道写入失败时包可能已发布，应用仍看旧渠道；Actions 报错并保留包 Artifact。使用 **Re-run failed jobs** 重试独立的 `promote-channel`，不重新发布包。成功后才清理重复 Artifact 和关闭故障 Issue。
- 应用启动和设置页可检查更新；无渠道（404）视为暂无更新，网络/清单错误显示错误。检查失败不访问官方渠道。可以忽略版本和恢复提醒，设置独立保存。
- 桌面下载后验证更新签名，刷盘保存当前笔记及待保存队列，再安装并重启。下载/安装期间主窗口显示阻止编辑的进度对话框；有独立编辑窗口时要求先关闭。Windows 只支持当前定制 NSIS x64 安装，不回退到 MSI。macOS 更新文件为 `.app.tar.gz`，不是 DMG。
- Android 的“我的”页始终显示定制更新卡片，发现新版本后打开该版本的具体 APK 链接，由系统确认安装，不静默安装、不新增安装权限。必须复用既有固定 Android 签名。
- 尚未接入 iOS/Linux 或其他架构；未做 Apple 公证/Windows 发行者签名，Tauri 更新签名不能替代这两种系统信任。macOS 安装位置权限、更新后启动，以及 Windows/Android 覆盖更新需实机验收。
- 已安装的旧版（例如 `0.39.1-custom.2`）没有此功能，需先手动安装一次本实现生成的新包。之后再用一个更高版本验证完整的应用内升级链路。手动构建仍是唯一打包入口，上游 Release 提醒不会自动构建或安装。

## 失败与恢复

失败时 Actions 显示红色结果，并创建/更新固定标题 Issue：`[Custom dev builds] Update requires attention`。第一次创建时明确提及通知账号；之后每次新运行失败用带提及的评论通知，并更新正文故障摘要。报告含运行链接、失败阶段和冲突文件。

三平台发布及应用更新渠道推进全部成功后，创建/复用 `[Custom dev builds] Successful releases` Issue；后续成功追加评论，含版本、Release 下载入口、运行链接并提及通知账号，同时关闭未解决的故障 Issue。成功日志被手动关闭后仍复用该 Issue，通过评论提醒，不反复新建。

- 通知账号默认是仓库所有者（本 fork 为 `@TheFBplus`）；可在 Repository Variables 中设置单个 `CUSTOM_NOTIFICATION_USER`。无需邮箱凭据。
- 通过 GitHub 的“参与、@mentions 和自定义”通知发信；账号需在该项开启 Email。创建 Issue 或发评论成功不等于邮件已送达，仍受 GitHub 投递、垃圾邮件过滤及个人设置影响。Actions 的“仅失败通知”可以继续保留；失败时可能同时收到 Actions 和提及两类邮件。
- 无新版本、首次建立发布基线、源码未变化而跳过构建时不新增提醒。同一运行 ID 的同类结果去重；失败后重跑成功会另发成功提醒。历史已处理的上游 Release 不补发通知。
- 如果 Issues 或写权限被禁用，报告会失败，Actions 原生状态和日志仍保留；恢复权限后重跑失败的 report 任务即可，通知去重会避免同一结果重复提及。

处理方式：

- 合并冲突：本地在功能分支正常合并上游，解决冲突并验证后推送，再运行工作流。不能通过强制覆盖一方解决。
- 测试/编译失败：查看对应任务日志，修复源码或构建环境，再重跑。
- 缺少/错误签名：修正 Secrets 后重跑，不能替换成临时密钥。
- 上传失败：Release 保持草稿，下一轮会清理本流程同标签的未完成草稿后重新发布；已公开版本和不属于草稿的现存标签不会被覆盖。

## 本地验证

```bash
python3 scripts/custom-release/test_pipeline.py
python3 scripts/custom-release/test_desktop_updates.py
python3 scripts/custom-release/test_watch_upstream.py
node scripts/custom-release/test-update-channel.mjs
COREPACK_ENABLE_AUTO_PIN=0 pnpm exec tsc --noEmit --incremental false
COREPACK_ENABLE_AUTO_PIN=0 pnpm exec eslint src/lib/custom-build.ts src/extensions/custom-updates src/stores/update.ts src/app/core/setting/about/updater.tsx
NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD=1 COREPACK_ENABLE_AUTO_PIN=0 pnpm build
```

Git 测试仅使用临时本地仓库，覆盖成功合并、冲突中止、不重复发布、固定来源、架构检查、三平台产物门槛、草稿发布、私钥清理和通知复用，不访问远端仓库。工作流还需使用 actionlint 验证语法与依赖关系。

本地验证不等于云端三平台首次构建成功；正式启用后仍须查看每个平台的首轮日志和实际安装结果。

2026-10-30 本地验证：actionlint、17 项控制面回归、更新渠道回归、类型检查、相关 ESLint 和定制模式前端生产构建通过。Android 图标生成命令也已实际验证。首次云端三平台构建仍待 Android 签名 Secrets 配置完成后执行。

GitHub 启用状态（2026-10-30）：配置已推送，默认分支已切换为 `codex/html-embed`，Issues 已开启，`Custom dev packages` 工作流有可用的 Run workflow 入口。Android 签名 Secrets 已于 2026-10-30 配置，首次运行已启动。

本机签名状态（2026-10-30）：固定密钥为 `~/.config/notegen-signing/notegen-custom.p12`，密码存于 macOS 钥匙串的 **NoteGen Android signing password**（service: `com.thefbplus.notegen.android-release`，account: `notegen-custom`）。没有创建明文密码文件；公共证书与指纹记录在同目录的 `certificate-info.json`。备份时应保留密钥和密码，不要把它们加入仓库。

首次云端运行：https://github.com/TheFBplus/note-gen/actions/runs/41078996240 。启动后 prepare 和 credentials 成功，后续测试/编译/签名结果以该运行页面为准。

### 扩展接入维护（2026-11-03）

定制更新文案位于 `src/extensions/locales/`，由根布局扩展 Provider 补齐，不再写入上游 messages 字典。`src/extensions/custom-updates/host.ts` 订阅定制 store，将桌面/Android 提醒及忽略状态映射到宿主字段；手机个人面板使用上游原有判断，更新卡片只操作定制 store。普通构建不会连接适配器，官方更新渠道隔离仍由宿主更新入口保留。`test-update-channel.mjs` 覆盖无面板挂载时的提醒同步及忽略/恢复。

### 定制更新代理与离线版本显示（2026-11-03）

更新模块复用常规设置的 `systemProxy` / `proxy`：系统模式忽略残留手动地址，让新原生客户端发现 OS/环境代理；手动模式将同一规范化 HTTP/HTTPS/SOCKS5 地址同时传给清单请求与桌面 updater。未填写手动地址时沿用原生客户端默认行为，不把空值伪装成明确禁用系统代理。模型专属代理不影响更新。

Tauri Update 原生资源保存检查时的代理，后续下载沿用它；如果用户在检查后改变代理，安装入口会重新检查相同的已展示版本并替换资源，版本发生变化则中止，要求重新检查。Android 的清单请求使用应用代理；APK 仍交给外部浏览器下载，应用无法替浏览器配置代理。

本地版本在 `getVersion()` 成功后立即显示，不再依赖联网完成；请求失败保留版本，显示可重试的中英文网络提示，无效代理不回退为直连，不放宽 HTTPS 或固定公钥验证。系统模式仍要求设备配置原生客户端可发现的代理；浏览器扩展/浏览器专用 VPN 不会自动变成设备代理，Android 的支持也依赖平台。可使用 VPN 提供的应用可访问手动代理地址或覆盖 NoteGen 的设备隧道。

回归覆盖网络挂起/失败时版本显示、系统模式忽略旧地址、手动 HTTP/HTTPS/SOCKS 传递、检查后切换代理、渠道变化拒绝下载、无效代理、原生检查/下载错误、签名失败不重启及 Android 不调用桌面 updater。模拟边界不能代替 Windows/Android 实际代理与跨版本安装验收。
