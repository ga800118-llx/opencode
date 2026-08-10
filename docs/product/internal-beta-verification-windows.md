# Guai Code Beta 0.1.0-alpha.2 Windows 验证记录

验证日期：2026-08-10

## 源码基线与运行环境

- 分支：`codex/phase-0-3`
- 可执行文件源码提交：`c6b8abbe81cb4d0b9cbb53a16a4fc1ba90bbe300`
- 成功运行：[GitHub Actions 31366877286](https://github.com/ga800118-llx/opencode/actions/runs/31366877286)
- 计划的附注标签：`v0.1.0-alpha.2`。控制器将在本次文档提交后创建该标签，并令其直接指向上述源码提交；本次文档提交更晚，不参与可执行文件构建。
- Runner：Microsoft Windows NT 10.0.26100.0，AMD64/x64；镜像 `win25-vs2026`，版本 `20260803.193.1`。
- PowerShell：7.6.4 Core；Windows PowerShell 5.1 与 PowerShell 7 语法解析门禁均通过。

交付目录：`packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-x64/`

证据目录：`packages/desktop/dist/internal-beta/0.1.0-alpha.2/windows-smoke-evidence/`

证据仅包含经过严格字段白名单投影的 JSON，不包含原始日志或绝对路径。两份启动日志仅复制到凭据扫描输入中，不作为原始证据交付。

## 交付文件

| 文件 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `Guai-Code-Beta-0.1.0-alpha.2-win-x64.exe` | 160414064 | `60bfd2ecb8a9cbc200610bd710ed48c509650da503f28af68b50fd2dc7970416` |
| `Guai-Code-Beta-0.1.0-alpha.2-win-x64-portable.zip` | 228373710 | `d6d9a81f7cffce61ca6ab301db3c8f36411e07705b3da01d7168c9b1530748b1` |
| `Guai-Code-Beta-Windows-试用说明.md` | 6057 | `157bf9e05e67538babef544955a2069611959382a0a43dd8dfc4781cf9ef150c` |
| `OpenCode-MIT-License.txt` | 1086 | `b5c625d157735f04e1b2b7ceccee849130b554bdb23cd58db55a38a257efbbdd` |
| `Git-for-Windows-License.txt` | 19125 | `454649ddc02b5cc098513cea28db6592b45ac0a906386287c4d48cf8dbde651c` |
| `SHA256SUMS.txt` | 513 | `95c1e97870d87e0eea68b76445d42df6fef941a1b2890617e9b8b1fefbc6cb08` |

`SHA256SUMS.txt` 只列出前五个交付载荷，不列出清单自身。本地清单校验五个载荷全部通过，便携 ZIP 通过完整 `unzip -t`。GitHub artifact 外层 ZIP 的精确大小为 388065332 字节；精确并行分段重组后通过 `unzip -t`。

## 安装包与内置运行时

- Authenticode 状态：`NotSigned`。
- 产品名：`Guai Code Beta`；`fileVersion` 为 `0.1.0-alpha.2`，`productVersion` 为 `0.1.0.0`。
- PE 架构：x64，machine `0x8664`。
- 静默、按用户、自定义目录安装退出码为 0，不需要管理员权限。
- 内置 Git：`git version 2.55.0.windows.3`。
- 固定来源：`MinGit-2.55.0.3-64-bit.zip`，38791206 字节，SHA-256 `f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05`。
- 安装器和便携包均自带运行所需的 Git；测试者不需要系统 Git、Bun 或 Node.js。

## 启动、重启与清理

- 首次启动在 3596 ms 就绪，重启在 3133 ms 就绪；两次均在就绪时确认进程存活，并记录内置 Git 已启用和服务已进入 `server ready`。
- 模型 Profile 数量为 0，未持久化模型状态。
- 两次运行日志均已复制供凭据扫描；停止方式为 `Stop-Process`。
- 静默卸载退出码为 0，耗时 1606 ms，安装目录已删除。

## 原生凭据加密

Electron 42.3.3 的 `safeStorage` 在 Windows 上确认使用 DPAPI 且加密可用。加密和解密由两个独立进程完成，已证明进程属于同一用户，并实际使用相同的 `userData` 与 `sessionData` 路径。`Local State` 存在、JSON 有效且包含加密密钥；密文为 115 字节，明文哈希往返一致。证据同时确认 `plaintextPersisted: false` 与 `ciphertextDeleted: true`。

## 凭据扫描

凭据扫描器自测及实际扫描均通过，覆盖 `win-unpacked`、交付目录和 smoke 证据。下载后又在本地扫描安装器、便携 ZIP 和证据，未发现 `phase2-api-key-canary`、`phase2-header-canary`、`sk-test-secret` 或 `Bearer secret-header`。

## 自动化回归

| 检查 | 结果 |
| --- | --- |
| Desktop Windows 全量测试 | 223 pass，0 fail，45 个文件；本地复跑 223 pass，0 fail |
| App Windows 全量单元测试 | 1046 pass，4 skip，0 fail；共 1050 项、138 个文件 |
| OpenCode 权限、会话和 HTTP 聚焦测试 | 本地 133 pass，0 fail，4 个文件 |
| Desktop、App、OpenCode 类型检查 | 全部通过 |
| pre-push 依赖包类型检查 | 30/30 通过 |

## 结论与限制

该版本已达到少量可信朋友在 Windows 11 x64 上内部试用的条件；安装器和便携包在 Git、Bun、Node.js 方面均为自包含交付。本结论基于上述自动化安装、启动、加密、扫描和回归证据，不表示已经完成朋友级手工 UI 试用。

安装器未签名，会触发 SmartScreen；仅可信内部测试者在核对 SHA-256 后使用。验证范围不包括 Windows 10 或 ARM64，也不包含自动更新或公开发布。项目目前没有开发者代码签名账号。
