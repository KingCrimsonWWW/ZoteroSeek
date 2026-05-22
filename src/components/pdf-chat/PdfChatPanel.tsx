/**
 * PdfChatPanel — PDF 对话面板
 *
 * 独立的 PDF 对话窗口主界面，包含 PDF 选择和对话功能。
 * 复用 MessageList 和 InputBox 组件，通过 useCrossWindowChat hook
 * 管理 PDF 窗口专属的对话状态。
 */

import React, { useState, useCallback, useRef } from 'react';
import { MessageList } from '@/components/chat/MessageList';
import { InputBox } from '@/components/chat/InputBox';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useCrossWindowChat } from '@/hooks/useCrossWindowChat';
import { getSelectedItems, getItemMetadata } from '@/apis/zotero';
import { createLogger } from '@/utils/logger';

const logger = createLogger('PdfChatPanel');

/** 从 Zotero 条目提取的 PDF 元数据 */
interface PdfInfo {
  id: number;
  title: string;
  creators: string[];
  abstractNote: string;
}

/** 停止生成按钮（与 ChatPanel 保持一致） */
function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center py-2">
      <button
        onClick={onClick}
        className="flex items-center gap-2 rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        停止生成
      </button>
    </div>
  );
}

export function PdfChatPanel() {
  const { messages, isLoading, sendMessage, stopGeneration } = useCrossWindowChat();
  const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
  const [selecting, setSelecting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSelectPdf = useCallback(() => {
    setSelecting(true);
    try {
      const items = getSelectedItems();
      if (items.length === 0) {
        logger.warn('未选中任何条目');
        setSelecting(false);
        return;
      }

      const item = items[0];
      const metadata = getItemMetadata(item.id);

      setPdfInfo({
        id: item.id,
        title: metadata.title || '未知标题',
        creators: metadata.creators,
        abstractNote: metadata.abstractNote || '',
      });

      logger.info('已选择 PDF', { id: item.id, title: metadata.title });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('选择 PDF 失败:', msg);
    } finally {
      setSelecting(false);
    }
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!pdfInfo) return;
      await sendMessage(content);
      // 发送后滚动到底部
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    },
    [sendMessage, pdfInfo],
  );

  return (
    <ErrorBoundary>
      <div className="flex h-full flex-col">
        {/* 头部：PDF 选择按钮和信息卡片 */}
        <header className="border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">PDF 对话</h2>
            <button
              onClick={handleSelectPdf}
              disabled={selecting}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selecting ? '选择中...' : '选择 PDF'}
            </button>
          </div>

          {/* 已选择 PDF 的信息卡片 */}
          {pdfInfo && (
            <div className="mt-2 animate-fade-in rounded-lg border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-start gap-2.5">
                {/* PDF 图标 */}
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>

                <div className="min-w-0 flex-1">
                  {/* 标题 */}
                  <h3 className="truncate text-sm font-medium text-gray-800">
                    {pdfInfo.title}
                  </h3>

                  {/* 作者 */}
                  {pdfInfo.creators.length > 0 && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {pdfInfo.creators.join(', ')}
                    </p>
                  )}

                  {/* 摘要（最多两行） */}
                  {pdfInfo.abstractNote && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                      {pdfInfo.abstractNote}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </header>

        {/* 对话消息区域 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {pdfInfo ? (
            <MessageList messages={messages} isLoading={isLoading} />
          ) : (
            /* 未选择 PDF 时的占位提示 */
            <div className="flex h-full items-center justify-center text-gray-400">
              <div className="text-center">
                <svg
                  className="mx-auto mb-4 h-12 w-12"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-sm">尚未选择 PDF 文档</p>
                <p className="mt-1 text-xs">
                  请先点击"选择 PDF"按钮选择 Zotero 中的条目，然后开始对话
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 停止生成按钮 */}
        {isLoading && <StopButton onClick={stopGeneration} />}

        {/* 输入区域 */}
        <div className="border-t border-gray-200 bg-white p-3">
          <InputBox
            onSend={handleSend}
            isLoading={isLoading}
            disabled={!pdfInfo}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default PdfChatPanel;
