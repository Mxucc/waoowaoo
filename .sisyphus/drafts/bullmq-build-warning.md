# Draft: 修复 Next build 的 BullMQ 警告

## 现象
- `next build` 警告：
  - `./node_modules/bullmq/dist/esm/classes/child-processor.js`
  - `Critical dependency: the request of a dependency is an expression`
  - Import trace：`bullmq -> src/lib/task/queues.ts -> src/app/api/tasks/[taskId]/route.ts`

## 已确认的仓库事实
- Next 配置文件：`next.config.ts`，当前只有 next-intl 插件与 `allowedDevOrigins`，没有任何 webpack/turbopack 定制，也没有 `serverExternalPackages` / `ignoreWarnings`。
- 代码中大量 server-side worker/queue 使用 `bullmq`（例如 `src/lib/task/queues.ts`、`src/lib/workers/*`）。

## 目标（你说的“修复警告”）
1. **优先**：让构建输出不再出现该 bullmq warning（真正消除），而不是简单忽略。
2. **可接受兜底**：若消除成本高，则在保证不影响功能的前提下“定向静音”该 warning。

## 候选方案（待外部资料/代码库进一步验证）
### 方案 A（推荐）：serverExternalPackages 外置 bullmq（不参与 Next server bundle）
- 思路：让 Next 在 server build 中把 `bullmq` 当作 external，从而不对其内部 dynamic require 进行 webpack 解析，自然不会出现该 warning。
- 落点：在 `next.config.ts` 增加 `serverExternalPackages: ['bullmq']`（或 Next 文档对应字段）。
- 风险点：需要确认当前部署形态（node server / serverless / standalone）与 file tracing 是否会把 `bullmq` 保留在产物中。

### 方案 B：webpack ignoreWarnings 定向忽略 bullmq child-processor
- 思路：保留打包，但让 webpack 对 bullmq 的这条 warning 不输出。
- 落点：在 `next.config.ts` 增加 `webpack(config){ config.ignoreWarnings.push({ module: /bullmq\/dist\/esm\/classes\/child-processor/ }) }`。
- 风险点：属于“压掉警告”，不是真正消除；但通常对功能无影响。

### 方案 C：减少/隔离在 route handler 中对 queues.ts 的静态 import
- 思路：把 `/api/tasks/[taskId]` 里对 `removeTaskJob` 之类的调用改成运行时动态 import，或拆分出不依赖 bullmq 的实现。
- 风险点：改动面更大，需要回归验证。

## Open Questions
- 你希望 **必须完全消除警告**（A 优先），还是 **可以定向静音**（B 即可）？
