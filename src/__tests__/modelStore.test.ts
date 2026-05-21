/**
 * Model Store 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prefs 工具
vi.mock('@/utils/prefs', () => ({
  getPref: vi.fn(),
  setPref: vi.fn(),
  clearPref: vi.fn(),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useModelStore } from '@/stores/modelStore';
import { getPref, setPref } from '@/utils/prefs';

describe('modelStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 store 状态
    useModelStore.setState({
      currentConfig: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4',
      },
      savedConfigs: [],
    });
  });

  describe('初始状态', () => {
    it('应有默认 currentConfig', () => {
      const state = useModelStore.getState();
      expect(state.currentConfig).toBeDefined();
      expect(state.currentConfig.provider).toBe('openai');
    });

    it('应有空的 savedConfigs', () => {
      const state = useModelStore.getState();
      expect(state.savedConfigs).toEqual([]);
    });

    it('应有预设模型列表', () => {
      const state = useModelStore.getState();
      expect(state.presetModels.length).toBeGreaterThan(0);
    });
  });

  describe('setCurrentConfig', () => {
    it('应设置当前配置并持久化', () => {
      const config = {
        provider: 'anthropic' as const,
        apiKey: 'sk-test',
        model: 'claude-3-opus',
      };

      useModelStore.getState().setCurrentConfig(config);

      const state = useModelStore.getState();
      expect(state.currentConfig).toEqual(config);
      expect(setPref).toHaveBeenCalled();
    });
  });

  describe('updateApiKey', () => {
    it('应更新 API Key', () => {
      useModelStore.getState().updateApiKey('new-key');

      expect(useModelStore.getState().currentConfig.apiKey).toBe('new-key');
    });

    it('应保留其他配置字段', () => {
      useModelStore.setState({
        currentConfig: { provider: 'anthropic', apiKey: 'old', model: 'claude-3' },
      });
      useModelStore.getState().updateApiKey('new-key');

      const state = useModelStore.getState();
      expect(state.currentConfig.provider).toBe('anthropic');
      expect(state.currentConfig.model).toBe('claude-3');
      expect(state.currentConfig.apiKey).toBe('new-key');
    });
  });

  describe('updateModel', () => {
    it('应更新模型名称', () => {
      useModelStore.getState().updateModel('gpt-4-turbo');

      expect(useModelStore.getState().currentConfig.model).toBe('gpt-4-turbo');
    });
  });

  describe('updateProvider', () => {
    it('应更新供应商', () => {
      useModelStore.getState().updateProvider('anthropic');

      expect(useModelStore.getState().currentConfig.provider).toBe('anthropic');
    });
  });

  describe('updateBaseUrl', () => {
    it('应更新 Base URL', () => {
      useModelStore.getState().updateBaseUrl('https://custom.api.com');

      expect(useModelStore.getState().currentConfig.baseUrl).toBe('https://custom.api.com');
    });
  });

  describe('保存配置 CRUD', () => {
    it('addSavedConfig 应添加配置', () => {
      const config = { provider: 'openai' as const, apiKey: 'key', model: 'gpt-4' };
      useModelStore.getState().addSavedConfig('我的配置', config);

      const state = useModelStore.getState();
      expect(state.savedConfigs.length).toBe(1);
      expect(state.savedConfigs[0].name).toBe('我的配置');
      expect(state.savedConfigs[0].apiKey).toBe('key');
      expect(setPref).toHaveBeenCalled();
    });

    it('updateSavedConfig 应更新指定配置', () => {
      useModelStore.setState({
        savedConfigs: [
          { name: 'config1', provider: 'openai', apiKey: 'old-key', model: 'gpt-4' },
        ],
      });

      useModelStore.getState().updateSavedConfig('config1', {
        provider: 'openai',
        apiKey: 'new-key',
        model: 'gpt-4-turbo',
      });

      const state = useModelStore.getState();
      expect(state.savedConfigs[0].apiKey).toBe('new-key');
      expect(state.savedConfigs[0].model).toBe('gpt-4-turbo');
    });

    it('deleteSavedConfig 应删除指定配置', () => {
      useModelStore.setState({
        savedConfigs: [
          { name: 'config1', provider: 'openai', apiKey: 'key1', model: 'gpt-4' },
          { name: 'config2', provider: 'anthropic', apiKey: 'key2', model: 'claude-3' },
        ],
      });

      useModelStore.getState().deleteSavedConfig('config1');

      const state = useModelStore.getState();
      expect(state.savedConfigs.length).toBe(1);
      expect(state.savedConfigs[0].name).toBe('config2');
    });

    it('loadSavedConfig 应加载配置到当前', () => {
      useModelStore.setState({
        savedConfigs: [
          { name: 'my-config', provider: 'anthropic', apiKey: 'loaded-key', model: 'claude-3-opus' },
        ],
      });

      useModelStore.getState().loadSavedConfig('my-config');

      const state = useModelStore.getState();
      expect(state.currentConfig.provider).toBe('anthropic');
      expect(state.currentConfig.apiKey).toBe('loaded-key');
      expect(state.currentConfig.model).toBe('claude-3-opus');
    });

    it('loadSavedConfig 不存在的配置应静默处理', () => {
      const initialConfig = useModelStore.getState().currentConfig;

      useModelStore.getState().loadSavedConfig('non-existent');

      expect(useModelStore.getState().currentConfig).toEqual(initialConfig);
    });
  });

  describe('applyPreset', () => {
    it('应应用预设并保留当前 API Key', () => {
      useModelStore.setState({
        currentConfig: { provider: 'openai', apiKey: 'my-key', model: 'gpt-4' },
      });

      useModelStore.getState().applyPreset({
        provider: 'anthropic',
        model: 'claude-3-opus',
        label: 'Claude 3 Opus',
      });

      const state = useModelStore.getState();
      expect(state.currentConfig.provider).toBe('anthropic');
      expect(state.currentConfig.model).toBe('claude-3-opus');
      expect(state.currentConfig.apiKey).toBe('my-key'); // 保留
    });

    it('应设置 baseUrl（如果预设有）', () => {
      useModelStore.getState().applyPreset({
        provider: 'openai',
        model: 'deepseek-chat',
        label: 'DeepSeek Chat',
        baseUrl: 'https://api.deepseek.com/v1',
      });

      expect(useModelStore.getState().currentConfig.baseUrl).toBe('https://api.deepseek.com/v1');
    });
  });

  describe('isConfigValid', () => {
    it('API Key 非空时应返回 true', () => {
      useModelStore.setState({
        currentConfig: { provider: 'openai', apiKey: 'valid-key', model: 'gpt-4' },
      });

      expect(useModelStore.getState().isConfigValid()).toBe(true);
    });

    it('API Key 为空时应返回 false', () => {
      useModelStore.setState({
        currentConfig: { provider: 'openai', apiKey: '', model: 'gpt-4' },
      });

      expect(useModelStore.getState().isConfigValid()).toBe(false);
    });

    it('API Key 为空白时应返回 false', () => {
      useModelStore.setState({
        currentConfig: { provider: 'openai', apiKey: '   ', model: 'gpt-4' },
      });

      expect(useModelStore.getState().isConfigValid()).toBe(false);
    });
  });
});
