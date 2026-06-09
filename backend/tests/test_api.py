"""
API 端点测试 — 使用 FastAPI TestClient
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from backend.main import app
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestLibraryEndpoint:
    def test_library_returns_list(self, client):
        resp = client.get("/api/v1/library")
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestSearchEndpoint:
    def test_search_returns_results(self, client):
        """搜索端点：返回结果结构正确"""
        resp = client.post("/api/v1/search", json={"query": "test", "top_k": 3})
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data
        assert isinstance(data["results"], list)

    def test_search_missing_query(self, client):
        resp = client.post("/api/v1/search", json={})
        assert resp.status_code == 422


class TestIndexEndpoint:
    def test_index_invalid_extractor(self, client):
        resp = client.post("/api/v1/index", json={
            "pdf_path": "test.pdf", "extractor": "invalid",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert "未知提取器" in resp.json()["error"]

    def test_index_missing_path(self, client):
        resp = client.post("/api/v1/index", json={})
        assert resp.status_code == 422


class TestZoteroEndpoint:
    def test_zotero_items_returns_structure(self, client):
        resp = client.get("/api/v1/zotero-items")
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "zotero_connected" in data
