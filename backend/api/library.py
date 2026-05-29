from fastapi import APIRouter
from backend.data.db import SessionLocal
from backend.data.models import Item

router = APIRouter(tags=["library"])

@router.get("/library")
async def list_items():
    """List all indexed items"""
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        return {
            "items": [
                {
                    "id": item.id,
                    "title": item.title,
                    "authors": item.authors,
                    "year": item.year,
                    "index_status": item.index_status,
                }
                for item in items
            ]
        }
    finally:
        db.close()
