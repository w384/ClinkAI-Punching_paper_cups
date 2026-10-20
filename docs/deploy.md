# 部署（公网试玩）

线上地址：**http://106.53.200.115/** · 服务器：腾讯云 Ubuntu 24.04（2C2G）
部署形态：**单个静态文件**（`demo.html` 上传为 `index.html`），nginx 直接托管，无后端、无数据库、无外部依赖。

## 访问与密钥（2026-10-20 已轮换）

| 项 | 现值 |
|---|---|
| 部署密钥 | `~/.ssh/id_cupsplash_deploy`（ed25519，指纹 `SHA256:B0Y9uuDkmbC/W1t+q3LNZwC/qXPBT9zSmjEt+U0FIXc`） |
| 旧密钥 | `id_rsa_demo` 已从服务器 `authorized_keys` 移除、本地文件已删除，**确认失效** |
| 密码登录 | **已关闭**（`PasswordAuthentication no`，drop-in：`/etc/ssh/sshd_config.d/00-cupsplash.conf`） |
| root 登录 | 仅密钥（`PermitRootLogin prohibit-password`） |

> `authorized_keys` 里现在只有一把钥匙（新部署密钥）。若再次轮换：先加新钥并验证，
> 再删旧钥（顺序不能反，否则会把自己锁在门外）。

## 一键更新

```powershell
pnpm build:single          # 产出 demo.html（自包含单文件）
.\scripts\deploy-remote.ps1
```


```bash
apt-get update && apt-get install -y nginx

# 2) 站点配置 /etc/nginx/sites-available/cupsplash
cat > /etc/nginx/sites-available/cupsplash <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/cupsplash;
    index index.html;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
    location = /index.html { add_header Cache-Control "no-store"; }
    location / { try_files $uri $uri/ /index.html; }
}
EOF

ln -sf /etc/nginx/sites-available/cupsplash /etc/nginx/sites-enabled/cupsplash
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 3) 目录
mkdir -p /var/www/cupsplash
```

> **安全组**：腾讯云控制台需要放通 TCP 80（当前已放通）。机器上 `ufw` 是关闭状态，无需额外配置。

> 服务器上原有的 python 服务（:8891）与本次部署无关，未做任何改动。

## 更新一版（每次改完代码）

```powershell
# Windows 本地
pnpm build:single                    # 产出 demo.html（自包含单文件）
.\scripts\deploy-remote.ps1          # 内部执行 scp 到服务器 index.html
```

## 之间手动更新

```powershell
scp -i "$env:USERPROFILE\.ssh\id_cupsplash_deploy" .\demo.html root@106.53.200.115:/var/www/cupsplash/index.html
```

无需重启 nginx（`Cache-Control: no-store`，刷新即拿到新版本）。

## 验证

```powershell
Invoke-WebRequest http://106.53.200.115/ -UseBasicParsing | Select-Object StatusCode, RawContentLength
```

服务器侧：

```bash
curl -sS --compressed -o /dev/null -D - http://127.0.0.1/ | head -10
# 期望：200 / Content-Type: text/html / Content-Encoding: gzip / content-length ≈ 198KB
```

实测：裸文件 572KB → gzip 后 202KB。

## 已知限制

- **只有 HTTP，没有 HTTPS**：`106.53.200.115` 是裸 IP，签发证书需要域名。若后续有域名，用 `certbot --nginx` 一行即可加 TLS。
- 单文件版每次更新都是整包替换（573KB），没有增量缓存；对试玩场景足够。
- 服务器 2C2G，nginx 托管静态文件几乎零负载；真正的瓶颈在玩家手机的 WebGL 性能。

## 排查

| 现象 | 检查 |
|---|---|
| 502 / 连不上 | `systemctl status nginx`，`ss -lnt \| grep :80` |
| 外网打不开、本机 curl 正常 | 腾讯云安全组是否放通 80 |
| 页面白屏 | 浏览器控制台；确认 `index.html` 是完整单文件（573KB 左右） |
| 旧版本 | `Cache-Control: no-store` 已设；强制刷新 / 换隐身窗口 |
