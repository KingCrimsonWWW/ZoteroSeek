/**
 * ZoteroSeek 的 Host 半边。
 *
 * 职责只有三件：
 * 1. 把 Runtime 装起来（索引 + Zotero + MinerU 的内存单例）；
 * 2. 注册 5 个工具给会话里的 Agent；
 * 3. 注册 `/zotero-seek` 路由给侧边栏面板；
 * 4. 往系统提示词里加一节「引用规则」，让模型的引用可被事后核对。
 *
 * 不 import 任何 @deepseek-ai/* 包：bundle 是零依赖的，装到任何 profile 都能跑。
 */
import type { RuntimeConfig } from './runtime.ts'
import { Runtime } from './runtime.ts'
import { createTools } from './tools.ts'
import { registerPanelRoutes } from './server.ts'

interface HostContextLike {
  tools: {
    register(definition: unknown): () => void
  }
  webServer: {
    register(route: {
      kind: 'prefix'
      path: string
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
    }): () => void
  }
  effect(callback: () => () => void, label?: string): unknown
  get(name: string): unknown
}

/** 硬依赖：没有工具注册表和 HTTP 服务就不激活。 */
export const inject = ['tools', 'webServer']

const PROMPT_SECTION_NAME = 'zotero-seek/citation-contract'
const PROMPT_SECTION_ORDER = 240

export function apply(ctx: HostContextLike, config: RuntimeConfig = {}): void {
  const runtime = new Runtime({
    ...(config.dataDir === undefined ? {} : { dataDir: config.dataDir }),
    ...(config.language === undefined ? {} : { language: config.language }),
    ...(config.defaultTopK === undefined ? {} : { defaultTopK: config.defaultTopK }),
  })

  // 预热：读设置、建目录；工具与路由在第一个请求到达时等同一个 Promise。
  void runtime.init()

  for (const tool of createTools(runtime)) {
    ctx.effect(() => ctx.tools.register(tool), `zotero-seek: tool ${tool.name}`)
  }

  registerPanelRoutes(ctx, runtime)

  // 系统提示词：只写「怎么引用」，不重复工具说明（见 dsh-doc 的 tool-design 约定）。
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== null && typeof systemPrompt === 'object' && 'section' in systemPrompt) {
    const section = (systemPrompt as { section(input: {
      name: string
      order: number
      text: string
    }): () => void })
    ctx.effect(() => section.section({
      name: PROMPT_SECTION_NAME,
      order: PROMPT_SECTION_ORDER,
      text: CITATION_CONTRACT,
    }), 'zotero-seek: citation contract')
  }
}

const CITATION_CONTRACT = `## 文献库（ZoteroSeek）
回答涉及用户文献内容的问题时，先用 \`zotero_search\` 检索，再基于返回片段作答。
- 每条引用写 \`[来源: chunk_id]\`，chunk_id 必须原样复制检索结果里的值，禁止自己拼或改写。
- 检索结果里没有的事实不要写；片段不足时直接说「文献库中没有相关内容」，并指出可以先 \`zotero_index\` 哪篇。
- 不编造标题、作者、年份、页码与数值；页码、章节以检索结果给出的为准。
- 需要读整篇结构或完整片段时用 \`zotero_read\`；需要引用格式时用 \`zotero_cite\`。`
