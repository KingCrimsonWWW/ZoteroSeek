/**
 * 评测执行器：把 `core/eval.ts` 的纯逻辑接到磁盘与模型上。
 *
 * 评测集默认放 `<dataDir>/qa-set.jsonl`（仓库里也有一份 `evals/qa-set.jsonl`，
 * 用 `zotero_eval` 的 qa_path 参数指向它即可），报告写到 `<dataDir>/reports/`。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { renderEvalReport, runEval, type EvalReport, type QaRow } from '../core/eval.ts'
import type { Runtime } from './runtime.ts'

export interface EvalDeps {
  /** 调一次模型，返回完整文本；由 Host 用 DSH 的 llm 服务实现。 */
  complete: (parts: { system: string; user: string }) => Promise<string>
  /** 报告里写的模型标识，例如 deepseek-official/deepseek-flash。 */
  label: string
}

export interface EvalRunResult {
  report: EvalReport
  jsonPath: string
  mdPath: string
}

export async function runEvalOnDisk(
  runtime: Runtime,
  deps: EvalDeps,
  options: { qaPath?: string; limit?: number; topK?: number } = {},
): Promise<EvalRunResult> {
  await runtime.init()
  const qaPath = options.qaPath !== undefined && options.qaPath.length > 0
    ? options.qaPath
    : join(runtime.dataDir, 'qa-set.jsonl')
  const raw = await readFile(qaPath, 'utf8')
  const rows: QaRow[] = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as QaRow)
  if (rows.length === 0) throw new Error(`评测集为空：${qaPath}`)

  const library = await runtime.library()
  const report = await runEval({
    library,
    rows,
    deps,
    qaPath,
    modelLabel: deps.label,
    ...(options.topK === undefined ? {} : { topK: options.topK }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  })

  const reportDir = join(runtime.dataDir, 'reports')
  await mkdir(reportDir, { recursive: true })
  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  const jsonPath = join(reportDir, `${stamp}-eval.json`)
  const mdPath = join(reportDir, `${stamp}-eval.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(mdPath, renderEvalReport(report), 'utf8')
  return { report, jsonPath, mdPath }
}
