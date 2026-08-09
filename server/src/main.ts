import { config } from './config.js'
import { DocumentRepository } from './document-repository.js'
import { createApp } from './index.js'
import { attachWebHost } from './web-host.js'

const repository = new DocumentRepository(config.databasePath)
const app = createApp(repository, config)
if (config.webRoot) attachWebHost(app, config.webRoot)

app.listen(config.port, config.host, () => {
  console.log(`MindTree server listening on http://${config.host}:${config.port}`)
})
