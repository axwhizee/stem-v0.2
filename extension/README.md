# extension —— 对 core 的扩展补充

> 机制在 core（ToolCapability / 三态 / drain）；**内容与领域能力**在 extension。  
> 与 custom（`.stem/tools/`）同契约；shell 不在此列（shell 是面向用户的延伸）。

## 职责

| 例子 | 说明 |
|---|---|
| `read` / `write` / `grep` | 文件操作面 |
| `bash` | 对外执行（宿主注入 ShellRunner） |
| `skill` | 渐进披露的知识/流程工具 |
| `mcp` | 外部工具服务器投影 |

## 装载

boot 发现段（后续 loader）按 `config.extensions.tools` 点名或目录扫描进无序清单 → `registry.drain`。  
`registerAccess` 随点名注入；custom 读入恒 `hidden`。

## 当前文件

| 文件 | 工具 |
|---|---|
| `tools/read.ts` | 读文本文件 |
| `tools/bash.ts` | 跑命令（需宿主 ShellRunner） |
