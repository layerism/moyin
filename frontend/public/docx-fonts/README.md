# DOCX 项目字体

此目录随前端部署，浏览器从 `/docx-fonts/` 加载字体，不依赖服务器或访问者的系统字体库。预览采用独立的 `MoyinDocx…` 字体族，不调用 `local()`。按文档使用的字体、字重及斜体加载所需文件，加载完成后再计算分页。

## 原版字体文件

指定字体文件优先从本目录读取，缺失或无法解码时使用 `fallback/` 内的备用文件。当前已按用户要求下载宋体、新宋体、黑体、仿宋、楷体、仿宋_GB2312、楷体_GB2312、华文行楷与 Times New Roman 四种字形，字体内部名称和版本已核对。微软雅黑、等线、Arial、Calibri、Consolas 尚未提供指定文件，仍使用备用字体。

本次文件来自社区上传仓库，而非字体厂商的官方下载；文件名称、版本和字节校验不能证明官方来源或取得 Web 分发授权。这些 Windows/Office 字体不适用 `fallback/` 的开源授权；公开部署前须核实对应字体的 Web 使用及分发授权。此目录文件可通过 HTTP 下载。来源、固定提交、内部名称、版权、版本及 SHA256 见 `WINDOWS-FONTS.json`。

| 文档字体 | 本目录中约定的原版文件 | 项目备用字体 |
| --- | --- | --- |
| 宋体、新宋体 | `simsun.ttc` | FandolSong |
| 仿宋、FangSong | `simfang.ttf` | FandolFang |
| 仿宋_GB2312、FangSong_GB2312 | `fangsong_gb2312.ttf`，再尝试 `simfang.ttf` | FandolFang |
| 黑体、SimHei | `simhei.ttf` | FandolHei |
| 微软雅黑 | `msyh.ttc` | FandolHei |
| 等线 | `deng.ttf` | FandolHei |
| 楷体、KaiTi | `simkai.ttf` | FandolKai |
| 楷体_GB2312 | `kaiti_gb2312.ttf`，再尝试 `simkai.ttf` | FandolKai |
| 华文行楷 | `stxingka.ttf` | FandolKai |
| Times New Roman | `times.ttf`、`timesbd.ttf`、`timesi.ttf`、`timesbi.ttf` | Liberation Serif |
| Arial | `arial.ttf`、`arialbd.ttf`、`ariali.ttf`、`arialbi.ttf` | Liberation Sans |
| Calibri | `calibri.ttf`、`calibrib.ttf`、`calibrii.ttf`、`calibriz.ttf` | Liberation Sans |
| Consolas、monospace | `consola.ttf`、`consolab.ttf`、`consolai.ttf`、`consolaz.ttf` | Liberation Mono |

西文字体文件按普通、粗体、斜体、粗斜体顺序列出。中文注册普通字重，其他字重和斜体沿用浏览器对字体的合成。DOCX 页面显式启用 `font-synthesis: weight style`，覆盖应用全局的 `font-synthesis: none`，使 XML 指定的粗体及斜体生效；Times New Roman 使用独立的粗体、斜体文件。未知字体使用项目宋体备用；字体族末尾追加项目宋体以覆盖中文。备用资源也加载失败时预览报错，不能静默改用系统字体。

备用字体与 Windows 原版字形并不相同。例如 FandolKai 不是华文行楷，Liberation Sans 也不是 Calibri。字形、字宽和分页仍可能存在差异。浏览器对字体未覆盖字符的系统字形回退不能完全消除。当前策略忽略 DOCX 内嵌字体，仅使用此目录的项目字体。

字体加载在当前页面内缓存。替换或补充原版文件后刷新整个页面；生产环境需重新发布前端，使文件复制到 `dist/docx-fonts/`。

## 已分发的备用字体

- **Fandol 0.3**：宋、黑、楷、仿宋普通字重。源文件未转换或修改。上游包：[CTAN Fandol](https://ctan.org/pkg/fandol)，本次下载地址 `https://mirrors.tuna.tsinghua.edu.cn/CTAN/fonts/fandol.zip`。原始说明与 GPL 3 授权全文见 `licenses/Fandol-README`、`licenses/Fandol-COPYING`；上游声明包含 GPL font exception。
- **Liberation 2.1.5**：Serif、Sans、Mono 的普通、粗体、斜体、粗斜体，共 12 个未经修改的 TTF 文件。本次取自 Debian `fonts-liberation2` 包 `2.1.5-1`；上游：[Liberation Fonts](https://github.com/liberationfonts/liberation-fonts)。字体适用 SIL OFL 1.1，完整版权和授权见 `licenses/Liberation-COPYRIGHT`。

`SHA256SUMS` 记录指定字体与备用字体的校验值。运行时只读取项目目录，不读取 Debian 或 Linux 的字体目录，也不依赖外部字体 CDN。
