# DOCX 项目原字体

此目录随前端部署。预览只从 `/docx-fonts/` 加载文档指定的原字体，使用独立的 `MoyinDocx…` 字体族，不调用 `local()`，不读取 Linux 字体目录，不依赖字体 CDN。已删除 Fandol/Liberation 和 `fallback/`，不再将未知字体改为宋体，也不将 GB2312 字体改为新版。

## XML 配置与加载

字体配置直接取自 DOCX 的 `styles.xml`、正文、页眉页脚、脚注尾注、`numbering.xml`、主题及语言设置，保留文档默认、`basedOn`、段落样式、字符样式及直接格式的继承。`ascii`、`hAnsi`、`eastAsia`、`cs` 分别记录，主题引用在该段文字的语言上下文中解析。同一段中的中英文按字符选择 XML 指定的字体，而非按一个 CSS 字体列表互相替换。编号、符号及页码字段也使用项目字体。

XML 制表符 `w:tab` 采用无文字的 CSS 间距节点，保留当前渲染器的 1em 占位宽度，避免生成 U+2003 后错误要求宋体提供该字形。这不替换正文字符，也不关闭真实正文的缺字检查；完整 Word 制表位对齐仍受当前渲染器能力限制。

只对实际渲染的文本及编号加载所需字体和字形，未使用的样式不触发字体请求。文件与字体注册在页面内缓存，字体加载完成后再计算分页。中文只有普通字形时，在同一字体上合成粗体/斜体；有独立粗体或斜体的字体使用对应文件。

TTC 保留原文件，在浏览器内存中取出指定成员并重建 sfnt 容器，不修改字形；宋体和新宋体、微软雅黑和微软雅黑 UI 使用各自的成员。校验字体 `cmap`：缺字体、文件解码失败或字体缺少所需字符时，预览明确报错，避免浏览器为正文偷偷采用系统字形。没有提供 XML 字体配置的字符槽位也会提示错误。

这仍是浏览器排版预览，并非 Word 排版引擎。无法匹配 XML 与渲染节点的结构、未支持的编号格式或公式/图形中的混合字体会明确提示下载原件，不静默替换。

## 原字体文件

| 字体 | 文件 |
| --- | --- |
| 宋体、新宋体 | `simsun.ttc` |
| 黑体 | `simhei.ttf` |
| 仿宋、仿宋_GB2312 | `simfang.ttf`、`fangsong_gb2312.ttf` |
| 楷体、楷体_GB2312 | `simkai.ttf`、`kaiti_gb2312.ttf` |
| 华文行楷、华文中宋 | `stxingka.ttf`、`stzhongs.ttf` |
| 微软雅黑、微软雅黑 UI | `msyh.ttc`、`msyhbd.ttc` |
| 微软雅黑 Light、微软雅黑 UI Light | `msyhl.ttc` |
| 等线 | `deng.ttf`、`dengb.ttf` |
| 等线 Light | `dengl.ttf` |
| Times New Roman | `times.ttf`、`timesbd.ttf`、`timesi.ttf`、`timesbi.ttf` |
| Arial | `arial.ttf`、`arialbd.ttf`、`ariali.ttf`、`arialbi.ttf` |
| Calibri | `calibri.ttf`、`calibrib.ttf`、`calibrii.ttf`、`calibriz.ttf` |
| Calibri Light | `calibril.ttf`、`calibrili.ttf` |
| Consolas | `consola.ttf`、`consolab.ttf`、`consolai.ttf`、`consolaz.ttf` |
| Courier New | `cour.ttf`、`courbd.ttf`、`couri.ttf`、`courbi.ttf` |
| Cambria、Cambria Math | `cambria.ttc`、`cambriab.ttf`、`cambriai.ttf`、`cambriaz.ttf` |
| Wingdings 2 | `wingdng2.ttf` |

西文四个文件依次对应普通、粗体、斜体、粗斜体。微软雅黑和等线包含真实粗体；Light 是其独立字体族。华文中宋、Courier New 和 Cambria 是在仓库模板 XML 审计中发现的实际字体或样式引用，一并补充，避免替换。

Wingdings 2 为原版符号字体（当前文件 Version 1.55）。其 Windows Symbol 编码使用独立 `cmap`，覆盖检查同时识别 Symbol 编码与 DOCX `w:sym` 私用区字符，不将它替换为 Unicode 通用符号或其他字体。

符号编码依据：[OpenType cmap 的 Windows Symbol 编码](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap#windows-platform-platform-id--3)。

文件来自固定提交的社区上传仓库，并非字体厂商的官方下载；核对内部名称、版本和校验值不能证明取得 Web 分发授权。来源、Git blob、内部名称、版权、版本及 SHA256 见 `WINDOWS-FONTS.json`。`SHA256SUMS` 仅记录保留的原字体。

替换或补充文件后刷新整个页面，以清除旧加载缓存。生产环境需要重新发布前端，确保 `dist/docx-fonts/` 同步删除旧备用文件。

解析依据：[RunFonts](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.runfonts?view=openxml-3.0.1)、[Word 字符槽位与继承规则 MS-OI29500 2.1.88](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/aef3c9a6-5d6c-434b-90b7-85e761fd8e62)。
