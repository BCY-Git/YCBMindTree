# MindTree 同步服务

```bash
npm install
npm run dev
```

## 本地开发

复制 `.env.example` 为 `.env`，填写 `MINDTREE_DEV_TOKEN` 后再启动。服务端测试与前端 Vitest 独立运行：

```bash
npm test
```

本服务依赖 `better-sqlite3` 原生模块。若切换 Node.js 主版本或出现原生模块加载错误，请在本目录运行：

```bash
npm rebuild better-sqlite3
```

不使用 `postinstall` 自动重建，以免每次安装都增加不必要的编译时间。
