# stem 架构

> **系统设计真相**：概念、关键模型、模块依赖与不变量
> **不**描述源码布局，**不**承载实施进度（→ `plan.md`）、场景压力（→ `scenarios.md`）
> 忠于**已定型设计**；过时表述整段改写或删除，禁止补丁式缝合
> **可重建判据**：只读本卷应能在任意语言/环境中重建行为等价的系统；答不出「非法消息怎么办、未决调用怎么闭、属性如何收敛、hidden 与 deny 差在哪、user#0 为何不特殊」= 本卷不合格

## 一、核心概念

| 概念 | 说明 |
|---|---|
| **微内核 + 服务**   | kernel 只做实例/族谱仲裁与调度入口；语料、工具、上下文、网关等为独立服务，组合根接线 |
| **平等 agent 系统** | 平等 agent 形成自治生态系统，外部以扮演 `user#0` 的形式参与其中，并通过 shell 面向用户 |
| **统一 Message**    | 原子化的上下文构成最小单元，所有模块操作的统一对象，严格约束操作的有效性 |
| **SQLite 数据结构** | 除 message 构成的上下文外，还包括面向上下文策略的描述符，以及一切需要持久化的信息 |
| **族谱树**          | 又称实例树，持有 agent 实例完整信息与拓扑结构的内存态储存空间，包含统一属性继承与修改面 |
| **工具系统**        | 工具三层分类、权限收敛转换、生命周期控制与初始化流程 |
| **邮局系统**        | 将每条 message 视为一封信，统一管理入库、策略编排、快递员分发与广播；内置上下文管道与记忆策略，是 agent 记忆能力的实现载体 |
| **agent 组成**      | agent 三要素：运行时、属性表、记忆（上下文）策略，及其与实例树的关系、并行逻辑 |
| **ToolAgent**       | 独立于实例树的工具 agent，系统直接控制调度与上下文，提供精简调用 |
| **stem 空间**       | 以 `.stem/` 目录承载系统运行空间，含配置 `stem.jsonc`、SQLite 数据库等 |
| **分层扩展**        | 以 `internal`、`extension`、`custom` 三层管理基本能力、扩展能力、用户自定义能力 |
| **系统 init**       | stem 空间初始化 → 策略初始化 → 工具初始化 → kernel 初始化 → 实例化 `user#0` 进入系统 |

## 二、系统结构

### 2.1 微内核 + 服务

```text
  ┌──────────────────────────────────────────┐
  │  shell / 宿主实现（UI · DB 驱动 · bash…） │
  └──────────────────┬───────────────────────┘
                      │ 实现宿主端口
  ┌──────────────────▼───────────────────────┐
  │  组合根 boot（唯一装配与 init 序列）      │
  └──────────────────┬───────────────────────┘
                      │ 构造并注入端口
  ┌──────────────────▼───────────────────────┐
  │  L4  kernel（微内核）                     │
  │  调度入口 · 属性写裁决 · 运行态推进       │
  └───────┬──────────────────────────┬───────┘
          │                          │
  ┌───────▼──────────────────────────┬───────────┐
  │ L3 post 管道/策略面              │ L3 工具服务 │
  │  pipeline（预处理→编排→通知）    │  注册表/执行│
  │  strategy（classic/none/…）      │  ToolAgent  │
  │  stamp（打戳）                   │  · pilot    │
  └───────┬──────────────────────────┴──────┬────┘
          │ post 内部：管道→信箱→快递员      │
  ┌───────▼──────────────────────────────────▼───┐
  │  L2 基础设施（依赖源 / 被依赖方）              │
  │  族谱资源面 · post 收发面（信箱/未决/窗口）    │
  │  网关 · 日志                                  │
  └───────┬──────────────────────────┬───────────┘
  ┌───────▼──────────┐      ┌────────▼─────────┐
  │ L1 模型（纯代数） │      │ 宿主端口（契约）  │
  │ Message/信封      │      │ 存储·fs·timer·…  │
  │ 属性表/权限/ id   │      │ 实现在 shell      │
  └──────────────────┘      └──────────────────┘
```

### 2.2 模块 ↔ 微架构成分（对照在结构内）

