/**
 * retrieval-adapter.mjs
 *
 * Thin Web BFF adapter for the Java Core RAG boundary. Node does not own
 * embedding, Qdrant, rerank, cache, or local knowledge retrieval.
 */

import './env.mjs';

function normalizeCitation(item) {
  if (!item || typeof item !== 'object') return null;
  const endpoint = String(item.endpoint || item.url || '').trim();
  if (!endpoint) return null;
  return {
    title: String(item.title || 'Java Core RAG 来源'),
    publisher: String(item.publisher || 'Java Core Backend'),
    endpoint,
    url: String(item.url || endpoint),
    updatedAt: String(item.updatedAt || new Date().toISOString()),
    status: String(item.status || '已核验'),
    note: String(item.note || '来源由 Java Core Backend 返回。')
  };
}

function emptyRetrieval(reason = '') {
  return {
    provider: 'Java Core Backend',
    owner: 'Java',
    configured: true,
    mode: 'Java Core RAG',
    endpoint: '/ai/rag/retrieve',
    source: 'Java Core Backend',
    verified: false,
    reason,
    directEmbedding: false,
    directQdrant: false,
    fallbackOwner: 'Java',
    embedding: {
      provider: 'Java EmbeddingModel',
      directFromNode: false
    },
    vectorStore: {
      provider: 'Java-managed Qdrant',
      configured: true,
      directFromNode: false,
      verified: false,
      indexedDocuments: null
    },
    contract: {
      request: '{ query, city, constraints, deep? }',
      response: '{ ok, mode, facts, citations, vectorSearch, vectorStore }',
      verified: true
    },
    facts: [],
    citations: []
  };
}

export function retrievalStatus() {
  return emptyRetrieval('');
}

function normalizeRetrieval(data) {
  const base = emptyRetrieval('');
  const source = data && typeof data === 'object' ? data : {};
  const citations = (Array.isArray(source.citations) ? source.citations : [])
    .map(normalizeCitation)
    .filter(Boolean);
  return {
    ...base,
    ...source,
    configured: true,
    provider: 'Java Core Backend',
    owner: 'Java',
    endpoint: '/ai/rag/retrieve',
    directEmbedding: false,
    directQdrant: false,
    fallbackOwner: 'Java',
    embedding: {
      ...base.embedding,
      ...(source.embedding && typeof source.embedding === 'object' ? source.embedding : {}),
      directFromNode: false
    },
    vectorStore: {
      ...base.vectorStore,
      ...(source.vectorStore && typeof source.vectorStore === 'object' ? source.vectorStore : {}),
      directFromNode: false
    },
    contract: {
      ...base.contract,
      ...(source.contract && typeof source.contract === 'object' ? source.contract : {}),
      verified: true
    },
    facts: Array.isArray(source.facts) ? source.facts : [],
    citations
  };
}

function normalizeKnowledgeDocument(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    ...source,
    docId: String(source.docId || source.id || ''),
    title: String(source.title || ''),
    content: String(source.content || source.contentSnippet || ''),
    topic: String(source.topic || source.category || ''),
    entityId: String(source.entityId || ''),
    entityName: String(source.entityName || ''),
    reviewStatus: String(source.reviewStatus || source.status || '已登记')
  };
}

/**
 * Admin status is fetched from Java when a client is available. The fallback
 * shape is deliberately metadata-only and contains no Node corpus or secrets.
 */
export async function knowledgeAdminStatus(javaCore, token) {
  const fallback = {
    corpus: {
      documents: 0,
      entities: 0,
      topics: {},
      reviewStatus: {},
      claimStatus: {},
      coverageWarnings: []
    },
    embedding: {
      provider: 'Java EmbeddingModel',
      status: 'java-managed',
      model: '',
      dimension: null
    },
    vectorStore: retrievalStatus().vectorStore,
    cacheStats: null,
    sourceRegister: []
  };
  if (!javaCore?.ragStats) return fallback;
  try {
    const stats = await javaCore.ragStats(token);
    const retrieval = stats?.retrieval || {};
    return {
      ...fallback,
      corpus: {
        ...fallback.corpus,
        documents: Number(stats?.documentCount ?? stats?.sourceCount ?? stats?.totalChunks ?? 0),
        entities: Number(stats?.entityCount ?? 0)
      },
      embedding: {
        ...fallback.embedding,
        ...(retrieval.embedding || {})
      },
      vectorStore: {
        ...fallback.vectorStore,
        ...(retrieval.vectorStore || {})
      },
      cacheStats: stats?.cacheStats || null
    };
  } catch {
    return fallback;
  }
}

export async function getKnowledgeDocuments(javaCore, token, { query = '', topic = '', entityId = '' } = {}) {
  if (!javaCore?.listKnowledgeDocuments) return [];
  const result = await javaCore.listKnowledgeDocuments(token, { query, topic, entityId });
  const items = Array.isArray(result) ? result : result?.items || result?.documents || [];
  return items.map(normalizeKnowledgeDocument);
}

export async function updateKnowledgeDocument(javaCore, token, docId, { title, content } = {}) {
  if (!javaCore?.updateKnowledgeDocument) return null;
  const result = await javaCore.updateKnowledgeDocument(token, docId, { title, content });
  return normalizeKnowledgeDocument(result?.document || result);
}

export async function createKnowledgeDocument(javaCore, token, formData) {
  if (!javaCore?.createKnowledgeDocument) return null;
  const result = await javaCore.createKnowledgeDocument(token, formData);
  return normalizeKnowledgeDocument(result?.document || result);
}

export async function retrieveTravelKnowledge({ prompt, constraints, javaCore, deep = false, signal } = {}) {
  if (!javaCore?.ragRetrieve) {
    return { ...emptyRetrieval('Java Core RAG 客户端未配置'), ok: false };
  }
  try {
    const result = await javaCore.ragRetrieve({
      query: String(prompt || ''),
      city: '重庆',
      constraints: constraints || {},
      deep,
      signal
    }, undefined);
    const normalized = normalizeRetrieval(result);
    return {
      ...normalized,
      ok: result?.ok !== false,
      reason: String(result?.reason || '')
    };
  } catch (error) {
    if (error?.code === 'REQUEST_ABORTED') throw error;
    const message = error?.message || 'Java Core RAG 暂不可用';
    return {
      ...emptyRetrieval(`Java Core RAG 暂不可用：${message}`),
      ok: false
    };
  }
}
