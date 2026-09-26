# Docker 部署

> 发布形态 = **WebUI 服务**（`shell/webui/server.ts`）。  
> **容器即边界**：挂载的 `/data` volume 是 bash 工具爆炸半径；非 root；密钥只经 env。

## 镜像

```bash
cd deploy
docker build -t stem:1.0 -f Dockerfile ..
docker run -d -p 4321:4321 -v stem-data:/data \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  --name stem stem:1.0
```

浏览器：`http://localhost:4321`；探针：`GET /api/health`。

## 要点

| 项 | 约定 |
|---|---|
| BASE | `node:24-bookworm-slim`（避开 24-slim 拉层卡死） |
| WORKDIR | `/app`（源码直跑 + tsx） |
| 数据 | `VOLUME /data` → `.stem/` + `stem.db` |
| 用户 | `node`（非 root；先 chown /data） |
| 健康 | `HEALTHCHECK` 打 `/api/health` |
| 密钥 | `-e KEY_ENV_NAME=...`，不进镜像 |

## 一键脚本

| 平台 | 脚本 |
|---|---|
| Windows / Docker Desktop | `powershell -File deploy.ps1` |
| WSL / Linux | `./deploy.sh` |

常用参数：`--build` `--port` `--name` `--volume` `--key-name` `--force`。

## 远程主机（无 git）

```bash
tar cz Dockerfile .dockerignore package.json package-lock.json src shell extension script \
  | ssh user@host "mkdir -p ~/workspace/stem && tar xz -C ~/workspace/stem"
ssh user@host "cd ~/workspace/stem/deploy && docker build -t stem:1.0 -f Dockerfile .."
# 密钥经管道注入，零落盘
printf 'OPENAI_API_KEY=%s' "$OPENAI_API_KEY" \
  | ssh user@host "docker rm -f stem; docker run -d -p 4321:4321 -v stem-data:/data --name stem --env-file /dev/stdin stem:1.0"
```

## 踩坑

1. **`node:24-slim` 拉层停滞**：钉 `node:24-bookworm-slim`；或 `docker pull` 预热。  
2. **WSL 无 docker.sock**：启动 Docker Desktop 并打开 WSL integration，或 `sudo service docker start`。  
3. **并发 build 打架**：先 `pgrep -fa 'docker build'`。  
4. **健康状态**：`docker inspect stem --format '{{.State.Health.Status}}'` 应为 `healthy`；日志里 provider 未接通 warn 属无密钥降级，非故障。

## 验收

- `curl /api/health` → `ok:true`
- 卷内出现 `.stem/stem.jsonc`、`.stem/stem.db`
- `docker rm` 后同 volume 重建 → 族谱/语料恢复
