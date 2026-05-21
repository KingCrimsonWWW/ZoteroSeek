/**
 * Type definitions for ZoteroSeek
 */

// LLM Adapter types
export type LLMProvider = 'openai' | 'anthropic';

export interface ModelConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LLMAdapter {
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string>;
  embeddings?(text: string): Promise<number[]>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// Conversation types
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  model?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Knowledge base types
export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    page?: number;
    chunkIndex: number;
  };
  embedding?: number[];
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
}

// Zotero types
export interface ZoteroItem {
  id: number;
  title: string;
  creators: Array<{ firstName?: string; lastName?: string }>;
  date: string;
  itemType: string;
}

// Plugin configuration
export interface PluginConfig {
  llm: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
  rag: {
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
  };
  ui: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
  };
}