| 物理模块 | 层 | 成分 | 职责摘要 | **不**负责 |
|---|---|---|---|---|
| `model/` | L1 | Message · Envelope · AttributeTable · 权限代数 · id | 纯代数与对象自检 | 无 IO |
| `lineage/` | L2 | 族谱资源面 | 拓扑+属性存取+物化+`canReach` | 调度、发消息 |
| `post/` | L2–L3 | 邮局（信箱·管道·策略·快递员） | 预处理→入库→编排→合并投递/广播/未决兑现/打戳 | 仲裁族谱、实现工具、spawn 实例 |
| `gateway/` | L2 | 网关 | ContentPart 协议映射、流式、用量 | 语料策略 |
| `logging/` | L2 | 日志 | 只追加观测 | 业务分支 |
| `tools/` | L3 | 工具服务 | 注册表、权限物化/执行、生命周期 | 持有族谱 |
| `toolagent/` | L3 | ToolAgent | 单轮工具执行体 | 实例、邮局、语料落库 |
| `pilot/` | L3 | user#0 扮演 | 根交互入口 | 特权地位 |
| `kernel/` | L4 | kernel | 调度仲裁、属性写裁决 | 拥有服务内部态 |
| `boot/` | L5 | 组合根 | new+接线+init/dispose 序列 | 业务状态 |
| `config/` | 装配输入 | 空间配置 | stem.jsonc 解析 | 运行时服务 |
| `shell/*` | 宿主 | 交互壳（cli/webui/dashboard/feishu…） | UI + pilot 扮演 + 事件 + 宿主端口实现 | 域模型（见 3.9） |
| `extension/`（含 mcp） | L3 边缘 | 扩展能力 | skill 与 mcp 等，与 custom 同契约 | 特权通道（skill/mcp 见 3.8） |

### 2.3 宿主端口（依赖倒置边界，非业务层）

core **纯逻辑、零平台依赖**。平台能力只以**契约**出现，**实现住 shell/宿主**

| 端口 | 契约 | 典型实现 |
|---|---|---|
| 消息/实例存储 | 语料行、实例行 load/upsert/archive | SQLite / 内存 |
| 文件窄口 | 空间读/写/列目录 | node fs |
| 动态加载 | extension/custom/策略模块装载 | import |
| shell 执行 | bash Runner | 宿主 |
| 定时器 | 倒计时/超时 | 宿主 timer |
| 类/策略/工具回写 | 运行时创建的 custom 资源落盘 | fs |

**SQLite 不是 core 模块**：只是存储端口的一种实现；信封语义、归档、恢复算法在本卷规定

### 2.4 虚拟分层与依赖教义

```text
L5  组合根 boot / shell
L4  kernel（调度与仲裁）
L3  post 管道/策略面 · 工具服务 · ToolAgent · pilot
L2  族谱资源面 · post 收发面 · 网关 · 日志     ← 依赖源（被依赖方）
L1  Message · 信封 · 权限代数 · 属性表 · id
```

1. 依赖箭头只允许 **L5→L4→L3→L2→L1**；同层只依赖**窄端口**
2. **L2 是依赖源**：上层可依赖它们；它们**不得**依赖 kernel/策略/工具服务
3. **状态单主人**；**组合根唯一** `new`
4. 物理模块扁平；虚拟分层 = 允许的 import 方向。模块内子单元可分属不同层

### 2.5 agent 并行

- 多 agent 运行时轮可交错；互不写对方信箱
- 信箱/合并窗口/策略状态属**该 agent 的上下文运行时**
- 系统级串行资源（如一空间一场梦）由显式协调者持有

## 三、关键模型

### 3.1 平等 agent 生态

```text
Agent 运行体 = 运行时 + 属性表（L1 对象） + 记忆策略
```

全体实例（含根）同一套机制；差异只来自**族谱位置**与**属性表内容**

#### 3.1.1 属性表

标记约定（对每项适用性除非另注）：

- **可继承**：子实例未显式填写则继承父生效值  
- **可修改**：运行期可写  
- **自动生成**：系统填充，不接受外部指定  

**类属性**（类必填/可填；实例经 `classRef` 索引）

| 字段 | 继承 | 修改 | 生成 | 说明 |
|---|---|---|---|---|
| `classRef` | — | 否 | 是 | 基类挂载点 |
| `description` | — | 类写 | — | 类描述 |
| `sysPrompt` | 否* | 类写 | — | 系统提示词（实例生效值可快照，见下） |

**实例属性**（出生落地；类可给默认）

