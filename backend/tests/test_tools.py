"""
Agent 工具测试 — 测试工具的 schema 和基本逻辑

由于工具内部使用 lazy import，测试侧重于验证工具注册和 schema。
"""

import pytest
from backend.agent.tools import search_knowledge, query_library, index_document


class TestToolRegistration:
    """验证工具正确注册"""

    def test_search_knowledge_is_tool(self):
        assert hasattr(search_knowledge, 'name')
        assert search_knowledge.name == 'search_knowledge'

    def test_query_library_is_tool(self):
        assert hasattr(query_library, 'name')
        assert query_library.name == 'query_library'

    def test_index_document_is_tool(self):
        assert hasattr(index_document, 'name')
        assert index_document.name == 'index_document'

    def test_search_knowledge_has_description(self):
        assert search_knowledge.description
        assert '搜索' in search_knowledge.description or 'search' in search_knowledge.description.lower()

    def test_query_library_has_description(self):
        assert query_library.description
        assert '文献' in query_library.description or 'library' in query_library.description.lower()

    def test_index_document_has_description(self):
        assert index_document.description
        assert '索引' in index_document.description or 'index' in index_document.description.lower()


class TestToolSchemas:
    """验证工具参数 schema 正确"""

    def test_search_knowledge_schema(self):
        schema = search_knowledge.args_schema.model_json_schema()
        props = schema.get('properties', {})
        assert 'query' in props
        assert 'top_k' in props

    def test_index_document_schema(self):
        schema = index_document.args_schema.model_json_schema()
        props = schema.get('properties', {})
        assert 'pdf_path' in props
        assert 'extractor' in props
