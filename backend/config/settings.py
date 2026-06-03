from pydantic_settings import BaseSettings
from pathlib import Path

# 获取项目根目录
ROOT_DIR = Path(__file__).parent.parent.parent


class Settings(BaseSettings):
    """
    应用配置 — 从环境变量和 .env 文件加载

    Pydantic v2 风格：使用 model_config 替代 class Config
    所有字段都有类型校验和默认值
    """
    # Server
    host: str = "127.0.0.1"
    port: int = 20801
    debug: bool = False  # 生产安全默认值

    # Zotero
    zotero_api_url: str = "http://localhost:23119/api"
    zotero_api_key: str = ""
    zotero_storage_path: str = ""  # 留空 = 自动检测

    # LLM
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    # Embedding
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"

    # MinerU (PDF 解析)
    mineru_api_url: str = ""
    mineru_api_key: str = ""
    mineru_backend: str = "pipeline"
    mineru_parse_method: str = "auto"
    mineru_language: str = "ch"

    # Database
    sqlite_path: str = "./data/zoteroseek.db"
    chroma_path: str = "./data/chroma"

    # Pydantic v2 配置
    model_config = {
        "env_prefix": "ZOTEROSEEK_",
        "env_file": str(ROOT_DIR / ".env"),
        "env_file_encoding": "utf-8",
    }


settings = Settings()
