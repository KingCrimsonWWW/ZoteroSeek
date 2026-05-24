/**
 * Logger utility for ZoteroSeek
 * Provides structured logging with module names and log levels
 */

/** 日志级别枚举 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/** 日志级别数值，用于过滤 */
const LOG_LEVEL_VALUE: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

/** 最小日志级别，开发环境显示所有，生产环境只显示 warn/error */
const MIN_LOG_LEVEL: Record<string, LogLevel> = {
  development: LogLevel.DEBUG,
  production: LogLevel.WARN,
};

/**
 * 检测当前环境
 */
function getEnv(): string {
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV;
    }
  } catch {
    // process 不存在时忽略
  }
  return 'development';
}

/**
 * 获取当前最小日志级别
 */
function getMinLogLevel(): LogLevel {
  const env = getEnv();
  return MIN_LOG_LEVEL[env] ?? LogLevel.DEBUG;
}

/**
 * 格式化日志消息
 * 格式: [ZoteroSeek][模块名][级别] 消息
 */
function formatMessage(module: string, level: LogLevel, ..._args: unknown[]): string {
  const prefix = `[ZoteroSeek][${module}][${level}]`;
  return prefix;
}

/**
 * Logger 类，提供 debug/info/warn/error 方法
 */
export class Logger {
  private module: string;
  private minLevel: LogLevel;

  constructor(module: string) {
    this.module = module;
    this.minLevel = getMinLogLevel();
  }

  /**
   * 检查是否应该输出该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUE[level] >= LOG_LEVEL_VALUE[this.minLevel];
  }

  /**
   * 输出日志到 Zotero
   */
  private log(level: LogLevel, ...args: unknown[]): void {
    const prefix = formatMessage(this.module, level);
    // Zotero 环境中使用 Zotero.log，回退到 console
    try {
      Zotero.log(`${prefix} ${args.map(a => {
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(' ')}`);
    } catch {
      // Zotero.log 失败时静默忽略（Zotero 环境中 console 不可用）
    }
  }

  /**
   * debug 级别日志
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.log(LogLevel.DEBUG, ...args);
    }
  }

  /**
   * info 级别日志
   */
  info(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.log(LogLevel.INFO, ...args);
    }
  }

  /**
   * warn 级别日志
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.log(LogLevel.WARN, ...args);
    }
  }

  /**
   * error 级别日志
   */
  error(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.log(LogLevel.ERROR, ...args);
    }
  }
}

/**
 * 创建 logger 实例的工厂函数
 * @param module 模块名称，用于日志前缀
 * @returns Logger 实例
 *
 * @example
 * ```ts
 * const logger = createLogger('chat');
 * logger.info('Chat initialized');
 * logger.error('Failed to send message', error);
 * ```
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}
