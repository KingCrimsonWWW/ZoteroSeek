/**
 * 领域双语词表：让中文提问能检索到英文文献（以及反过来）。
 *
 * 为什么用「词表 + 查询扩展」而不是向量检索：
 * - 个人文献库的主题是收敛的（隧道衬砌脱空 / 探地雷达 / 激光测振 / 声学检测），
 *   这类领域词表几十行就覆盖高频概念，比下载 embedding 模型轻两个数量级；
 * - 完全确定、可解释：检索结果能告诉你「空洞 被扩展成了 void/cavity」，
 *   用户看得懂，评测也能复现；
 * - 作为一期手段已经很有效（见 evals/RESULTS.md 的前后对比），语义检索可以作为二期叠加。
 *
 * 词表结构：每个条目是一组「同义的中文词」↔「同义的英文词」。
 * 匹配是子串级（中文按去空格后的子串、英文按小写子串），所以变体要显式列出。
 */

export interface GlossaryEntry {
  zh: readonly string[]
  en: readonly string[]
}

export interface QueryExpansion {
  /** 原始查询。 */
  query: string
  /** 扩展后的查询串（原文 + 追加的等价词），直接喂给 BM25。 */
  expandedQuery: string
  /**
   * 只含扩展词的查询串。它是第三路检索的输入：
   * 中文问英文文献时这一路是纯英文查询，英文问中文文献时是纯中文查询，
   * 能避免原始查询里的数字/缩写造成「假命中」。
   */
  translatedQuery: string
  /** 实际生效的映射，用于解释与调试。 */
  added: Array<{ from: string; to: string; direction: 'zh→en' | 'en→zh' }>
}

