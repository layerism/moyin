# 部署：Nginx 与免费 HTTPS

适用：Ubuntu 22.04/24.04、域名 ainami.tech、gray.ainami.tech、test.ainami.tech，项目通过 tmux 手动运行。
本文沿用 deploy/nginx.conf：Nginx 通过稳定符号链接读取三套仓库各自的 `frontend/dist`，API 分别转发至本机 8000、8001、8002。无需安装 moyin.service.template。
以下命令是操作教程，不代表服务器已经执行过。除安装系统软件外，项目命令均在实际仓库根目录执行。

## 1. 确认域名和端口

在阿里云 DNS 添加三个 A 记录：主机记录分别为 @、gray、test，记录值均为实际服务器公网 IP。
如果存在 AAAA 记录，确保它也指向这台可访问的服务器，否则先修正。
安全组及服务器防火墙允许 TCP 80、443；有路由器时需转发这两个端口。正式、灰度、测试环境不启动 Vite，不需要开放 5173、5174、5175。

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

## 3. 启动项目进程

项目依赖尚未安装时，先执行 bash deploy/install.sh，并配置 backend/.env。
若项目已在运行，不要重复启动，以免端口冲突。

`run_server.sh` 每次启动都会先构建当前仓库前端，构建成功后创建或核对 `/var/www/moyin/<环境> → 当前仓库/frontend/dist` 符号链接，再以前台方式启动对应环境的 Uvicorn 后端。Nginx 直接提供构建后的静态前端，因此脚本不启动 Vite。构建失败时脚本立即退出，不启动后端。脚本不会申请 HTTPS 证书，首次部署仍须完成第 5—6 节。

在项目根目录创建 tmux 会话：

```bash
tmux new -s moyin
bash deploy/run_server.sh prod
```

灰度和测试环境应在各自独立的代码目录与 tmux 会话中启动：

```bash
bash deploy/run_server.sh gray
bash deploy/run_server.sh test
```

`prod`、`gray`、`test` 的后端分别使用 8000、8001、8002，并仅监听本机 `127.0.0.1`。不传参数时默认 `prod`。端口被占用时直接报错，不自动换端口。模式参数不改变 Nginx 的监听端口或静态文件配置。

按 Ctrl+B，再按 D 返回普通终端，服务仍在运行。重新进入使用 tmux attach -t moyin；停止时在会话中按 Ctrl+C，当前环境后端随即停止。

## 4. 自动构建与发布前端

执行以下任一启动命令时，脚本都会在对应的当前仓库自动执行一次 `npm --prefix frontend run build`：

```bash
bash deploy/run_server.sh prod
bash deploy/run_server.sh gray
bash deploy/run_server.sh test
```

脚本只构建当前 clone：`prod` 构建正式仓库，`gray` 构建灰度仓库，`test` 构建测试仓库；不会在一个 clone 中同时构建另外两个环境。构建产物保留在当前仓库的 `frontend/dist`，不复制到 `/var/www`。

如果服务已经运行，只想更新静态前端而不重启后端，可以在该环境仓库根目录手动执行：

```bash
export PATH="$PWD/.local/node/bin:$PATH"
npm --prefix frontend run build
chmod -R a+rX frontend/dist
```

`run_server.sh` 会把对应的 `/var/www/moyin/<环境>` 建立为当前仓库 `frontend/dist` 的符号链接；如果该环境已经链接到另一仓库，脚本会中止，不会静默改向。`/var/www/moyin` 中不保存构建文件或 `node_modules`。

Nginx 只通过链接读取 `dist`，不读取源码。前端修改后只须重新构建，无须复制文件或 reload Nginx。需要 Vite 热更新时，应按根 README 的本地开发方式单独启动前后端。

## 5. 安装 HTTP 站点配置

检查 deploy/nginx.conf 中以下值：

```nginx
listen 80;
server_name ainami.tech;
root "/var/www/moyin/prod";
index index.html;
```

