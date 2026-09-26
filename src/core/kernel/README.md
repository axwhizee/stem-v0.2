# kernel —— 调度仲裁与写面

> 落实 `docs/architecture.md` 3.1.3 / 3.1.1 写面 / 3.8 依赖方向。  
> kernel 是微内核：**只做**实例/类仲裁与运行期写裁决。它不拥有邮局内部态、不实现工具、不跑策略。

---

## 1. 职责边界

| 做 | 不做 |
|---|---|
| 类注册与基因校验 | 拼上下文快照 |
| 实例化收敛链 + 族谱登记 + 首信 | 执行工具 |
| `updateAgent` 唯一写面 | 直接 fetch 模型 |
| terminate / interrupt / setStatus | 持有合并窗口 |

状态单主人：拓扑与能力在 `LineageTree`；语料在 `PostOffice`；工具表在 `ToolCapabilityRegistry`。kernel **编排**它们。

---

## 2. 实例化流程

```text
instantiate({ className, userPrompt, parentId?, name?, incoming?, raise? })
  ① 类解析（classOf）
  ② 属性收敛：
       根     rootEffective(genes) → applyInstance
       普通   inherit(parent) → applyClass → applyInstance
  ③ 族谱登记 lineage.attach（能力物化）
  ④ name 占用登记
  ⑤ 首信 deliverFirst → 管道（userPrompt 不落属性表）
```

- `parentId: null` = 建根（boot 用）。
- id 发号：`lineage.nextChildID`，路径 `父.序号`。
- 失败返回 `KernelIssue` 判别联合，不抛。

---

## 3. 运行期写面（敏感）

```text
updateAgent(id, patch)
  → canWrite(patch)     // 仅 name/model/temperature/effort
  → name 唯一检查
  → lineage.rewriteAttrs
```

禁止散点 setter。类 `tools` 收敛硬门禁在 `updateClassGenes`。

| 操作 | 语义 |
|---|---|
| `terminate` | 墓碑；id/name 占用保留 |
| `interrupt` | runtime.status = interrupted |
| `setStatus` | idle/thinking/tooling/interrupted/holding |

---

## 4. 状态机（运行时）

```text
idle → thinking → (tooling ⇄ thinking)* → idle
any  → interrupted →（可恢复）idle
idle 无信 → holding
```

具体轮循环住 Runtime/组合侧（尚未在 kernel 内嵌），kernel 只记状态。

---

## 5. 与 boot 的装配顺序

```text
策略 registry 就绪 → 工具 drain 冻结 → new Kernel({ lineage, deliverFirst })
```

kernel **消费**二者的就绪面；构造函数不 `new` 兄弟服务。

---

## 6. 文件

| 文件 | 内容 |
|---|---|
| `types.ts` | AgentClass / InstantiateOptions / KernelIssue |
| `Kernel.ts` | 门面 |
| `index.ts` | 唯一出口 |

## 7. 依赖

`model`（收敛代数）、`lineage`（门面）。不 import post/tools/gateway 实现。
