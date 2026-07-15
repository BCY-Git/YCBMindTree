import { describe, expect, it } from 'vitest'
import { parseWorkflowAsset } from './workflow-asset'

describe('workflow assets', () => {
  it('turns a decision record response into a reusable mind-map branch', () => {
    const branch = parseWorkflowAsset(JSON.stringify({
      title: '第一阶段地图方案',
      decision: '采用 Three.js',
      reasons: ['局部区域表现自由度高'],
      alternatives: [{ name: 'Cesium', rejectionReason: '第一阶段不需要完整 GIS 能力' }],
      conditions: ['仅覆盖南京重点区域'],
      revisitTriggers: ['需要标准 3D Tiles'],
      nextActions: ['制作地图原型'],
    }), 'decision-record')

    expect(branch.topic).toBe('决策记录：第一阶段地图方案')
    expect(branch.children.map((child) => child.topic)).toEqual(['最终决策', '选择原因', '候选与取舍', '适用条件', '重新评估条件', '下一步'])
    expect(branch.children[2].children.map((child) => child.topic)).toEqual(['Cesium：第一阶段不需要完整 GIS 能力'])
  })

  it('turns a knowledge card response into a personal, transferable concept branch', () => {
    const branch = parseWorkflowAsset(JSON.stringify({
      title: 'Zod',
      personalUnderstanding: 'TypeScript 后面的第二道防线',
      definition: '在运行时验证数据是否符合 schema',
      boundaries: ['TypeScript 主要约束编译时'],
      examples: ['校验工具调用参数'],
      misconceptions: ['不能替代 TypeScript 类型检查'],
      openQuestions: ['多余字段默认如何处理'],
    }), 'knowledge-card')

    expect(branch.topic).toBe('知识卡：Zod')
    expect(branch.children.map((child) => child.topic)).toEqual(['我的理解', '标准定义', '关键边界', '示例', '常见误区', '待验证'])
    expect(branch.children[5].children.map((child) => child.topic)).toEqual(['多余字段默认如何处理'])
  })
})
