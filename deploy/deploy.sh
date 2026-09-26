#!/usr/bin/env bash
# stem 一键部署（WSL / Linux）。密钥只进容器 env，零落盘。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="stem:1.0"
NAME="stem"
VOLUME="stem-data"
PORT="4321"
KEY_NAME="OPENAI_API_KEY"
BUILD=0
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --force) FORCE=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --volume) VOLUME="$2"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --key-name) KEY_NAME="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# 密钥：进程 env → Windows 用户变量回落（WSL interop）
KEY_VAL="${!KEY_NAME:-}"
if [[ -z "$KEY_VAL" ]] && command -v powershell.exe >/dev/null 2>&1; then
  KEY_VAL="$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('$KEY_NAME','User')" | tr -d '\r\n' || true)"
fi

if [[ "$BUILD" -eq 1 ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" -f "$ROOT/deploy/Dockerfile" "$ROOT"
fi

if [[ "$FORCE" -eq 1 ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
fi

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "container $NAME 已存在；用 --force 接管"
  exit 1
fi

ENV_ARGS=()
if [[ -n "$KEY_VAL" ]]; then
  ENV_ARGS+=(-e "${KEY_NAME}=${KEY_VAL}")
else
  echo "warn: ${KEY_NAME} 未设置，将以无密钥启动（LLM 调用将失败）"
fi

docker run -d -p "${PORT}:4321" -v "${VOLUME}:/data" "${ENV_ARGS[@]}" --name "$NAME" "$IMAGE"
echo "stem web → http://127.0.0.1:${PORT}"
