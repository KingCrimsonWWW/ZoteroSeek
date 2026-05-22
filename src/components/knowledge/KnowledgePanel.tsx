/**
 * KnowledgePanel — RAG 知识库管理
 *
 * 三个区域：
 * 1. 索引状态 — 进度条 + "索引文献库"按钮 + 已索引/总计数量
 * 2. 搜索 — 文本输入 + "搜索"按钮
 * 3. 搜索结果列表 — 标题、摘要片段（前150字）、相似度评分
 */

import React, { useState, useCallback } from 'react';

/** 搜索结果条目 */
interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number; // 0-1
}

interface KnowledgePanelProps {
  /** 点击搜索结果时的回调（预留：注入到对话） */
  onResultClick?: (result: SearchResult) => void;
}

export function KnowledgePanel({ onResultClick }: KnowledgePanelProps) {
  // ── 索引状态 ──
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(0); // 0-100
  const [indexedCount, setIndexedCount] = useState(0);
  const totalCount = 42; // 硬编码占位值

  // ── 搜索 ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // ── 模拟索引 ──
  const handleStartIndexing = useCallback(() => {
    if (isIndexing) return;
    setIsIndexing(true);
    setIndexProgress(0);
    setIndexedCount(0);

    const interval = setInterval(() => {
      setIndexProgress((prev) => {
        const next = prev + Math.random() * 15 + 5;
        if (next >= 100) {
          clearInterval(interval);
          setIsIndexing(false);
          setIndexedCount(totalCount);
          return 100;
        }
        setIndexedCount(Math.floor((next / 100) * totalCount));
        return next;
      });
    }, 400);
  }, [isIndexing]);

  // ── 模拟搜索 ──
  const handleSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setHasSearched(true);

    // 模拟搜索结果
    const mockResults: SearchResult[] = [
      {
        id: '1',
        title: '深度学习在自然语言处理中的应用',
        snippet:
          '本文综述了深度学习技术在自然语言处理领域的最新进展，包括Transformer架构、预训练语言模型以及它们在文本分类、机器翻译和问答系统中的应用。实验结果表明...',
        score: 0.92,
      },
      {
        id: '2',
        title: 'Attention Is All You Need',
        snippet:
          'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on...',
        score: 0.87,
      },
      {
        id: '3',
        title: '基于知识图谱的文献检索系统',
        snippet:
          '提出了一种基于知识图谱的学术文献检索方法，通过构建领域知识图谱来增强语义理解能力。实验在计算机科学文献数据集上进行，相比传统关键词检索，召回率提升了...',
        score: 0.74,
      },
    ].filter(
      (r) =>
        r.title.toLowerCase().includes(trimmed.toLowerCase()) ||
        r.snippet.toLowerCase().includes(trimmed.toLowerCase()),
    );

    setSearchResults(mockResults);
  }, [searchQuery]);

  // ── 结果点击 ──
  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onResultClick?.(result);
    },
    [onResultClick],
  );

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold text-gray-900">知识库</h2>

      {/* ═══════ 索引状态 ═══════ */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">索引状态</h3>

        {/* 进度条 */}
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>
              {isIndexing
                ? `索引中... ${Math.round(indexProgress)}%`
                : indexProgress === 100
                  ? '索引完成'
                  : '尚未索引'}
            </span>
            <span>
              {indexedCount} / {totalCount}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                indexProgress === 100 ? 'bg-green-500' : 'bg-blue-600'
              }`}
              style={{ width: `${indexProgress}%` }}
            />
          </div>
        </div>

        {/* 索引按钮 */}
        <button
          onClick={handleStartIndexing}
          disabled={isIndexing}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isIndexing ? '索引中...' : indexProgress === 100 ? '重新索引' : '索引文献库'}
        </button>
      </div>

      {/* ═══════ 搜索 ═══════ */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">搜索知识库</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            placeholder="输入搜索关键词..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={!searchQuery.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            搜索
          </button>
        </div>
      </div>

      {/* ═══════ 搜索结果 ═══════ */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">
          搜索结果
          {hasSearched && (
            <span className="ml-1 font-normal text-gray-400">
              ({searchResults.length})
            </span>
          )}
        </h3>

        {!hasSearched ? (
          <p className="py-8 text-center text-sm text-gray-400">输入关键词开始搜索</p>
        ) : searchResults.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">未找到相关结果</p>
        ) : (
          <ul className="space-y-3">
            {searchResults.map((result) => (
              <li key={result.id}>
                <button
                  onClick={() => handleResultClick(result)}
                  className="w-full rounded-lg border border-gray-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  {/* 标题 + 评分 */}
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {result.title}
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {Math.round(result.score * 100)}%
                    </span>
                  </div>

                  {/* 摘要片段 */}
                  <p className="text-xs leading-relaxed text-gray-600">
                    {result.snippet.length > 150
                      ? result.snippet.slice(0, 150) + '...'
                      : result.snippet}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
