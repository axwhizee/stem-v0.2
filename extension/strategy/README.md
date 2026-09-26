# extension/strategy —— 扩展记忆策略

> 目录与用户空间 `.stem/strategy/` 同构。  
> **cortex 等非内置策略住这里**（architecture 3.6.1：internal=classic/none，extension=本目录，custom=`.stem/strategy/`）。  
> core 只保留最小内置；有成长性的策略作为对 core 的扩展补充。

## 计划中的 cortex

| 槽 | 内容 | 谁写 |
|---|---|---|
| LTM | 跨任务精炼条目 | dream 段2 |
| STM | 当前工作台 | dream 段1 |
| 上下文 | 对话投影 + 笔记清单 | 对话流 + 目录再生 |
| 笔记 | `home/<id>/` 主题文件 | ownedTools |

两段 dream、水位触发、无 dreamer 实例；整理经 ToolAgent `complete`。实现时导出 `createCortexStrategy()`，boot/策略注册表装配。
