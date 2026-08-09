# Guai Code Beta 0.1.0-alpha.1 验收记录

验收日期：2026-08-10

## 源码基线

- 分支：`codex/phase-0-3`
- 可执行文件源码提交：`9028a128af6d3fbd0d411052d6fea96fed33ed24`
- 标签：`v0.1.0-alpha.1`
- 标签直接指向上述源码提交；本文件是打包完成后追加的验收记录，不参与可执行文件构建。

## 交付文件

目录：`packages/desktop/dist/internal-beta/0.1.0-alpha.1/`

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.dmg` | 154282269 | `baa72302ea9cf9c730ae94920b9b8d0af02a32ad0b5c9a3d34ecaaf3acc24d85` |
| `Guai-Code-Beta-0.1.0-alpha.1-mac-arm64.zip` | 153665962 | `0f344b3b935229666f5577a30cc8f161a593b9689e67966c6a94e1db106d41c1` |
| `Guai-Code-Beta-试用说明.md` | 2538 | `8fc9d6d79b5a4c1c3d661100f89176f454eeeb2a38dd17c8c254c2aa4970b0ff` |
| `OpenCode-MIT-License.txt` | 1065 | `625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b` |

`shasum -a 256 -c SHA256SUMS.txt` 在交付目录内验证四个文件全部通过。

## 自动化回归

| 检查 | 结果 |
| --- | --- |
| App 全量单元测试 | 1050 pass，0 fail |
| Desktop 全量测试 | 190 pass，0 fail |
| OpenCode 权限、会话和 HTTP 聚焦测试 | 112 pass，0 fail |
| 内测打包脚本测试 | 3 pass，0 fail |
| Schema、Core、Protocol、Server、Client、SDK、OpenCode、App、UI、Session UI、Desktop 类型检查 | 全部通过 |

HTTP 测试曾在与十个类型检查并行运行时发生一次 5 秒超时；无并发复跑对应文件时 21 项全部通过。

## 安装包验证

- 产品名：`Guai Code Beta`
- Bundle ID：`com.guaicode.desktop.beta`
- URL Scheme：`guai-code-beta`
- 版本：`0.1.0-alpha.1`
- 架构：原生 Apple Silicon `arm64`
- 最低系统版本：macOS 12.0
- 签名：完整 ad-hoc hardened runtime 签名；`codesign --verify --deep --strict` 通过
- 公证：未公证；`spctl` 按预期拒绝，因此首次启动必须按试用说明在“隐私与安全性”中选择“仍要打开”
- DMG：`hdiutil verify` 通过，并已实际挂载、复制应用和卸载
- ZIP：`unzip -t` 全部通过
- 开源许可：应用内部与交付目录中的 MIT License 哈希一致
- 更新隔离：Beta 无发布地址，产品策略测试确认 Beta 自动更新始终关闭
- 凭据扫描：应用与交付目录均未发现真实测试 Key、`fixture-secret` 或私有请求头明文

## 干净配置启动

从 DMG 复制出的应用使用独立的临时 `HOME`、Electron `user-data-dir` 以及 XDG data/config/cache/state 目录启动，未读取开发者日常配置。

- 首次启动成功，嵌入式服务进入 `server ready`。
- 关闭后使用同一隔离配置再次启动，嵌入式服务再次进入 `server ready`。
- `agent.model-profiles` 中没有模型 Profile，只生成运行时所需的本机凭据代理端口。
- 首次启动状态、窗口 ID 和迁移标记在第二次启动时被正确识别。
- 本机当时处于锁屏状态，macOS 拒绝 Computer Use，Electron CDP 端点也不响应，因此无法在该轮通过 Agent Browser 点击完成模型发现、首条回复和页面截图。
- 模型错误提示、发现、保存、默认模型、凭据加密、能力检测、权限模式、简洁/高级切换、运行位置和过程折叠由上述 Desktop、App 与 OpenCode 自动化回归覆盖；锁屏下未重复执行安装包级可视化操作。

## 结论与限制

该版本已达到少量可信朋友的 Apple Silicon Mac 内部试用条件。主要剩余风险是未使用 Apple Developer ID 签名和公证，以及本轮锁屏导致安装包级 UI 自动化未执行。对外公开发布、自动更新、Intel Mac 和 Windows 安装包不在本版本范围内。
