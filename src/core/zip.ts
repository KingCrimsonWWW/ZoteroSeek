/**
 * 最小 ZIP 读取器：只依赖 node:zlib。
 *
 * 为什么自己写：MinerU 的解析结果是 zip（里面有 full.md / content_list*.json /
 * images/*.jpg），而 Electron 宿主里不想引入第三方依赖，也不想 spawn 外部
 * unzip 可执行文件。ZIP 的「中央目录」结构足够稳定，百来行就能读完。
 *
 * 支持的子集：store(0) 与 deflate(8) 两种压缩方法、无加密、非 ZIP64。
 * 超出子集时抛错而不是返回半成品 —— 宁可显式失败。
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const MAX_COMMENT = 65535

export class ZipError extends Error {
  readonly kind: 'truncated' | 'unsupported' | 'corrupt'

  constructor(kind: 'truncated' | 'unsupported' | 'corrupt', message: string) {
    super(message)
    this.name = 'ZipError'
    this.kind = kind
  }
}

/** 解压整个 zip，返回 文件名 → 字节。目录条目会被跳过。 */
export function unzip(buffer: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const eocd = findEocd(view)
  const totalEntries = view.getUint16(eocd + 10, true)
  const centralSize = view.getUint32(eocd + 12, true)
  const centralOffset = view.getUint32(eocd + 16, true)
  if (centralOffset + centralSize > buffer.byteLength) {
    throw new ZipError('truncated', 'ZIP 中央目录越界，文件可能不完整')
  }

  const files = new Map<string, Uint8Array>()
  let cursor = centralOffset
  const decoder = new TextDecoder('utf-8')

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) {
      throw new ZipError('corrupt', `第 ${i} 个中央目录项签名错误 @${cursor}`)
    }
    const method = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength))
    cursor += 46 + nameLength + extraLength + commentLength

    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('unsupported', `ZIP64 未支持：${name}`)
    }
    if (name.endsWith('/')) continue // 目录
    if (view.getUint32(localOffset, true) !== LOCAL_SIG) {
      throw new ZipError('corrupt', `本地头签名错误：${name}`)
    }
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)

    let data: Uint8Array
    if (method === 0) {
      data = raw
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(raw))
    } else {
      throw new ZipError('unsupported', `不支持的压缩方法 ${method}：${name}`)
    }
    files.set(name, data)
  }
  return files
}

function findEocd(view: DataView): number {
  const length = view.byteLength
  const lowest = Math.max(0, length - MAX_COMMENT - 22)
  for (let offset = length - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIG) return offset
  }
  throw new ZipError('corrupt', '找不到 ZIP 结尾记录（EOCD）')
}
