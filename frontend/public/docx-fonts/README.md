# DOCX 项目原字体

此目录随前端部署。预览从 `/docx-fonts/` 加载文档指定的原字体，使用独立的 `MoyinDocx…` 字体族，不调用 `local()`，不读取 Linux 字体目录，不依赖字体 CDN。已删除 Fandol/Liberation 和 `fallback/`。未知字体仍明确报错；已加载的字体缺字时，仅对缺失字符使用下面规定的项目字体补齐，不替换整个字体族或整段文字。

## XML 配置与加载

字体配置直接取自 DOCX 的 `styles.xml`、正文、页眉页脚、脚注尾注、`numbering.xml`、主题及语言设置，保留文档默认、`basedOn`、段落样式、字符样式及直接格式的继承。`ascii`、`hAnsi`、`eastAsia`、`cs` 分别记录。同一段中的中英文按字符选择 XML 指定的字体，而非按一个 CSS 字体列表互相替换。编号、符号及页码字段也使用项目字体。

主题引用按引用名称的区域（EastAsia/Bidi/Ascii/HAnsi）解析，而非按引用所在的文字槽位判断。`settings.xml` 的 `themeFontLang` 分别通过 `eastAsia`、`bidi`、`val` 指定主题语言，其脚本映射优先于主题区域默认字体；未提供主题语言时使用区域默认字体，空区域再按 XML 继承的相应语言查找。校对语言 `w:lang/val=en-US` 不会覆盖东亚主题配置，`asciiTheme="minorEastAsia"` 也使用东亚主题语言。依据：[ThemeFontLanguages](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.themefontlanguages?view=openxml-3.0.1)。

XML 制表符 `w:tab` 采用无文字的 CSS 间距节点，保留当前渲染器的 1em 占位宽度，避免生成 U+2003 后错误要求宋体提供该字形。这不替换正文字符，也不关闭真实正文的缺字检查；完整 Word 制表位对齐仍受当前渲染器能力限制。

只对实际渲染的文本及编号加载所需字体和字形，未使用的样式不触发字体请求。文件与字体注册在页面内缓存，字体加载完成后再计算分页。中文只有普通字形时，在同一字体上合成粗体/斜体；有独立粗体或斜体的字体使用对应文件。

TTC 保留原文件，在浏览器内存中取出指定成员并重建 sfnt 容器，不修改字形；宋体和新宋体、微软雅黑和微软雅黑 UI 使用各自的成员。缺字体、文件解码失败或 XML 未提供所需字体配置时仍明确报错。

## 缺字补齐

每个实际需要的字形先检查原字体 `cmap`。只有缺失的字符才进入补齐流程：仿宋_GB2312 优先使用仿宋，楷体_GB2312 优先使用楷体；仍缺字或其他文字字体缺字时，依次检查项目宋体、微软雅黑，跳过原字体。保留原字符、字号、加粗和斜体要求，替代字体独立字形或同族合成规则不变。字体文件继续按需加载和缓存，不扫描或下载整个目录。

所有候选字体都缺字时，以已校验的项目宋体 `□` 占位，其余内容继续预览。私用区和符号字体中的缺字直接占位，不尝试用其他字体的同码位符号替代，因为符号含义可能不同。CSS 生成计数器无法逐字替换输出，若计数器所需字形在全部候选中都缺失，该编号整体占位，避免隐式调用系统字体。控制字符和 Unicode 默认可忽略字符不要求独立字形，保留原文本，不转为占位。

正文与生成编号共用补齐结果；相同原字体、字重、字形和码位在一次预览中只解析一次。同一预览中，相同编号字体与 Unicode 覆盖范围共用字体对象，关闭时释放编号字体。正文缺字使用独立字符片段，XML 单字体的公式/图形使用明确的项目字体链补齐。分页在字体处理完成后计算。

发生补齐或占位时，预览显示可展开的提示，列出原字体、补齐字体及字符码位，每组最多展示 12 种字符并注明总数。补齐可能改变字形、行高及换行，因此不保证与 Word 完全一致。这是项目固定的补齐策略，不声称复刻不同 Windows/Word 版本的字体回退顺序。

这仍是浏览器排版预览，并非 Word 排版引擎。无法匹配 XML 与渲染节点的结构、未支持的编号格式或公式/图形中的混合字体会明确提示下载原件，不静默替换。

## 原字体文件

