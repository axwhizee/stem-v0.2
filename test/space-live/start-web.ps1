@'
$k = [Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY","User")
if (-not $k) { Write-Output "NO_KEY"; exit 1 }
$env:DEEPSEEK_API_KEY = $k
$env:STEM_PROJECT_ROOT = "C:\Users\Richa\WorkSpace\Coding\LLM\Projects\stem\test\space-live"
Remove-Item Env:STEM_FAKE_GATEWAY -ErrorAction SilentlyContinue
Set-Location "C:\Users\Richa\WorkSpace\Coding\LLM\Projects\stem"
node --import tsx shell/webui/server.ts
'@ | Set-Content -Encoding utf8 "$env:TEMP\start-stem-web.ps1"
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$env:TEMP\start-stem-web.ps1" -WindowStyle Hidden
Start-Sleep -Seconds 4
try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:4321/api/health" -UseBasicParsing; Write-Output "HEALTH $($r.Content)" } catch { Write-Output "err: $_" }