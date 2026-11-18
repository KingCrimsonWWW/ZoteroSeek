/**
 * Reciprocal Rank Fusion（RRF）：把多路检索的排名融合成一个。
 *
 * 公式：score(d) = Σ_r weight_r / (k + rank_r(d))
 *
 * 为什么合并「排名」而不是「分数」：BM25 分数和任何其它路（语义、扩展查询）
 * 的绝对量纲不可比，而排名是可比的。k 取小一点（本实现默认 10）让头部名次
 * 差异更明显 —— 个人文献库只取 top-5，不需要大 k 把长尾压平。
 */
export interface RankedList {
  /** 按相关度降序的 id 列表。 */
  ids: readonly string[]
  /** 这一路的权重；扩展查询通常给 0.8–1.0，避免淹没原始词面命中。 */
  weight?: number
}

export interface FusedHit {
  id: string
  score: number
  /** 每路的 1 起名次与被计入的权重。 */
  ranks: Array<{ list: number; rank: number; weight: number }>
}

export function fuseRrf(lists: readonly RankedList[], options: { k?: number; topK?: number } = {}): FusedHit[] {
  const k = options.k ?? 10
  const scores = new Map<string, FusedHit>()

  lists.forEach((list, listIndex) => {
    const weight = list.weight ?? 1
    list.ids.forEach((id, index) => {
      const rank = index + 1
      const existing = scores.get(id)
      const contribution = weight / (k + rank)
      if (existing === undefined) {
        scores.set(id, { id, score: contribution, ranks: [{ list: listIndex, rank, weight }] })
      } else {
        existing.score += contribution
        existing.ranks.push({ list: listIndex, rank, weight })
      }
    })
  })

  return [...scores.values()]
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, options.topK ?? 10)
}
