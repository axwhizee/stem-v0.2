# stem 一键部署（Windows / Docker Desktop）。密钥只进容器 env。
param(
  [switch]$Build,
  [switch]$Force,
  [int]$Port = 4321,
  [string]$Name = "stem",
  [string]$Volume = "stem-data",
  [string]$Image = "stem:1.0",
  [string]$KeyName = "OPENAI_API_KEY"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$KeyValue = [Environment]::GetEnvironmentVariable($KeyName, "Process")
if (-not $KeyValue) { $KeyValue = [Environment]::GetEnvironmentVariable($KeyName, "User") }

if ($Build -or -not (docker image inspect $Image 2>$null)) {
  docker build -t $Image -f "$PSScriptRoot/Dockerfile" $Root
}

if ($Force) { docker rm -f $Name 2>$null | Out-Null }

if (docker inspect $Name 2>$null) {
  Write-Host "container $Name 已存在；用 -Force 接管"
  exit 1
}

$envArgs = @()
if ($KeyValue) { $envArgs += @("-e", "$KeyName=$KeyValue") }
else { Write-Host "warn: $KeyName 未设置，将以无密钥启动" }

docker run -d -p "${Port}:4321" -v "${Volume}:/data" @envArgs --name $Name $Image
Write-Host "stem web → http://127.0.0.1:$Port"