| 字段 | 继承 | 修改 | 生成 | 说明 |
|---|---|---|---|---|
| `id` | — | 否 | **是** | 出生路径 `x.x`，直接体现族谱树中的位置 |
| `name` | 否 | **是** | 可 | 全局唯一称呼，合法三种称呼：`name`/`name#id`/`id` |
| `ctxStrategy` | **是** | 否 | 可默认 | agent 选择的记忆策略 |
| `tools` | **是（会收敛）** | 受限 | 可 | 工具清单，见 3.6 |
| `sendCountdown` | **是** | 可 | 可默认 | 快递员合并时间窗口 |
| `model` | **是（可收敛）** | **是** | — | LLM 模型选择 |
| `temperature` | **是** | **是** | — | LLM 推理温度 |
| `effort` | **是** | **是** | — | LLM 思考强度 |
| `maxSteps` | **是** | **是** | 可默认 0（无限） | 单轮步数上限 |

**运行时/账目属性**（派生或系统写）

| 字段 | 说明 |
|---|---|
| `status` | 当前运行态 |
| `turnCount` | 累积运行轮数 |
| `ctxTokens` | 上下文窗口 token 占用 |
| `totalTokens` | agent 累积 token 消耗 |
| `lastActive` | 最近活跃时间 |

**明确不在属性表**：`assemble` / 面板标签 / userPrompt / 父 id 冗余存储（父 = `parentIdOf(id)` 纯推导）/ `childList`（子清单 = `children()` 纯推导）

**对象自检与继承（纯方法，L1）**：

```text
AttributeTable
  validate(): Issue[]                 // 值域、互斥、必填
  inherit(parent): T                  // 严格父子；无跨代直达
  applyClass(genes): T                // 收敛①
  applyInstance(incoming): T          // 收敛②
  canWrite(patch): Issue[]            // 写面预检（kernel 裁决前）
  effective(): Snapshot               // 落地表
```

收敛链：

```text
父生效属性表（继承）
  → 类基因（收敛①）
  → 实例化入参（收敛②）
  → 节点落地表（持久；改父不级联子）
解析序：实例显式 > 类 > 父
```

#### 3.1.2 运行时状态机

```text
idle → thinking → (tooling ⇄ thinking)* → idle
any  → interrupted →（可恢复）idle
idle 无信 → holding
```

**单轮时序**：

```text
输入快照 { messages: Message[], tools }
1. 网关流式：text / toolCalls / usage / finish
2. toolCalls ≠ ∅：
     登记 Pending → 并行 execute
     闭合结果按后继表写回；未闭合则待兑现后再触发
3. finish=stop|length：写回 assistant；有父则投递回信
4. 步数/信号收束；abort → 合法闭合后停止
```

#### 3.1.3 实例化流程（关键模型）

```text
入参：类名 + 首信 userPrompt + 可选 name/model/tools/contextRefs…
① 类解析（internal/extension/custom 目录真相）
② 属性收敛（3.1.1）+ 工具收敛预检（3.6）
③ 族谱登记（节点 + 能力物化）
④ 实例化落地（temperature/effort/maxSteps…）
⑤ 上下文开辟（策略解析；system 贡献者拼装入库）
⑥ 未决槽位登记（若父 hold 等待）
⑦ 首信入管道（userPrompt → 邮局）
```

实例化失败：类不可解析、属性/工具收敛违例；此后步骤失败语义在对应模型

**system 贡献者**（可追加注入，实例化时一次拼装）：类 `sysPrompt` → 策略 `note` → 其它注册贡献者。禁止运行期任意改 system 行结构

### 3.1.4 族谱树（实例树）

- 族谱树（实例树）是 agent 之间拓扑关系的承载，树上的所有 agent 以 `x.x`格式作为 id，以 `user#0` 实例化的首个子 agent 为`1`，以此类推
- 任何 agent 的创建都应该注册到族谱树上，作为树节点持有其属性表，并提供子 agent 的属性继承基础
- 凭借其 `id` 作为拓扑树上的位置索引（子清单由 `children()` 推导），agent 始终持有其 `id`，即使其被销毁
- 辖区谓词 `canReach(from, target)`：from 为 target **自身或祖先**——父管子，兄弟不可越界

#### 3.1.5 user#0 视为平凡/平等实例

实现者必须把 `user#0` 当作**普通实例**，其「特殊」均可还原为平凡事实：

