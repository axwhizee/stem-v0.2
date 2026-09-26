# extension/agent —— 扩展 agent 类

> 目录与用户空间 `.stem/agent/` 同构：类定义（Markdown frontmatter 或模块）住这里，由 boot 发现段读入。  
> 与 custom 类同一契约；差异只在仓库扩展 vs 用户空间。

## 形状（类真相）

```text
name / description / sysPrompt
tools / contextStrategy / model / sendCountdown / temperature / effort / maxSteps
```

收敛见 `src/core/model` AttributeTable。运行期创建的 custom 类可写回 `.stem/agent/`；extension 类随仓库分发。
