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
function formatMessage(module: string, level: LogLevel, ...args: unknown[]): string {
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
   * debug 级别日志
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const prefix = formatMessage(this.module, LogLevel.DEBUG);
      console.log(prefix, ...args);
    }
  }

  /**
   * info 级别日志
   */
  info(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      const prefix = formatMessage(this.module, LogLevel.INFO);
      console.log(prefix, ...args);
    }
  }

  /**
   * warn 级别日志
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      const prefix = formatMessage(this.module, LogLevel.WARN);
      console.warn(prefix, ...args);
    }
  }

  /**
   * error 级别日志
   */
  error(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      const prefix = formatMessage(this.module, LogLevel.ERROR);
      console.error(prefix, ...args);
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
