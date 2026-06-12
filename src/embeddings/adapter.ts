export type Embedding = number[];

export interface EmbeddingsAdapter {
  generate(text: string): Promise<Embedding>;
  getDimension(): number;
}

// Local deterministic fallback: hash tokens and produce small dense vector.
export class LocalFallbackAdapter implements EmbeddingsAdapter {
  private dim: number;
  constructor(dim = 384) { this.dim = dim; }

  getDimension(): number { return this.dim; }

  async generate(text: string): Promise<Embedding> {
    const out = new Array(this.dim).fill(0);
    const s = text || '';
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      out[i % this.dim] += (code % 97) / 97;
    }
    const norm = Math.sqrt(out.reduce((acc, v) => acc + v * v, 0)) || 1;
    return out.map(v => v / norm);
  }
}

// Remote adapter: POST /embed with {text} -> {embedding: number[]}
export class EmbeddingServerAdapter implements EmbeddingsAdapter {
  private url: string;
  constructor(url: string) { this.url = url; }

  getDimension(): number { return 384; }

  async generate(text: string): Promise<Embedding> {
    const url = this.url.replace(/\/$/, '') + '/embed';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Embedding service error: ${res.status}`);
    const j = await res.json();
    if (!Array.isArray(j.embedding)) throw new Error('Invalid embedding response');
    return j.embedding;
  }
}

let defaultAdapter: EmbeddingsAdapter = new LocalFallbackAdapter(384);
let serverUrl: string | undefined;

export const setRemoteUrl = (url?: string) => {
  serverUrl = url;
  if (url) defaultAdapter = new EmbeddingServerAdapter(url);
  else defaultAdapter = new LocalFallbackAdapter(384);
};

export const getServerUrl = () => serverUrl;

export const getDefaultAdapter = () => defaultAdapter;
