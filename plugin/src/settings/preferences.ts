// preferences.ts - Preference pane event handling

import { bridge } from '../bridge';
import { launcher } from '../launcher';

export function registerPrefsScripts(_window: Window) {
  const doc = _window.document;

  // Test Connection 按钮
  const checkBtn = doc.getElementById('zoteroseek-check');
  checkBtn?.addEventListener('command', async () => {
    const statusLabel = doc.getElementById('zoteroseek-status');
    if (statusLabel) {
      statusLabel.setAttribute('value', 'Testing...');
      statusLabel.style.color = 'gray';
    }
    try {
      const result = await bridge.health();
      if (statusLabel) {
        statusLabel.setAttribute('value', 'Connected');
        statusLabel.style.color = 'green';
      }
      Zotero.log(`[ZoteroSeek] Health check passed: ${JSON.stringify(result)}`);
    } catch (e) {
      if (statusLabel) {
        statusLabel.setAttribute('value', 'Failed');
        statusLabel.style.color = 'red';
      }
      Zotero.log(`[ZoteroSeek] Health check failed: ${e}`);
    }
  });

  // Open ZoteroSeek 按钮
  const openBtn = doc.getElementById('zoteroseek-open');
  openBtn?.addEventListener('command', () => {
    launcher.openUI();
  });

  // Show API Key 按钮 - 切换密码可见性
  const toggleKeyBtn = doc.getElementById('zoteroseek-toggle-key');
  toggleKeyBtn?.addEventListener('command', () => {
    const apiKeyInput = doc.getElementById('zoteroseek-apikey') as HTMLInputElement | null;
    if (apiKeyInput) {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      if (toggleKeyBtn) {
        toggleKeyBtn.setAttribute('label', isPassword ? 'Hide' : 'Show');
      }
    }
  });

  // Use custom embeddings 复选框 - 控制嵌入选项显示/隐藏
  const customEmbeddingCheckbox = doc.getElementById('zoteroseek-use-custom-embedding') as HTMLInputElement | null;
  const embeddingOptions = doc.getElementById('zoteroseek-embedding-options');

  function updateEmbeddingOptionsVisibility() {
    if (embeddingOptions) {
      embeddingOptions.style.display = customEmbeddingCheckbox?.checked ? '' : 'none';
    }
  }

  customEmbeddingCheckbox?.addEventListener('command', updateEmbeddingOptionsVisibility);
  // 初始化时设置正确状态
  updateEmbeddingOptionsVisibility();
}