| 表象 | 平凡解释 |
|---|---|
| id 为 `0` | 仍是出生路径：**族谱第 0 层** = 唯一根；`parentIdOf(0)=null`，是拓扑原点，不是特权码 |
| 「用户在系统里」 | 用户即 **LLM/网关角色**：用户敲入的内容 = `user#0` 的 **assistant 消息**；其它 agent 投给它的 assistant 消息，对 `user#0` 而言是 **user 消息**（外来信件） |
| boot 里被创建 | 与任何实例化同路径；**没有根实例则族谱无原点，系统不成立**——所以 init 必做，不是「根特权」 |
| 属性很多为空 | 空 = 未配置/不适用（如温度可空）；**仍是一张属性表**，走同一 validate/inherit |
| 「有对话历史」 | 上下文语料与其它 agent **同一套** Envelope/SQLite；推荐照常持久化 |
| shell 总连它 | 因为**外部用户扮演的是这个实例**（pilot = 扮演接口）；pilot 理论上可扮演任意实例，不靠标签特许 |
| 启动权限看起来大 | 来自 `config.user`（user 类基因）+ 根收敛清单，与「给某类配了宽松 tools」同机制 |

**禁止**：为 user#0 开旁路 API、跳过属性表、跳过管道、在 Kernel 里写 `if (id===0)` 特判

#### 3.1.6 pilot 扮演

- pilot = **以某实例身份行动**的对外接口（默认 `user#0`）
- 扮演 = 使用该实例的属性/权限/语料，不是新类型
- shell（cli/webui/feishu）只经 pilot + 只读查询端口

### 3.2 统一 Message

Message 只表达**模型协议意义**；策略/审计元数据在信封

#### 3.2.1 形状（含多模态）

```text
ContentPart
  | { type: 'text',  text }
  | { type: 'image', ref, mime?, detail? }
  | { type: 'audio', ref, mime?, durationMs? }
  | { type: 'video', ref, mime?, durationMs? }
  | { type: 'file',  ref, mime?, name? }

Message
  kind: system | user | assistant | tool
  content: ContentPart[]
  toolCalls?: [{ id, name, arguments }]  // assistant 且非空
  toolCallId?: string                    // tool
```

- 多模态**不改 kind**；字节在空间资产（`assets/` 或内容寻址），JSON/库行只存 `ref`
- 策略整理默认 `textContent(message)` 投影；非 text 可投影为占位

#### 3.2.2 五型与后继表（写入 = 快照）

| kind | 约束 | 合法后继 |
|---|---|---|
| `system` | 文本为主 | `user`；其后不再追加 system |
| `user` | ContentPart[] | `assistant` |
| `assistant`（无 calls） | content | `user` |
| `assistant`（有 calls） | call id 唯一 | 逐条配对 `tool`… |
| `tool` | 有 `toolCallId` | 未兑现的下一 `tool`，或 `assistant` |

不变量：

1. 每个 `toolCallId` 恰好由前置未兑现 call 声明且只兑现一次
2. 无悬空调用、无孤儿结果进入合法序列
3. `tool` → `user` 必须隔 `assistant`
4. **未闭合槽位不得形成完整快照送网关**（快递员收不到就绪信号）

| 操作 | 规则 |
|---|---|
| 构造 | kind 必填 + 相对前缀后继校验 |
| 改写 | 同 kind 内容修订；结构变 = 新消息/显式重组 |
| 作废 | 信封 `valid`，不改 Message |
| 出口 | Message → 网关协议 **单向** |

**不进 Message**：`tag` `valid` `turn` `indexInTurn` `from` `tokens` 打戳字段

#### 3.2.3 Message 时序（构造与写回）

```text
构造 assistant(toolCalls) → 登记 Pending 槽位
  → 工具完成 → 构造 tool 结果 → 后继校验 → 入库闭合
  → 全槽位闭合后策略才可投影完整前缀
abort/超时 → 合成合法 tool 结果闭合（timeout/aborted 文本）
```

### 3.3 语料信封与持久化

```text
Envelope
  id, agentId, at, tokens
  valid, tag?, turn, indexInTurn
  from?                    // 来源必采集
  stamp?: { timestamp?, delay?, tokens? }
  message: Message
```

| 实体 | 内容 |
|---|---|
| messages | Envelope 全量 JSON + 查询冗余列 |
| instances | 属性表 JSON + 墓碑 |
| assets | ref → 存储位置/摘要 |
| （无 classes 表） | 类/策略/工具定义 = **空间目录真相** |

