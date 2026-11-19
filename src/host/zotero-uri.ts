/**
 * Zotero 自定义协议链接的构造（纯函数，便于单测与在 Host 侧复用）。
 *
 * - 有 PDF 附件：`zotero://open-pdf/library/items/<attachmentKey>[?page=N]`，直接翻到对应页；
 * - 没有附件：`zotero://select/library/items/<itemKey>`，只在 Zotero 里选中条目。
 *
 * 两个 key 都会再次校验，避免把协议拼接变成任意命令注入（Host 侧会用它去执行 start/open）。
 */
const KEY_PATTERN = /^[A-Za-z0-9]{6,16}$/

export function isZoteroKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

/** 页码从 1 起；越界或非整数时忽略页码，只打开 PDF。 */
export function zoteroUriOf(itemKey: string, attachmentKey: string | null | undefined, page?: number | null): string {
  const safeItem = isZoteroKey(itemKey) ? itemKey : ''
  if (safeItem.length === 0) throw new Error('非法 item_key')
  if (attachmentKey !== null && attachmentKey !== undefined && isZoteroKey(attachmentKey)) {
    const paged = typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= 9999
      ? `?page=${page}`
      : ''
    return `zotero://open-pdf/library/items/${attachmentKey}${paged}`
  }
  return `zotero://select/library/items/${safeItem}`
}
