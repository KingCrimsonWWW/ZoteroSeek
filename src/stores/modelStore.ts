/**
 * 模型配置管理 Store
 * 使用 Zustand 管理模型配置状态，通过 Zotero.Prefs 持久化
 */

import { create } from 'zustand';
import type { LLMProvider, ModelConfig } from '@/typings';
import { getPref, setPref } from '@/utils/prefs';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modelStore');

// ============ 预设模型 ============

/** 预设模型定义 */
export interface PresetModel {
  provider: LLMProvider;
  model: string;
  label: string;
  baseUrl?: string;
}

/** 预设模型列表 */
const PRESET_MODELS: PresetModel[] = [
  // OpenAI
  { provider: 'openai', model: 'gpt-4', label: 'GPT-4' },
  { provider: 'openai', model: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { provider: 'openai', model: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  // DeepSeek (OpenAI 兼容接口)
  {
    provider: 'openai',
    model: 'deepseek-chat',
    label: 'DeepSeek Chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  {
    provider: 'openai',
    model: 'deepseek-coder',
    label: 'DeepSeek Coder',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  // MiMo (OpenAI 兼容接口)
  {
    provider: 'openai',
    model: 'mimo-7b',
    label: 'MiMo 7B',
    baseUrl: 'https://api.xiaomi.com/v1',
  },
  // Anthropic
  { provider: 'anthropic', model: 'claude-3-opus', label: 'Claude 3 Opus' },
  { provider: 'anthropic', model: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
  { provider: 'anthropic', model: 'claude-3-haiku', label: 'Claude 3 Haiku' },
];

// ============ 持久化键名 ============

const PREF_CURRENT_CONFIG = 'model.currentConfig';
const PREF_SAVED_CONFIGS = 'model.savedConfigs';

// ============ 持久化工具函数 ============

/**
 * 从 Zotero.Prefs 加载 JSON 对象
 * @param key 偏好设置键名
 * @param fallback 默认值
 */
function loadJsonPref<T>(key: string, fallback: T): T {
  try {
    const raw = getPref(key);
    if (typeof raw === 'string' && raw.length > 0) {
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    logger.warn(`Failed to load pref "${key}":`, e);
  }
  return fallback;
}

/**
 * 将对象序列化为 JSON 存入 Zotero.Prefs
 * @param key 偏好设置键名
 * @param value 要存储的值
 */
function saveJsonPref(key: string, value: unknown): void {
  try {
    setPref(key, JSON.stringify(value));
  } catch (e) {
    logger.warn(`Failed to save pref "${key}":`, e);
  }
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: ModelConfig = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4',
};

// ============ Store 类型 ============

/** 保存的模型配置（带名称） */
export interface SavedModelConfig extends ModelConfig {
  name: string;
}

interface ModelState {
  /** 当前选中的模型配置 */
  currentConfig: ModelConfig;
  /** 已保存的模型配置列表 */
  savedConfigs: SavedModelConfig[];
  /** 预设模型列表（只读） */
  readonly presetModels: PresetModel[];

  // --- 当前配置操作 ---
  /** 设置当前配置（整体替换） */
  setCurrentConfig: (config: ModelConfig) => void;
  /** 更新 API Key */
  updateApiKey: (apiKey: string) => void;
  /** 更新模型名称 */
  updateModel: (model: string) => void;
  /** 更新供应商 */
  updateProvider: (provider: LLMProvider) => void;
  /** 更新 Base URL */
  updateBaseUrl: (baseUrl: string) => void;

  // --- 保存配置 CRUD ---
  /** 保存新配置 */
  addSavedConfig: (name: string, config: ModelConfig) => void;
  /** 更新已保存的配置 */
  updateSavedConfig: (name: string, config: ModelConfig) => void;
  /** 删除已保存的配置 */
  deleteSavedConfig: (name: string) => void;
  /** 加载已保存的配置到当前 */
  loadSavedConfig: (name: string) => void;

  // --- 预设操作 ---
  /** 应用预设模型（保留当前 API Key） */
  applyPreset: (preset: PresetModel) => void;

  // --- 验证 ---
  /** 检查当前配置是否有效（API Key 非空） */
  isConfigValid: () => boolean;
}

// ============ Store 实现 ============

export const useModelStore = create<ModelState>((set, get) => ({
  // 从 Zotero.Prefs 加载持久化状态
  currentConfig: loadJsonPref(PREF_CURRENT_CONFIG, DEFAULT_CONFIG),
  savedConfigs: loadJsonPref<SavedModelConfig[]>(PREF_SAVED_CONFIGS, []),
  presetModels: PRESET_MODELS,

  // --- 当前配置操作 ---

  setCurrentConfig: (config) => {
    set({ currentConfig: config });
    saveJsonPref(PREF_CURRENT_CONFIG, config);
    logger.info('Current config updated:', config.provider, config.model);
  },

  updateApiKey: (apiKey) => {
    const config = { ...get().currentConfig, apiKey };
    get().setCurrentConfig(config);
  },

  updateModel: (model) => {
    const config = { ...get().currentConfig, model };
    get().setCurrentConfig(config);
  },

  updateProvider: (provider) => {
    const config = { ...get().currentConfig, provider };
    get().setCurrentConfig(config);
  },

  updateBaseUrl: (baseUrl) => {
    const config = { ...get().currentConfig, baseUrl };
    get().setCurrentConfig(config);
  },

  // --- 保存配置 CRUD ---

  addSavedConfig: (name, config) => {
    const saved = [...get().savedConfigs, { ...config, name }];
    set({ savedConfigs: saved });
    saveJsonPref(PREF_SAVED_CONFIGS, saved);
    logger.info('Saved config added:', name);
  },

  updateSavedConfig: (name, config) => {
    const saved = get().savedConfigs.map((c) =>
      c.name === name ? { ...config, name } : c,
    );
    set({ savedConfigs: saved });
    saveJsonPref(PREF_SAVED_CONFIGS, saved);
    logger.info('Saved config updated:', name);
  },

  deleteSavedConfig: (name) => {
    const saved = get().savedConfigs.filter((c) => c.name !== name);
    set({ savedConfigs: saved });
    saveJsonPref(PREF_SAVED_CONFIGS, saved);
    logger.info('Saved config deleted:', name);
  },

  loadSavedConfig: (name) => {
    const found = get().savedConfigs.find((c) => c.name === name);
    if (found) {
      // 提取 ModelConfig 字段（去掉 name）
      const { name: _, ...config } = found;
      get().setCurrentConfig(config);
      logger.info('Loaded saved config:', name);
    } else {
      logger.warn('Saved config not found:', name);
    }
  },

  // --- 预设操作 ---

  applyPreset: (preset) => {
    const config: ModelConfig = {
      provider: preset.provider,
      model: preset.model,
      apiKey: get().currentConfig.apiKey, // 保留当前 API Key
      baseUrl: preset.baseUrl,
    };
    get().setCurrentConfig(config);
    logger.info('Applied preset:', preset.label);
  },

  // --- 验证 ---

  isConfigValid: () => {
    const { apiKey } = get().currentConfig;
    return typeof apiKey === 'string' && apiKey.trim().length > 0;
  },
}));
