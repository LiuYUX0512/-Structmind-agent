# -*- coding: utf-8 -*-
"""智构 StructMind · 国赛级技术说明文档生成脚本
排版：A4 / 黑体标题(深蓝) + 宋体正文 / 动态TOC目录 / 页眉页脚页码 / 插图+图题 / 规范清单
生成：智构StructMind-技术说明文档.docx
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement

BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(BASE, "images")
OUT = os.path.join(BASE, "智构StructMind-技术说明文档.docx")

DEEP = RGBColor(0x0F, 0x4C, 0x81)
GRAY = RGBColor(0x5A, 0x6B, 0x7D)
INK = RGBColor(0x20, 0x2A, 0x33)


def set_font(run, east, west="Times New Roman", size=None, bold=None, color=None,
             italic=None):
    run.font.name = west
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:ascii"), west)
    rFonts.set(qn("w:hAnsi"), west)
    rFonts.set(qn("w:eastAsia"), east)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    if italic is not None:
        run.font.italic = italic


def strip_theme_font(rPr):
    """移除 rPr/rFonts 上的主题字体引用，避免 shadowing 冲突"""
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is not None:
        for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
            key = qn(attr)
            if rFonts.get(key) is not None:
                del rFonts.attrib[key]


def build_styles(doc):
    st = doc.styles
    def cfg(name, east, west, size, bold, color=INK, align=None, before=0,
            after=0, line=None, indent=None):
        s = st[name]
        s.font.size = Pt(size)
        s.font.bold = bold
        s.font.color.rgb = color
        pf = s.paragraph_format
        if align is not None:
            pf.alignment = align
        pf.space_before = Pt(before)
        pf.space_after = Pt(after)
        if line:
            pf.line_spacing = line
        if indent is not None:
            pf.first_line_indent = Cm(indent)
        # east asia font
        rPr = s.element.get_or_add_rPr()
        rFonts = rPr.find(qn("w:rFonts"))
        if rFonts is None:
            rFonts = OxmlElement("w:rFonts")
            rPr.append(rFonts)
        rFonts.set(qn("w:ascii"), west)
        rFonts.set(qn("w:hAnsi"), west)
        rFonts.set(qn("w:eastAsia"), east)
        strip_theme_font(rPr)
        return s

    cfg("Normal", "宋体", "Times New Roman", 12, False, INK, line=1.5)
    cfg("Title", "黑体", "Times New Roman", 24, True, DEEP, WD_ALIGN_PARAGRAPH.CENTER, after=12)
    cfg("Subtitle", "楷体", "Times New Roman", 14, False, GRAY, WD_ALIGN_PARAGRAPH.CENTER, after=12)
    cfg("Heading 1", "黑体", "Times New Roman", 16, True, DEEP, before=14, after=6)
    cfg("Heading 2", "黑体", "Times New Roman", 14, True, DEEP, before=11, after=5)
    cfg("Heading 3", "黑体", "Times New Roman", 12, True, INK, before=9, after=4)
    cfg("Caption", "宋体", "Times New Roman", 10.5, False, GRAY, WD_ALIGN_PARAGRAPH.CENTER, before=4, after=6)
    cfg("List Bullet", "宋体", "Times New Roman", 12, False, INK, line=1.3)


def add_para(doc, text, style="Normal", size=None, bold=None, color=None,
             align=None, east="宋体", after=None):
    p = doc.add_paragraph(style=style)
    run = p.add_run(text)
    set_font(run, east, size=size, bold=bold, color=color)
    if align is not None:
        p.alignment = align
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    return p


def add_caption(doc, text):
    add_para(doc, text, style="Caption")


def add_figure(doc, img, caption, width_cm=14.5):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True
    run = p.add_run()
    run.add_picture(img, width=Cm(width_cm))
    add_caption(doc, caption)


def set_table_props(t):
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.style = "Table Grid"
    tbl = t._tbl
    tblPr = tbl.tblPr
    # 禁止行跨页
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)
    # 表头重复
    first = t.rows[0]._tr
    trPr = first.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    trPr.append(header)


def set_shd(cell, fill):
    """以 OOXML schema 顺序插入 w:shd（置于 w:vAlign 之前）"""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill)
    vAlign = tcPr.find(qn("w:vAlign"))
    if vAlign is not None:
        vAlign.addprevious(shd)
    else:
        tcPr.append(shd)


def style_table(t, header_fill="0F4C81"):
    for j, cell in enumerate(t.rows[0].cells):
        set_shd(cell, header_fill)
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for r in p.runs:
            set_font(r, "黑体", size=10.5, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))
    for i, row in enumerate(t.rows[1:], start=1):
        for cell in row.cells:
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            for p in cell.paragraphs:
                p.paragraph_format.first_line_indent = Cm(0)
                for r in p.runs:
                    set_font(r, "宋体", size=10.5)


def add_table(doc, rows, header_fill="0F4C81"):
    n_cols = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=n_cols)
    set_table_props(t)
    for i, row in enumerate(rows):
        for j in range(n_cols):
            cell = t.cell(i, j)
            text = row[j] if j < len(row) else ""
            cell.text = ""
            p = cell.paragraphs[0]
            run = p.add_run(text)
            set_font(run, "宋体", size=10.5)
    style_table(t, header_fill)
    return t


def add_toc_field(doc):
    p = doc.add_paragraph()
    run = p.add_run()
    fldChar = OxmlElement("w:fldChar")
    fldChar.set(qn("w:fldCharType"), "begin")
    instrText = OxmlElement("w:instrText")
    instrText.set(qn("xml:space"), "preserve")
    instrText.text = 'TOC \\o "1-2" \\h \\z \\u'
    fldChar2 = OxmlElement("w:fldChar")
    fldChar2.set(qn("w:fldCharType"), "separate")
    t = OxmlElement("w:t")
    t.text = "右键“更新域”刷新目录"
    r2 = OxmlElement("w:r")
    r2.append(t)
    fldChar3 = OxmlElement("w:fldChar")
    fldChar3.set(qn("w:fldCharType"), "end")
    run._r.append(fldChar)
    run._r.append(instrText)
    run._r.append(fldChar2)
    run._r.append(r2)
    run._r.append(fldChar3)


def add_page_number_footer(section, start_at=1):
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run()
    set_font(run, "宋体", size=9)
    fldChar = OxmlElement("w:fldChar")
    fldChar.set(qn("w:fldCharType"), "begin")
    instrText = OxmlElement("w:instrText")
    instrText.set(qn("xml:space"), "preserve")
    instrText.text = "PAGE"
    fldChar2 = OxmlElement("w:fldChar")
    fldChar2.set(qn("w:fldCharType"), "end")
    run._r.append(fldChar)
    run._r.append(instrText)
    run._r.append(fldChar2)
    # 起始页码
    sectPr = section._sectPr
    pgNumType = sectPr.find(qn("w:pgNumType"))
    if pgNumType is None:
        pgNumType = OxmlElement("w:pgNumType")
        sectPr.append(pgNumType)
    pgNumType.set(qn("w:start"), str(start_at))


def add_header_text(section, text):
    header = section.header
    header.is_linked_to_previous = False
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run(text)
    set_font(run, "黑体", size=9, color=GRAY)


# ============ 文档组装 ============
doc = Document()
build_styles(doc)

sec = doc.sections[0]
sec.page_height = Cm(29.7)
sec.page_width = Cm(21.0)
sec.top_margin = Cm(2.5)
sec.bottom_margin = Cm(2.5)
sec.left_margin = Cm(2.8)
sec.right_margin = Cm(2.8)

# ---------- 封面分节 ----------
sec.header.is_linked_to_previous = False
sec.footer.is_linked_to_previous = False
# 封面装饰线
for _ in range(3):
    doc.add_paragraph()
add_para(doc, "“海之子杯” AI 智能体挑战赛", size=15, color=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, east="楷体")
add_para(doc, "西建大校内赛 · 参赛作品", size=13, color=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, east="楷体", after=24)
add_para(doc, "智构 StructMind", size=32, bold=True, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="黑体", after=6)
add_para(doc, "建筑结构方案优化 AI 智能体", size=16, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="楷体", after=18)
# 分隔线
line_p = doc.add_paragraph()
line_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
add_para(doc, "——  多智能体协同 · 规范可追溯 · 人工在环  ——", size=12, color=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, east="楷体", after=30)

add_para(doc, "作品简介", size=14, bold=True, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="黑体")
add_para(doc, "面向建筑方案阶段的多智能体协同结构选型与优化工具：输入工程参数即可自动生成多套候选结构方案，完成国标逐条校核、七维量化比选与综合推荐，让工程师在数分钟内获得可溯源、可干预、可导出的寻优结果。", size=11.5, color=INK, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=24)

add_para(doc, "线上 Demo：https://liuyux0512.github.io/-Structmind-agent/", size=11.5, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=4)
add_para(doc, "提交日期：2026 年 9 月 28 日", size=11.5, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=4)
add_para(doc, "团队 / 成员：＿＿＿＿＿＿＿＿（请填写）", size=11.5, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=4)

# ---------- 目录分节 ----------
sec2 = doc.add_section(WD_SECTION.NEW_PAGE)
sec2.top_margin = Cm(2.5)
sec2.bottom_margin = Cm(2.5)
sec2.left_margin = Cm(2.8)
sec2.right_margin = Cm(2.8)
sec2.header.is_linked_to_previous = False
sec2.footer.is_linked_to_previous = False
add_heading(doc, "目  录", level=1)
add_toc_field(doc)

# ---------- 正文分节 ----------
sec3 = doc.add_section(WD_SECTION.NEW_PAGE)
sec3.top_margin = Cm(2.5)
sec3.bottom_margin = Cm(2.5)
sec3.left_margin = Cm(2.8)
sec3.right_margin = Cm(2.8)
add_header_text(sec3, "智构 StructMind · 建筑结构方案优化 AI 智能体")
add_page_number_footer(sec3, start_at=1)

# 1. 项目背景与场景
add_heading(doc, "1. 项目背景与场景", 1)
add_heading(doc, "1.1 目标用户", 2)
add_para(doc, "本作品面向建筑结构方案阶段的设计决策人群，主要包括：结构工程师与方案设计团队、建筑设计单位前期技术部门、房地产开发与建设单位技术岗、土木工程相关专业师生，以及关注绿色低碳设计的技术决策者。")
add_heading(doc, "1.2 用户痛点与问题定义", 2)
add_para(doc, "建筑结构方案阶段存在三重痛点：其一，方案比选依赖人工试算与经验判断，从结构体系初选、截面拟定到规范校核、造价与碳排放评估，需在多个维度反复迭代，周期长、主观性强；其二，现行国家标准条目繁多、判定规则耦合复杂，人工逐条核对易遗漏，合规结论难以快速追溯条文依据；其三，造价、工期、绿色低碳等目标往往相互冲突，缺乏统一的多目标量化权衡手段，决策信息不完整。")
add_heading(doc, "1.3 使用场景", 2)
add_para(doc, "典型使用场景包括：新建多层/高层建筑方案前期比选、结构体系与截面快速探索、多方案“安全—经济—绿色”综合权衡、规范合规快速体检，以及作为 PKPM、YJK 等专业结构软件的“智能前端”进行方案阶段预筛选。")
add_heading(doc, "1.4 价值体现", 2)
add_para(doc, "本作品将方案阶段从“经验驱动”升级为“AI 协同驱动”：以多智能体协同完成结构选型、规范校核、经济与碳排放评估、综合推荐的全流程自动化，同时通过人工在环（HITL）机制将最终决策权保留在持证工程师手中，兼顾效率、合规与责任边界。")

# 2. 功能说明
add_heading(doc, "2. 功能说明", 1)
add_heading(doc, "2.1 核心功能", 2)
add_table(doc, [
    ["功能模块", "说明"],
    ["方案智能生成", "输入层数、面积、跨度、设防烈度、预算等工程参数，自动生成框架、框架-剪力墙、钢结构等候选方案并拟定初始截面"],
    ["规范逐条校核", "依据 GB 55002-2021、GB/T 50011-2010（2024 年版）等现行标准，对抗震、耐火、位移等指标逐条硬判定，输出限值对照与条文号"],
    ["七维综合比选", "从结构安全、经济性、施工可行性、规范合规、绿色低碳、可维护性、创新性七维量化评分，输出雷达图与推荐方案"],
    ["多目标经济评估", "对总造价、施工工期、单位面积碳排放进行多目标量化对比"],
    ["智能问答与干预", "支持语义意图解析与澄清；提供人工在环面板，可锁定方案、设定预算上限、注入工程备注并约束下重跑"],
    ["结果导出", "一键导出 PDF 优化报告，以及可供 PKPM/YJK 等专业软件继续建模的结构文件"],
], header_fill="0F4C81")

add_heading(doc, "2.2 技术方案与总体架构", 2)
add_para(doc, "系统采用“前端纯静态应用 + 多智能体协同管线”的整体架构，大模型仅承担意图理解与表达调度，不参与具体力学数值计算；规范校核与造价、碳排放计算全部走确定性硬编码规则引擎，从根本上规避结构计算领域的“大模型幻觉”风险。")
add_figure(doc, os.path.join(IMG, "fig_arch.png"), "图 1  智构 StructMind 多智能体协同总体架构")
add_para(doc, "管线包含五个核心智能体：意图理解 Agent 完成参数语义归一与歧义澄清；方案创作工程师生成候选体系与初始截面；规范校核工程师按现行国标逐条硬判定；经济评估工程师完成造价、工期、碳排放多目标量化；总工评审 Agent 汇聚各方论点，组织反思与辩论仲裁，给出加权评分、推荐方案、风险提示与置信度。规范知识库、硬编码计算引擎与人工干预入口分别向各智能体提供权威依据、确定性计算与决策约束。")

add_heading(doc, "2.3 Agent 真实推理机制", 2)
add_para(doc, "区别于“Prompt 串行”的伪智能体，本系统引入状态机与回退闭环：规范校核发现违规时，将问题写回共享上下文并打回方案创作重新选型；经济评估与总工评审在目标冲突时通过辩论与仲裁拍板，形成“校核—回退—重算—仲裁”的真实推理回路。执行全程以节点树与推理轨迹可视化呈现，评审可逐节点回看“思考—查规范—判定—重算”过程。")
add_figure(doc, os.path.join(IMG, "fig_flow.png"), "图 2  真实 Agent 推理回路：校核-回退-重算-仲裁")
add_para(doc, "为支撑该推理回路，系统对 LLM 工具调用进行了防错位改造：每次工具调用均记录调用参数（含 systemId），结果按参数键而非输出顺序对齐，杜绝乱序调用导致的数据错位；全部 LLM 调用内置自动重试与退避机制，网络抖动时自动降级并续跑。")

add_heading(doc, "2.4 方案比选与决策", 2)
add_para(doc, "系统对候选方案在七个维度进行归一化评分并绘制雷达图（数据为产品运行示例），同时对比总造价、施工工期与单位面积碳排放三项关键指标，为总工评审的加权推荐提供量化依据。")
add_figure(doc, os.path.join(IMG, "fig_radar.png"), "图 3  候选方案七维综合比选雷达图（示例数据）")
add_figure(doc, os.path.join(IMG, "fig_compare.png"), "图 4  三套候选方案关键指标对比（示例数据）")

add_heading(doc, "2.5 规范依据与合规可追溯", 2)
add_para(doc, "系统内置结构化规范知识库，逐条判定均绑定现行有效的标准条文与限值对照，点击条文号可展开原文，保证结论可追溯、可复核。现行依据如下：")
add_table(doc, [
    ["标准编号", "标准名称", "实施日期", "状态"],
    ["GB 55002-2021", "建筑与市政工程抗震通用规范", "2022-01-01", "现行 · 全文强制"],
    ["GB/T 50011-2010（2024 年版）", "建筑抗震设计标准", "2024-08-01", "现行（替代 GB 50011-2010 2016 年版）"],
    ["GB/T 51366-2019", "建筑碳排放计算标准", "2019-12-01", "现行"],
], header_fill="0F4C81")

add_heading(doc, "2.6 创新与差异化", 2)
add_para(doc, "其一，大模型只做调度、规则引擎算结构，隔离推理与计算，规避幻觉与权责风险；其二，多 Agent 真实协同（状态机 + 回退 + 辩论仲裁），而非线性 Prompt 串行；其三，规范校核走结构化规则判定而非纯文本检索，保证专业准确性；其四，人工在环机制将最终决策权留给工程师，体现人机协同；其五，面向 PKPM/YJK 等专业软件提供“智能前端”衔接，定位为专业软件的加速器而非替代者。")

# 3. 演示示例
add_heading(doc, "3. 演示示例", 1)
add_para(doc, "以一个八层办公楼为例：输入建筑面积 8000 平方米、跨度 8.4 米、设防烈度 7 度、预算 1.2 亿元，点击“启动方案智能生成”。系统依次调度意图理解、方案创作、规范校核、经济评估、总工评审五个智能体，展示完整推理轨迹；规范校核发现一项不满足时回退重算。最终给出三套候选方案（框架 / 框架-剪力墙 / 钢结构）及其七维比选雷达图与推荐结论。")
add_para(doc, "随后工程师可在“专家干预面板”锁定结构体系、设定预算上限并追加备注，系统在约束下重新寻优；一键导出 PDF 优化报告与结构建模文件，供专业软件继续深化。完整操作流程与解说见随附《核心功能演示视频》。")

# 4. 团队分工
add_heading(doc, "4. 团队分工", 1)
add_table(doc, [
    ["成员", "分工内容", "AI 参与环节"],
    ["＿＿＿（请填写）", "产品架构与系统设计；工程规则引擎、多智能体管线与前端开发", "通过豆包 / DeepSeek 等 AI 智能体完成代码生成、重构、评审与修复；AI 提出规范校核与多目标优化方案并经人工确认落地"],
    ["＿＿＿（请填写）", "（待补充：演示视频录制、文档排版、答辩准备等）", "（待补充）"],
], header_fill="0F4C81")
add_para(doc, "说明：人机协同的具体分工、AI 参与环节及修改验证过程，详见随附《人机协同履历表》。")

# 5. 完成度与后续规划
add_heading(doc, "5. 完成度与后续规划", 1)
add_para(doc, "当前版本已完成多智能体协同管线、规范硬判定、七维比选、3D 结构可视化、专家干预、PDF 与结构文件导出等核心能力，线上 Demo 可稳定运行，并通过类型检查、静态检查与专项回归测试全量验证。")
add_para(doc, "后续规划：接入真实专业结构计算内核（PKPM / YJK 接口），扩充场地类别、基础形式、风荷载等专家级参数，支持 CAD/Revit 模型导入，引入更多结构体系与建材碳排放数据库，逐步从“方案阶段智能前端”走向“设计-校核-优化”一体化工作台。")

# 免责声明
add_heading(doc, "附：免责声明", 1)
add_para(doc, "本作品的计算基于经验公式与简化假定，仅用于建筑方案前期概念比选与决策参考，不构成设计依据。实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。最终决策权始终在持证工程师手中，AI 仅提供量化建议。")

# 依据来源
add_heading(doc, "附：规范依据来源", 1)
add_table(doc, [
    ["标准", "发布公告来源"],
    ["GB 55002-2021", "住房和城乡建设部公告（2021-07-15）"],
    ["GB/T 50011-2010（2024 年版）", "住房和城乡建设部关于发布国家标准《建筑抗震设计规范》局部修订的公告（2024-05-24）"],
    ["GB/T 51366-2019", "住房和城乡建设部公告（2019-05-30）"],
], header_fill="0F4C81")

doc.save(OUT)
print("SAVED ->", OUT)
