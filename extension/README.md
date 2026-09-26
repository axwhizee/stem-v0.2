# extension —— 对 core 的扩展补充

> 机制在 core（ToolCapability / 策略契约 / 三态 / drain）；**内容与领域能力**在 extension。  
> shell 管「人怎么用」；extension 管「系统多会什么」。

## 目录与 `.stem/` 用户面同构

| extension | 用户空间 | 内容 |
|---|---|---|
| `agent/` | `.stem/agent/` | agent 类 |
| `strategy/` | `.stem/strategy/` | 上下文（记忆）策略 |
| `tools/` | `.stem/tools/` | 工具 |
| `skills/`（可选） | `.stem/skills/` | 技能正文 |

装载器按**同一套目录真相**发现：extension 随仓库/镜像分发，custom 由用户空间写入；boot 发现段一次读入，运行期不热扫。

## 当前内容

| 路径 | 说明 |
|---|---|
| `tools/read.ts` | 读文本文件 |
| `tools/bash.ts` | 跑命令（宿主 ShellRunner） |
| `strategy/` | 扩展策略位（cortex 等） |
| `agent/` | 扩展类位 |

## 装载

`config.extensions.tools` 点名或目录扫描 → 无序清单 → `registry.drain`。  
`registerAccess` 随点名注入；custom 读入恒 `hidden`。
