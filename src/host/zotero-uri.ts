/**
 * Zotero 自定义协议链接的构造（纯函数，便于单测与在 Host 侧复用）。
 *
 * - 默认：`zotero://select/library/items/<itemKey>`，只在 Zotero 里选中条目（不强行开 PDF）；
 * - 仅当调用方显式传 `mode: 'pdf'` 且有 PDF 附件时：`zotero://open-pdf/library/items/<attachmentKey>[?page=N]`。
 *
 * 两个 key 都会再次校验，避免把协议拼接变成任意命令注入（Host 侧会用它去执行 start/open）。
 */
const KEY_PATTERN = /^[A-Za-z0-9]{6,16}$/

export function isZoteroKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

export type ZoteroOpenMode = 'select' | 'pdf'

/**
 * 构造 zotero:// 链接。
 *
 * 默认 `select`：只选中条目，不打开 PDF。只有显式 `mode: 'pdf'` 且有附件时才走 open-pdf。
 * 页码从 1 起；越界或非整数时忽略页码，只打开 PDF 首页。
 */
export function zoteroUriOf(
  itemKey: string,
  attachmentKey: string | null | undefined,
  page?: number | null,
  mode: ZoteroOpenMode = 'select',
): string {
  const safeItem = isZoteroKey(itemKey) ? itemKey : ''
  if (safeItem.length === 0) throw new Error('非法 item_key')
  if (mode === 'pdf' && attachmentKey !== null && attachmentKey !== undefined && isZoteroKey(attachmentKey)) {
    const paged = typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= 9999
      ? `?page=${page}`
      : ''
    return `zotero://open-pdf/library/items/${attachmentKey}${paged}`
  }
  return `zotero://select/library/items/${safeItem}`
}
