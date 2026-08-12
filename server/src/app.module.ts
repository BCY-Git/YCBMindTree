import { DynamicModule, Module } from '@nestjs/common'
import { AuthController, ClientDiagnosticsController, DocumentsController, HealthController, PairingsController } from './api.controller.js'
import { ApiBearerGuard } from './api-auth.guard.js'
import type { DocumentRepository } from './document-repository.js'
import type { AppOptions } from './http-options.js'
import { MINDTREE_RUNTIME, MindTreeRuntime } from './runtime.js'

@Module({})
export class MindTreeAppModule {
  static register(repository: DocumentRepository, options: AppOptions): DynamicModule {
    return {
      module: MindTreeAppModule,
      controllers: [HealthController, ClientDiagnosticsController, AuthController, PairingsController, DocumentsController],
      providers: [
        { provide: MINDTREE_RUNTIME, useValue: new MindTreeRuntime(repository, options) },
        ApiBearerGuard,
      ],
    }
  }
}
