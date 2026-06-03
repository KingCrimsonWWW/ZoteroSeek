from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.data.db import get_db
from backend.data.models import Item

router = APIRouter(tags=["library"])


@router.get("/library")
async def list_items(db: Session = Depends(get_db)):
    """列出已索引的文献"""
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