const GLOSSARY: readonly GlossaryEntry[] = [
  // —— 对象与场景 ——
  { zh: ['空洞', '脱空', '空腔', '空鼓'], en: ['void', 'cavity', 'hollow', 'delamination', 'debonding'] },
  { zh: ['衬砌'], en: ['lining'] },
  { zh: ['隧道'], en: ['tunnel'] },
  { zh: ['盾构'], en: ['shield'] },
  { zh: ['管片'], en: ['segment'] },
  { zh: ['双拱'], en: ['double-arch', 'double arch'] },
  { zh: ['道床', '轨道板'], en: ['track slab', 'track bed', 'slab'] },
  { zh: ['无砟轨道'], en: ['ballastless track'] },
  { zh: ['铁路', '铁道'], en: ['railway', 'rail'] },
  { zh: ['地铁'], en: ['subway', 'metro'] },
  { zh: ['混凝土'], en: ['concrete'] },
  { zh: ['钢筋'], en: ['rebar', 'reinforcement', 'reinforced'] },
  { zh: ['病害', '缺陷', '损伤'], en: ['defect', 'damage', 'deterioration'] },
  { zh: ['裂缝', '开裂', '裂纹'], en: ['crack', 'cracking'] },
  { zh: ['厚度不足', '厚度'], en: ['thickness', 'insufficient thickness'] },
  { zh: ['渗漏', '水害', '含水'], en: ['leakage', 'moisture', 'water'] },
  { zh: ['分层', '离层'], en: ['delamination', 'separation'] },

  // —— 检测方法 ——
  { zh: ['检测', '探测', '检查'], en: ['detection', 'detect', 'inspection', 'inspect', 'testing'] },
  { zh: ['监测'], en: ['monitoring', 'monitor'] },
  { zh: ['识别'], en: ['identification', 'identify', 'recognition'] },
  { zh: ['分类'], en: ['classification', 'classify'] },
  { zh: ['探地雷达', '地质雷达', '雷达'], en: ['ground penetrating radar', 'ground-penetrating radar', 'GPR', 'radar'] },
  { zh: ['逆时偏移'], en: ['reverse time migration', 'reverse-time migration', 'RTM'] },
  { zh: ['反投影'], en: ['back projection', 'back-projection'] },
  { zh: ['反演'], en: ['inversion', 'inverse'] },
  { zh: ['成像'], en: ['imaging', 'image'] },
  { zh: ['激光多普勒测振仪', '激光多普勒', '测振仪'], en: ['laser doppler vibrometry', 'laser Doppler vibrometer', 'LDV', 'vibrometer'] },
  { zh: ['声波激励', '远程声波', '声激励'], en: ['acoustic excitation', 'acoustic excitation signal'] },
  { zh: ['声压级'], en: ['sound pressure level', 'SPL'] },
  { zh: ['冲击回波'], en: ['impact echo'] },
  { zh: ['超声波', '超声'], en: ['ultrasonic', 'ultrasound'] },
  { zh: ['声发射'], en: ['acoustic emission'] },
  { zh: ['敲击'], en: ['impact', 'hammer', 'tapping'] },
  { zh: ['振动'], en: ['vibration'] },
  { zh: ['共振频率', '固有频率'], en: ['resonance frequency', 'natural frequency'] },
  { zh: ['弯曲振动'], en: ['bending vibration'] },
  { zh: ['振动速度'], en: ['vibration velocity'] },
  { zh: ['幅值', '振幅'], en: ['amplitude'] },
  { zh: ['频谱', '谱'], en: ['spectrum', 'spectral'] },
  { zh: ['质心'], en: ['centroid'] },
  { zh: ['模态'], en: ['modal', 'mode'] },
  { zh: ['时域'], en: ['time domain'] },
  { zh: ['频域'], en: ['frequency domain'] },
  { zh: ['频带', '带宽'], en: ['frequency band', 'bandwidth'] },
  { zh: ['峰值'], en: ['peak'] },
  { zh: ['相位'], en: ['phase'] },
  { zh: ['滤波'], en: ['filter', 'filtering'] },
  { zh: ['去噪'], en: ['denoising', 'noise removal'] },
  { zh: ['杂波'], en: ['clutter'] },
  { zh: ['合成孔径'], en: ['synthetic aperture'] },
  { zh: ['传感器'], en: ['sensor', 'transducer'] },
  { zh: ['采集'], en: ['acquisition', 'acquire'] },
  { zh: ['扫描'], en: ['scanning', 'scan'] },

  // —— 声学与机器学习 ——
  { zh: ['声学特征', '声音特征'], en: ['acoustic feature', 'sound feature'] },
  { zh: ['梅尔频率倒谱系数', '倒谱系数'], en: ['MFCC', 'mel frequency cepstral', 'mel-frequency cepstral'] },
  { zh: ['声音分类', '环境声音'], en: ['sound classification', 'environmental sound', 'acoustic event'] },
  { zh: ['深度学习'], en: ['deep learning'] },
  { zh: ['神经网络'], en: ['neural network'] },
  { zh: ['卷积'], en: ['convolution', 'convolutional', 'CNN'] },
  { zh: ['残差网络', '残差'], en: ['residual network', 'ResNet', 'residual'] },
  { zh: ['注意力'], en: ['attention'] },
  { zh: ['多尺度'], en: ['multi-scale', 'multiscale'] },
  { zh: ['动态卷积'], en: ['dynamic convolution'] },
  { zh: ['分割'], en: ['segmentation', 'segment'] },
  { zh: ['数据集'], en: ['dataset'] },
  { zh: ['准确率', '精度'], en: ['accuracy', 'precision'] },
  { zh: ['召回率'], en: ['recall'] },
  { zh: ['阈值'], en: ['threshold'] },

  // —— 力学与施工 ——
  { zh: ['应力'], en: ['stress'] },
  { zh: ['变形'], en: ['deformation'] },
  { zh: ['位移'], en: ['displacement'] },
  { zh: ['刚度'], en: ['stiffness'] },
  { zh: ['注浆', '灌浆'], en: ['grouting', 'grout'] },
  { zh: ['回填'], en: ['backfill', 'back-fill'] },
  { zh: ['加固', '修复', '修补'], en: ['reinforcement', 'repair', 'remediation'] },
  { zh: ['模型试验'], en: ['model test'] },
  { zh: ['数值模拟', '有限元'], en: ['numerical simulation', 'finite element', 'FEM'] },
  { zh: ['现场'], en: ['field'] },
  { zh: ['实验', '试验'], en: ['experiment', 'experimental', 'test'] },
  { zh: ['参数'], en: ['parameter'] },
  { zh: ['方法'], en: ['method', 'approach'] },
  { zh: ['局限'], en: ['limitation', 'limitations'] },
  { zh: ['薄板', '薄板方程'], en: ['thin plate', 'thin-plate equation', 'thin plate theory'] },
  { zh: ['厚板', '厚板模型'], en: ['thick plate', 'thick-plate model'] },
  { zh: ['特征参数'], en: ['characteristic parameter', 'characteristic parameters'] },
  { zh: ['测量网格', '测点', '网格'], en: ['measurement grid', 'measurement point', 'grid'] },
  { zh: ['研究空白', '研究不足'], en: ['research gap', 'few studies', 'limited research'] },
  { zh: ['山区'], en: ['mountainous', 'mountainous areas'] },
  { zh: ['锚杆'], en: ['bolt', 'rock bolt', 'anchor bolt'] },
  { zh: ['回填材料'], en: ['backfill material', 'backfill materials'] },
  { zh: ['注浆压力'], en: ['grouting pressure'] },
  { zh: ['步进单频扫描', '步进扫频'], en: ['stepped-tone sweep', 'stepped frequency', 'stepped-tone'] },
  { zh: ['线性调频'], en: ['linear chirp', 'chirp'] },
  { zh: ['试件', '试样'], en: ['specimen', 'sample'] },
  { zh: ['带通滤波', '带通滤波器'], en: ['band-pass filter', 'bandpass filter', 'BPF'] },
  { zh: ['接缝'], en: ['joint'] },
  { zh: ['成像条件'], en: ['imaging condition'] },
  { zh: ['相对误差', '误差'], en: ['relative error', 'error'] },
  { zh: ['仿真', '数值仿真'], en: ['simulation', 'numerical simulation'] },
  { zh: ['剖面'], en: ['profile'] },
  { zh: ['运营'], en: ['operational', 'operation'] },
  { zh: ['维护', '保养'], en: ['maintenance'] },
  { zh: ['支护'], en: ['support'] },
  { zh: ['结果'], en: ['results', 'result'] },
  { zh: ['结论'], en: ['conclusion', 'conclusions'] },
  { zh: ['背景'], en: ['background', 'introduction'] },
  { zh: ['小波变换', '小波'], en: ['wavelet transform', 'wavelet'] },
  { zh: ['信号重构', '重构'], en: ['signal reconstruction', 'reconstruction'] },
  { zh: ['分解层数'], en: ['decomposition level', 'decomposition levels'] },
  { zh: ['峰值压力'], en: ['peak pressure'] },
  { zh: ['冲击波'], en: ['shock wave'] },
  { zh: ['红外热成像', '红外'], en: ['infrared thermography', 'infrared'] },
  { zh: ['无损检测', '无损'], en: ['non-destructive testing', 'non-destructive', 'NDT'] },
  { zh: ['超声回波'], en: ['ultrasonic echo'] },
  { zh: ['配合比'], en: ['mix proportion', 'mix design'] },
  { zh: ['加速度计', '加速度传感器'], en: ['accelerometer', 'acceleration sensor'] },
  { zh: ['压电'], en: ['piezoelectric'] },
  { zh: ['噪声', '去噪'], en: ['noise', 'denoising'] },
  { zh: ['空域', '空间谱熵'], en: ['spatial spectral entropy', 'spatial'] },
  { zh: ['特征提取'], en: ['feature extraction'] },
  { zh: ['信号处理'], en: ['signal processing'] },
  { zh: ['模态分析'], en: ['modal analysis'] },
]