write-through；作废可审计；schema 不符拒载；恢复 = 载箱 + 拓扑序重放 + 未决重建。**派生文件**（agent 私有面等）不进库

### 3.4 邮局（上下文管道、策略、持久化存储）

所有 messages 消息（五型）都默认发送给邮局，由邮局进行入库、处理、编排和分发。入库 = 进信箱 + write-through 存储端口（SQLite 实现仍属宿主）；策略编排、快递员合并窗口与未决兑现同属邮局，不拆模块。

#### 3.4.1 管道时序

```text
进入邮局（信件|工具结果|运行时写回|兑现回填）
  → 预处理：代数校验 · from 确定 · 打戳采集 · 未决登记/兑现
  → 入库（顺序 = classic 基线）
  → 策略编排（调整上下文）
  → 通知快递员（就绪 + 原因）
  → 快递员合并窗口 → 取快照 → 出模块
```

**打戳配置**（`stem.jsonc` → `stamp`，可扩展）：

```text
stamp = {
  source: boolean        // 投影开关；信封必采集 from
  timestamp?: boolean
  delay?: boolean
  tokens?: boolean
}
```

采集（信封）与投影（LLM 可见）分离

#### 3.4.2 策略

```text
orchestrate(view, trigger) → Message[]   // 必须过 3.2.2
trigger: user_prompt | tool | manual | watermark | fill
```

- core **只内置** `classic` 与 `none`；**不得**为 extension/custom 策略耦合任何代码
- 策略可以在初始化流程中追加新的工具
- 策略的操作面是已经入库的合法的上下文列表，采用 none 作为策略意味着跳过策略编排部分
- ownedTools 并入 drain；raise 只抬不封
- 整理经 **complete**（ToolAgent），禁止 spawn 实例
- 合成消息必须落在后继表允许槽位

- core 基础策略
  - none：直接跳过策略编排
  - classic：上下文达到水位线时，按照特定模板进行上下文压缩
- 扩展策略
  -  cortex：上下文达到水位线时，触发两轮上下文压缩
    1. STM压缩：针对当前上下文（含笔记表）直接压缩，得到STM
    2. LTM压缩：针对全部上下文窗口压缩，得到LTM
    3. 自动以假工具调用的形式更新笔记表

#### 3.4.3 快递员时序（合并窗口）

```text
notifyReady(reason)
  → 若 cooling：重置倒计时，pending=true
  → 若 ready：启动倒计时
  → 到点：取策略快照 → onDelivery
  → 发送后进入 cooling，直至下一次就绪
```

- 快照为倒计时内到达的userPrompt累积叠加
- 支持点对点与**广播**；广播不替代语料点对点
- 自身写回历史不自动重投递

#### 3.4.4 未决 toolCall 兑现（唯一延迟机制）

```text
Pending { callId, owner, tool, deadline? }
fill: 本地返回 | 定时自填 | 信件配对 | abort 闭合
不变式：快照不含未闭合槽位
```

- **无通用 Waiter。**  
- **`agent_pause` = 普通工具** + 自带定时，到点产生 tool 结果——设计上唯一「等一会儿」用例
- 跨 agent 回信 = 邮局配对兑现

### 3.5 工具系统

#### 3.5.1 权限三态（hidden / allow / deny）

| 状态 | 模型可见 | 执行 | 收敛语义 |
|---|---|---|---|
| **`hidden`** | 否 | **否** | **未启用**：默认档；可被声明/收敛**抬为 allow**；保证收敛方向有下界 |
| **`allow`** | 是 | 是 | 启用 |
| **`deny`** | 否 | 否 | **锁死**：后序不可放宽为 allow/hidden |

- **hidden ≠ deny**：hidden 是「还没启用」，可抬升；deny 是「禁用铁律」
- 二者运行期都不执行；差别只在**收敛图上是否可启用**
- 注册声明 `registerAccess`（custom 读入恒 `hidden`；internal 写死；extension 随点名）
- 收敛链：`类清单 → 策略 raise（只抬不封）→ 实例清单`；键即白名单；**只紧不松**，无环
- 生效 = 族谱位置函数；无人判定 → 注册声明
- 模型可见面 = `allow`
- `hidden → allow` 仅 raise/显式启用允许；`deny` 不可逆

#### 3.5.2 生命周期时序

工具也参与系统初始化流程，先构建无序清单再正式注册

