# 补齐 DOCX Wingdings 2 原字体

用户在已批准的 XML 原字体预览中反馈缺少 Wingdings 2；这是原任务的缺项修复。遵循根 MEMORY.md 的项目内资源、任务范围提交、静态审计和 run_dev 重启约束，保留无关审核配置修改。

补齐原 wingdng2.ttf，登记确切字体族、版本、固定源提交、Git blob 与 SHA256；仅为 Wingdings 2 注册独立私有字体族，不使用其他字体替换。检查 Symbol 编码的 cmap 与 DOCX 的 w:sym 私用区字符，补全字形覆盖检查。更新项目字体说明和校验清单。实施前后各一次提交，不运行测试、构建或浏览器，完成后本地重启。

资源审计：字体内部名称 Wingdings 2，Version 1.55，固定源提交 8c980c24289cb08e03f72915970ce1bd6767e45a。原 cmap 为 Windows platform 3/encoding 0/format 4；F052、F0A3、F020 分别指向非零 glyph 53、133、3。模板还使用字节值 0052 和 00A3，因此在此符号字体内归一化为 F052/F0A3；这是原符号编码到原字形的映射，不是字体替换。编号字面符号同步归一化，保留原 CSS 计数器和非符号编号。

通过 TypeScript no-emit、差异格式、源 Git blob 和 SHA256 审计；未进行测试或浏览器视觉验证。