正式、灰度、测试三个站点的 `/api/` 应分别代理到 8000、8001、8002，root 分别为 `/var/www/moyin/prod`、`/var/www/moyin/gray`、`/var/www/moyin/test`。root 是前端发布目录，不是后端或整个仓库目录。

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
如果正式站点或 Certbot 管理的配置已经存在，`run_server.sh` 不会用仓库文件覆盖它。此时应将新增的 gray/test `server` 块人工合并到系统配置，执行 `sudo nginx -t`，确认成功后再 `sudo systemctl reload nginx`。

站点配置生效后，检查当前环境的 `index.html`，并通过本机 Nginx 验证 HTTP。以正式环境为例：

```bash
sudo test -f /var/www/moyin/prod/index.html
readlink -f /var/www/moyin/prod
curl -I -H 'Host: ainami.tech' http://127.0.0.1/
curl -i -H 'Host: ainami.tech' http://127.0.0.1/api/health
```

页面和健康检查均应返回 `200`。如果页面返回 `500` 且错误日志出现 `rewrite or internal redirection cycle`，通常是对应静态目录或 `index.html` 尚未发布。确认 `http://ainami.tech` 可到达网站后再申请证书。

## 6. 安装 Certbot 并申请免费证书

使用 Let's Encrypt，无需购买商业证书。以下采用 Certbot 的 snap 安装方式；如果已有其他方式安装的 Certbot，先确认现有安装，不要混装。

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d ainami.tech --redirect
```

按提示填写邮箱、阅读并同意条款。Certbot 会通过 HTTP 验证域名控制权，为匹配 server_name 的站点安装证书，并配置 HTTP 跳转 HTTPS。此验证需要该域名已经正确解析、公网 80 端口可达，而且 HTTP 页面能够访问。

gray 和 test 应在各自 DNS、HTTP 页面及后端均可用后分别申请，避免一个尚未就绪的子域名导致其他域名的证书申请一起失败：

```bash
sudo /snap/bin/certbot --nginx -d gray.ainami.tech --redirect
sudo /snap/bin/certbot --nginx -d test.ainami.tech --redirect
```

成功后访问 https://ainami.tech。Certbot 修改系统站点文件，不修改 Git 仓库中的 deploy/nginx.conf。
申请完成前不要手动添加指向不存在证书的 ssl_certificate，否则 Nginx 可能无法启动。

查看实际证书路径和期限：

```bash
sudo /snap/bin/certbot certificates
sudo nginx -t
```

证书通常位于 /etc/letsencrypt/live/ 下，实际目录以命令输出为准。私钥不得公开或提交 Git。

## 7. 检查自动续期

```bash
sudo /snap/bin/certbot renew --dry-run
sudo systemctl status snap.certbot.renew.timer --no-pager
```

snap 安装包含自动续期安排。dry-run 是续期模拟检查，不是重新购买证书。
保留验证所需的 DNS 和公网 80 端口配置；不要等证书过期才检查。

## 8. 项目如何使用 HTTPS

```text
浏览器 HTTPS
        ↓
Nginx :443（证书）
        ├─ ainami.tech      → /var/www/moyin/prod + 127.0.0.1:8000
        ├─ gray.ainami.tech → /var/www/moyin/gray + 127.0.0.1:8001
        └─ test.ainami.tech → /var/www/moyin/test + 127.0.0.1:8002
```

run_server.sh 不加载证书，也不需要改成 HTTPS。浏览器与 Nginx 之间由证书保护，本机转发继续使用 HTTP。

HTTPS 确认可用后，编辑 backend/.env：

```dotenv
APP_ENV=production
CORS_ORIGINS=["https://ainami.tech"]
```

灰度和测试仓库的 `CORS_ORIGINS` 应分别填写 `https://gray.ainami.tech` 与 `https://test.ainami.tech`；三套环境还应使用独立数据库和 OSS 前缀。

在对应 tmux 会话中 Ctrl+C 停止项目，再执行 `bash deploy/run_server.sh <prod|gray|test>` 加载配置。此时登录 Cookie 仅通过安全连接发送，应统一使用 HTTPS 域名登录。
域名与 IP 的登录会话不通用，切换入口后重新登录。
安全组只需对公网开放 80、443；5173、5174、5175、8000、8001、8002 均不应对公网开放。

