# extension —— 对 core 的扩展补充

> 机制在 core（ToolCapability / 策略契约 / 三态 / drain）；**内容与领域能力**在 extension。  
> shell 管「人怎么用」；extension 管「系统多会什么」。

## 目录与 `.stem/` 用户面同构

| extension | 用户空间 | 内容 |
|---|---|---|
| `agent/` | `.stem/agent/` | agent 类 |
| `strategy/` | `.stem/strategy/` | 上下文（记忆）策略 |
| `tools/` | `.stem/tools/` | 工具 |
| `skills/`（内容） | `.stem/skills/` | 技能正文 `SKILL.md` |

装载器按**同一套目录真相**发现：extension 随仓库/镜像分发，custom 由用户空间写入；boot 发现段一次读入，运行期不热扫。

## 装载规则

- **extension 必须点名**（`stem.jsonc → extensions.tools|agent|strategy`）：未点名 = 不装载，实现按需启动与系统裁剪。
- **custom 不点名**：`.stem/tools|agent|strategy/` 目录扫描；工具读入默认 `hidden`。
- `registerAccess` 随点名注入；custom 读入恒 `hidden`。

## 当前内容

| 路径 | 说明 |
|---|---|
| `tools/read.ts` | 读文本文件 |
| `tools/fs.ts` | write / edit（唯一匹配）/ grep（正则）/ glob |
| `tools/bash.ts` | 跑命令（宿主 ShellRunner） |
| `tools/skill.ts` | 渐进披露：列技能 / 读 `SKILL.md` 正文 |
| `tools/web.ts` | webfetch / websearch |
| `tools/mcp.ts` | MCP 客户端：`.stem/mcp.jsonc` 投影远程工具并转发 |
| `strategy/` | cortex 等扩展策略 |
| `agent/` | 扩展类位 |

`tools/index.ts` 为唯一出口。
