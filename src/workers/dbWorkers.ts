/**
 * Database Web Worker
 *
 * Runs Dexie operations off the main thread. In Zotero 9's sandbox,
 * IndexedDB is NOT available on the main thread, but IS available
 * inside Worker scope.
 *
 * Communication uses MessageHelper (zotero-plugin-toolkit) for
 * type-safe RPC over postMessage.
 */

import { MessageHelper } from 'zotero-plugin-toolkit';
import {
  chatDb,
  ragDb,
  type ConversationDBSchema,
  type MessageDBSchema,
  type RagChunkDBSchema,
  type RagProgressDBSchema,
} from '../db/db';

// ========== Handlers ==========

export const handlers = {
  // ─── Conversation CRUD ─────────────────────────────────────────────

  /** Create or update a conversation */
  async upsertConversation(conversation: ConversationDBSchema) {
    await chatDb.conversations.put(conversation);
  },

  /** Get a conversation by ID */
  async getConversation(id: string) {
    return await chatDb.conversations.get(id);
  },

  /** Get all conversations, sorted by updatedAt descending */
  async getConversations() {
    return await chatDb.conversations
      .orderBy('updatedAt')
      .reverse()
      .toArray();
  },

  /** Delete a conversation and all its messages */
  async deleteConversation(id: string) {
    await chatDb.transaction(
      'rw',
      [chatDb.conversations, chatDb.messages],
      async () => {
        await chatDb.conversations.delete(id);
        await chatDb.messages.where('conversationId').equals(id).delete();
      },
    );
  },

  // ─── Message CRUD ──────────────────────────────────────────────────

  /** Create or update a single message */
  async upsertMessage(message: MessageDBSchema) {
    await chatDb.messages.put(message);
  },

  /** Bulk create/update messages */
  async upsertMessages(messages: MessageDBSchema[]) {
    await chatDb.messages.bulkPut(messages);
  },

  /** Get all messages for a conversation, sorted by timestamp */
  async getMessages(conversationId: string) {
    return await chatDb.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('timestamp');
  },

  /** Delete a single message */
  async deleteMessage(id: string) {
    await chatDb.messages.delete(id);
  },

  /** Delete multiple messages by ID */
  async deleteMessages(ids: string[]) {
    await chatDb.messages.bulkDelete(ids);
  },

  /** Clear all messages (for all conversations) */
  async clearAllMessages() {
    await chatDb.messages.clear();
  },

  /** Clear messages for a specific conversation */
  async clearMessagesForConversation(conversationId: string) {
    await chatDb.messages
      .where('conversationId')
      .equals(conversationId)
      .delete();
  },

  // ─── RAG: Chunks ──────────────────────────────────────────────────

  /** Bulk insert RAG chunks */
  async upsertChunks(chunks: RagChunkDBSchema[]) {
    await ragDb.chunks.bulkAdd(chunks);
  },

  /** Get all chunks for an item */
  async getChunksByItem(itemId: number) {
    return await ragDb.chunks.where('itemId').equals(itemId).toArray();
  },

  /** Get all chunks */
  async getAllChunks() {
    return await ragDb.chunks.toArray();
  },

  /** Delete chunks for a specific item */
  async deleteChunksByItem(itemId: number) {
    await ragDb.chunks.where('itemId').equals(itemId).delete();
  },

  /** Clear all chunks */
  async clearAllChunks() {
    await ragDb.chunks.clear();
  },

  // ─── RAG: Progress ────────────────────────────────────────────────

  /** Get indexing progress */
  async getProgress(id: string) {
    return await ragDb.progress.get(id);
  },

  /** Upsert indexing progress */
  async upsertProgress(progress: RagProgressDBSchema) {
    await ragDb.progress.put(progress);
  },

  /** Clear all progress */
  async clearAllProgress() {
    await ragDb.progress.clear();
  },

  // ─── Utility ──────────────────────────────────────────────────────

  /** Health check — returns true if Worker and DB are alive */
  async _ping() {
    return true;
  },
};

// ========== MessageHelper Server ==========

const messageServer = new MessageHelper({
  canBeDestroyed: true,
  dev: true,
  name: 'dbWorker',
  target: self,
  handlers,
});

messageServer.start();
