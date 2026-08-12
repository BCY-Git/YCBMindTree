import { Injectable } from '@nestjs/common'
import type { DocumentRepository } from './document-repository.js'
import type { AppOptions } from './http-options.js'

export const MINDTREE_RUNTIME = Symbol('MINDTREE_RUNTIME')

/** 提供给 Nest 控制器和守卫的运行时依赖，便于测试时替换数据库和配置。 */
@Injectable()
export class MindTreeRuntime {
  constructor(
    readonly repository: DocumentRepository,
    readonly options: AppOptions,
  ) {}
}
