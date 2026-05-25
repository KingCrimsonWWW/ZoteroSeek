/**
 * CustomToolkit — 轻量封装 zotero-plugin-toolkit
 *
 * 继承 BasicTool 并选择性引入项目实际使用的模块（UI、Keyboard、Menu），
 * 避免引入 ZoteroToolkit 中未使用模块以减小插件体积。
 *
 * 参考 Aria 的 CustomToolkit 模式，但仅引入必要模块。
 * ReactRoot 当前为占位属性，将在 T14 中实现完整功能。
 */

import {
  BasicTool,
  unregister,
  UITool,
  KeyboardManager,
  MenuManager,
} from 'zotero-plugin-toolkit';

export class CustomToolkit extends BasicTool {
  UI: UITool;
  Keyboard: KeyboardManager;
  Menu: MenuManager;
  /** 占位属性 — 将在 T14 中替换为 ReactRootManager */
  ReactRoot: Record<string, unknown>;

  constructor() {
    super();
    this.UI = new UITool(this);
    this.Keyboard = new KeyboardManager(this);
    this.Menu = new MenuManager(this);
    this.ReactRoot = {}; // T14: 替换为 new ReactRootManager(this)
  }

  /**
   * 解注册所有由本 toolkit 创建的 UI / 快捷键 / 菜单
   */
  unregisterAll(): void {
    unregister(this);
  }
}
