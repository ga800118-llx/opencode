# Guai Code Beta 0.1.0-alpha.2 Windows 验证记录

验证日期：2026-08-10

## 源码基线与运行环境

- 分支：`codex/phase-0-3`
- 可执行文件源码提交：`d2880064ce62162f4bc22ee22f6919887350a901`
- 成功运行：[GitHub Actions 31377997106](https://github.com/ga800118-llx/opencode/actions/runs/31377997106)
- 附注标签：`v0.1.0-alpha.2` 已剥离到上述可执行文件源码提交；后续文档提交不参与可执行文件构建。
- Runner：Microsoft Windows Server 2025 Datacenter（Microsoft Windows NT 10.0.26100.0），AMD64/x64；镜像 `win25-vs2026`，版本 `20260803.193.1`。
- PowerShell：7.6.4 Core；Windows PowerShell 5.1 与 PowerShell 7 语法解析门禁均通过。

交付目录：`packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-x64/`

证据目录：`packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-smoke-evidence/`

证据仅包含经过严格字段白名单投影的 JSON，不包含原始日志或绝对路径。两份启动日志仅复制到凭据扫描输入中，不作为原始证据交付。

本记录中的自动化打包、安装、DPAPI、内置 Git、重启和卸载证据均来自上述 Windows Server 2025 x64 Runner，不等同于 Windows 11 x64 实机验证。

## 交付文件

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `Guai-Code-Beta-0.1.0-alpha.2-win-x64.exe` | 160414487 | `6bbfbfab28fc695f3fad8b1d8719d38bdad472bd9ecfc2b054f54fa18ca41d39` |
| `Guai-Code-Beta-0.1.0-alpha.2-win-x64-portable.zip` | 228373702 | `02362d3f87e42e4b5062ddf5b6be52d0ad3692eff2d03557c62a021905cadcfe` |
| `Guai-Code-Beta-Windows-试用说明.md` | 6707 | `1ce2049908985f80080977fb9bf06fc51c738135592266e3e8df5c6bcdbf1103` |
| `OpenCode-MIT-License.txt` | 1086 | `b5c625d157735f04e1b2b7ceccee849130b554bdb23cd58db55a38a257efbbdd` |
| `Git-for-Windows-License.txt` | 19125 | `454649ddc02b5cc098513cea28db6592b45ac0a906386287c4d48cf8dbde651c` |
| `SHA256SUMS.txt` | 513 | `ab7545079a1f9a87bb19a233c248c075b0a28d4af13dbed1d9be080326fc720c` |

`SHA256SUMS.txt` 只列出前五个交付载荷，不列出清单自身。本地修正后清单校验五个载荷全部通过，便携 ZIP 通过完整 `unzip -t`。GitHub artifact 外层 ZIP 的精确大小为 388066331 字节；精确并行分段重组后通过 `unzip -t`。

## 安装包与内置运行时

- Authenticode 状态：`NotSigned`。
- 产品名：`Guai Code Beta`；`fileVersion` 为 `0.1.0-alpha.2`，`productVersion` 为 `0.1.0.0`。
- PE 架构：x64，machine `0x8664`。
- 静默、按用户、自定义目录安装退出码为 0，不需要管理员权限。
- 内置 Git：`git version 2.55.0.windows.3`。
- 固定来源：`MinGit-2.55.0.3-64-bit.zip`，38791206 字节，SHA-256 `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`。
- 安装器和便携包均自带运行所需的 Git；测试者不需要系统 Git、Bun、Node.js 或管理员权限。

## 启动、重启与清理

- 首次启动在 3716 ms 就绪，重启在 3144 ms 就绪；两次均在就绪时确认进程存活，并记录内置 Git 已启用和服务已进入 `server ready`。
- 模型 Profile 数量为 0，未持久化模型状态。
- 两次运行日志均已复制供凭据扫描；停止方式为 `Stop-Process`。
- 静默卸载退出码为 0，耗时 1604 ms，安装目录已删除。

## 原生凭据加密

Electron 42.3.3 的 `safeStorage` 在 Windows 上确认使用 DPAPI 且加密可用。加密和解密由两个独立进程完成，已证明进程属于同一用户，并实际使用相同的 `userData` 与 `sessionData` 路径。`Local State` 存在、JSON 有效且包含加密密钥；明文 SHA-256 为 `4be9c4a14868af95301e05ee190261168818edabb4618ea492577536e2c6c2f8`，115 字节密文的 SHA-256 为 `1aed9b8485782d67b16574e88fdb271c6b617dd3cf2c3faadb4b464098559a14`，明文哈希往返一致。证据同时确认 `plaintextPersisted: false` 与 `ciphertextDeleted: true`。

## 凭据扫描

凭据扫描器自测及实际扫描均通过，覆盖 `win-unpacked`、交付目录和 smoke 证据。下载后又在本地扫描安装器、便携 ZIP 和证据，未发现 `phase2-api-key-canary`、`phase2-header-canary`、`sk-test-secret` 或 `Bearer secret-header`。

## 自动化回归

| 检查 | 结果 |
| --- | --- |
| Desktop Windows 全量测试 | CI 224 pass，0 fail；本地复跑 224 pass，0 fail |
| App Windows 全量单元测试 | 1046 pass，4 skip，0 fail；共 1050 项、138 个文件 |
| OpenCode 权限、会话和 HTTP 聚焦测试 | 本地 133 pass，0 fail，4 个文件 |
| Core URL Skill 发现聚焦测试 | 本地 10 pass，0 fail；Node-target bundle 在系统 Node 下执行生产缓存键辅助函数，固定 SHA-1 `f145b299db43ea48dd1f04fc25254d1df422a858`，确认不依赖 Bun 全局对象；未声明 Core 全量测试通过 |
| Desktop、App、OpenCode 类型检查 | 全部通过 |
| pre-push 依赖包类型检查 | 30/30 通过 |

## 结论与限制

该版本已准备交给少量可信 Windows 11 x64 测试者开展首次真实机器测试；朋友不需要预装 Git、Bun、Node.js，也不需要管理员权限。当前自动化证据来自 Windows Server 2025，Windows 11 x64 实机验证仍待完成，不能表述为已完成 Windows 11 x64 验证。

安装器未签名；是否出现 SmartScreen 取决于文件信誉、下载来源和系统策略，预计可能触发拦截，且受管策略下“仍要运行”（`Run anyway`）可能不可用。便携 ZIP 仅验证了结构和完整性，未启动便携 UI；内置 Git 仅以 `--version` 验证，未执行仓库工作流；原生 Windows 凭据选择器 UI 未实际操作。仅可信内部测试者在核对 SHA-256 后使用。验证范围不包括 Windows 10 或 ARM64，也不包含自动更新或公开发布。项目目前没有开发者代码签名账号。
