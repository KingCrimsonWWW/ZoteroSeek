// bridge.ts - HTTP client for backend API

import { getPref } from './utils/prefs';

function getBackendUrl(): string {
  const url = getPref('url') || 'http://localhost';
  const port = getPref('port') || 20801;
  return `${url}:${port}`;
}

export const bridge = {
  async health() {
    const response = await fetch(`${getBackendUrl()}/api/v1/health`);
    return response.json();
  },
  
  async index(pdfPath: string, itemId: string = 'manual') {
    const response = await fetch(`${getBackendUrl()}/api/v1/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_path: pdfPath, item_id: itemId }),
    });
    return response.json();
  },
  
  async search(query: string, topK: number = 5) {
    const response = await fetch(`${getBackendUrl()}/api/v1/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK }),
    });
    return response.json();
  },
  
  async library() {
    const response = await fetch(`${getBackendUrl()}/api/v1/library`);
    return response.json();
  },

  async chat(message: string, conversationId?: string): Promise<ReadableStream<string>> {
    const response = await fetch(`${getBackendUrl()}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversation_id: conversationId }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return new ReadableStream<string>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              controller.close();
              return;
            }
            controller.enqueue(data);
          }
        }
      },
    });
  },
};
