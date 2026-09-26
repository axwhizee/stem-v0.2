# stem

> **S**elf-**T**raining **E**volutionary **M**atrix —— 自我训练·进化·矩阵。  
> 以原子化 Agent 类 + 实例构成平等生态；族谱树承载拓扑与属性；用户以扮演 `user#0` 参与。

---

## 这是什么

stem 是**用户主权的 Agent 运行时**：没有写死角色，一切来自你定义的类与实例；实例在族谱上协作；每个实例可挂**记忆（上下文）策略**决定消息如何整理与外挂。core 纯逻辑、零平台依赖，平台能力经端口注入；一进程一 **stem 空间**（`.stem/`）。

## 特征速览

| | |
|---|---|
| 平等 agent 生态 | 含根同一套机制；差异只来自族谱位置与属性表 |
| 统一 Message | 上下文原子通货；合法性内生于对象 |
| 微内核 + 服务 | kernel 只做调度/仲裁；语料·上下文·工具·网关独立 |
| 记忆策略 | classic / cortex / none… 可扩展 |
| 工具三层 | internal / extension / custom |
| stem 空间 | 配置 + 类/策略/工具/私有目录；SQLite 持久 |

机制与模型 → `docs/architecture.md`。接口全量 → `docs/api.md`。

## 快速上手

```bash
npm install
npm run shell                      # CLI：cwd 即空间
npm run web                        # WebUI
npm run dashboard -- [path]        # 只读仪表盘
npm test && npm run typecheck
```

真实模型：在 `.stem/stem.jsonc` 配置 `providers`，密钥只经 env。  
部署（源码 / Docker / 发布形态）→ `deploy/`。

## 文档指南

| 想了解 | 去哪 |
|---|---|
| 系统设计（概念 / 关键模型 / 分层） | `docs/architecture.md` |
| 某模块怎么落实设计 | 该模块 `README.md` |
| 对外接口与装配/文件契约 | `docs/api.md` |
| 场景与能力压力 | `docs/scenarios.md` |
| 怎么开发（纪律 / 测试 / 提交） | `docs/contributor.md` |
| agent 实操 | `AGENTS.md` |

## 环境

- Node ≥ 23.4（`node:sqlite`）
- LLM：OpenAI 兼容端点；密钥只走 env
