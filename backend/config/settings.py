from pydantic_settings import BaseSettings
from pathlib import Path

# 获取项目根目录
ROOT_DIR = Path(__file__).parent.parent.parent

class Settings(BaseSettings):
    # Server
    host: str = "127.0.0.1"
    port: int = 20801
    debug: bool = True
    
    # Zotero
    zotero_api_url: str = "http://localhost:23119/api"
    zotero_api_key: str = ""
    
    # LLM
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    
    # Embedding
    embedding_api_key: str = ""
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_model: str = "text-embedding-3-small"

    # MinerU (PDF 解析)
    mineru_api_url: str = ""          # 留空 = 自动启动本地 mineru-api，填写 = 连接远程服务
    mineru_api_key: str = ""          # 云 API Key（从 mineru.net 获取）
    mineru_backend: str = "pipeline"  # pipeline / hybrid-auto-engine / vlm-auto-engine
    mineru_parse_method: str = "auto" # auto / txt / ocr
    mineru_language: str = "ch"       # 文档语言：ch / en

    # Database
    sqlite_path: str = "./data/zoteroseek.db"
    chroma_path: str = "./data/chroma"
    
    class Config:
        env_prefix = "ZOTEROSEEK_"
        env_file = ROOT_DIR / ".env"
        env_file_encoding = "utf-8"

settings = Settings()