## 9. 更新、迁移和多版本

- 前端更新：重新构建并复制 dist；无需重新申请证书。
- 后端更新：在 tmux 中重启；不要重复启动多个同端口进程。
- 不要用仓库 HTTP 配置覆盖 Certbot 已修改的系统站点，否则会丢失 HTTPS 配置。
- 修改系统站点后，先 nginx -t，再 reload。
- 新服务器：部署代码和数据、安装 Nginx、修改 DNS，再申请该服务器的证书。
- 多版本分别使用 /var/www/moyin/prod、/var/www/moyin/test 等目录，并分别配置域名、站点文件、后端端口、数据库及存储。子域名也需要解析和证书。

## 10. 常见故障

| 现象 | 检查方向 |
| --- | --- |
| 证书申请超时 | A/AAAA 解析、安全组、防火墙及路由器的公网 80 转发 |
| 找不到域名对应站点 | server_name 是否正确，配置是否已启用，nginx -t 是否通过 |
| 默认欢迎页 | 是否访问正确域名、站点是否启用、是否有重复 server_name |
| 页面 500，日志包含 internal redirection cycle | 对应仓库是否已生成 `frontend/dist/index.html`，以及 `/var/www/moyin/<环境>` 链接是否正确 |
| 页面 403 | root 是否存在、是否有 index.html、Nginx 用户是否有读取和目录访问权限 |
| API 502 | tmux 中后端是否运行，proxy_pass 的端口是否匹配 |
| HTTPS connection refused | 是否已经申请证书，以及 Nginx 是否监听 443 |
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

## 11. 官方参考

- [Certbot：Nginx 与 snap 安装步骤](https://certbot.eff.org/instructions?os=snap&ws=nginx)
- [Ubuntu：申请 TLS 证书](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)

## 12. 可选：正式环境使用 systemd

测试阶段使用上文 tmux 即可。需要开机启动和异常重启时，改用以下方式；不要与 tmux 后端同时运行。


编辑 deploy/moyin.service.template：

- 将 ubuntu 替换为实际普通用户，不使用 root。
- 将所有 /opt/moyin 替换为当前项目的绝对路径（使用无空格、无 % 的路径）。
- 用户须能访问项目、虚拟环境和 backend/.env，并能写入 backend/storage。
- 默认端口 8000；修改时同步 nginx.conf 的 proxy_pass。

先停止占用同一端口的本项目开发服务，再执行：

```bash
sudo install -m 644 deploy/moyin.service.template /etc/systemd/system/moyin.service
sudo systemctl daemon-reload
sudo systemctl enable --now moyin
```

保持单 worker；审核任务随应用启动，扩进程前需审计任务并发。


## 13. 数据备份

以下命令针对 systemd；若使用 tmux，先在对应会话停止项目，备份完成后手动启动，跳过 systemctl 命令。


在项目根目录停机打包整个数据目录，避免 SQLite WAL 与本地文件不一致。
确认没有开发进程继续写入；备份目录放在数据目录外，实际使用时修改下面的目标目录。

```bash
sudo systemctl stop moyin
umask 077
mkdir -p "$HOME/moyin-backups"
tar -czf "$HOME/moyin-backups/data-$(date -u +%Y%m%dT%H%M%S).tar.gz" -C backend/storage .
sudo systemctl start moyin
```

备份失败也需检查并恢复服务。执行备份的用户必须能读取数据文件。
另行安全保存 backend/.env（特别是加密密钥）、代码版本；OSS 对象须单独保留或备份。

迁移：克隆同一版本 → 安装依赖 → 恢复 .env 和完整 backend/storage 并设置运行用户权限 → 修改两份配置中的域名、项目路径和用户 → 构建发布 → 启动服务 → 切换 DNS → 申请证书。
不复制虚拟环境或 node_modules。切换时停止旧服务器写入，避免两份 SQLite 数据分叉。新站验收前保留旧服务器和备份。
