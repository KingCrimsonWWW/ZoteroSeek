/**
 * Settings panel component for ZoteroSeek
 * Provides API Key, model selection, and Base URL configuration
 */

import React, { useState, useCallback, useEffect } from 'react';
import { XulButton } from '@/components/common/XulButton';
import { useModelStore } from '@/stores/modelStore';

export function SettingsPanel() {
  const {
    currentConfig,
    presetModels,
    savedConfigs,
    setCurrentConfig,
    addSavedConfig,
    deleteSavedConfig,
    loadSavedConfig,
  } = useModelStore();

  // 表单本地状态
  const [apiKey, setApiKey] = useState(currentConfig.apiKey);
  const [baseUrl, setBaseUrl] = useState(currentConfig.baseUrl ?? '');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState(() => {
    // 找到当前模型对应的预设索引
    const idx = presetModels.findIndex(
      (p) =>
        p.model === currentConfig.model &&
        p.provider === currentConfig.provider,
    );
    return idx >= 0 ? idx : 0;
  });
  const [validationError, setValidationError] = useState('');
  const [saved, setSaved] = useState(false);

  // 保存配置管理
  const [configName, setConfigName] = useState('');
  const [selectedSavedName, setSelectedSavedName] = useState('');

  // 当 currentConfig 变化时同步表单状态
  useEffect(() => {
    setApiKey(currentConfig.apiKey);
    setBaseUrl(currentConfig.baseUrl ?? '');
    const idx = presetModels.findIndex(
      (p) =>
        p.model === currentConfig.model &&
        p.provider === currentConfig.provider,
    );
    setSelectedPresetIndex(idx >= 0 ? idx : 0);
  }, [currentConfig, presetModels]);

  // 选择预设模型
  const handlePresetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const index = Number(e.target.value);
      setSelectedPresetIndex(index);
      const preset = presetModels[index];
      // 预设的 baseUrl 覆盖当前输入（如果没有则清空）
      setBaseUrl(preset.baseUrl ?? '');
      setValidationError('');
    },
    [presetModels],
  );

  // 保存配置
  const handleSave = useCallback(() => {
    // 验证 API Key
    if (!apiKey.trim()) {
      setValidationError('API Key 不能为空');
      return;
    }

    const preset = presetModels[selectedPresetIndex];
    const newConfig = {
      provider: preset.provider,
      model: preset.model,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
    };

    setCurrentConfig(newConfig);
    setValidationError('');
    setSaved(true);

    // 2 秒后恢复按钮状态
    setTimeout(() => setSaved(false), 2000);
  }, [apiKey, baseUrl, selectedPresetIndex, presetModels, setCurrentConfig]);

  // 保存为新配置
  const handleSaveAsNew = useCallback(() => {
    const trimmedName = configName.trim();
    if (!trimmedName) return;

    const preset = presetModels[selectedPresetIndex];
    const config = {
      provider: preset.provider,
      model: preset.model,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || undefined,
    };

    addSavedConfig(trimmedName, config);
    setConfigName('');
    setSelectedSavedName(trimmedName);
  }, [configName, apiKey, baseUrl, selectedPresetIndex, presetModels, addSavedConfig]);

  // 加载已保存配置
  const handleLoadConfig = useCallback(() => {
    if (!selectedSavedName) return;
    loadSavedConfig(selectedSavedName);
  }, [selectedSavedName, loadSavedConfig]);

  // 删除已保存配置
  const handleDeleteConfig = useCallback(() => {
    if (!selectedSavedName) return;
    deleteSavedConfig(selectedSavedName);
    setSelectedSavedName('');
  }, [selectedSavedName, deleteSavedConfig]);

  // 当前选中的预设
  const currentPreset = presetModels[selectedPresetIndex];

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold text-gray-900">设置</h2>

      {/* 模型选择 */}
      <div>
        <label
          htmlFor="model-select"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          模型
        </label>
        <select
          id="model-select"
          value={selectedPresetIndex}
          onChange={handlePresetChange}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {presetModels.map((preset, index) => (
            <option key={`${preset.model}-${index}`} value={index}>
              {preset.label}
            </option>
          ))}
        </select>
        {currentPreset && (
          <p className="mt-1 text-xs text-gray-500">
            {currentPreset.provider} · {currentPreset.model}
          </p>
        )}
      </div>

      {/* API Key */}
      <div>
        <label
          htmlFor="api-key"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          API Key
        </label>
        <input
          id="api-key"
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            if (validationError) setValidationError('');
          }}
          placeholder="输入你的 API Key"
          autoComplete="off"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {validationError && (
          <p className="mt-1 text-xs text-red-600">{validationError}</p>
        )}
      </div>

      {/* Base URL */}
      <div>
        <label
          htmlFor="base-url"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Base URL
        </label>
        <input
          id="base-url"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          留空使用默认地址，或输入自定义 API 地址
        </p>
      </div>

      {/* 保存按钮 */}
      <XulButton
        onClick={handleSave}
        disabled={saved}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {saved ? '已保存 ✓' : '保存设置'}
      </XulButton>

      {/* 保存的配置管理 */}
      <div className="border-t border-gray-200 pt-4">
        <h3 className="mb-3 text-sm font-medium text-gray-700">保存的配置</h3>

        {/* 配置名称输入 + 保存按钮 */}
        <div className="flex gap-2">
          <input
            id="config-name"
            type="text"
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            placeholder="配置名称"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <XulButton
            onClick={handleSaveAsNew}
            disabled={!configName.trim()}
            className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
          >
            保存为新
          </XulButton>
        </div>

        {/* 已保存配置选择器 */}
        {savedConfigs.length > 0 && (
          <>
            <label
              htmlFor="saved-config-select"
              className="mb-1 mt-3 block text-sm font-medium text-gray-700"
            >
              已保存的配置
            </label>
            <select
              id="saved-config-select"
              value={selectedSavedName}
              onChange={(e) => setSelectedSavedName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">选择配置...</option>
              {savedConfigs.map((sc) => (
                <option key={sc.name} value={sc.name}>
                  {sc.name} ({sc.provider} · {sc.model})
                </option>
              ))}
            </select>

            {/* 加载 / 删除按钮 */}
            <div className="mt-2 flex gap-2">
              <XulButton
                onClick={handleLoadConfig}
                disabled={!selectedSavedName}
                className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
              >
                加载
              </XulButton>
              <XulButton
                onClick={handleDeleteConfig}
                disabled={!selectedSavedName}
                className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
              >
                删除
              </XulButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
