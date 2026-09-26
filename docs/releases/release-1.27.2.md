# MindTree 1.27.2

侧栏第二轮打磨（参考 shadcn/ui sidebar block、AFFiNE、Notion 的做法）。

## 改造

- 分组之间去掉分割线，改为纯间距节奏（shadcn SidebarGroup 样式），视觉更干净。
- 分组标签右侧的「+」按钮平时隐藏，悬停分组时才显现（shadcn SidebarGroupAction 模式），减少常驻噪点。
- 项目文件夹、文件类型、kind 分组等图标从强调绿统一为中性灰，仅悬停/激活时变绿（shadcn muted-foreground 惯例），降低色彩噪音。

验证：前端 397 用例与类型检查通过。
