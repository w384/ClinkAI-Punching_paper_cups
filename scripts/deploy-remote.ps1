# 部署到公网服务器：构建单文件 → scp 覆盖 index.html
# 用法： .\scripts\deploy-remote.ps1
param(
    [string]$Target = "root@106.53.200.115",
    [string]$Key = "$env:USERPROFILE\.ssh\id_rsa_demo",
    [string]$RemotePath = "/var/www/cupsplash/index.html",
    [string]$PublicUrl = "http://106.53.200.115/"
)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "[1/3] 构建单文件 demo.html ..." -ForegroundColor Cyan
pnpm build:single
if ($LASTEXITCODE -ne 0) { throw "构建失败" }

Write-Host "[2/3] 上传到 $Target ..." -ForegroundColor Cyan
scp -i $Key -o BatchMode=yes -o StrictHostKeyChecking=no `
    -o "UserKnownHostsFile=$env:USERPROFILE\.ssh\known_hosts" `
    ".\demo.html" "${Target}:${RemotePath}"
if ($LASTEXITCODE -ne 0) { throw "上传失败" }

Write-Host "[3/3] 验证 $PublicUrl ..." -ForegroundColor Cyan
$r = Invoke-WebRequest -Uri $PublicUrl -UseBasicParsing -TimeoutSec 20
Write-Host ("HTTP {0}，{1:N0} 字节" -f $r.StatusCode, $r.RawContentLength) -ForegroundColor Green
