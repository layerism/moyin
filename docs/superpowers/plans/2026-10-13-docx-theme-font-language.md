# 修复 minorEastAsia 被按英文语言解析

用户在已批准的 XML 原字体预览中反馈 minorEastAsia（en-US）报错，继续修复该功能；保持现有文件组织。遵循根 MEMORY.md 的当前源码/XML 优先、任务范围提交、无测试或浏览器、项目 run_dev 重启约束，保留无关审核配置修改。

源码问题：加载器按文字脚本槽位（ascii/hAnsi/eastAsia/cs）选语言，却允许 XML 的 asciiTheme/hAnsiTheme 指向 minorEastAsia。仓库论文正文有 679 个 asciiTheme、679 个 hAnsiTheme 使用 minorEastAsia；settings.xml 主题语言为 val=en-US、eastAsia=zh-CN，主题 minorFont 的 ea 为空，但 Hans 配置为宋体。因此用 en-US 查找东亚主题字体会错误报缺项。

修复：向主题解析器传入完整的 XML 继承语言（包含段落标记语言）。解析器按主题 token 的 EastAsia/Bidi/Ascii/HAnsi 类别选取 settings/themeFontLang 对应属性，主题语言独立于文字校对语言和所在字体槽位。显式主题语言优先选择主题中的脚本映射，否则沿用该区域默认字体；缺失时才使用对应 XML 继承语言解析空区域配置。不按 en-US 推断中文，不固定使用宋体，不恢复替代字体。

依据：Microsoft ThemeFontLanguages / ISO 29500 17.15.1.88：https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.themefontlanguages?view=openxml-3.0.1。

只审计源码、模板 XML、TypeScript no-emit 与差异格式。未运行测试、构建或浏览器验证；完成后提交并重启。
