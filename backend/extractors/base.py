"""
提取器基础模块 —— 定义文档提取的抽象接口和统一数据契约

设计模式：抽象工厂模式（Abstract Factory）的前置步骤
- Extractor 是所有提取器的抽象基类（ABC），定义了统一的提取接口
- RawContent 是提取结果的标准化数据模型（Pydantic BaseModel）

为什么需要这个抽象层：
1. 后端可能对接多种文档来源（PDF、Markdown、HTML、网页等），每种来源的提取逻辑不同
2. 通过统一的 RawContent 契约，下游流水线（解析 → 分块 → 嵌入）无需关心上游数据来源
3. 新增提取器只需继承 Extractor 并实现 extract() 和 supports() 方法，符合开闭原则（OCP）

为什么 RawContent 使用 Pydantic BaseModel：
- 自动序列化/反序列化，方便日志记录和调试
- 内置字段校验，确保数据完整性
- 与 FastAPI 生态无缝集成
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Any, Dict


# =============================================================================
# 数据契约：RawContent
# =============================================================================
# RawContent 是提取器输出的标准化格式，是连接"提取阶段"和"解析阶段"的桥梁。
# 所有提取器（MinerU、PyMuPDF 等）都必须返回这个类型，保证下游流水线的统一处理。
# 字段说明：
#   - content: 提取出的原始文本内容（可能是 Markdown、纯文本或 HTML）
#   - content_type: 内容类型标识，用于下游解析器选择对应的解析策略
#   - metadata: 通用元数据字典，存放提取过程中的额外信息（如 API 版本、文件大小等）
#   - page_count: 文档页数，用于统计和调试
#   - source_path: 原始文件路径，用于溯源和错误报告
class RawContent(BaseModel):
    """Raw content extracted from source"""
    content: str
    content_type: str  # "pdf", "markdown", "html"
    metadata: Dict[str, Any] = {}
    page_count: int = 0
    source_path: str = ""


# =============================================================================
# 抽象基类：Extractor
# =============================================================================
# 使用 Python 的 ABC（Abstract Base Class）机制，强制所有子类实现核心方法。
#
# 为什么用 ABC 而不是普通基类：
# - 普通基类的方法如果不被重写，运行时才会发现逻辑错误
# - ABC 的 @abstractmethod 在实例化时就会检查，未实现则直接报错（TypeError）
# - 这是一种"快速失败"（Fail-Fast）的防御性编程策略
#
# 两个抽象方法的设计意图：
# - extract(): 核心提取逻辑，接收文件路径，返回标准化的 RawContent
#   使用 async 是因为大多数提取器涉及 I/O 操作（网络请求、文件读取）
# - supports(): 类型判断方法，用于工厂模式中选择合适的提取器
#   例如 MinerUExtractor.supports("pdf") == True
class Extractor(ABC):
    """Base extractor interface"""

    @abstractmethod
    async def extract(self, source: str, config: Dict[str, Any] = None) -> RawContent:
        """Extract content from source"""
        ...

    @abstractmethod
    def supports(self, source_type: str) -> bool:
        """Check if this extractor supports the source type"""
        ...
