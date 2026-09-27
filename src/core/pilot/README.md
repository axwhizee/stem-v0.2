# pilot —— 扮演接口

> 落实 `docs/architecture.md` 3.1.5 / 3.1.6。  
> 人类通过 shell **以某个实例的身份行动**，默认 `user#0`。pilot 不是特权通道，只是「穿上谁的鞋」：使用被扮演实例的属性、权限、语料。

---

## 1. 设计要点

```text
用户在敲字  =  user#0 的 assistant 消息（LLM 角色视角）
别人寄来的信 =  user#0 的 user 消息（外来信件）
```

`user#0` 是平凡实例：id=`0` 是拓扑原点；boot 必建是因为没有根则无原点，不是根特权。禁止 `if (id===0)` 旁路。

---

## 2. API

```ts
createPilot({ send, peek, now? }, actAs = '0')

pilot.send(text)      // 以 actAs 发出
pilot.peek()          // 该视角可见的最近消息（只读）
pilot.play(otherId)   // 换扮演对象，共用同一 deps
```

| 依赖 | 语义 |
|---|---|
| `send(as, text)` | 注入 kernel/管道的用户输入口 |
| `peek(as)` | 只读查询端口 |
| `play(id)` | 理论可扮演任意实例；仍走同一机制 |

---

## 3. shell 如何用

```text
cli/webui/feishu
  → pilot.send(用户输入)
  → 订阅 EventHub（stream/letter/status/tool）
  → 只读查询（仪表盘）
  → 宿主端口实现（存储/fs/bash/timer）
```

**第一视角 = 扮演**。不为 shell 开旁路 API；多入口指向同一空间时写入口径仍经 pilot。

---

## 4. 文件

| 文件 | 内容 |
|---|---|
| `Pilot.ts` | createPilot |
| `index.ts` | 唯一出口 |

## 5. 依赖

`model`（AgentID/Message）。不依赖 kernel 实现——send/peek 由组合根适配注入。
