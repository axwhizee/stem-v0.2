# tools —— 工具服务

> 落实 `docs/architecture.md` 3.6（三层、三态、生命周期、execute）。  
> 工具是模型**唯一**的行动面：一切能力（读文件、bash、发信、改类…）都必须先成为 `ToolCapability` 进表，才可能被调用。本模块管「表怎么长出来、谁可执行、结果长什么样」，**不**拥有族谱、**不**跑记忆策略。

---

## 1. 在链路中的位置

```text
boot 发现（internal + extension + custom 无序清单）
  → registry.drain：register → init? → init 内 registerMore → …
  → 冻结
  → 每次模型要动手：
        materialize(agentId) 生成 LLM 工具清单（仅 allow）
        … 模型返回 toolCalls …
        execute(agentId, name, input, resolve, ctx)
  → 结果统一成形 → 写回 Message(tool) → 邮局兑现
```

---

## 2. 工具三层（provenance，不参与权限推断）

| kind | 来源 | 例子 |
|---|---|---|
| `internal` | core 内置 | 系统管理、bash、邮件 |
| `extension` | 仓库 `extension/tools` | read/grep、skill、mcp |
| `custom` | `.stem/tools/` 用户工具 | 空间私有 |

`kind` 只是来源标签（审计/展示）。**权限只有两个来源**：注册声明 `registerAccess` + 族谱收敛清单。

---

## 3. ToolCapability 形状

```text
{
  name, description
  kind: internal | extension | custom
  parameters: ToolParametersSchema   // JSON Schema 子集
  registerAccess: hidden | allow | deny   // 入表声明，全局封顶
  init?(ctx)      // 仅 drain 期：可读 fs、可 registerMore
  execute(input, ctx)  // 运行期：无 fs
  dispose?()
}
```

### 3.1 init 与 execute 的能力分离

| | init | execute |
|---|---|---|
| 时机 | drain 队列中 | 模型发起后 |
| fs | `ToolInitFs`（list/read） | **无** |
| 追加注册 | `registerMore`（drain 内有效） | 冻结后无效 |
| 典型 | 扫 SKILL.md、连 MCP、读配置 | 转发调用、改文件、跑命令 |

失败策略：**fail-soft**。init 抛错 → 记入 `issues`，不炸启动；execute 抛错 → 收成 `tool_error` 回模型。

### 3.2 ToolContext / ToolResult

```text
ToolContext { agentId, callId?, signal? }

ToolResult
  | { kind:'tool_ok',    content, data? }
  | { kind:'tool_error', content, code?, data? }
```

`output.ts` 保证成功与失败**同一入口**；`content` 超长截断。领域判别联合错误**原样透传**（`code=kind`），杂讯异常收 `execution_failed`。

---

## 4. 三态与注册声明

| 状态 | 模型可见 | 执行 | 收敛 |
|---|---|---|---|
| `hidden` | 否 | 否 | 默认；可抬为 allow |
| `allow` | 是 | 是 | 启用 |
| `deny` | 否 | 否 | 锁死 |

`registerAccess` 是工具**入表时自报的宽度上界**：

- `deny`：任何清单都拧不过来（封顶锁死）。
- `allow`：允许在收敛中被启用（不是自动打开）。
- `hidden`：中性，默认档。

族谱 `materializeAccess` 做清单折叠后，本模块只查：

```text
resolve.effective(agentId, toolName) → AccessState
```

`execute` 对非 `allow` **直接** `tool_access_denied`，无消息化审批路径。

---

## 5. 生命周期时序

```text
发现（无序清单）
  → drain:
       while (队列) {
         register（重名 → issue 跳过）
         init?()
         init 内 registerMore → 入同一队列
       }
  → 冻结（frozen=true）
  → execute / materialize
  → dispose（逆序清理连接等）
```

**无热插拔**：改 `.stem/tools/` 或 mcp 配置只影响下次 boot。  
**无策略 boot 钩子**：策略不参与工具初始化；策略自有 `ownedTools` 在策略装载时并入清单。

### drain 细节

| 情况 | 行为 |
|---|---|
| 重名 | `duplicate tool: x` 进 issues，后到者丢弃 |
| init 抛错 | `init failed: x: msg` 留痕，表项仍在 |
| init 中 registerMore | 推进同一队列 |
| 冻结后再 registerMore | 忽略 |
| 单工具 dispose 抛错 | 吞掉，不影响其它 |

---

## 6. execute 逐步

```text
① 查表：无 → tool_not_found
② 生效态 = resolve.effective(agentId, name) ?? hidden
   非 allow → tool_access_denied（含 state）
③ validateArgs(parameters, input)
   失败 → tool_invalid_args
④ emit called
⑤ await execute
   成功 tool_ok / 失败 tool_error → emit success|error
   抛错 → fromThrown → tool_error → emit error
```

事件相位 `called|success|error` 经 `ToolEventSink` 旁路观测（telemetry/审计），不改变结果形状。

---

## 7. materialize（给模型看的清单）

只包含 **effective === allow** 的工具：

```text
{ name, description, parameters }
```

hidden/deny 不进清单——模型根本看不见，减少误调与提示词噪音。

---

## 8. validate / output

**validate**：JSON Schema 子集（string/number/boolean/array/object/null + enum + items + required）。与提示词 schema 同一份，避免两套真相。

**output**：

```text
toolOk(text, data?)
toolError(text, code?, data?)
fromThrown(err, fallback)  // 有 kind 的领域错误透传
clip(text)                 // 窗口限制
```

---

## 9. 与权限模块的分工

```text
model.access     偏序代数（raise/converge/canTransition）
lineage          把清单+raise+register 折成每 agent 的 explicit 映射
tools.execute    只问 resolve.effective，查表拒执行
```

禁止在 tools 再写一套收敛公式——状态单主人在族谱台账。

---

## 10. 文件

| 文件 | 内容 |
|---|---|
| `types.ts` | ToolCapability / Context / Result / Event |
| `validate.ts` | 参数子集校验 |
| `output.ts` | 统一成形与截断 |
| `ToolCapabilityRegistry.ts` | drain / 冻结 / materialize / execute |
| `index.ts` | 唯一出口 |

## 11. 依赖

`model`（AccessState）、`logging`（LogSink）、`gateway`（ToolDefinition 形状）。  
**不** import kernel / lineage / post。权限经注入的 `AccessResolver` 查询。
