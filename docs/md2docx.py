# -*- coding: utf-8 -*-
"""通用 Markdown → Word(.docx) 转换（面向竞赛文档的排版规范）

支持：# / ## / ### 标题、**粗体**、`行内代码`、- 列表、1. 有序列表、
      | 表格 |、> 引用块、``` 代码块（含 mermaid 降级为说明）、--- 分隔线、
      - [ ] 勾选清单

排版：标题黑体深蓝 / 正文宋体 / 表格带表头底纹 / 代码块等宽灰底
"""
import os
import re
import sys
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DEEP = RGBColor(0x0F, 0x4C, 0x81)
INK = RGBColor(0x20, 0x2A, 0x33)
GRAY = RGBColor(0x5A, 0x6B, 0x7D)


def set_font(run, east="宋体", west="Times New Roman", size=None, bold=None, color=None):
    run.font.name = west
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rPr.append(rf)
    rf.set(qn("w:ascii"), west)
    rf.set(qn("w:hAnsi"), west)
    rf.set(qn("w:eastAsia"), east)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shd(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    e = OxmlElement("w:shd")
    e.set(qn("w:val"), "clear")
    e.set(qn("w:color"), "auto")
    e.set(qn("w:fill"), fill)
    tcPr.append(e)


def add_rich(p, text, size=10.5, base_bold=False, color=INK, east="宋体"):
    """解析 **粗体** 与 `代码`，写入同一段落"""
    parts = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = p.add_run(part[2:-2])
            set_font(r, east=east, size=size, bold=True, color=color)
        elif part.startswith("`") and part.endswith("`"):
            r = p.add_run(part[1:-1])
            set_font(r, east="Consolas", west="Consolas", size=size - 0.5, color=RGBColor(0xB4, 0x35, 0x1A))
        else:
            r = p.add_run(part)
            set_font(r, east=east, size=size, bold=base_bold, color=color)


def h(doc, text, level):
    sizes = {0: 20, 1: 15, 2: 13, 3: 11.5}
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level <= 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    if level == 0:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_rich(p, text, size=sizes.get(level, 11), base_bold=True, color=DEEP, east="黑体")
    return p


def add_table(doc, rows):
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j in range(ncol):
            txt = row[j] if j < len(row) else ""
            cell = t.cell(i, j)
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            add_rich(p, txt, size=9, base_bold=(i == 0),
                     color=RGBColor(0xFF, 0xFF, 0xFF) if i == 0 else INK)
            if i == 0:
                shd(cell, "0F4C81")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def md_to_docx(md_path, out_path, subtitle=None):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")

    doc = Document()
    # 页边距
    for s in doc.sections:
        s.left_margin = Cm(2.4)
        s.right_margin = Cm(2.4)
        s.top_margin = Cm(2.2)
        s.bottom_margin = Cm(2.2)
    st = doc.styles["Normal"]
    st.font.name = "Times New Roman"
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")

    i = 0
    first_h1 = True
    while i < len(lines):
        line = lines[i]
        s = line.rstrip()

        # 代码块
        if s.startswith("```"):
            lang = s[3:].strip()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            if lang in ("mermaid", "mermaid-edges") or (buf and ("-->" in buf[0] or "flowchart" in buf[0].lower() or "graph" in buf[0].lower())):
                p = doc.add_paragraph()
                add_rich(p, "【架构图（源文件见 Markdown 版本）】", size=9.5, base_bold=True, color=GRAY)
                p.paragraph_format.space_after = Pt(2)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(8)
            r = p.add_run("\n".join(buf))
            set_font(r, east="Consolas", west="Consolas", size=8.5, color=RGBColor(0x33, 0x44, 0x55))
            continue

        # 表格
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            rows = []
            header = [c.strip() for c in s.strip("|").split("|")]
            rows.append(header)
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            add_table(doc, rows)
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            if lvl == 1 and first_h1:
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                add_rich(p, m.group(2), size=20, base_bold=True, color=DEEP, east="黑体")
                if subtitle:
                    q = doc.add_paragraph()
                    q.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    add_rich(q, subtitle, size=10.5, color=GRAY, east="楷体")
                first_h1 = False
            else:
                h(doc, m.group(2), lvl - 1 if not first_h1 else lvl)
            i += 1
            continue

        # 分隔线
        if re.match(r"^---+$", s):
            p = doc.add_paragraph()
            pPr = p._p.get_or_add_pPr()
            bd = OxmlElement("w:pBdr")
            bt = OxmlElement("w:bottom")
            bt.set(qn("w:val"), "single"); bt.set(qn("w:sz"), "6")
            bt.set(qn("w:space"), "1"); bt.set(qn("w:color"), "C8D4E0")
            bd.append(bt); pPr.append(bd)
            p.paragraph_format.space_after = Pt(6)
            i += 1
            continue

        # 引用
        if s.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(4)
            add_rich(p, s.lstrip("> ").strip(), size=10, color=GRAY)
            i += 1
            continue

        # 勾选清单 / 列表
        m = re.match(r"^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$", s)
        if m:
            box = "☑" if m.group(2).lower() == "x" else "□"
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6 + len(m.group(1)) * 0.15)
            p.paragraph_format.space_after = Pt(2)
            add_rich(p, f"{box} {m.group(3)}", size=10)
            i += 1
            continue

        m = re.match(r"^(\s*)[-*]\s+(.*)$", s)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6 + len(m.group(1)) * 0.15)
            p.paragraph_format.space_after = Pt(2)
            add_rich(p, "• " + m.group(2), size=10.5)
            i += 1
            continue

        m = re.match(r"^(\s*)(\d+)\.\s+(.*)$", s)
        if m:
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(2)
            add_rich(p, f"{m.group(2)}. {m.group(3)}", size=10.5)
            i += 1
            continue

        # 空行
        if not s.strip():
            i += 1
            continue

        # 普通段落
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.35
        add_rich(p, s.strip(), size=10.5)
        i += 1

    doc.save(out_path)
    print("SAVED ->", out_path)


if __name__ == "__main__":
    md_to_docx(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