```text
发现（目录/内置/点名）→ 无序清单
  → drain: while(队列){ register; init?; registerMore? } → 冻结
  → execute（无 fs）
  → dispose
```

execute 绑定宿主端口可在 kernel 构造后完成，时序：

```text
查工具 → 生效态：hidden|deny → 拒绝；allow → 继续
  → 参数校验 → execute → 相位事件 called|success|error
```

### 3.6 stem 空间

系统首次在指定目录 boot 后，会创建 `.stem` 目录作为系统空间的承载者，随后的每次启动都会读取该目录作为依据，**目录迁移即空间迁移**

### 3.6.1 目录结构

```text
<projectRoot>/.stem/
  stem.jsonc    唯一配置
  agent/        custom 类（目录真相）
  strategy/     custom 上下文策略
  tools/        custom 工具（读入默认 hidden）
  skills/ 等    extension 内容
  assets/       多模态资产
  home/         agent 私有主目录（按 id 隔离）
  stem.db       SQLite（宿主实现）
```

#### 3.6.2 系统 boot 流程

1. stem 空间定位 + config + 资源发现（类/策略/工具）
2. 策略初始化（注册表就绪；无策略编排 boot）
3. 工具初始化（drain → 冻结；execute 端口可未绑）
4. kernel 初始化（族谱/实例就绪；绑定工具宿主端口；caps/raise 可用）
5. 恢复接线 → 实例化 user#0 → shell

| 失败 | 语义 |
|---|---|
| 空间/config 非法、类/策略解析失败 | **拒启** |
| 单工具 init 失败 | **issue 留痕** |
| dispose | 中断活跃轮 → 未决闭合 → 关存储 |

boot 序列只住组合根；服务只暴露 `init/dispose`
**kernel 在策略、工具就绪之后**构造（依赖方向：kernel 消费二者的就绪面）

#### 3.6.3 核心/扩展/自定义三层扩展

系统的完整工具（`tool/`）、策略（`strategy/`）、agent 类（`agent/`）这三种可自定义可扩展的内容都采用三层的注入顺序

- **internal**：系统内置内容，是 core 最小系统的一部分
- **extension**：stem 可选内容，直接放在 extension 目录当中，通过显式声明注入，实现系统功能裁切
- **custom**：自定义内容，直接读取 `.stem` 目录下放置的文件，完全交给用户扩展
  - 运行期创建的 custom 资源 **写回对应目录**，下次 boot 再发现
  - `.stem/tools/` 目录扫描进表的工具默认给定权限为 `hidden`

### 3.7 ToolAgent 与 `invoke`

```text
create({ system?, model, tools: 点名[], principal?, access?, maxSteps? })
complete({ messages, signal? })
  → gateway ⇄ 工具子集直至 stop|maxSteps
  → { text, messages 增量, usage?, toolRounds, finish }
```

| 规则 | |
|---|---|
| 身份 | 不属于实例树；系统直调不写语料 |
| 清单 | 冻结表点名；缺名失败 |
| 权限 | principal 档案或会话 grant；否则注册声明 |
| `invoke` | internal 包装；外层一条工具记录；内层非实例身份 |

**`home/`**：`home/<agentId>/` 为该 agent **私有持久操作面**

- 路径夹紧：只暴露自己的子树；兄弟互不可见
- 面向 agent 的工具/接口：列、读、写、删**己方**文件
- 策略派生（笔记等）若属记忆资产亦住 `home/<id>/`
- 不进 SQLite；文件即真相

### 3.8 基于工具的 skill 与 mcp

两者都是 **extension 工具域**：core 只认 `ToolCapability`，不为业务领域写死工具包。共同原则——**机制在 extension，内容/定义在 stem 空间**；都经无序清单 + drain 入表；无热插拔；密钥只经 env

| | **skill** | **mcp** |
|---|---|---|
| **本质** | 可渐进披露的「知识/流程」工具：调用返回文本 | 外部工具服务器的**投影与转发** |
| **机制** | 读 `SKILL.md`、组装就绪描述、execute 按需披露正文 | 连接会话、`tools/list` 投影、`tools/call`、dispose |
| **定义/内容** | `.stem/skills/<名>/SKILL.md` | `.stem/mcp.jsonc`（`mcpServers`） |
| **入表** | init 发现技能 → 通常 1 枚（或按技能）工具能力 | init 按服务器投影 **N 枚**远程工具 |
| **execute** | 返回技能正文/步骤（文本） | 转发到 MCP 服务器并回传结果 |

