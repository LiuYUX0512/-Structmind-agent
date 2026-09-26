# -*- coding: utf-8 -*-
"""
智构 StructMind · 参赛材料一键生成脚本
生成两份 Word 文档：
  1. 智构StructMind-技术说明文档.docx（按官方说明文档模板结构）
  2. 智构StructMind-人机协同履历表.docx（按官方履历表模板结构）
运行：双击本脚本所在目录下的 run-docs.bat，或在 PowerShell 执行：
  python docs/gen-docs.py
依赖：python-docx（若缺失会自动尝试安装）
"""
import os
import sys
import re

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = BASE  # 输出到 docs/ 目录

try:
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml.ns import qn
except ImportError:
    print("缺少 python-docx，正在尝试安装 ...")
    os.system(f'"{sys.executable}" -m pip install python-docx --quiet')
    try:
        from docx import Document
        from docx.shared import Pt, Cm, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.enum.table import WD_TABLE_ALIGNMENT
        from docx.oxml.ns import qn
    except ImportError:
        print("安装失败，请手动执行：pip install python-docx")
        sys.exit(1)

TEAL = RGBColor(0x0F, 0x4C, 0x81)
GRAY = RGBColor(0x64, 0x74, 0x8B)


def set_cn_font(run, name="宋体", size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def add_para(doc, text, style=None, size=12, bold=False, align=None, color=None, font="宋体"):
    p = doc.add_paragraph(style=style)
    if align:
        p.alignment = align
    run = p.add_run(text)
    set_cn_font(run, font, size, bold, color)
    return p


def add_md_table(doc, rows):
    """rows: list[list[str]]，首行为表头"""
    n_cols = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=n_cols)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j in range(n_cols):
            cell = t.cell(i, j)
            text = row[j] if j < len(row) else ""
            cell.text = ""
            p = cell.paragraphs[0]
            run = p.add_run(text)
            set_cn_font(run, "宋体", 10, bold=(i == 0))
            if i == 0:
                shd = cell._tc.get_or_add_tcPr().makeelement(qn("w:shd"), {qn("w:val"): "clear", qn("w:fill"): "EAF2FB"})
                cell._tc.get_or_add_tcPr().append(shd)
    doc.add_paragraph()
    return t


def add_flow_chart(doc, text):
    """以等宽字体渲染架构图 ASCII 流程图"""
    for line in text.splitlines():
        if not line.strip():
            doc.add_paragraph()
            continue
        p = doc.add_paragraph()
        run = p.add_run(line)
        set_cn_font(run, "Courier New", 9, False)
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    doc.add_paragraph()


def parse_md(md_text):
    """极简 md 解析 → 返回指令列表 [(kind, payload)]"""
    blocks = []
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.startswith("### "):
            blocks.append(("h3", line[4:].strip()))
        elif line.startswith("## "):
            blocks.append(("h2", line[3:].strip()))
        elif line.startswith("# "):
            blocks.append(("h1", line[2:].strip()))
        elif line.startswith("---"):
            blocks.append(("hr", None))
        elif line.startswith("- "):
            blocks.append(("li", line[2:].strip()))
        elif line.startswith("> "):
            blocks.append(("quote", line[2:].strip()))
        elif line.startswith("|"):
            table = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                table.append(cells)
                i += 1
            blocks.append(("table", table))
            continue
        else:
            blocks.append(("p", line.strip()))
        i += 1
    return blocks


def render(doc, blocks):
    for kind, payload in blocks:
        if kind == "h1":
            add_para(doc, payload, size=17, bold=True, color=TEAL)
        elif kind == "h2":
            add_para(doc, payload, size=16, bold=True, color=TEAL)
        elif kind == "h3":
            add_para(doc, payload, size=13, bold=True)
        elif kind == "li":
            add_para(doc, "• " + payload, size=12)
        elif kind == "quote":
            add_para(doc, payload, size=11, color=GRAY)
        elif kind == "p":
            add_para(doc, payload, size=12)
        elif kind == "table":
            add_md_table(doc, payload)
        elif kind == "hr":
            doc.add_paragraph()


