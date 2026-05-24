/**
 * ID 生成工具
 * 提供统一的唯一 ID 生成函数，供 chatStore、hooks 等模块共用
 */

/** 生成唯一 ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
