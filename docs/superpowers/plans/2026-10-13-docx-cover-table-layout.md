# DOCX 封面表格布局修复

用户已确认：按 XML 修复固定表格宽度、单元格内文本框定位、边框和内边距，并审计分页兼容性。

## 已完成

- 固定布局且总宽自动的表格采用有效 tblGrid 列宽总和，保留现有 gridSpan、vMerge 和对齐解析。
- XML AlternateContent 与 docx-preview 0.4.1 一致选择 Fallback，避免重复计算文本框段落导致行距补充失效。
- 单元格内 text-relative VML 矩形文本框使用单元格定位上下文，恢复矩形与文本 inset；保留原字体及文本节点。
- 原有分页器克隆 DOM 时保留内联尺寸、定位和 SVG 子树。本次未改变分页算法。

## 验证及边界

- TypeScript 无输出类型检查通过；git diff --check 通过。
- 审阅本地论文模板 XML 和固定版本依赖源码；未运行测试或浏览器验证。
- 仅补充 VML t202 矩形文本框，不声称完整支持任意 DrawingML 浮动形状或 Word 排版。
- 交付时提交任务文件并使用 deploy/run_dev.sh 重启。
