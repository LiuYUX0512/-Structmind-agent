# -*- coding: utf-8 -*-
"""智构 StructMind · 国赛级技术说明文档生成脚本
排版：A4 / 黑体标题(深蓝) + 宋体正文 / 动态TOC目录 / 页眉页脚页码 / 插图+图题 / 规范清单
正文结构：严格按官方模板（背景与场景 / 功能说明 / 演示示例 / 团队分工）
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
add_para(doc, "团队成员：刘宇翔（负责人）、李国扬、吕勇宽、张盛涵", size=11.5, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=4)
add_para(doc, "所属学院：土木工程 · 指导教师：无", size=11.5, color=DEEP, align=WD_ALIGN_PARAGRAPH.CENTER, east="宋体", after=4)

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


# ============ 一、背景与场景 ============
add_heading(doc, "1. 背景与场景", 1)

add_heading(doc, "1.1 目标用户", 2)
add_para(doc, "智构 StructMind 主要面向结构工程师、设计院以及从事建筑结构方案前期设计的专业人员。该用户群体具备土木工程专业背景，熟悉结构概念设计与规范条文，数字化工具使用能力较强，日常高频使用 PKPM、YJK、Revit、AutoCAD 等专业软件，关注方案的安全性、经济性与合规性，期望在方案阶段快速完成多方案试算与比选，而非在繁琐的人工算量中消耗时间。")

add_heading(doc, "1.2 用户痛点与问题定义", 2)
add_para(doc, "结构方案前期设计长期依赖人工试算与经验判断，主要存在以下痛点：")
add_table(doc, [
    ["痛点", "具体场景", "现有方式不足", "要解决的核心问题"],
    ["人工比对耗时", "结构体系、材料用量、抗震性能、造价、工期、碳排放等多目标反复试算", "单方案比选常需数天，试错成本高", "将“数天”压缩至“分钟级”"],
    ["多目标难兼顾", "安全、经济、低碳互相制约，需全局寻优", "工程师凭经验权衡，顾此失彼、难达全局最优", "多目标自动寻优"],
    ["经验依赖强、易漏检", "规范条文繁多（GB 55002、GB/T 50011 等）", "人工逐条核对，新手与资深工程师产出差距大，存在漏检漏判风险", "规范强条自动判定、逐条可追溯"],
], header_fill="0F4C81")

add_heading(doc, "1.3 使用场景", 2)
add_para(doc, "场景一（方案前期多目标比选）：结构工程师在拿到建筑方案后，输入建筑面积、层数、跨度、设防烈度、预算等参数，智构自动生成多套结构候选方案（框架 / 框架—剪力墙 / 钢结构），并完成规范校核与造价、工期、碳排放估算，输出七维比选雷达图与推荐结论，帮助工程师在数分钟内锁定可深入设计的方案方向。")
add_para(doc, "场景二（方案敏感度与约束试算）：当预算收紧或场地条件变化时，工程师修改个别参数（如降低设防烈度、缩小跨度），智构仅对改动部分重新寻优，快速评估其对造价与安全的影响，辅助工程师在与甲方或审图方的多轮沟通中灵活决策。")

add_heading(doc, "1.4 价值体现", 2)
add_para(doc, "其一，效率提升——方案生成与比选效率较人工可提升约 80%（以方案前期阶段计），单轮多目标比选由“数天”压缩至“分钟级”；其二，决策更科学——以确定性计算引擎保证工程数值精准，多 Agent 协同与辩论机制让方案在安全、经济、低碳之间真实收敛；其三，合规更可靠——规范强条自动判定、逐条可追溯，降低漏检漏判风险；其四，人机协同——引入专家干预，AI 提供量化建议，最终决策权始终在持证工程师手中。")


# ============ 二、功能说明 ============
add_heading(doc, "2. 功能说明", 1)

add_heading(doc, "2.1 核心功能", 2)
add_para(doc, "系统以四类 AI 智能体构建“虚拟工程部”，各司其职、接力协作：")
add_table(doc, [
    ["功能模块", "用户输入", "处理方式", "输出结果", "解决的问题"],
    ["参数录入", "建筑面积、层数、跨度、设防烈度、场地类别、预算等", "表单 + 自然语言", "结构化工程参数", "参数输入繁琐"],
    ["方案生成", "工程参数", "Architect 生成多体系候选方案", "多套结构候选方案", "人工试算耗时"],
    ["规范校核", "候选方案", "Code 执行现行国标强条判定", "逐条校核结论（含条文依据）", "规范漏检漏判"],
    ["经济评估", "合规方案", "Economist 核算造价/工期/碳排放", "多维经济指标", "多目标难权衡"],
    ["对比分析", "多方案结果", "七维比选", "比选雷达图 + 推荐结论", "方案优劣难直观"],
    ["智能问答", "自然语言（如“帮我砍预算”）", "LLM 意图解析 + 工具调度", "针对性方案调整", "交互门槛高"],
], header_fill="0F4C81")
add_para(doc, "四 Agent 协同管线（核心亮点）：方案创作（Architect）→ 规范校核（Code）→ 经济评估（Economist）→ 总工评审（Chief），四类智能体接力协作、层层递进。")
add_table(doc, [
    ["Agent", "角色", "核心职责"],
    ["Architect", "方案创作", "依据参数与约束生成候选结构体系与截面方案"],
    ["Code", "规范校核", "对方案执行现行国标强条判定，识别违规项"],
    ["Economist", "经济评估", "对合规方案核算造价、工期、碳排放"],
    ["Chief", "总工评审", "综合多目标仲裁，输出最终推荐与风险提示"],
], header_fill="0F4C81")
add_para(doc, "多 Agent 辩论机制（核心亮点）：本项目不止于串行流水线，更引入状态机回退辩论机制——Code 发现规范违规时，把问题写回共享上下文并“打回”Architect 重新选型；重新校核通过后交 Economist 核算，再由 Chief 对冲突论点仲裁，直至满足约束或达到最大回退次数。该机制让系统具备“发现—纠错—重算—仲裁”的闭环能力，而非一次性预演式给出结果。")

add_heading(doc, "2.2 技术方案", 2)
add_para(doc, "整体流程：用户输入工程参数或自然语言 → LLM 意图调度理解需求、拆解任务 → 依次调度 Architect（出方案）、Code（校核）、Economist（算钱）、Chief（仲裁）四个 Agent，各 Agent 共享上下文、协作推进 → 确定性计算引擎产出全部数值 → 前端以推理轨迹看板呈现完整过程并输出最终方案。")
add_para(doc, "架构核心（确定性计算引擎 + LLM 意图调度）：本项目采用“前端 React + TypeScript 直连大模型 + 确定性计算引擎”架构，核心原则是大模型不参与数值计算。")
add_table(doc, [
    ["引擎", "职责", "原则"],
    ["确定性计算引擎", "配筋率、挠度、造价、碳排放等全部数值计算，内置国标规则与因子库", "硬编码规则引擎，工程数据 100% 精准"],
    ["LLM 意图调度", "理解自然语言、拆解任务、调度 Agent、整理输出", "只做“调度员/翻译官”，不判定数值"],
], header_fill="0F4C81")
add_para(doc, "该架构从底层杜绝大模型在结构计算上的“幻觉”风险：大模型只负责理解与调度，一切工程数值由确定性引擎产出，结论可复核、可追溯。")
add_para(doc, "提示词与交互设计：为各 Agent 设计了角色设定、任务指令与输出格式约束；支持多轮追问与异常提示（如参数越界、规范不满足时主动告警并回退重算）。")
add_para(doc, "工作流与工具调用：各 Agent 通过统一工具接口调用规范校核、经济估算、比选寻优等确定性工具，工具调用参数与结果均记录于推理轨迹，支持溯源。")
add_para(doc, "自主开发情况：本项目自主完成前端开发（React 19 + TypeScript + Vite），部署于 GitHub Pages；后端提供轻量级 API 代理层，实现 Key 托管、请求限频与白名单保护；规范知识库以结构化 JSON 轻量实现，覆盖 GB 55002-2021、GB/T 50011-2010（2024 年版）、GB/T 51366-2019 等现行标准。")

add_heading(doc, "2.3 功能架构图", 2)
add_figure(doc, os.path.join(IMG, "fig_arch.png"), "图 1  智构 StructMind 多智能体协同总体架构")
add_figure(doc, os.path.join(IMG, "fig_flow.png"), "图 2  真实 Agent 推理回路：校核-回退-重算-仲裁")
add_para(doc, "系统内置结构化规范知识库，逐条判定均绑定现行有效的标准条文与限值对照，点击条文号可展开原文，保证结论可追溯、可复核。")

add_heading(doc, "2.4 创新与差异化", 2)
add_para(doc, "创新一（状态机回退辩论机制）：以状态机替代线性流水线，支持“校核违规→打回重算→重新仲裁”的循环回退，实现多 Agent 间的真实对抗与收敛，区别于普通 Prompt 串行工作流。")
add_para(doc, "创新二（人类在环 HITL）：引入专家干预面板，支持人工锁定方案、设定预算上限、强制调整评分权重、注入备注；干预信息写入推理轨迹，体现“人机协同、人做最终决策”的安全边界。")
add_para(doc, "创新三（规范知识图谱的轻量化实现）：将 GB 55002、GB/T 50011 等强条拆解为结构化逻辑判断树与判定函数，替代纯文本检索，实现“逐条可追溯、结论带条文依据”的精准校核，规避 RAG 在复杂强条上的检索失真。")

add_heading(doc, "2.5 作品完成度", 2)
add_para(doc, "当前完成度：UI 层已完备（参数面板、推理看板、3D 可视化、对比分析），底层 Agent 状态机与辩论机制已部署上线，线上 Demo 可正常复现运行，并通过类型检查、静态检查与专项回归测试全量验证。")
add_para(doc, "存在的不足：规范知识库覆盖仍以常用强条为主，复杂条文（如抗震等级随高度调整）的判定逻辑仍在持续完善；暂未接入专业软件接口。")
add_para(doc, "后续优化方向：①接入 BIM 模型（支持 DXF/Revit 模型导入，自动提取梁柱轴线）；②扩充规范知识库，完善知识图谱覆盖；③对接 PKPM/YJK 等专业软件，形成“智能前端 + 专业后端”闭环。")


# ============ 三、演示示例 ============
add_heading(doc, "3. 演示示例", 1)

add_heading(doc, "3.1 访问方式", 2)
add_para(doc, "访问链接：https://liuyux0512.github.io/-Structmind-agent/。无需登录、无需 API Key（演示模式可直接运行），手机与电脑浏览器均可打开。")
add_para(doc, "使用步骤：① 打开链接进入首页；② 在参数录入区输入建筑面积、层数、跨度、设防烈度、预算等参数；③ 点击“启动方案智能生成”，观察四 Agent 协同推理轨迹；④ 查看三套候选方案及七维比选雷达图；⑤ 查看 Chief 综合推荐、风险提示与置信度。")
add_para(doc, "测试问题：①“帮我做一个八层办公楼，建筑面积 8000㎡，跨度 8.4 米，设防烈度 7 度”；②“预算收紧到 1.2 亿，帮我重新比选”；③“哪套方案碳排放最低？”")

add_heading(doc, "3.2 案例展示", 2)
add_figure(doc, os.path.join(IMG, "ui_demo.png"), "图 3  智构 StructMind 产品主界面（线上 Demo）", width_cm=12.0)
add_para(doc, "案例流程：输入上述测试问题①后，系统依次调度意图理解、方案创作、规范校核、经济评估、总工评审五个智能体，完整展示推理轨迹；规范校核发现某项不满足时自动回退重算。最终输出三套候选方案（框架 / 框架—剪力墙 / 钢结构）及七维比选雷达图与关键指标对比（以下为运行示例数据）。")
add_figure(doc, os.path.join(IMG, "fig_radar.png"), "图 4  候选方案七维综合比选雷达图（示例数据）")
add_figure(doc, os.path.join(IMG, "fig_compare.png"), "图 5  三套候选方案关键指标对比（示例数据）")
add_para(doc, "随后工程师可在“专家干预面板”锁定结构体系、设定预算上限并追加备注，系统在约束下重新寻优；一键导出 PDF 优化报告与结构建模文件，供专业软件继续深化。完整操作流程与解说见随附《核心功能演示视频》。")


# ============ 团队分工 ============
add_heading(doc, "团队分工", 1)
add_table(doc, [
    ["成员", "分工内容", "AI 参与环节"],
    ["刘宇翔（负责人）", "产品架构与系统设计；工程规则引擎、多智能体管线、前端开发与 3D 可视化", "通过 AI 智能体完成核心代码生成、重构、评审与修复；AI 提出规范校核与多目标优化方案并经人工确认落地"],
    ["李国扬", "界面设计与交互、演示视频录制", "使用 AI 辅助界面设计与文案，人工修订验证"],
    ["吕勇宽", "规范口径梳理、测试验证与文档排版", "使用 AI 辅助规范条文整理与文档排版，人工复核"],
    ["张盛涵", "演示材料、答辩准备与项目资料整理", "使用 AI 辅助内容组织与文案，人工修订验证"],
], header_fill="0F4C81")
add_para(doc, "说明：本项目为 AI 智能体挑战赛参赛作品，开发全程采用“人机协同”模式——AI 负责代码生成、数据与排版辅助，人工负责方案逻辑、规范核验与最终决策，所有环节均经人工复核验证。具体分工、AI 参与环节及修改验证过程，详见随附《人机协同履历表》。")


# ============ 附录 ============
add_heading(doc, "附：免责声明", 1)
add_para(doc, "本作品的计算基于经验公式与简化假定，仅用于建筑方案前期概念比选与决策参考，不构成设计依据。实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。最终决策权始终在持证工程师手中，AI 仅提供量化建议。")

add_heading(doc, "附：规范依据来源", 1)
add_table(doc, [
    ["标准", "发布公告来源"],
    ["GB 55002-2021", "住房和城乡建设部公告（2021-07-15）"],
    ["GB/T 50011-2010（2024 年版）", "住房和城乡建设部关于发布国家标准《建筑抗震设计规范》局部修订的公告（2024-05-24）"],
    ["GB/T 51366-2019", "住房和城乡建设部公告（2019-05-30）"],
], header_fill="0F4C81")

doc.save(OUT)
print("SAVED ->", OUT)
