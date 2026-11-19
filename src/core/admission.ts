/**
 * 扩展路的「校准准入」。
 *
 * 思想借自 dsh-zotero 的语义准入：稠密检索一定会返回最近邻，所以只用
 * 「离最佳不远」当门槛，等于任何非空语料都至少放行一条。词表扩展路有同样的
 * 风险——中文查询扩展成一串英文词后，几乎总能和某些片段产生弱重合。
 *
 * 但它不能照抄「余弦 + 绝对下限」：BM25 的原始分随查询长度、语料规模浮动，
 * 在词面域直接拿分数做绝对门槛，实测会把金标片段一起挡掉（标定报告
 * evals/reports/admission-calibration.json 里记录了这一负结果）。词面域真正
 * 可移植的信号是**覆盖率**：
 *
 *   覆盖率 = 命中的扩展词数 / 扩展词总数
 *
 * 金标片段通常命中大部分扩展词，弱相关片段只命中零散几个。于是规则变成：
 *
 * - **绝对下限 minCoverage**：覆盖率低于下限的片段一律不放行（整路都不达标
 *   时返回空，宁可只给词面结果，也不给「看起来相关」的弱命中）；
 * - **相对余量 margin**：过线后，只保留分数与最佳分相差 margin 以内的片段，
 *   让同主题片段成组出现，不拖进远邻。
 *
 * 两个参数都由 `evals/calibrate-admission.mjs` 用 answer-removed 对照组标定，
 * 不是拍脑袋。
 */
export interface AdmissionRules {
  /** 扩展词覆盖率下限（0–1）。 */
  minCoverage: number
  /** 相对余量：best * (1 - margin) 作为分数阈值。 */
  margin: number
}

export interface ScoredCandidate {
  id: string
  score: number
  matched: readonly string[]
}

export interface AdmissionOutcome {
  /** 过审的候选，按分数降序；空数组表示整路不参与。 */
  admitted: ScoredCandidate[]
  /** 过审候选里的最高分；无候选时为 0。 */
  best: number
  /** 实际生效的分数阈值 = best * (1 - margin)。 */
  threshold: number
  /** 是否有候选因覆盖率不足被拦下（用于解释「扩展路被准入拦住」）。 */
  gated: boolean
  /** 被覆盖率拦下的候选数。 */
  rejected: number
}

/** 覆盖率分母：扩展词总数（BM25 的 matched 最多保留前 8 个词，所以覆盖率天然不超过 8/N）。 */
export function coverageDenominatorOf(termCount: number): number {
  return Math.max(1, Math.trunc(termCount))
}

/** 一个候选的扩展词覆盖率（0–1）。 */
export function coverageOf(candidate: Pick<ScoredCandidate, 'matched'>, denominator: number): number {
  const terms = new Set(candidate.matched.filter((term) => term.trim().length > 0))
  return Math.min(1, terms.size / Math.max(1, denominator))
}

/** 校验一组准入规则；非法值直接抛错，绝不放行全部。 */
export function validateAdmissionRules(rules: AdmissionRules, label: string): AdmissionRules {
  const fail = (reason: string): never => {
    throw new Error(`${label} 准入规则非法：${reason}`)
  }
  if (typeof rules !== 'object' || rules === null) fail('缺少规则对象')
  if (!Number.isFinite(rules.minCoverage) || rules.minCoverage < 0 || rules.minCoverage > 1) fail('minCoverage 必须是 0–1 的有限数')
  if (!Number.isFinite(rules.margin) || rules.margin < 0 || rules.margin > 1) fail('margin 必须是 0–1 的有限数')
  return rules
}

/**
 * 对一个候选集做准入。逐查询、逐路独立计算：多条查询各自过审，
 * 彼此不互相抬高或压低（与 dsh-zotero 的 per-phrasing 规则一致）。
 */
export function admitCandidates(
  candidates: readonly ScoredCandidate[],
  rules: AdmissionRules = EXPANDED_ADMISSION,
  denominator = 1,
): AdmissionOutcome {
  if (candidates.length === 0) return { admitted: [], best: 0, threshold: 0, gated: false, rejected: 0 }

  const covered = []
  let rejected = 0
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.score) || candidate.score <= 0) continue
    const coverage = coverageOf(candidate, denominator)
    if (coverage < rules.minCoverage) {
      rejected += 1
      continue
    }
    covered.push(candidate)
  }
  if (covered.length === 0) return { admitted: [], best: 0, threshold: 0, gated: rejected > 0, rejected }

  const best = covered.reduce((high, candidate) => (candidate.score > high ? candidate.score : high), 0)
  const threshold = best * (1 - rules.margin)
  const admitted = covered
    .filter((candidate) => candidate.score >= threshold)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))

  return { admitted, best, threshold, gated: rejected > 0, rejected }
}

/**
 * 生产参数。来自 `evals/calibrate-admission.mjs`：
 * minCoverage 取「对照组覆盖率高分位」之上，margin 在评测集上扫到召回不降、MRR 最优。
 * 具体数值与对照表见 evals/reports/admission-calibration.json 与 RESULTS.md。
 */
export const EXPANDED_ADMISSION: AdmissionRules = {
  minCoverage: 0.4,
  margin: 0.5,
}
