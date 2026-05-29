from pydantic_settings import BaseSettings

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
    
    # Database
    sqlite_path: str = "./data/zoteroseek.db"
    chroma_path: str = "./data/chroma"
    
    class Config:
        env_prefix = "ZOTEROSEEK_"

settings = Settings()