/** 单次查询最多追加多少个词，防止长查询把检索打分冲淡。 */
const MAX_ADDED_TERMS = 40

/**
 * 把查询扩展成「原文 + 领域等价词」。
 *
 * 只有命中的词条才扩展：查「空洞检测」→ void/cavity/hollow + detection/inspection；
 * 查「GPR 杂波」→ 探地雷达/杂波 对应的中文词，方便命中中文文献。
 */
export function expandQuery(query: string): QueryExpansion {
  const trimmed = query.trim()
  const added: QueryExpansion['added'] = []
  const appended: string[] = []
  const seen = new Set<string>()

  const zhHaystack = trimmed.replace(/\s+/g, '')
  const enHaystack = trimmed.toLowerCase()

  const push = (from: string, to: string, direction: 'zh→en' | 'en→zh'): void => {
    const key = to.toLowerCase()
    if (seen.has(key) || appended.length >= MAX_ADDED_TERMS) return
    seen.add(key)
    added.push({ from, to, direction })
    appended.push(to)
  }

  for (const entry of GLOSSARY) {
    const zhHit = entry.zh.find((term) => term.length > 0 && zhHaystack.includes(term))
    if (zhHit !== undefined) {
      for (const term of entry.en) push(zhHit, term, 'zh→en')
    }
    const enHit = entry.en.find((term) => term.length > 1 && enHaystack.includes(term.toLowerCase()))
    if (enHit !== undefined) {
      for (const term of entry.zh) push(enHit, term, 'en→zh')
    }
  }

  const expandedQuery = appended.length === 0 ? trimmed : `${trimmed} ${appended.join(' ')}`
  return { query: trimmed, expandedQuery, translatedQuery: appended.join(' '), added }
}

/** 供 UI/工具输出的一句话解释；没有扩展时返回空串。 */
export function describeExpansion(expansion: QueryExpansion): string {
  if (expansion.added.length === 0) return ''
  const shown = expansion.added.slice(0, 6).map((item) => `${item.from}→${item.to}`)
  const suffix = expansion.added.length > shown.length ? ` 等 ${expansion.added.length} 个` : ''
  return `跨语言扩展：${shown.join('、')}${suffix}`
}

/** 词表条目数（用于文档与自检）。 */
export const GLOSSARY_SIZE = GLOSSARY.length