#### skill

| 部分 | 住哪 | 形状 |
|---|---|---|
| 机制 | extension skill 装载器 | 工具工厂 + init 扫 `.stem/skills/` |
| 内容 | `.stem/skills/<skill>/SKILL.md` | YAML 头 `name` / `description` + 正文（操作说明、清单、范例） |

- **工具化**：对模型暴露为工具（名称/描述来自 YAML）；调用结果 = 正文（或摘要 + 路径指引），实现**渐进披露**，避免把全部技能塞进系统提示词
- **init**：枚举技能目录、校验 YAML、填充 description；drain 后冻结
- **正文可再读**：若空间有读文件类工具，模型可按 skill 内路径读全文；无则 execute 一次给出全文
- **与 custom 工具**：skill 是「内容型工具」；需要副作用时用普通工具/MCP，或 skill 内约定调用哪些工具

#### mcp

| 部分 | 是什么 | 住哪 |
|---|---|---|
| **机制** | 通用 MCP 客户端（stdio/HTTP 会话） | extension **一枚** mcp 机制 |
| **定义** | 服务器清单 | `.stem/mcp.jsonc` |
| **表内条目** | `tools/list` 投影出的工具能力 | drain 追加；execute 绑定会话 |

**定义格式（规范面 = `mcpServers`）**：

```jsonc
{
  "mcpServers": {
    "local-name": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "TOKEN": "{env:SOME_TOKEN}" }
    },
    "remote-name": {
      "type": "http", // 或 "sse"
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer {env:OTHER_TOKEN}" }
    }
  }
}
```

| 形态 | 字段 |
|---|---|
| **stdio** | `command` + 可选 `args` / `env` / `cwd` |
| **http / sse** | `type` + `url` + 可选 `headers` |
| **stem 可选** | `enabled?`、`access?`（投影工具注册声明） |

mcp 不变量：

1. 密钥 `{env:NAME}`，不写明文
2. init 连接并投影 → 可 `registerMore` → 冻结；运行期 `tools/call`；dispose 关会话
3. 改 `.stem/mcp.jsonc` 只影响下次 boot
4. 投影工具与其它工具同一套三态/生命周期/`ToolCapability`
5. 专用直连工具可并存；次要兼容其它 harness 的 `mcp.servers` 变体，**规范面仍是 `mcpServers`**

### 3.9 Shell（宿主交互层）

shell = **平台适配 + UI**，不是领域模型。所有 shell 经同一套对外端口与 stem 世界交互：**pilot（扮演）+ 只读查询 + 事件订阅 + 宿主端口实现**

| 形态 | 职责 | 交互面 |
|---|---|---|
| **cli** | 终端参考壳：对话、斜杠指令、空间选择 | stdin/stdout + pilot |
| **webui** | 浏览器单页：族谱树、流式对话、监督/控制 | HTTP + SSE（事件流）+ 写口（send/instantiate/…） |
| **dashboard** | 只读法医/运维：语料、实例、token、资源清单、清理门禁 | HTTP 只读查询（无扮演写口或强门禁） |
| **feishu 等消息壳** | 远程通道：IM 入站 → 同一 pilot/投递；出站渲染 | 长连接/Webhook + 身份闸门 |

共同不变量：

1. **第一视角 = 扮演**：人类经 pilot 以 `user#0`（或指定实例）行动；不为 shell 开旁路 API
2. **事件**：`stream` / `letter` / `status` / `tool` 等经 EventHub 多订阅；SSE/IM 只是投递载体
3. **宿主端口**（存储/fs/bash/加载/timer）由 **shell 或宿主装配**提供实现；core 不感知进程/文件系统
4. **一进程一空间**；多 shell 可指向同一空间的运行时（或只读打开库），写入口径仍经 pilot/内核写通道
5. **UI 细节**（布局、主题、路由）住各 shell 模块实现 README，**不进本卷**

## 四、配置文件

位于 `.stem/stem.jsonc`，承载全量配置信息（唯一配置文件）。分区铁律：**core 段落只谈 core；extension 的一切进 `extensions` 伞下**。类/策略/工具仍是「目录即真相」，点名只决定「装不装」，不决定「存不存在」（custom 无点名、目录全量扫）。

