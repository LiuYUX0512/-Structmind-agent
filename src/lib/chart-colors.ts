// 图表配色 - 明亮工程蓝图工作台风格
// 适用于 ECharts / recharts 等不支持 CSS var 的图表库

export const CHART_COLORS = [
  '#0F4C81', // chart-1 - 工程深蓝（主色、推荐方案）
  '#2A93D5', // chart-2 - 天空蓝（方案二）
  '#4DB6AC', // chart-3 - 青蓝（方案三）
  '#F0AD4E', // chart-4 - 工程橙（警示/高亮）
  '#5BAE5B', // chart-5 - 工程绿（可持续/安全）
];

// 语义色
export const CHART_SEMANTIC = {
  primary: '#0F4C81',
  secondary: '#2A93D5',
  accent: '#4DB6AC',
  warning: '#F0AD4E',
  success: '#5BAE5B',
  danger: '#D9534F',
  text: '#1F2937',
  textMuted: '#6B7280',
  gridLine: 'rgba(107, 114, 128, 0.2)',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
};

export const CHART_COLOR_NAMES = {
  primary: CHART_COLORS[0],
  secondary: CHART_COLORS[1],
  accent: CHART_COLORS[2],
  highlight: CHART_COLORS[3],
  warning: CHART_COLORS[3],
  success: CHART_COLORS[4],
};
