# 部署与迁移

支持 Ubuntu 22.04/24.04、Linux x86_64、systemd、Nginx；不是任意操作系统通用安装器。
所有命令从仓库根目录运行。项目目录使用无空格、无 `$`、无 `%` 的绝对路径；生产服务使用普通用户，不能以 root 运行。

## 文件职责

- `install.sh`：安装项目固定 Python、Node、npm 和依赖；已有 backend/.env 不覆盖。
- `run_server.sh`：开发服务，使用 Vite 和后端热重载，不用于正式部署。
- `.env.example` → `.env`：部署参数，不包含业务密钥；`.env` 为可信 Bash 配置。
- `nginx.conf.template`、`moyin.service.template`：生产配置模板。
- `deploy.sh`：构建前端、生成 `.generated/`，不修改系统服务或数据。
- `backup.sh`：停机后打包完整数据目录，不包含 OSS 文件和密钥。
- `nginx.docker.conf`：保留原 Compose 部署兼容性，本说明不启动 Docker。
- `INSTALL_DESIGN.md`、`INSTALL_PLAN.md`：历史依赖安装设计，本文件为当前部署入口。

生成配置和本地 `.env` 已由 deploy/.gitignore 排除。只改源码不会更新正式前端，必须重新构建并发布。

## 1. 准备

```bash
sudo apt update
sudo apt install -y nginx gettext-base curl xz-utils
bash deploy/install.sh
cp -n deploy/.env.example deploy/.env
```

编辑 deploy/.env：

```dotenv
SITE_DOMAIN=ainami.tech
APP_PORT=8000
SERVICE_USER=ubuntu
DATA_DIR=/var/lib/moyin
WEB_ROOT=/var/www/moyin
BACKEND_ENV=
```

SERVICE_USER 改成实际部署用户。BACKEND_ENV 留空使用 backend/.env；可以指定外部文件。
数据目录留空则继续使用当前 backend/storage。现有部署不要直接改到空目录，否则应用会看到新数据库。
业务配置（OSS、短信、模型、加密密钥等）写入 BACKEND_ENV 对应文件；该文件须兼容 systemd EnvironmentFile 的 KEY=value 格式，不写 export 或变量替换。
设置 CORS_ORIGINS=["https://ainami.tech"]。服务启动时强制 APP_ENV=production，数据路径来自部署配置。

公网域名解析到服务器，放行 TCP 80、443；保留 SSH 管理端口。后端只监听本机。大陆服务器按接入商要求完成备案。

## 2. 生成生产配置

```bash
bash deploy/deploy.sh
```

查看 `.generated/nginx.conf` 和 `.generated/moyin.service`。Nginx 模板不能直接加载，也不要再把它软链接到 sites-enabled。
`render_nginx.sh` 单独运行只输出配置，不写入系统；它的静态目录取 WEB_ROOT。

首次创建数据目录并赋予服务用户权限；使用已有目录时先备份，不改变业务文件内容：

```bash
source deploy/config.sh
sudo install -d -o "$SERVICE_USER" -m 700 "$DATA_DIR"
sudo install -d -m 755 "$WEB_ROOT"
sudo cp -r frontend/dist/. "$WEB_ROOT/"
sudo chmod -R a+rX "$WEB_ROOT"
```

项目运行环境和 BACKEND_ENV 必须可被 SERVICE_USER 读取；密钥文件不要设为全员可读。
迁移旧数据库时先停止旧服务，再复制完整旧数据目录到 DATA_DIR，不能只复制运行中的 app.db。

## 3. 首次安装服务和 HTTP 站点

先停止旧的开发启动脚本，释放后端端口。只停止确认属于本项目的进程。

```bash
sudo install -m 644 deploy/.generated/moyin.service /etc/systemd/system/moyin.service
sudo systemctl daemon-reload
sudo systemctl enable --now moyin
```

如果 `/etc/nginx/sites-available/moyin` 或 `/etc/nginx/sites-enabled/moyin` 已存在，先核对并备份。特别是旧模板软链接，必须改为生成配置的普通文件；不要覆盖其他站点或已有 HTTPS 配置。
首次没有同名文件时执行：

```bash
sudo install -m 644 deploy/.generated/nginx.conf /etc/nginx/sites-available/moyin
sudo ln -s /etc/nginx/sites-available/moyin /etc/nginx/sites-enabled/moyin
sudo nginx -t
sudo systemctl reload nginx
```

仅在 nginx -t 成功后 reload。确保其他站点没有重复声明同一域名。

## 4. 免费 HTTPS

安装 Certbot 后执行（以下为 snap 安装方式，不与另一套 Certbot 混装）：

```bash
sudo apt install -y snapd
sudo snap install --classic certbot
source deploy/config.sh
sudo /snap/bin/certbot --nginx -d "$SITE_DOMAIN" --redirect
sudo /snap/bin/certbot renew --dry-run
```

Certbot 修改的是系统站点文件，不改仓库模板。私钥留在 `/etc/letsencrypt/`，不提交 Git。
服务为 production 模式，登录应在 HTTPS 就绪后使用。HTTPS 验收后关闭公网 5173/8000 入口。

## 5. 后续更新

更新前记录 Git 版本并备份。审核任务运行时避免更新，应安排维护窗口。
依赖发生变化时，在维护窗口运行 install.sh；它可能重建虚拟环境，不应在正在运行的服务上执行。

```bash
bash deploy/deploy.sh
source deploy/config.sh
sudo cp -r frontend/dist/. "$WEB_ROOT/"
sudo chmod -R a+rX "$WEB_ROOT"
sudo systemctl restart moyin
```

保留旧静态资源供已打开页面使用，不能自动清空数据或密钥。
**普通更新不重新安装 nginx.conf，以免覆盖 Certbot 配置。** 若域名、端口或目录变化，审阅生成配置后合并系统配置，并运行 nginx -t。
systemd 配置变化时重新 install 服务文件、daemon-reload、restart。数据库可能在启动时迁移，回滚须同时考虑代码与数据库版本。

## 6. 备份与迁移

完整备份需停机（开发进程也须停止），避免 SQLite WAL 和本地文件不一致：

```bash
sudo systemctl stop moyin
bash deploy/backup.sh /absolute/path/outside-data/backups
sudo systemctl start moyin
```

即使备份失败，也需检查并恢复服务。备份使用受限权限；服务用户与登录用户不同，应由可读取数据目录的用户执行。
另外单独安全保存 BACKEND_ENV，尤其是加密密钥，以及 Git 版本；备份包不包含这些信息。OSS 对象需单独保留或备份。

迁移顺序：克隆同一代码版本 → install.sh → 恢复部署参数和业务配置 → 停机恢复完整数据目录并设置 SERVICE_USER 所有权 → deploy.sh → 安装服务与站点 → 切换 DNS → 新服务器申请证书。
虚拟环境和 node_modules 不直接复制。切换期间停止旧服务器写入，不让两台独立 SQLite 实例同时接收业务。旧数据和服务器保留到新站验收完毕。

## 7. 人工验收

```bash
sudo systemctl status moyin nginx --no-pager
sudo journalctl -u moyin -n 60 --no-pager
sudo nginx -t
```

人工检查 HTTPS、登录、手机号、上传下载、审核以及刷新前端深层链接。
单 worker 保持现有审核进程结构；扩展进程数量前先审计任务并发领取机制。
