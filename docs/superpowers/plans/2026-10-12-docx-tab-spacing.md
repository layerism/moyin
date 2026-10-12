# 修复 DOCX 制表符导致宋体 U+2003 缺字报错

用户反馈原字体模式在 U+2003 停止预览，属于已批准的 XML 字体功能缺陷修复。遵循根 MEMORY.md 的共享预览、原字体、静态审计、任务范围提交和 run_dev 重启约束。

当前 docx-preview 0.4.1 renderTab 用 h({ tagName: "span", children: ["\u2003"] }) 创建占位；非 experimental 模式未计算 Word 制表位。项目宋体 cmap 对 U+2003 返回 glyph 0，但普通空格映射为 glyph 3。仓库 11 份模板均含 w:tab，正文没有字面 U+2003。

在项目已有 h 钩子中精确识别这个生成节点，返回无文字的 docx-tab，CSS inline-block 宽度 1em、高度 0，沿用当前占位宽度并继承 XML 字号。实际 w:t 的字符由渲染器先变成 Text 节点，不能命中这条规则，因此真实正文 U+2003 仍执行缺字校验。不修改字体文件、字体槽位、依赖包，不恢复备用字体。完整 Word 制表位排版不纳入本次修复。

检查范围：源码调用链、模板 XML 和字体 cmap 审计、TypeScript no-emit 与差异检查；不运行测试、构建或浏览器。完成后提交并重启本地开发服务。
