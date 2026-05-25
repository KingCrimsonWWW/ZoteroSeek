/**
 * Centralized Dexie Database Definition
 *
 * Single source of truth for IndexedDB schemas used by both chat and RAG stores.
 * Accessed exclusively through the Web Worker (src/workers/dbWorkers.ts).
 *
 * NOTE: This module runs inside the Worker scope where IndexedDB IS available,
 * even in Zotero 9's sandbox environment.
 */

import Dexie, { type Table } from 'dexie';
import type { Conversation, Message } from '@/typings';
import type { RagChunk, RagProgress } from '@/stores/ragStore';

// ========== Schema Types ==========

/** Conversation stored in IndexedDB (without embedded messages) */
export type ConversationDBSchema = Omit<Conversation, 'messages'>;

/** Message stored in IndexedDB (with conversationId for indexing) */
export type MessageDBSchema = Message & { conversationId: string };

/** RAG chunk stored in IndexedDB */
export type RagChunkDBSchema = Omit<RagChunk, 'id'> & { id?: number };

/** RAG progress stored in IndexedDB */
export type RagProgressDBSchema = RagProgress;

// ========== Database Classes ==========

/**
 * Chat database — stores conversations and messages separately.
 * Messages are linked to conversations via `conversationId`.
 */
export class ChatDatabase extends Dexie {
  conversations!: Table<ConversationDBSchema, string>;
  messages!: Table<MessageDBSchema, string>;

  constructor() {
    super('ZoteroSeekChat');

    this.version(1).stores({
      conversations: 'id, title, updatedAt, createdAt',
    });

    // Version 2: add messages table (separate from conversations)
    this.version(2).stores({
      conversations: 'id, title, updatedAt, createdAt',
      messages: 'id, conversationId, timestamp',
    });
  }
}

/**
 * RAG database — stores document chunks and indexing progress.
 */
export class RagDatabase extends Dexie {
  chunks!: Table<RagChunkDBSchema, number>;
  progress!: Table<RagProgressDBSchema, string>;

  constructor() {
    super('ZoteroSeekRAG');

    this.version(1).stores({
      chunks: '++id, itemId, chunkIndex',
      progress: 'id',
    });
  }
}

// ========== Singleton Instances ==========

export const chatDb = new ChatDatabase();
export const ragDb = new RagDatabase();