FLOW_CHART = """用户输入工程参数
      │
      ▼
┌───────────────────────────────┐
│ ① 意图理解 Agent（intent.ts）  │
│ 解析参数 / 语义归一 / 补全      │
└───────────────────────────────┘
      │
      ▼
┌───────────────────────────────┐
│ ② 方案创作工程师（pipeline.ts）│
│ 生成候选体系 + 初始截面          │
└───────────────────────────────┘
      │  校核失败 → 回退重算 ┐
      ▼                     │
┌───────────────────────────┴──┐
│ ③ 规范校核工程师（real-engine）│
│ 抗震/耐火/位移 逐条硬判定       │
└──────────────────────────────┘
      │
      ▼
┌───────────────────────────────┐
│ ④ 经济评估工程师（optimizer）  │
│ 造价/工期/碳排放 多目标量化     │
└───────────────────────────────┘
      │
      ▼
┌───────────────────────────────┐
│ ⑤ 总工评审 Agent（反思+辩论+仲裁）│
│ 加权评分 → 推荐 + 风险 + 置信度  │
└───────────────────────────────┘
      │
      ▼
    综合比选 · 规范校核报告 · 智能问答 · 导出
                ▲
                │ 人工干预（锁定/预算上限/备注）
             工程师决策入口（HITL）"""


def gen_tech_doc():
    md_path = os.path.join(BASE, "技术说明文档.md")
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2.5)
        section.bottom_margin = Cm(2.5)
        section.left_margin = Cm(2.8)
        section.right_margin = Cm(2.8)
    # 封面
    add_para(doc, "海之子杯 AI 智能体挑战赛 · 西建大校内赛", size=12, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_para(doc, "智构 StructMind · 建筑结构方案优化 AI 智能体", size=20, bold=True, color=TEAL, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_para(doc, "作品简介：面向建筑方案阶段的多 Agent 协同结构选型与优化工具，输入工程参数即可自动生成多套候选结构方案，完成规范逐条校核、七维量化比选与综合推荐，让工程师快速获得可溯源、可干预的寻优结果。", size=11, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_para(doc, "作品链接：https://liuyux0512.github.io/-Structmind-agent/", size=11, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_para(doc, "提交日期：2026 年 9 月 28 日", size=11, align=WD_ALIGN_PARAGRAPH.CENTER)
    doc.add_page_break()

    # 按小节切分渲染：1 背景、2.1/2.2/2.4/2.5、2.3 用流程图、3、4
    secs = [
        ("# 1. 背景与场景", "# 2. 功能说明"),
        ("# 2. 功能说明", "## 2.3 功能架构图"),
        ("## 2.3 功能架构图", "## 2.4 创新与差异化"),
        ("## 2.4 创新与差异化", "# 3. 演示示例"),
        ("# 3. 演示示例", "# 4. 团队分工"),
        ("# 4. 团队分工", None),
    ]
    for start, end in secs:
        s = md_text.find(start)
        e = md_text.find(end) if end else len(md_text)
        if s == -1 or e == -1 or e <= s:
            continue
        segment = md_text[s:e]
        # 2.3 小节：替换占位说明为流程图
        if start == "## 2.3 功能架构图":
            add_para(doc, "2.3 功能架构图", size=16, bold=True, color=TEAL)
            add_flow_chart(doc, FLOW_CHART)
            continue
        render(doc, parse_md(segment))
    # 文末加免责声明
    add_para(doc, "免责声明", size=13, bold=True)
    add_para(doc, "本工具的计算基于经验公式与简化假定，仅用于方案前期概念比选与决策参考，不构成设计依据。实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。最终决策权始终在持证工程师手中，AI 仅提供量化建议。", size=11, color=GRAY)

    out = os.path.join(OUT, "智构StructMind-技术说明文档.docx")
    doc.save(out)
    print(f"[OK] 技术说明文档 → {out}")


def gen_cv_doc():
    md_path = os.path.join(BASE, "人机协同履历表.md")
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2.5)
        section.bottom_margin = Cm(2.5)
        section.left_margin = Cm(2.5)
        section.right_margin = Cm(2.5)
    add_para(doc, "人机协同履历表", size=18, bold=True, color=TEAL, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_para(doc, "（“海之子杯”AI 智能体挑战赛 · 西建大校内赛）", size=11, align=WD_ALIGN_PARAGRAPH.CENTER)
    doc.add_paragraph()
    blocks = parse_md(md_text)
    render(doc, blocks)
    out = os.path.join(OUT, "智构StructMind-人机协同履历表.docx")
    doc.save(out)
    print(f"[OK] 人机协同履历表 → {out}")


if __name__ == "__main__":
    gen_cv_doc()
    print("人机协同履历表已生成。技术说明文档请运行 gen_tech.py（国赛级排版，含封面/目录/插图/规范清单）。")
