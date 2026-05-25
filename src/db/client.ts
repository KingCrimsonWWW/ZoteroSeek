/**
 * Database Client — Main-thread proxy for Worker-based Dexie operations.
 *
 * Provides a type-safe API that mirrors the Worker handlers. All calls
 * are forwarded to the Worker via MessageHelper RPC.
 *
 * Usage:
 *   import { dbClient } from '@/db/client';
 *   const conversations = await dbClient.getConversations();
 */

import { MessageHelper } from 'zotero-plugin-toolkit';
import { config } from '../../package.json';
import type { handlers } from '../workers/dbWorkers';
import type {
  ConversationDBSchema,
  MessageDBSchema,
  RagChunkDBSchema,
  RagProgressDBSchema,
} from './db';
import { createLogger } from '@/utils/logger';

const logger = createLogger('dbClient');

// ========== Worker Lifecycle ==========

let server: MessageHelper<typeof handlers> | null = null;
let initPromise: Promise<MessageHelper<typeof handlers>> | null = null;

/**
 * Get or create the MessageHelper server connected to the DB Worker.
 * Lazy-initializes on first call; subsequent calls return the cached instance.
 */
async function getServer(): Promise<MessageHelper<typeof handlers>> {
  if (server) return server;

  // Deduplicate concurrent init calls
  if (!initPromise) {
    initPromise = initWorker();
  }

  server = await initPromise;
  initPromise = null;
  return server;
}

async function initWorker(): Promise<MessageHelper<typeof handlers>> {
  const workerUrl = `chrome://${config.addonRef}/content/scripts/dbWorkers.js`;

  logger.info('Initializing DB Worker', workerUrl);

  const worker = new Worker(workerUrl, { name: 'dbWorker' });

  const helper = new MessageHelper<typeof handlers>({
    canBeDestroyed: false,
    dev: __env__ === 'development',
    name: 'dbWorkerMain',
    target: worker,
    handlers: {},
  });

  helper.start();

  // Ping to ensure Worker is alive and DB is accessible
  await helper.exec('_ping');
  logger.info('DB Worker ready');

  return helper;
}

/**
 * Destroy the Worker and release resources.
 * Call on plugin unload or when switching to memory fallback.
 */
export function closeDbClient() {
  if (server) {
    server.destroy();
    server = null;
    logger.info('DB Worker destroyed');
  }
}

// ========== Conversation API ==========

export async function upsertConversation(conversation: ConversationDBSchema) {
  const s = await getServer();
  await s.proxy.upsertConversation(conversation);
}

export async function getConversation(id: string) {
  const s = await getServer();
  return await s.proxy.getConversation(id);
}

export async function getConversations() {
  const s = await getServer();
  return await s.proxy.getConversations();
}

export async function deleteConversation(id: string) {
  const s = await getServer();
  await s.proxy.deleteConversation(id);
}

// ========== Message API ==========

export async function upsertMessage(message: MessageDBSchema) {
  const s = await getServer();
  await s.proxy.upsertMessage(message);
}

export async function upsertMessages(messages: MessageDBSchema[]) {
  const s = await getServer();
  await s.proxy.upsertMessages(messages);
}

export async function getMessages(conversationId: string) {
  const s = await getServer();
  return await s.proxy.getMessages(conversationId);
}

export async function deleteMessage(id: string) {
  const s = await getServer();
  await s.proxy.deleteMessage(id);
}

export async function deleteMessages(ids: string[]) {
  const s = await getServer();
  await s.proxy.deleteMessages(ids);
}

export async function clearAllMessages() {
  const s = await getServer();
  await s.proxy.clearAllMessages();
}

export async function clearMessagesForConversation(conversationId: string) {
  const s = await getServer();
  await s.proxy.clearMessagesForConversation(conversationId);
}

// ========== RAG: Chunks API ==========

export async function upsertChunks(chunks: RagChunkDBSchema[]) {
  const s = await getServer();
  await s.proxy.upsertChunks(chunks);
}

export async function getChunksByItem(itemId: number) {
  const s = await getServer();
  return await s.proxy.getChunksByItem(itemId);
}

export async function getAllChunks() {
  const s = await getServer();
  return await s.proxy.getAllChunks();
}

export async function deleteChunksByItem(itemId: number) {
  const s = await getServer();
  await s.proxy.deleteChunksByItem(itemId);
}

export async function clearAllChunks() {
  const s = await getServer();
  await s.proxy.clearAllChunks();
}

// ========== RAG: Progress API ==========

export async function getProgress(id: string) {
  const s = await getServer();
  return await s.proxy.getProgress(id);
}

export async function upsertProgress(progress: RagProgressDBSchema) {
  const s = await getServer();
  await s.proxy.upsertProgress(progress);
}

export async function clearAllProgress() {
  const s = await getServer();
  await s.proxy.clearAllProgress();
}
