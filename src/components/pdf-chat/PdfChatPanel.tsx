/**
 * PdfChatPanel — PDF 对话面板
 *
 * 独立的 PDF 对话窗口主界面，包含 PDF 选择和对话功能。
 * 复用 MessageList 和 InputBox 组件，通过 useChatBase（pdf 模式）
 * 管理 PDF 窗口专属的对话状态。
 */

import React, { useState, useCallback, useRef } from 'react';
import { MessageList } from '@/components/chat/MessageList';
import { InputBox } from '@/components/chat/InputBox';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useChatBase } from '@/hooks/useChatBase';
import { getSelectedItems, getItemMetadata } from '@/apis/zotero';
import { XulButton } from '@/components/common/XulButton';
import { Icon } from '@/components/common/Icon';
import { useTheme } from '@/hooks/useTheme';
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
function StopButton({ onClick, dark }: { onClick: () => void; dark: boolean }) {
  return (
    <div className="flex justify-center py-2">
      <XulButton
        onClick={onClick}
        className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          dark
            ? 'border-white/[0.06] bg-[#1f1f23] text-[#888] hover:bg-white/[0.04]'
            : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Icon name="stop" className="h-3.5 w-3.5" />
        停止生成
      </XulButton>
    </div>
  );
}

export function PdfChatPanel() {
  const { dark } = useTheme();
  const { messages, isLoading, sendMessage, stopGeneration } = useChatBase({ mode: 'pdf' });
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
        <header className={`border-b px-4 py-3 ${dark ? 'border-white/[0.06] bg-[#1f1f23]' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-sm font-medium ${dark ? 'text-[#ececec]' : 'text-gray-700'}`}>PDF 对话</h2>
            <XulButton
              onClick={handleSelectPdf}
              disabled={selecting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="document" className="h-3.5 w-3.5" />
              {selecting ? '选择中...' : '选择 PDF'}
            </XulButton>
          </div>

          {/* 已选择 PDF 的信息卡片 */}
          {pdfInfo && (
            <div className="mt-2 animate-fade-in rounded-lg border border-blue-100 bg-blue-50 p-3">
              <div className="flex items-start gap-2.5">
                {/* PDF 图标 */}
                <Icon name="document" className="mt-0.5 h-4 w-4 flex-shrink-0" />

                <div className="min-w-0 flex-1">
                  {/* 标题 */}
                  <h3 className={`truncate text-sm font-medium ${dark ? 'text-[#ececec]' : 'text-gray-800'}`}>
                    {pdfInfo.title}
                  </h3>

                  {/* 作者 */}
                  {pdfInfo.creators.length > 0 && (
                    <p className={`mt-0.5 text-xs ${dark ? 'text-[#888]' : 'text-gray-500'}`}>
                      {pdfInfo.creators.join(', ')}
                    </p>
                  )}

                  {/* 摘要（最多两行） */}
                  {pdfInfo.abstractNote && (
                    <p className={`mt-1 line-clamp-2 text-xs ${dark ? 'text-[#888]' : 'text-gray-500'}`}>
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
            <div className={`flex h-full items-center justify-center ${dark ? 'text-[#666]' : 'text-gray-400'}`}>
              <div className="text-center">
                <Icon name="document" className="mx-auto mb-4 h-12 w-12" />
                <p className="text-sm">尚未选择 PDF 文档</p>
                <p className="mt-1 text-xs">
                  请先点击「选择 PDF」按钮选择 Zotero 中的条目，然后开始对话
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 停止生成按钮 */}
        {isLoading && <StopButton onClick={stopGeneration} dark={dark} />}

        {/* 输入区域 */}
        <div className={`border-t p-3 ${dark ? 'border-white/[0.06] bg-[#1f1f23]' : 'border-gray-200 bg-white'}`}>
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
