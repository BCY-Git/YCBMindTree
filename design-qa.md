# 登录与注册页面 Design QA

final result: passed

## 视觉基准

- shadcn `login-04`：桌面端居中卡片、左右等宽分栏、左侧表单、右侧视觉区域。
- React Bits `Threads`：深色底上的 40 条柔和动态线，保留鼠标交互与运动降级。
- 对照图：`output/playwright/design-qa-login-comparison.png`（左侧为参考，右侧为实现，均为 1440 × 900）。

## 已验证状态

| 状态 | 视口 | 结果 |
| --- | --- | --- |
| 登录 | 1440 × 900 | 分栏比例、表单间距、圆角、边框、视觉层级正常；Threads 完整渲染。 |
| 注册 | 1440 × 900 | 新增确认密码后仍保持卡片内完整布局，无裁切和溢出。 |
| 注册 | 390 × 844 | 视觉区转换为顶部横幅，表单单列显示，页面可滚动，按钮和输入框均在安全宽度内。 |

## 交互与可访问性

- 登录和注册切换正常，切换时会清空密码和旧错误提示。
- 注册会校验两次密码是否一致；邮箱会在提交前去除首尾空格。
- 密码显示/隐藏、处理中禁用、接口错误提示和 Escape 返回本地工作区均已覆盖。
- 表单使用真实标签、自动填充语义、焦点态、状态播报与 `prefers-reduced-motion` 降级。
- 未加入当前服务端不支持的第三方登录和忘记密码入口，避免出现无效控件。

## 截图产物

- `output/playwright/auth-login-1440.png`
- `output/playwright/auth-register-1440.png`
- `output/playwright/auth-register-mobile.png`
- `output/playwright/design-qa-login-comparison.png`

## 回归结果

- `npm test`：58 个测试文件、234 个测试全部通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- 浏览器控制台仅有项目原有的 `/favicon.ico` 404，不影响页面功能或渲染。
