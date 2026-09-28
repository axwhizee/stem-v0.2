# extension/strategy —— 扩展记忆策略

> 目录与用户空间 `.stem/strategy/` 同构。  
> **cortex 等非内置策略住这里**；core 内置仅 classic / none。  
> 参数来自 `stem.jsonc → extensions.strategy.<名>`（点名装载；如 cortex 的 `dreamAt/note/stmMax/ltmMax/recentChars`）。

## cortex 笔记假 tool 槽（关键实现细节）

投影时把**笔记目录**做成假工具调用，满足：

| 要求 | 做法 |
|---|---|
| 位置 | 插在「最新 userPrompt 的前驱 assistant」**之前** |
| 只保留一份 | `spliceNoteSlot` 先剥掉历史 `cortex_notes` 槽，再原地再生 |
| 实时更新 | 每次 `orchestrate` 重读 `home/<id>/*.md` 目录 |
| 缓存友好 | 槽位固定在尾段（最新 user 前），call id 稳定；只变 tool 正文，少 churn 前缀 |

### 形状

```text
… → user_prev → assistant{toolCalls:[cortex_notes]} → tool{目录文本}
      → assistant_real → user_latest
```

边界：

- 起始不得是 assistant：若插入点落在头部，改挂到首个 user 之后。  
- `tool` 不得直接接 `user`：后继是 user 时补一条空 `assistant` 收束。  
- 假槽**只在投影里**，不写语料库。

固定名：`NOTES_CALL_ID = 'cortex_notes'`，`NOTES_TOOL_NAME = 'cortex_note_dir'`。

## 三槽投影

| 槽 | 来源 |
|---|---|
| LTM | dream 段2（system 文本前缀） |
| STM | dream 段1 |
| 上下文 | 有效语料 + 假 tool 笔记目录 |

## ownedTools

`cortex_add_note` / `cortex_del_note`（默认 hidden；写 `home/<agentId>/`，路径夹紧）。

## dream

水位 `ctxTokens ≥ dreamAt` 且无在途梦 → `complete` 两段 → 更新 LTM/STM → 重投影。无 dreamer 实例。
