# 部署

支持 Ubuntu 22.04/24.04、Linux x86_64；使用 Nginx、systemd 和单后端进程。
仓库只保留配置样例与依赖安装、开发启动脚本。以下命令从项目根目录执行。

| 文件 | 用途 |
| --- | --- |
| install.sh | 安装固定版本的 Python、Node.js 和项目依赖 |
| run_server.sh | 本地开发启动，不用于生产 |
| nginx.conf | HTTP 站点配置，修改域名即可；前端统一发布到 /var/www/moyin |
| moyin.service.template | 后端服务样例，替换运行用户和所有项目路径 |
| nginx.docker.conf | 保留根目录 Compose 引用的容器配置 |

## 1. 安装与配置

```bash
sudo apt update
sudo apt install -y nginx curl xz-utils
bash deploy/install.sh
```

编辑 backend/.env，填写 OSS、短信、模型及必要加密密钥，并设置：

```dotenv
APP_ENV=production
CORS_ORIGINS=["https://ainami.tech"]
```

.env 不提交 Git，应由服务运行用户读取，不对其他用户公开。
生产服务样例固定使用项目的 backend/storage；迁移时保留其中全部数据。

## 2. 构建前端

```bash
export PATH="$PWD/.local/node/bin:$PATH"
npm --prefix frontend run build
sudo mkdir -p /var/www/moyin
sudo cp -r frontend/dist/. /var/www/moyin/
sudo chmod -R a+rX /var/www/moyin
```

前端发布目录与仓库位置无关。迁移服务器继续使用该目录，不需要配置生成脚本。

## 3. 启动后端

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

## 4. 安装 Nginx 站点

编辑 deploy/nginx.conf 的 server_name，默认 ainami.tech。模板是可直接使用的 HTTP 站点配置。
域名指向服务器，公网 TCP 80、443 放行。大陆服务器按接入商要求完成备案。

以下命令仅用于首次安装。已有同名配置或软链接时先检查并备份，不覆盖其他站点或已有证书配置。

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/moyin
sudo ln -s /etc/nginx/sites-available/moyin /etc/nginx/sites-enabled/moyin
sudo nginx -t
sudo systemctl reload nginx
```

仅 nginx -t 成功后 reload；避免其他启用的站点重复声明同一域名。
此处复制配置，不把仓库文件软链接为系统站点，避免后续更新影响 Certbot 管理的配置。

## 5. 免费 HTTPS

若尚未安装 Certbot，可用 snap 安装；不要与另一套 Certbot 混装：

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
sudo /snap/bin/certbot --nginx -d ainami.tech --redirect
sudo /snap/bin/certbot renew --dry-run
```

替换为实际域名。HTTP 验证需要公网 80 端口可达。
Certbot 自动管理证书与续期，修改系统里的站点配置；不要将私钥提交 Git。
HTTPS 就绪后使用域名登录，停止对外提供开发端口 5173 和后端端口 8000。

## 6. 更新

更新前记录代码版本并备份，安排审核任务的维护窗口。依赖变化时先停止服务，再执行 install.sh，它可能重建虚拟环境。
重新执行第 2 步发布前端，然后：

```bash
sudo systemctl restart moyin
```

不要重新复制 HTTP nginx.conf 覆盖已启用 HTTPS 的系统配置。
服务路径或用户变化时重新安装 service、daemon-reload 并 restart。
保留旧前端资源供已打开页面使用。数据库可能随启动迁移，回滚须匹配代码与数据版本。

## 7. 备份与迁移

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

## 8. 验收

```bash
sudo systemctl status moyin nginx --no-pager
sudo journalctl -u moyin -n 60 --no-pager
sudo nginx -t
```

人工检查 HTTPS、登录、上传下载、审核和前端深层链接刷新。
