# Nginx 与免费 HTTPS 配置教程

适用：Ubuntu 22.04/24.04、域名 ainami.tech、项目通过 tmux 手动运行。
本文沿用 deploy/nginx.conf：Nginx 提供构建后的前端，API 转发至本机 8000。无需安装 moyin.service.template。
以下命令是操作教程，不代表服务器已经执行过。除安装系统软件外，项目命令均在实际仓库根目录执行。

## 1. 确认域名和端口

在阿里云 DNS 添加 A 记录：主机记录 @，记录值为实际服务器公网 IP。@ 对应 ainami.tech，而不是 oa.ainami.tech。
如果存在 AAAA 记录，确保它也指向这台可访问的服务器，否则先修正。
安全组及服务器防火墙允许 TCP 80、443；有路由器时需转发这两个端口。仅开放 5173 不够。

```bash
getent ahosts ainami.tech
sudo ss -ltnp '( sport = :80 or sport = :443 )'
```

域名解析结果应与服务器一致。若端口被其他服务使用，先确认用途，不要直接终止。

## 2. 安装 Nginx

```bash
sudo apt update
sudo apt install -y nginx tmux
sudo systemctl enable --now nginx
sudo systemctl status nginx --no-pager
```

若已安装，无须重复安装。此时只有 HTTP，尚未启用 HTTPS。

## 3. 启动项目并发布前端

项目依赖尚未安装时，先按 README 执行 bash deploy/install.sh，并配置 backend/.env。
若项目已在运行，不要重复启动，以免端口冲突。

在项目根目录创建 tmux 会话：

```bash
tmux new -s moyin
bash deploy/run_server.sh
```

按 Ctrl+B，再按 D 返回普通终端，服务仍在运行。重新进入使用 tmux attach -t moyin；停止时在会话中按 Ctrl+C。

回到项目根目录，构建并发布前端：

```bash
export PATH="$PWD/.local/node/bin:$PATH"
npm --prefix frontend run build
sudo mkdir -p /var/www/moyin
sudo cp -r frontend/dist/. /var/www/moyin/
sudo chmod -R a+rX /var/www/moyin
```

只在构建成功后复制。Nginx 读取 /var/www/moyin，不读取源码，也不读取 5173 的页面。
因此前端修改后须重新构建、复制；Vite 的热更新只适用于开发入口。

## 4. 安装 HTTP 站点配置

检查 deploy/nginx.conf 中以下值：

```nginx
listen 80;
server_name ainami.tech;
root "/var/www/moyin";
index index.html;
```

/api/ 的 proxy_pass 应为 http://127.0.0.1:8000。root 是前端发布目录，不是后端或整个仓库目录。

首次安装站点前检查：

```bash
sudo ls -l /etc/nginx/sites-available/ /etc/nginx/sites-enabled/
```

若已有 moyin 配置或同名软链接，先检查和备份，尤其不要覆盖已配置 HTTPS 的站点。确认没有同名文件时执行：

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/moyin
sudo ln -s /etc/nginx/sites-available/moyin /etc/nginx/sites-enabled/moyin
sudo nginx -t
```

只有检查成功才执行：

```bash
sudo systemctl reload nginx
```

此处复制配置到系统目录，再用系统内部软链接启用；不将仓库文件直接链接为站点。避免其他配置重复声明 ainami.tech。
访问 http://ainami.tech，确认可到达网站后申请证书。

## 5. 安装 Certbot 并申请免费证书

使用 Let's Encrypt，无需购买商业证书。以下采用 Certbot 的 snap 安装方式；如果已有其他方式安装的 Certbot，先确认现有安装，不要混装。

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d ainami.tech --redirect
```

按提示填写邮箱、阅读并同意条款。Certbot 会通过 HTTP 验证域名控制权，为匹配 server_name 的站点安装证书，并配置 HTTP 跳转 HTTPS。此验证需要公网 80 端口可达。

成功后访问 https://ainami.tech。Certbot 修改系统站点文件，不修改 Git 仓库中的 deploy/nginx.conf。
申请完成前不要手动添加指向不存在证书的 ssl_certificate，否则 Nginx 可能无法启动。

查看实际证书路径和期限：

```bash
sudo /snap/bin/certbot certificates
sudo nginx -t
```

证书通常位于 /etc/letsencrypt/live/ 下，实际目录以命令输出为准。私钥不得公开或提交 Git。

## 6. 检查自动续期

```bash
sudo /snap/bin/certbot renew --dry-run
sudo systemctl status snap.certbot.renew.timer --no-pager
```

snap 安装包含自动续期安排。dry-run 是续期模拟检查，不是重新购买证书。
保留验证所需的 DNS 和公网 80 端口配置；不要等证书过期才检查。

## 7. 项目如何使用 HTTPS

```text
浏览器 https://ainami.tech
        ↓ HTTPS
Nginx :443（证书）
        ├─ 前端：/var/www/moyin
        └─ /api/ → HTTP 127.0.0.1:8000（tmux 启动的后端）
```

run_server.sh 不加载证书，也不需要改成 HTTPS。浏览器与 Nginx 之间由证书保护，本机转发继续使用 HTTP。
IP:5173 仍是 HTTP，不是同一个 HTTPS 入口。

HTTPS 确认可用后，编辑 backend/.env：

```dotenv
APP_ENV=production
CORS_ORIGINS=["https://ainami.tech"]
```

在 tmux 中 Ctrl+C 停止项目，再执行 bash deploy/run_server.sh 加载配置。此时登录 Cookie 仅通过安全连接发送，应统一使用 HTTPS 域名登录。
域名与 IP 的登录会话不通用，切换入口后重新登录。
可以在安全组中关闭公网 5173/8000 访问；本机 Nginx 仍可访问后端。

## 8. 更新、迁移和多版本

- 前端更新：重新构建并复制 dist；无需重新申请证书。
- 后端更新：在 tmux 中重启；不要重复启动多个同端口进程。
- 不要用仓库 HTTP 配置覆盖 Certbot 已修改的系统站点，否则会丢失 HTTPS 配置。
- 修改系统站点后，先 nginx -t，再 reload。
- 新服务器：部署代码和数据、安装 Nginx、修改 DNS，再申请该服务器的证书。
- 多版本分别使用 /var/www/moyin/prod、/var/www/moyin/test 等目录，并分别配置域名、站点文件、后端端口、数据库及存储。子域名也需要解析和证书。

## 9. 常见故障

| 现象 | 检查方向 |
| --- | --- |
| 证书申请超时 | A/AAAA 解析、安全组、防火墙及路由器的公网 80 转发 |
| 找不到域名对应站点 | server_name 是否正确，配置是否已启用，nginx -t 是否通过 |
| 默认欢迎页 | 是否访问正确域名、站点是否启用、是否有重复 server_name |
| 页面 403 | root 是否存在、是否有 index.html、Nginx 用户是否有读取和目录访问权限 |
| API 502 | tmux 中后端是否运行，proxy_pass 的端口是否匹配 |
| 证书正常但页面没更新 | 是否重新构建并发布到 root 对应目录 |
| Secure Cookie 下无法使用 IP 登录 | 改用 HTTPS 域名入口 |

诊断命令：

```bash
sudo nginx -t
sudo journalctl -u nginx -n 60 --no-pager
sudo tail -n 60 /var/log/nginx/error.log
sudo tail -n 60 /var/log/letsencrypt/letsencrypt.log
tmux attach -t moyin
```

## 官方参考

- [Certbot：Nginx 与 snap 安装步骤](https://certbot.eff.org/instructions?os=snap&ws=nginx)
- [Ubuntu：申请 TLS 证书](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)
