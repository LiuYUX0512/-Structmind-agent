# -*- coding: utf-8 -*-
"""智构 StructMind · 国赛级技术说明文档插图生成脚本
生成 4 张高分辨率（300dpi）专业图表：
  fig_arch.png    多 Agent 协同架构图
  fig_radar.png   七维方案比选雷达图
  fig_compare.png 三方案关键指标对比图
  fig_flow.png    Agent 回退重算闭环流程图
配色遵循产品主题：深蓝 #0F4C81 / 青 #12B5C9 / 琥珀 #E8A33D / 绿 #3FA96B / 金 #C9A227
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
os.makedirs(OUT, exist_ok=True)

# 中文字体
CN = None
for name in ["Microsoft YaHei", "SimHei", "SimSun"]:
    try:
        CN = fm.FontProperties(family=name)
        fm.findfont(CN)
        plt.rcParams["font.family"] = name
        break
    except Exception:
        continue
plt.rcParams["axes.unicode_minus"] = False

DEEP = "#0F4C81"
CYAN = "#12B5C9"
AMBER = "#E8A33D"
GREEN = "#3FA96B"
GOLD = "#C9A227"
INK = "#16324A"
LIGHT = "#EAF2FB"

def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=300, bbox_inches="tight",
                facecolor="white")
    plt.close(fig)
    print("saved", name)


def draw_box(ax, x, y, w, h, text, fc, ec=None, tc="white", fs=11, lw=1.2,
             sub=None, subfs=8.5):
    box = FancyBboxPatch((x, y), w, h,
                         boxstyle="round,pad=0.06,rounding_size=0.12",
                         linewidth=lw, facecolor=fc,
                         edgecolor=ec if ec else fc)
    ax.add_patch(box)
    ax.text(x + w / 2, y + h * 0.62, text, ha="center", va="center",
            color=tc, fontsize=fs, fontweight="bold", zorder=3)
    if sub:
        ax.text(x + w / 2, y + h * 0.30, sub, ha="center", va="center",
                color=tc, fontsize=subfs, zorder=3)
    return (x + w / 2, y + h)


# ---------- 图1 多 Agent 协同架构图 ----------
def fig_arch():
    fig, ax = plt.subplots(figsize=(11, 7.6))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8.2)
    ax.axis("off")

    ax.text(5, 8.0, "智构 StructMind · 多智能体协同架构", ha="center",
            fontsize=16, fontweight="bold", color=DEEP)

    # 顶部：用户输入
    draw_box(ax, 3.5, 7.15, 3.0, 0.62, "用户输入工程参数", DEEP, sub="层数/面积/跨度/烈度/预算/场地类别", subfs=8)
    # 意图理解
    draw_box(ax, 3.5, 6.15, 3.0, 0.72, "① 意图理解 Agent", CYAN, sub="语义归一 / 参数补全 / 歧义澄清", subfs=8)
    # 方案创作
    draw_box(ax, 3.5, 5.0, 3.0, 0.86, "② 方案创作工程师", AMBER, sub="候选体系生成 + 初始截面", subfs=8)
    # 规范校核
    draw_box(ax, 3.5, 3.55, 3.0, 0.86, "③ 规范校核工程师", GREEN, sub="GB55002 / GB/T50011 逐条硬判定", subfs=8)
    # 经济评估
    draw_box(ax, 3.5, 2.2, 3.0, 0.86, "④ 经济评估工程师", CYAN, sub="造价 / 工期 / 碳排放 多目标量化", subfs=8)
    # 总工评审
    draw_box(ax, 3.5, 0.85, 3.0, 0.86, "⑤ 总工评审 Agent", GOLD, sub="反思 + 辩论仲裁 + 置信度", subfs=8)

    # 主流程箭头
    for y0, y1 in [(6.87, 6.87), (5.92, 5.92), (4.78, 4.78), (3.33, 3.33), (1.98, 1.98)]:
        ax.add_patch(FancyArrowPatch((5, y0 - 0.02), (5, y1 + 0.02),
                                     arrowstyle="-|>", mutation_scale=16,
                                     color=DEEP, lw=1.6))
    # 用户输入 → 意图理解
    ax.add_patch(FancyArrowPatch((5, 7.16), (5, 6.88),
                                 arrowstyle="-|>", mutation_scale=16, color=DEEP, lw=1.6))

    # 回退箭头：③ → ② （规范校核失败打回重算）
    ax.add_patch(FancyArrowPatch((6.55, 3.9), (6.55, 5.45),
                                 arrowstyle="-|>", mutation_scale=16,
                                 color="#C0392B", lw=2.0, linestyle="--"))
    ax.text(6.62, 4.7, "校核失败\n打回重算", ha="left", va="center",
            fontsize=8, color="#C0392B", fontweight="bold")

    # 右侧：知识库与人工干预
    draw_box(ax, 7.3, 5.0, 2.2, 0.86, "规范知识库", GREEN, sub="结构化条文 + 判定函数", subfs=8, lw=0.9)
    draw_box(ax, 7.3, 3.8, 2.2, 0.86, "硬编码计算引擎", DEEP, sub="力学库 / 碳排因子 / 造价库", subfs=8, lw=0.9)
    draw_box(ax, 7.3, 2.2, 2.2, 0.86, "人工干预 HITL", GOLD, sub="锁定方案 / 预算上限 / 备注", subfs=8, lw=0.9)
    # 连线到左侧节点
    for x2, y2 in [(4.4, 5.45), (4.4, 4.0), (4.4, 2.6)]:
        ax.add_patch(FancyArrowPatch((7.2, y2 + 0.1), (6.6, y2 + 0.1),
                                     arrowstyle="-|>", mutation_scale=12,
                                     color="#7B93A7", lw=1.1, linestyle=":"))

    # 底部输出
    draw_box(ax, 1.2, 0.15, 7.6, 0.6, "综合比选 · 规范校核报告 · 智能问答 · PDF / 结构建模文件导出",
             INK, sub="", fs=10.5)
    ax.add_patch(FancyArrowPatch((5, 0.86), (5, 0.78),
                                 arrowstyle="-|>", mutation_scale=16, color=DEEP, lw=1.6))
    save(fig, "fig_arch.png")


# ---------- 图2 七维雷达图 ----------
def fig_radar():
    dims = ["结构安全", "经济性", "施工可行性", "规范合规", "绿色低碳", "可维护性", "创新性"]
    N = len(dims)
    # 三方案得分（示意示例，0-100）
    A = [88, 72, 82, 90, 70, 78, 75]
    B = [84, 86, 78, 88, 82, 80, 80]
    C = [90, 62, 70, 92, 88, 74, 86]
    ang = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
    ang += ang[:1]

    def close(v):
        return v + v[:1]

    fig, ax = plt.subplots(figsize=(8.2, 8.2), subplot_kw=dict(polar=True))
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 100)
    ax.set_xticks(np.linspace(0, 2 * np.pi, N, endpoint=False))
    ax.set_xticklabels(dims, fontsize=11, color=INK)
    ax.set_yticks([20, 40, 60, 80, 100])
    ax.set_yticklabels(["20", "40", "60", "80", "100"], fontsize=8, color="#9AA7B4")
    for sp in ["polar"]:
        ax.spines[sp].set_color("#CBD5E1")
    ax.grid(color="#E2E8F0", lw=0.8)

    for vals, col, lab in [(A, AMBER, "方案A · 框架结构"),
                           (B, GREEN, "方案B · 框架-剪力墙"),
                           (C, CYAN, "方案C · 钢结构")]:
        ax.plot(ang, close(vals), color=col, lw=2.2, label=lab)
        ax.fill(ang, close(vals), color=col, alpha=0.16)

    ax.legend(loc="upper right", bbox_to_anchor=(1.28, 1.10), fontsize=10, frameon=False)
    ax.set_title("候选方案七维综合比选雷达图", fontsize=15, fontweight="bold",
                 color=DEEP, pad=22)
    save(fig, "fig_radar.png")


# ---------- 图3 三方案关键指标对比 ----------
def fig_compare():
    fig, axes = plt.subplots(1, 3, figsize=(11, 4.4))
    labels = ["方案A\n框架", "方案B\n框架-剪力墙", "方案C\n钢结构"]
    cost = [9800, 11200, 13800]      # 万元
    period = [14, 17, 12]            # 月
    carbon = [860, 780, 910]         # kgCO2/m2
    colors = [AMBER, GREEN, CYAN]
    titles = ["总造价（万元）", "施工工期（月）", "单位面积碳排放\n（kgCO2/m2）"]
    datas = [cost, period, carbon]

    for ax, d, t, cols in zip(axes, datas, titles, [colors, colors, colors]):
        bars = ax.bar(labels, d, color=cols, width=0.55, edgecolor="white", lw=1)
        for b, v in zip(bars, d):
            ax.text(b.get_x() + b.get_width() / 2, v + max(d) * 0.02,
                    f"{v:,}" if v >= 1000 else str(v), ha="center",
                    va="bottom", fontsize=11, fontweight="bold", color=INK)
        ax.set_title(t, fontsize=12, fontweight="bold", color=DEEP)
        ax.set_ylim(0, max(d) * 1.16)
        ax.tick_params(labelsize=9, length=0)
        for s in ["top", "right"]:
            ax.spines[s].set_visible(False)
        for s in ["left", "bottom"]:
            ax.spines[s].set_color("#CBD5E1")
        ax.grid(axis="y", color="#E2E8F0", lw=0.8)
        ax.set_axisbelow(True)
    fig.suptitle("三套候选方案关键指标对比", fontsize=15, fontweight="bold",
                 color=DEEP, y=1.02)
    fig.tight_layout()
    save(fig, "fig_compare.png")


# ---------- 图4 Agent 回退重算闭环 ----------
def fig_flow():
    fig, ax = plt.subplots(figsize=(11, 5.6))
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 5.2)
    ax.axis("off")
    ax.text(5.5, 4.95, "真实 Agent 推理回路：校核-回退-重算-仲裁", ha="center",
            fontsize=14, fontweight="bold", color=DEEP)

    draw_box(ax, 0.4, 3.3, 2.1, 0.9, "方案创作", AMBER, sub="生成候选体系 + 初始截面", subfs=8)
    draw_box(ax, 4.4, 3.3, 2.1, 0.9, "规范校核", GREEN, sub="逐条判定（硬编码规则）", subfs=8)
    draw_box(ax, 8.4, 3.3, 2.1, 0.9, "经济评估", CYAN, sub="造价/工期/碳排 多目标", subfs=8)
    draw_box(ax, 4.4, 0.7, 2.1, 0.9, "总工评审", GOLD, sub="辩论仲裁 + 推荐 + 置信度", subfs=8)

    # 前向
    for x0, x1 in [(2.5, 4.4), (6.5, 8.4)]:
        ax.add_patch(FancyArrowPatch((x0, 3.75), (x1, 3.75),
                                     arrowstyle="-|>", mutation_scale=15, color=DEEP, lw=1.5))
    ax.add_patch(FancyArrowPatch((6.5, 3.3), (6.5, 1.6),
                                 arrowstyle="-|>", mutation_scale=15, color=DEEP, lw=1.5))
    # 总工 → 方案创作（仲裁后重新出方案）
    ax.add_patch(FancyArrowPatch((5.0, 0.7), (1.4, 3.3),
                                 arrowstyle="-|>", mutation_scale=15, color=GOLD, lw=1.8, linestyle="-"))
    # 校核失败 → 打回方案创作（红色虚线）
    ax.add_patch(FancyArrowPatch((4.4, 4.2), (2.5, 4.2),
                                 arrowstyle="-|>", mutation_scale=15,
                                 color="#C0392B", lw=2.2, linestyle="--"))
    ax.text(3.45, 4.28, "发现违规 打回", ha="center", fontsize=9, color="#C0392B", fontweight="bold")

    ax.text(1.5, 2.15, "回退重算", ha="center", fontsize=9, color=GOLD, fontweight="bold")
    ax.text(6.9, 2.0, "仲裁拍板", ha="center", fontsize=9, color=GOLD, fontweight="bold")
    save(fig, "fig_flow.png")


fig_arch()
fig_radar()
fig_compare()
fig_flow()
print("ALL CHARTS DONE ->", OUT)
