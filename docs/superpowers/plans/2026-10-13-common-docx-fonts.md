# 补充推荐的 DOCX 原字体

用户要求补齐此前推荐的华文楷体、华文仿宋、华文宋体、Symbol、Wingdings、Wingdings 3、Webdings 和 Aptos。按根 MEMORY.md 的当前源码/XML 优先及共享预览约束，在现有 `frontend/public/docx-fonts` 与字体注册表中补充，保持现有文件组织，不安装 Linux 字体，不增加其他字体类别，不改变缺字补齐策略。保留用户无关审核配置修改。

中文/符号字体复用清单中已有的三个仓库的固定提交，核对 Git blob、字体内部名称、版本、字形和 cmap。Aptos 从微软下载中心 id=106087 的官方下载包获取，保留原始 28 个字体和协议：Aptos、Display、Narrow、Mono、Serif 各四字形，Light、SemiBold、ExtraBold、Black 各两字形。按原始独立字体名称注册，不将特殊字重改为普通 Aptos；整个家族仍按 XML 实际使用的字体按需加载。

追加 `WINDOWS-FONTS.json` 来源与字体元数据、`SHA256SUMS` 校验值，官方 ZIP 记录原包 SHA256 及包内文件名；README 区分官方来源与社区仓库来源。Symbol 等沿用现有 Windows Symbol cmap / 私用区处理，不用普通字体替换其符号。

只进行 TypeScript no-emit、字体元数据/资源审计及差异核对，不运行测试、构建或浏览器插件。当前分支实施前后各一次提交，完成后通过 `bash deploy/run_dev.sh` 重启，删除本任务临时下载包、脚本及中间缓存。
