import { config } from './config.js'
import { DocumentRepository } from './document-repository.js'
import { createApp } from './index.js'

const repository = new DocumentRepository(config.databasePath)
const app = createApp(repository, config)

app.listen(config.port, config.host, () => {
  console.log(`MindTree server listening on http://${config.host}:${config.port}`)
})
