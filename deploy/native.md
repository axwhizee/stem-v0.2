# 源码部署（native）

## 前置

- Node ≥ 23.4（`node:sqlite`）
- npm

## 步骤

```bash
npm install
npm run typecheck
npm test

# 终端壳
npm run shell -- /path/to/space

# WebUI（默认 127.0.0.1:4321）
npm run web

# 只读面板（4421）
npm run dashboard
```

空间定位：位置参数 > `STEM_PROJECT_ROOT` > cwd。首启自动建 `.stem/` 与默认 `stem.jsonc`。

## 真实模型

在 `.stem/stem.jsonc`：

```jsonc
{
  "user": { "model": "openai/gpt-4o-mini" },
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  }
}
```

```bash
export OPENAI_API_KEY=...   # 只进进程环境
npm run web
```

## 常用脚本

| 脚本 | 作用 |
|---|---|
| `npm run typecheck` | tsc --noEmit |
| `npm test` | 单测（core + extension） |
| `npm run check-exports` | api 出口在位 |
| `npm run shell` / `web` / `dashboard` | 三壳 |

## 注意

- 一进程一空间；多入口勿并发写同一 `.stem/` 写口。
- Windows 下用 `npm.cmd` 或 `node --import tsx ...`；PowerShell `Start-Process npm` 可能无效。
