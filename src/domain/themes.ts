/**
 * 主题系统 — 定义 MindTree 的六套预设主题配色。
 *
 * 每套主题包含画布/控件/节点三层的颜色值，以及一个 6 色渐变调色板
 * `palette`，用于为不同深度的节点和连接线着色（根节点子节点用 palette[0]，
 * 依次类推），使导图层次一目了然。
 *
 * `getTheme(id)` 按 ID 查找主题，找不到时回退到第一个主题（calm），
 * 确保任意时刻都有有效主题可用。
 */

export type ThemeId = 'calm' | 'vanilla' | 'coast' | 'iris' | 'cyber' | 'midnight'

export type MindTreeTheme = {
  id: ThemeId
  name: string
  description: string
  // 画布和 UI 框架颜色
  canvas: string
  grid: string
  chrome: string
  surface: string
  // 节点样式
  rootBackground: string
  rootText: string
  nodeBackground: string
  nodeText: string
  nodeBorder: string
  // 选中态和高亮
  selected: string
  branch: string
  // 6 色调色板，按深度索引（depth 0 的子节点用 palette[0]，depth 1 用 palette[1]……）
  palette: [string, string, string, string, string, string]
}

export const themes: MindTreeTheme[] = [
  { id: 'calm', name: '柔雾', description: '克制的松绿与暖白', canvas: '#f5f5ef', grid: '#d9d9cf', chrome: '#fafaf6', surface: '#fffefa', rootBackground: '#274b42', rootText: '#f2f5e9', nodeBackground: '#fffefa', nodeText: '#292a25', nodeBorder: '#d4d5cb', selected: '#467566', branch: '#8aa49a', palette: ['#5d8e7b', '#7ba68b', '#9ab88d', '#c3b66e', '#c68a70', '#8a9db5'] },
  { id: 'vanilla', name: '香草', description: '明亮纸张与蜜糖色', canvas: '#fff8ea', grid: '#eadfc7', chrome: '#fffdf7', surface: '#fffdf8', rootBackground: '#9c6234', rootText: '#fff9ed', nodeBackground: '#fffdf8', nodeText: '#49382c', nodeBorder: '#ead7bd', selected: '#bb7540', branch: '#cb9a66', palette: ['#c9784e', '#d89c58', '#d2b44a', '#83a86d', '#799db0', '#ad7fa9'] },
  { id: 'coast', name: '海岸', description: '海盐蓝与珊瑚暖调', canvas: '#f1f8fa', grid: '#d5e6e9', chrome: '#fbfeff', surface: '#ffffff', rootBackground: '#2e6478', rootText: '#effafd', nodeBackground: '#ffffff', nodeText: '#283d46', nodeBorder: '#cfe0e4', selected: '#377e91', branch: '#70a6b5', palette: ['#4d91a8', '#4eabb1', '#7cba98', '#e0aa5e', '#de8068', '#967ba8'] },
  { id: 'iris', name: '虹彩', description: '轻快、清晰的多色分支', canvas: '#f8f6fc', grid: '#e2ddec', chrome: '#fdfcff', surface: '#ffffff', rootBackground: '#65528d', rootText: '#faf8ff', nodeBackground: '#ffffff', nodeText: '#3e374c', nodeBorder: '#ddd6e8', selected: '#8068ac', branch: '#a38cc5', palette: ['#7e72c6', '#9c70b8', '#cc7698', '#dd975b', '#a5ae5f', '#63a59c'] },
  { id: 'cyber', name: '霓光', description: '深色画布与高对比荧光', canvas: '#171b22', grid: '#2d3540', chrome: '#202630', surface: '#262d38', rootBackground: '#d94f8b', rootText: '#fff8fc', nodeBackground: '#262d38', nodeText: '#edf5f8', nodeBorder: '#3d4856', selected: '#5ee0cf', branch: '#5ee0cf', palette: ['#5ee0cf', '#61b8ff', '#ad7dff', '#ff70ad', '#ffb45f', '#c9e86e'] },
  { id: 'midnight', name: '夜航', description: '靛蓝底色与月白文字', canvas: '#1d2130', grid: '#30364b', chrome: '#252b3d', surface: '#2b3246', rootBackground: '#8398d0', rootText: '#182033', nodeBackground: '#2b3246', nodeText: '#eef1fa', nodeBorder: '#404a63', selected: '#a5b8ed', branch: '#8297c9', palette: ['#90a4df', '#72afc5', '#72ba9b', '#c9ad68', '#c7878d', '#b58bc6'] },
]

// 找不到时回退到第一项（calm），保证任意时刻都有可用主题。
export function getTheme(id: ThemeId): MindTreeTheme {
  return themes.find((theme) => theme.id === id) ?? themes[0]
}