```jsonc
{
  // providers：模型提供商注册表。密钥只经 env 名，config 永不承载明文
  // models = 该提供商可用模型白名单；空/缺省 = 全启用
  "providers": {
    "opencode-go": {
      "base_url": "https://opencode.ai/zen/go/v1",
      "key_env": "OPENCODE_API_KEY",
      "models": ["deepseek-v4.1-flash", "deepseek-v4-flash", "glm-5.3"]
    },
    "alibaba": {
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "key_env": "ALIBABA_API_KEY",
      "models": ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-plus"]
    },
    "deepseek": {
      "base_url": "https://api.deepseek.com/v1",
      "key_env": "DEEPSEEK_API_KEY",
      "models": ["deepseek-v4-pro", "deepseek-v4-flash"]
    }
  },

  // user#0 的完整配置（类基因）：族谱根属性表源头
  // tools = 根收敛清单（键即白名单）；未列 = hidden。sendCountdown 为实例属性
  "user": {
    "model": "opencode-go/deepseek-v4.1-flash",
    "tools": {
      "agent_instantiate": "allow",
      "agent_list": "allow",
      "agent_inspect": "allow",
      "agent_ancestry": "allow",
      "agent_descendants": "allow",
      "agent_class_list": "allow",
      "agent_class_create": "allow",
      "agent_class_update": "allow",
      "agent_update": "allow",
      "agent_terminate": "allow",
      "mail_send": "allow",
      "mail_participants": "allow",
      "context_overview": "allow",
      "context_export": "allow",
      "context_remove": "allow",
      "context_edit": "allow",
      "context_apply": "allow",
      "telemetry_query": "allow",
      "skill": "allow",
      "bash": "allow",
      "websearch": "allow",
      "webfetch": "allow",
      "read": "allow",
      "write": "allow",
      "edit": "allow",
      "grep": "allow",
      "glob": "allow"
    },
    "sendCountdown": 3,
    "temperature": 0.5,
    "effort": "low",
    "maxSteps": 0
  },

  // 信封打戳：采集（信封必采集 from）与投影（LLM 可见）分离
  "stamp": {
    "source": true,
    "timestamp": false,
    "delay": false,
    "tokens": false
  },

  // core 内置策略 classic 的参数（core 策略配 core 区）
  "classic": {
    "window": 128000
  },

  // bash 工具参数
  "bash": {
    "defaultTimeoutMs": 120000,
    "maxOutputChars": 50000
  },

  // extension：点名 = 装载开关 + 注册声明；未点名 = 不装载
  "extensions": {
    "tools": {
      "read": "allow",
      "write": "allow",
      "edit": "allow",
      "grep": "allow",
      "glob": "allow",
      "bash": "allow",
      "websearch": "allow",
      "webfetch": "allow",
      "skill": "allow"
    },
    "agent": ["creator"],
    "strategy": {
      "cortex": {
        "dreamAt": 10000,
        "note": "You are a long-horizon agent with externalized memory notes.",
        "stmMax": 12,
        "ltmMax": 20,
        "recentChars": 4000
      }
    }
  }
}
```

字段约定：

| 项 | 约定 |
|---|---|
| `user.maxSteps` | `0` = 无限（正常默认）；正数 = 受限/成本敏感场景的步数上限 |
| `user.sendCountdown` | 实例属性，单位秒；子实例可继承/覆盖 |
| `extensions.tools` 等 | extension **必须点名**才装载，实现按需启动与系统裁剪 |
| `extensions.strategy.*` | 扩展策略的自持参数（如 cortex 五字段），**不进 core 段落** |
| 权限词 | `hidden` / `allow` / `deny` 三态，见 3.5.1 |

## 五、技术选型

- TypeScript + `node:test`；`node ≥ 23.4`（宿主 SQLite）  
- LLM：OpenAI 兼容；密钥只经 env  
- 容器边界 = bash 爆炸半径；schema 开发期零兼容  
- FakeGateway；资产 ref 可替换存储

## 六、维护纪律

1. 本卷 = **设计**不变量 + 模型规范；源码布局、接口全量、实现细节**不进卷**
2. **实现**住各模块 `README.md`（本卷在代码中的落实延伸）；**接口**住 `api.md`
3. 概念表与关键模型冲突时改到一致
4. 废弃机制整段删除
5. 可重建判据定期自检
6. 时序说明**住在对应关键模型内**，不设平行「时序总章」
