/**
 * ReactRoot — Toolbar button + window management for ZoteroSeek
 *
 * Follows Aria's ReactRoot pattern:
 *   - Registers a toolbar button (inserted after "zotero-tb-note-add")
 *   - Opens popup.xhtml via Zotero.getMainWindow().openDialog()
 *   - Mounts React <Container /> into the dialog's entry point
 *   - Cleans up React root on dialogclosing event
 *   - Window reuse: focuses existing dialog instead of creating a new one
 *   - Keyboard shortcut: Ctrl+Shift+S via KeyboardManager
 *
 * Dependencies: T5 (CustomToolkit), T13 (popup.xhtml with #zoteroseek-entry-point)
 */

import {
  BasicTool,
  ManagerTool,
  UITool,
  KeyboardManager,
} from 'zotero-plugin-toolkit';
import { config } from '../../package.json';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Container } from './Container';

// ─────────────────────────────────────────────────────────────────────────────
// ReactRoot — handles toolbar button, keyboard shortcut, and popup window
// ─────────────────────────────────────────────────────────────────────────────
export class ReactRoot {
  private ui: UITool;
  private base: BasicTool;
  private document: Document;
  private dialog?: Window;
  private reactRoot?: ReturnType<typeof createRoot>;

  constructor(Keyboard: KeyboardManager, options?: { skipShortcut?: boolean }) {
    this.base = new BasicTool();
    this.ui = new UITool(this.base);
    this.document = this.base.getGlobal('document');
    this.registerToolbar();
    if (!options?.skipShortcut) {
      this.registerShortcut(Keyboard);
    }
  }

  // ── Toolbar button ──────────────────────────────────────────────────────

  private registerToolbar(): void {
    const btn = this.ui.createElement(this.document, 'toolbarbutton', {
      id: 'zotero-tb-zoteroseek',
      removeIfExists: true,
      attributes: {
        class: 'zotero-tb-button',
        tooltiptext: 'ZoteroSeek',
        style:
          'list-style-image: url(chrome://zoteroseek/content/icons/icon.png)',
      },
      listeners: [
        {
          type: 'click',
          listener: () => {
            if (this.isOpen()) {
              this.dialog!.focus();
            } else {
              this.launchApp();
            }
          },
        },
      ],
    });

    const toolbarNode = this.document.getElementById('zotero-tb-note-add');
    if (toolbarNode) {
      toolbarNode.after(btn);
    }
  }

  // ── Popup window management ─────────────────────────────────────────────

  /** Whether the popup dialog is currently open */
  isOpen(): boolean {
    return !!this.dialog && !this.dialog.closed;
  }

  /** Toggle popup: focus if open, launch if closed */
  toggleApp(): void {
    if (this.isOpen()) {
      this.dialog!.focus();
    } else {
      this.launchApp();
    }
  }

  launchApp(): void {
    const windowArgs = {
      _initPromise: Zotero.Promise.defer(),
    };

    const win = Zotero.getMainWindow();
    const dialogWidth = Math.max(win.outerWidth * 0.6, 720);
    const dialogHeight = win.outerHeight * 0.8;
    const left = win.screenX + win.outerWidth / 2 - dialogWidth / 2;
    const top = win.screenY + win.outerHeight / 2 - dialogHeight / 2;

    const dialog = (win as any).openDialog(
      `chrome://${config.addonRef}/content/popup.xhtml`,
      `${config.addonRef}-window`,
      `chrome,titlebar,status,width=${dialogWidth},height=${dialogHeight},left=${left},top=${top},resizable=yes`,
      windowArgs,
    );

    this.dialog = dialog;

    // Mount React on dialog load
    dialog.addEventListener(
      'load',
      () => {
        const entry = dialog.document.getElementById(
          'zoteroseek-entry-point',
        );
        if (entry) {
          const root = createRoot(entry);
          this.reactRoot = root;
          root.render(
            React.createElement(Container, {
              onContainerHide: () => {
                dialog.close();
              },
            }),
          );
        }
      },
      { once: true },
    );

    // Cleanup on dialog close
    dialog.addEventListener(
      'dialogclosing',
      () => {
        if (this.reactRoot) {
          this.reactRoot.unmount();
          this.reactRoot = undefined;
        }
        this.dialog = undefined;
      },
      { once: true },
    );
  }

  // ── Keyboard shortcut (Ctrl+Shift+S) ────────────────────────────────────
  // "accel" resolves to Ctrl on Windows/Linux and Cmd on macOS

  private registerShortcut(Keyboard: KeyboardManager): void {
    Keyboard.register((_ev: Event, data: { type: string; keyboard?: any }) => {
      if (data.type === 'keyup' && data.keyboard) {
        if (data.keyboard.equals('accel,shift,s')) {
          if (this.isOpen()) {
            this.dialog!.focus();
          } else {
            this.launchApp();
          }
        }
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ReactRootManager — wraps ReactRoot for CustomToolkit integration (T15)
// ─────────────────────────────────────────────────────────────────────────────

type BasicToolWithKeyboardManager = BasicTool & { Keyboard: KeyboardManager };

export class ReactRootManager extends ManagerTool {
  private reactRoot: ReactRoot;

  constructor(base: BasicToolWithKeyboardManager) {
    super(base);
    this.reactRoot = new ReactRoot(base.Keyboard);
  }

  // Stub methods — implement in T15/T19
  register(_commands: unknown[]): void {}
  unregister(_name: string): void {}
  unregisterAll(): void {}
}
