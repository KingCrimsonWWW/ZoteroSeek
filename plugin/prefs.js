// Backend settings
pref("extensions.zotero.zoteroseek.url", "http://localhost");
pref("extensions.zotero.zoteroseek.port", 20801);

// LLM settings (与 .env 对应，不存储 API Key)
pref("extensions.zotero.zoteroseek.apikey", "");
pref("extensions.zotero.zoteroseek.baseurl", "https://token-plan-cn.xiaomimimo.com/v1");
pref("extensions.zotero.zoteroseek.model", "mimo-v2.5");
pref("extensions.zotero.zoteroseek.temperature", 1.0);
pref("extensions.zotero.zoteroseek.maxtokens", 4096);

// Embedding settings (与 .env 对应，不存储 API Key)
pref("extensions.zotero.zoteroseek.useCustomEmbedding", false);
pref("extensions.zotero.zoteroseek.embeddingUrl", "https://api.siliconflow.cn/v1");
pref("extensions.zotero.zoteroseek.embeddingKey", "");
pref("extensions.zotero.zoteroseek.embeddingModel", "BAAI/bge-m3");
pref("extensions.zotero.zoteroseek.batchSize", 20);
