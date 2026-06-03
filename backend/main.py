from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from backend.api.health import router as health_router
from backend.api.index import router as index_router
from backend.api.search import router as search_router
from backend.api.chat import router as chat_router
from backend.api.library import router as library_router
from backend.api.zotero import router as zotero_router
from backend.config.settings import settings
from backend.data.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    init_db()
    yield

app = FastAPI(
    title="ZoteroSeek API",
    version="0.1.0",
    description="Local AI Research Assistant Runtime",
    lifespan=lifespan,
)

# CORS 配置
# 注意：allow_credentials=True 时不能用 allow_origins=["*"]（CORS 规范限制）
# 本地开发环境用 allow_credentials=False 即可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router, prefix="/api/v1")
app.include_router(index_router, prefix="/api/v1")
app.include_router(search_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(library_router, prefix="/api/v1")
app.include_router(zotero_router, prefix="/api/v1")

# Static files (React build)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
