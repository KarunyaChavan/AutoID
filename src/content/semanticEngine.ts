import { getDefaultAdapter, EmbeddingsAdapter } from '../embeddings/adapter';
import { InMemoryVectorStore } from '../embeddings/vectorStore';

type Intent = {
  id: string;
  aliases: string[];
};

const INTENTS: Intent[] = [
  { id: 'pan', aliases: ['pan', 'permanent account number', 'income tax number', 'tax id', 'pan no', 'income tax id', 'taxpayer id', 'pan card'] },
  { id: 'aadhaar', aliases: ['aadhaar', 'uidai', 'national id', 'aadhar', 'aadhaar number', 'unique identification number', '12 digit id', 'aadhaar card'] },
  { id: 'uan', aliases: ['uan', 'universal account number', 'epfo number', 'epfo', 'pf account', 'provident fund number', 'uan number'] },
  { id: 'passport', aliases: ['passport', 'passport number', 'passport no', 'travel document'] },
  { id: 'dl', aliases: ['driving license', 'driving licence', 'dl number', 'driver license', 'motor vehicle'] },
  { id: 'voterid', aliases: ['voter id', 'voter id number', 'epic card', 'epic number', 'voter card', 'elector id'] },
  { id: 'dob', aliases: ['date of birth', 'dob', 'birth date', 'birthday'] },
  { id: 'email', aliases: ['email', 'e-mail', 'email address', 'email id', 'electronic mail', 'mail id'] },
  { id: 'phone', aliases: ['phone', 'mobile', 'phone number', 'mobile number', 'contact number', 'telephone', 'cell phone', 'phone no'] },
  { id: 'name', aliases: ['name', 'full name', 'first name', 'last name', 'your name', 'applicant name', 'employee name', 'given name', 'surname'] },
];

const scoreTokens = (hay: string, needle: string): number => {
  const a = hay.toLowerCase().split(/\W+/).filter(Boolean);
  const b = needle.toLowerCase().split(/\W+/).filter(Boolean);
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  setB.forEach(token => { if (setA.has(token)) common++; });
  return common / Math.max(1, setB.size);
};

const fastClassify = (text: string): string | null => {
  const cleaned = text.trim();
  if (!cleaned) return null;

  let best: { id: string; score: number } | null = null;
  for (const intent of INTENTS) {
    for (const alias of intent.aliases) {
      const s = scoreTokens(cleaned, alias);
      if (!best || s > best.score) best = { id: intent.id, score: s };
      if (cleaned.toLowerCase().includes(alias) && (!best || 1 > best.score)) {
        best = { id: intent.id, score: 1 };
      }
    }
  }
  if (best && best.score >= 0.5) return best.id;
  return null;
};

const embeddingClassify = async (
  text: string,
  adapter: EmbeddingsAdapter,
  store: typeof InMemoryVectorStore
): Promise<string | null> => {
  try {
    const embedding = await adapter.generate(text);
    const results = store.search(embedding, 3);

    if (results.length === 0) return null;

    const intentResults = results.filter(r => r.metadata?.type === 'intent');
    if (intentResults.length > 0 && intentResults[0].score > 0.5 && intentResults[0].metadata) {
      return intentResults[0].metadata.intent;
    }

    return null;
  } catch {
    return null;
  }
};

export const semanticClassify = async (
  text: string
): Promise<string | null> => {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const fast = fastClassify(cleaned);
  if (fast) return fast;

  if (InMemoryVectorStore.size() > 0) {
    const adapter = getDefaultAdapter();
    return embeddingClassify(cleaned, adapter, InMemoryVectorStore);
  }

  return null;
};

export const semanticClassifySync = (text: string): string | null => {
  return fastClassify(text);
};
