# DOCX 原始页面参数与连续表格分页

用户已确认：默认使用 DOCX XML 的页面尺寸、页边距和表格宽度，保留手动 A4/A3 重排；让超高表格行使用当前页剩余空间；补齐字体和段落网格参数。

继续复用 docx-preview 0.4.1 的解析与样式继承，启用页面及单元格宽度读取。每页高度按其原始节设置固定，手动纸张选择只覆盖页面大小。修正页脚净占用高度的计算，避免同时扣除已有底部页边距和落在该区域内的页脚。

表格先保留能完整放入的行，再尝试将下一行或合并组的正文填入本页，余下部分才移到续页。沿用已实现的单元格分片、列宽、边框及合并属性；分片失败恢复完整行分页，不能重复或丢失正文。

通过已安装的 fflate 读取 document/styles/settings XML，以局部适配模块补充库遗漏的 hAnsi 字体、段前段后行单位、最小行距和网格参数；字体与字号仍由 XML 和已有样式继承决定。文档网格遵循 [Open XML LinePitch](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.docgrid.linepitch?view=openxml-3.0.1)：固定行距和 snapToGrid 关闭时不套用网格，表格内仅在 adjustLineHeightInTable 兼容设置启用时应用。浏览器字体可用性与 Word 排版引擎差异仍需明确，不承诺一致页码。

遵循根 MEMORY.md 的共享预览与任务范围约束：所有 DocxPreview 入口同步生效，保留原文件、权限及用户已有配置。实施前后各提交一次检查点，仅做静态类型与逻辑审计，不运行测试、构建或浏览器；检查项目中间缓存，并通过 deploy/run_dev.sh 重启开发服务。
