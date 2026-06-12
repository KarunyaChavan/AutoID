import { Embedding } from './adapter';
import { saveVector, loadAllVectors, deleteVector, clearVectors } from './persistence';

export type Metadata = Record<string, any>;

// Simple in-memory vector store with brute-force cosine similarity search.
export class LocalVectorStore {
  private vectors: Map<string, Embedding> = new Map();
  private meta: Map<string, Metadata> = new Map();

  add(id: string, vector: Embedding, metadata?: any) {
    this.vectors.set(id, vector);
    if (metadata) this.meta.set(id, metadata);
    // Persist asynchronously
    try { saveVector(id, vector, metadata || {}); } catch (e) { /* ignore persistence errors */ }
  }

  remove(id: string) {
    this.vectors.delete(id);
    this.meta.delete(id);
    try { deleteVector(id); } catch (e) { /* ignore */ }
  }

  clear() {
    this.vectors.clear();
    this.meta.clear();
    try { clearVectors(); } catch (e) { /* ignore */ }
  }

  // Load persisted vectors into memory (call at startup)
  async loadFromStorage() {
    const items = await loadAllVectors();
    for (const it of items) {
      this.vectors.set(it.id, it.vector);
      if (it.metadata) this.meta.set(it.id, it.metadata);
    }
  }

  private dot(a: Embedding, b: Embedding) {
    let s = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
    return s;
  }

  private norm(a: Embedding) {
    return Math.sqrt(a.reduce((acc, v) => acc + v * v, 0)) || 1;
  }

  search(query: Embedding, topK = 5) {
    const results: Array<{ id: string; score: number; metadata?: Metadata }> = [];
    const qnorm = this.norm(query);
    for (const [id, vec] of this.vectors.entries()) {
      const score = this.dot(query, vec) / (qnorm * this.norm(vec));
      results.push({ id, score, metadata: this.meta.get(id) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  size() { return this.vectors.size; }
}

export const InMemoryVectorStore = new LocalVectorStore();

export default LocalVectorStore;