| 字体 | 文件 |
| --- | --- |
| 宋体、新宋体 | `simsun.ttc` |
| 黑体 | `simhei.ttf` |
| 仿宋、仿宋_GB2312 | `simfang.ttf`、`fangsong_gb2312.ttf` |
| 楷体、楷体_GB2312 | `simkai.ttf`、`kaiti_gb2312.ttf` |
| 华文行楷、华文中宋 | `stxingka.ttf`、`stzhongs.ttf` |
| 华文宋体、华文楷体、华文仿宋 | `stsong.ttf`、`stkaiti.ttf`、`stfangso.ttf` |
| 微软雅黑、微软雅黑 UI | `msyh.ttc`、`msyhbd.ttc` |
| 微软雅黑 Light、微软雅黑 UI Light | `msyhl.ttc` |
| 等线 | `deng.ttf`、`dengb.ttf` |
| 等线 Light | `dengl.ttf` |
| Times New Roman | `times.ttf`、`timesbd.ttf`、`timesi.ttf`、`timesbi.ttf` |
| Arial | `arial.ttf`、`arialbd.ttf`、`ariali.ttf`、`arialbi.ttf` |
| Segoe UI | `segoeui.ttf`、`segoeuib.ttf`、`segoeuii.ttf`、`segoeuiz.ttf` |
| Open Sans | `OpenSans-Regular.ttf`、`OpenSans-Bold.ttf`、`OpenSans-Italic.ttf`、`OpenSans-BoldItalic.ttf` |
| Calibri | `calibri.ttf`、`calibrib.ttf`、`calibrii.ttf`、`calibriz.ttf` |
| Calibri Light | `calibril.ttf`、`calibrili.ttf` |
| Aptos | `aptos.ttf`、`aptos-bold.ttf`、`aptos-italic.ttf`、`aptos-bold-italic.ttf` |
| Aptos Display / Narrow / Mono / Serif | 对应 `aptos-display*`、`aptos-narrow*`、`aptos-mono*`、`aptos-serif*`，各四种字形 |
| Aptos Light / SemiBold / ExtraBold / Black | 对应 `aptos-light*`、`aptos-semibold*`、`aptos-extrabold*`、`aptos-black*`，各普通与斜体 |
| Consolas | `consola.ttf`、`consolab.ttf`、`consolai.ttf`、`consolaz.ttf` |
| Courier New | `cour.ttf`、`courbd.ttf`、`couri.ttf`、`courbi.ttf` |
| Cambria、Cambria Math | `cambria.ttc`、`cambriab.ttf`、`cambriai.ttf`、`cambriaz.ttf` |
| Wingdings 2 | `wingdng2.ttf` |
| Symbol、Wingdings、Wingdings 3、Webdings | `symbol.ttf`、`wingding.ttf`、`wingdng3.ttf`、`webdings.ttf` |

西文四个文件依次对应普通、粗体、斜体、粗斜体。微软雅黑和等线包含真实粗体；Light 是其独立字体族。华文中宋、Courier New 和 Cambria 是在仓库模板 XML 审计中发现的实际字体或样式引用，一并补充，避免替换。

符号字体保留 Windows Symbol 编码，覆盖检查同时识别 Symbol 编码与 DOCX `w:sym` 私用区字符，不将它替换为 Unicode 通用符号或其他字体。当前 Wingdings 2/3 文件为 Version 1.55，Symbol、Wingdings、Webdings 为 Version 5.00；缺字时按前述规则占位。

Aptos 使用微软官方下载包（下载页面版本 4.40，字体内部版本 2.01），共 28 个原始 TTF 文件，包含所有上述独立名称及配套字形。基础 Aptos、Display、Narrow、Mono、Serif 的粗体/斜体使用对应原文件；Light、SemiBold、ExtraBold、Black 作为 XML 可指定的独立字体族，保留文件本身的特殊字重，不改为普通 Aptos。字体选择仍取自 XML，不预加载整个家族。原包协议保留为 `aptos-eula.rtf`。

符号编码依据：[OpenType cmap 的 Windows Symbol 编码](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap#windows-platform-platform-id--3)。

Aptos 来自 [微软下载中心](https://www.microsoft.com/en-us/download/details.aspx?id=106087)，清单记录下载 URL、原包 SHA256 与原始包内文件名。Open Sans 来自 [Google Fonts 官方仓库](https://github.com/googlefonts/opensans/tree/bd7e37632246368c60fdcbd374dbf9bad11969b6)，保留四个原始静态 TTF 文件及 `OpenSans-OFL.txt` 授权文本。其余文件来自固定提交的社区上传仓库，并非字体厂商的官方下载；核对内部名称、版本和校验值不能证明取得 Web 分发授权。来源、Git blob（仓库来源）、内部名称、版权、版本及 SHA256 见 `WINDOWS-FONTS.json`。`SHA256SUMS` 仅记录保留的原字体。

替换或补充文件后刷新整个页面，以清除旧加载缓存。生产环境需要重新发布前端，确保 `dist/docx-fonts/` 同步删除旧备用文件。

解析依据：[RunFonts](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.runfonts?view=openxml-3.0.1)、[Word 字符槽位与继承规则 MS-OI29500 2.1.88](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/aef3c9a6-5d6c-434b-90b7-85e761fd8e62)。
