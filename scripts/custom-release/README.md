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
5. 按下节生成 Android 密钥并配置三个 Secrets。未配置时会在预检查明确失败，不启动耗时的三平台构建，不生成临时签名顶替固定密钥。
6. Actions → **Custom dev packages** → **Run workflow**，选择 `codex/html-embed`。首次不勾选 force。
7. 在账号通知设置中启用 Actions 失败通知，并关注仓库中的失败 Issue。

当前源码分支和仓库名称固定在工作流中；以后更名时同步修改工作流、更新渠道链接及本文。

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

进入本 fork 的 Settings → Secrets and variables → Actions，创建 Repository Secrets：

| 名称 | 内容 |
| --- | --- |
| `CUSTOM_ANDROID_KEYSTORE_BASE64` | 刚才复制的完整 Base64，不能含换行 |
| `CUSTOM_ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `CUSTOM_ANDROID_KEY_PASSWORD` | 该密钥的密码；PKCS12 通常与 keystore 相同 |

默认别名为 `notegen-custom`。如果使用别的别名，在同一页面的 Variables 创建 `CUSTOM_ANDROID_KEY_ALIAS`。使用前确认没有把 Base64 内容误放到公开 Variable。

Android 编译任务不接触私钥；单独签名任务只执行受控的自动化脚本，使用 `zipalign`、`apksigner` 并验证版本、签名和 ARM64 ABI，结束后删除临时私钥。

该签名不是官方签名，不能直接覆盖官方 Android 安装版。第一次切换至自签名版需要规划应用标识及数据迁移；不要为了安装新包直接卸载仍含重要本地数据的旧应用。后续相同签名的定制版可继续更新。

## 手动构建行为

macOS 使用 `macos-15`，显式指定 `--bundles app,dmg` 保留 `.app` 供主程序与 OCR helper 的 ARM64 架构校验；仅指定 dmg 时 Tauri 会在成功生成磁盘映像后清理中间 `.app`。最终只收集、上传和发布 DMG，不额外发布 `.app`。

- 仅通过 Actions → Custom dev packages → Run workflow 手动启动，不设定时，不监听 push、PR 或上游发布事件；失败后也不会自动定时重试。
- 每次手动运行时主动 fetch 上游 `dev`，与最新 `codex/html-embed` 合并。
- 固定本次上游提交和自定义分支提交。完全相同的一对源码已有已发布版本时跳过；force 可以重新构建。修改我们自己的源码后，需手动启动新一轮构建。
- 从功能分支创建候选合并，只把候选提交推到本次专用的 `codex/ci-build-*` 临时分支。不改写 `dev` 或 `codex/html-embed`。
- 合并冲突记录文件名并退出；无冲突后还要执行类型检查、HTML Embed 的普通/DOM/React 回归及原有代码块回归。无文本冲突不代表必然兼容。
- 检查通过后并行编译三平台。包版本使用上游三段版本加 `-custom.<run_number>`；Android versionCode 为 `1000000000 + run_number`，Mac bundleVersion 为 run_number。请保留该工作流的运行序列，换工作流/仓库时先规划 versionCode 连续性。
- 所有平台成功后，先创建草稿 Release，上传三份安装包、`build-info.json`、`SHA256SUMS.txt`，验证齐全后才公开为 Prerelease。部分失败不会发布半套包，也不覆盖已发布版本。
- Release 标签包含上游及自定义提交摘要。force 会生成新的运行标签，不覆盖已有版本。记录的来源提交对应候选代码；打包版本/更新端点覆盖配置是明确记录的构建阶段生成物。
- 发布成功后清理本轮重复的包 Artifact，并删除临时分支；来源仍可通过 Release 标签追溯。失败元数据保留 7 天，包产物最多 3 天，未签名 Android 中间包最多 1 天。

只有合并结果经你确认并合并回功能分支后，后续维护分支才会前进。本流程自动生成候选安装包，不替代源码审查。

## 每日上游正式发布提醒

独立工作流 **Upstream release reminder**（`upstream-release-watch.yml`）每天 UTC 03:17 / 北京时间 11:17 检查 `codexu/note-gen` 的 GitHub Releases，也支持 Run workflow 手动检查；仅在默认分支运行。它不检查 dev 提交，不合并、不打包、不访问 Android 密钥，也不启动构建工作流。

- 第一次成功运行只记录当前全部正式发布作为基线，不为历史版本创建 Issue。之后发现新的正式 Release ID 时，每个版本创建一个提醒 Issue，包含版本、UTC 发布时间、Release 链接和手动构建入口。排除草稿和 Prerelease；预发布转正式后会提醒。
- 去重状态保存于独立分支 `codex/upstream-release-state` 的 `upstream-release-state.json`。该分支不作为代码合并或构建来源，不回写功能分支。请不要删除状态分支；丢失后会重新建立基线。
- Issue 创建后才保存状态；如果保存失败，重试会检查已有的机器人 Issue（包括已关闭的），避免对同一 Release 再次通知。没有变化不提交状态。多次运行串行执行。
- 第一次运行完成前发布的版本都会纳入基线，因此启用后应先手动运行一次，建立基线。
- 请关注本仓库 Issues 并配置 GitHub 邮件/手机通知。提醒检查自身失败会在 Actions 显示失败，需要开启 Actions 失败通知。
- 11:17 是计划时间，GitHub 调度与 runner 排队可能延迟；公开仓库长时间无活动可能自动停用定时工作流，需要重新启用。
- 提醒对应正式 Release；手动构建仍获取运行时最新 dev，可能包含该正式版之后的开发改动。收到提醒不会自动执行任何构建。

改变工作流配置不会影响已启动的构建或其重试；新触发的运行使用新配置。已有运行不会自动取消。

## 更新与安装边界

生成的定制包设置 `NEXT_PUBLIC_NOTEGEN_CUSTOM_BUILD=1`，关闭官方桌面和手机更新检查。关于页显示定制版 Releases 入口，手机的手动下载入口也指向本 fork。普通本地开发构建没有这个标志时保持上游行为。

第一阶段手动下载和安装；不会下载官方安装包覆盖定制功能，也不会远程替换你电脑上正在运行的应用。macOS 包没有发行证书和公证，Windows 包也没有发行者签名。将来接入自动安装需要单独的定制更新清单、Tauri 更新签名和平台安装验收，本流程不生成官方 `latest.json`。

## 失败与恢复

失败时 Actions 显示红色结果，并创建/更新一个固定标题的 Issue：`[Custom dev builds] Update requires attention`。报告包含运行链接、失败阶段、合并冲突文件；重复失败更新原 Issue。成功发布后关闭该 Issue。请自行启用 GitHub 邮件/Web 通知；如果 Issues 或写权限被禁用，Issue 创建也会失败，但 Actions 原生失败状态和日志仍保留。

处理方式：

- 合并冲突：本地在功能分支正常合并上游，解决冲突并验证后推送，再运行工作流。不能通过强制覆盖一方解决。
- 测试/编译失败：查看对应任务日志，修复源码或构建环境，再重跑。
- 缺少/错误签名：修正 Secrets 后重跑，不能替换成临时密钥。
- 上传失败：Release 保持草稿，下一轮会清理本流程同标签的未完成草稿后重新发布；已公开版本和不属于草稿的现存标签不会被覆盖。

## 本地验证

```bash
python3 scripts/custom-release/test_pipeline.py
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
