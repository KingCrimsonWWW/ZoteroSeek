/**
 * PDF 文本提取服务
 * 使用 pdfjs-dist 逐页提取 PDF 文本内容，避免大文件 OOM
 */

import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { createLogger } from '@/utils/logger';

const logger = createLogger('pdf-extractor');

/** PDF 提取结果 */
export interface ExtractionResult {
  fullText: string;
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

/**
 * 从 PDF 文件中提取文本
 * 逐页处理以控制内存使用，适合大文件
 *
 * @param pdfPath - PDF 文件路径
 * @returns 包含全文、页数和元数据的提取结果
 */
export async function extractText(pdfPath: string): Promise<ExtractionResult> {
  logger.info('开始提取 PDF 文本', { pdfPath });

  // 动态导入避免启动时加载 pdfjs-dist
  const pdfjsLib = await import('pdfjs-dist');

  // Node/Zotero 环境中禁用 Web Worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  const loadingTask = pdfjsLib.getDocument(pdfPath);
  const pdf = await loadingTask.promise;

  const pageCount = pdf.numPages;
  logger.info('PDF 加载完成', { pageCount });

  const textParts: string[] = [];

  // 逐页提取文本（顺序执行，不用 Promise.all 以控制内存）
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item) => 'str' in item)
      .map((item) => (item as TextItem).str)
      .join(' ');
    textParts.push(pageText);

    // 每 10 页记录一次进度
    if (i % 10 === 0) {
      logger.debug('提取进度', { currentPage: i, totalPages: pageCount });
    }
  }

  const metadata = await pdf.getMetadata();
  const info = metadata.info as Record<string, string | undefined>;

  logger.info('PDF 文本提取完成', {
    pageCount,
    textLength: textParts.join('').length,
  });

  return {
    fullText: textParts.join('\n\n'),
    pageCount,
    metadata: {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
    },
  };
}
