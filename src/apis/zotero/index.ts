/**
 * Zotero API 封装
 * 提供访问 Zotero 条目和 PDF 附件的基本函数
 */

import { createLogger } from '@/utils/logger';

const logger = createLogger('zotero-api');

/**
 * 获取 Zotero 面板中当前选中的条目
 * @returns 当前选中的 Zotero 条目数组
 */
export function getSelectedItems(): any[] {
  try {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    logger.info('获取选中条目', { count: items.length });
    return items;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('获取选中条目失败:', msg);
    return [];
  }
}

/**
 * 获取 Zotero 条目的元数据
 * @param itemId - Zotero 条目 ID
 * @returns 包含标题、作者和摘要的对象
 */
export function getItemMetadata(itemId: number): { title: string; creators: string[]; abstractNote: string } {
  try {
    const item = Zotero.Items.get(itemId);
    const title: string = item.getField('title');
    const creators: string[] = item
      .getCreators()
      .map((c: any) => `${c.firstName} ${c.lastName}`.trim());
    const abstractNote: string = item.getField('abstractNote');
    return { title, creators, abstractNote };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('获取条目元数据失败:', msg);
    return { title: '', creators: [], abstractNote: '' };
  }
}

/**
 * 获取 PDF 附件的全文内容
 * @param itemId - Zotero 条目 ID
 * @returns PDF 的提取文本内容，若不存在则返回空字符串
 */
export async function getAttachmentText(itemId: number): Promise<string> {
  try {
    const item = Zotero.Items.get(itemId);
    const text: string = item.attachmentText || '';
    logger.info('获取附件文本', { itemId, length: text.length });
    return text;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('获取附件文本失败:', msg);
    return '';
  }
}

/**
 * 获取 PDF 附件的文件路径
 * @param itemId - Zotero 条目 ID
 * @returns PDF 文件的绝对路径，若不存在则返回空字符串
 */
export async function getPDFPath(itemId: number): Promise<string> {
  try {
    const item = Zotero.Items.get(itemId);
    const path: string = item.getFilePathAsync
      ? await item.getFilePathAsync()
      : item.getFilePath() || '';
    logger.info('获取 PDF 路径', { itemId, path });
    return path;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('获取 PDF 路径失败:', msg);
    return '';
  }
}
