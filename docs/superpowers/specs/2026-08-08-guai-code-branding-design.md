# Guai Code 用户可见品牌替换

## 目标

将交付给用户的产品名称从 `OpenCode` 或 `Open Code` 改为 `Guai Code`，使应用界面、产品文档和 README 将当前产品称为 Guai Code。

## 文本分类

### 当前产品称呼：替换

所有自然语言中指向当前应用的名称替换为 `Guai Code`。范围包括：

- 桌面应用标题、菜单、设置、WSL 引导和提示。
- App 与 Desktop 的全部本地化文本。
- Web 页面、Web 文档和 README 中描述当前产品能力、安装桌面应用、配置当前产品或使用当前产品的句子。
- 安全说明中指向当前产品行为的自然语言。

示例：`Change OpenCode language` 改为 `Change Guai Code language`；`OpenCode provides...` 改为 `Guai Code provides...`。

### 上游归属：保留并明确

仅在描述来源、许可证、版权、兼容性或原始项目时保留 `OpenCode`。此类内容应清楚表述为上游项目，例如 `Guai Code is based on OpenCode` 或 `Original project: OpenCode`。

### 技术标识和外部目标：不替换

以下内容保持不变，以免破坏既有运行、分发或外部集成：

- URL、域名和外部链接，例如 `opencode.ai`、`api.opencode.ai`、`github.com/anomalyco/opencode`。
- 可执行命令、包名、文件名和路径，例如 `opencode`、`opencode-ai`、`.opencode`、`opencode.json`。
- 环境变量、请求头、存储键、应用 ID、协议和内部 TypeScript 标识，例如 `OPENCODE_*`、`x-opencode-*`、`@opencode-ai/*`、`IconOpencode`。
- 代码块、命令示例、配置示例和链接目标。其周围的说明文字仍按当前产品称呼规则替换。

## 修改策略

对用户阅读到的普通文本执行精确替换，保留技术 token 和 URL。对同时包含普通文本与技术 token 的字符串，只改普通文本部分。

不重命名文件、目录、包、CLI、环境变量、域名、内部 API 或发布身份。本次不更换图像/视频二进制资产；只处理资产所承载的可见文字和应用中引用的名称。

## 验收

- App、Desktop 和 Web 的本地化自然语言中不再将当前产品称为 OpenCode。
- README、Web 文档和 SECURITY 的自然语言使用 Guai Code；上游来源说明仍保留 OpenCode。
- 所有 `http(s)` URL、命令、代码块、配置路径、环境变量和包标识保持原样。
- 定向搜索验证残留的 `OpenCode` 均属于上游归属、URL、命令、代码/配置标识、测试夹具或内部标识。
