import { IdentityVault, normalizeDOB } from './storage';
import { InMemoryVectorStore } from '../embeddings/vectorStore';

export interface ProcessorDocument {
  file_name: string;
  file_type: string;
  relative_path: string;
  extracted_text: string;
  extracted_fields: Record<string, string | null>;
  embedding: number[];
}

export interface ProcessorOutput {
  version: number;
  generated_at: string;
  source_dir: string;
  document_count: number;
  documents: ProcessorDocument[];
  merged_fields: Record<string, string | null>;
  intent_embeddings?: Record<string, number[]>;
}

export function validateProcessorOutput(data: any): data is ProcessorOutput {
  return (
    data &&
    typeof data.version === 'number' &&
    Array.isArray(data.documents) &&
    typeof data.merged_fields === 'object'
  );
}

export function mergeIntoVault(
  vault: IdentityVault,
  mergedFields: Record<string, string | null>
): IdentityVault {
  const result = { ...vault };
  for (const [key, value] of Object.entries(mergedFields)) {
    if (!value) continue;
    if (result[key]) continue; // Don't overwrite existing values
    if (key === 'dob') {
      result[key] = normalizeDOB(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function indexDocuments(
  documents: ProcessorDocument[]
): Promise<number> {
  let count = 0;
  for (const doc of documents) {
    if (doc.embedding && doc.embedding.length > 0) {
      InMemoryVectorStore.add(
        `doc:${doc.file_name}`,
        doc.embedding,
        {
          fileName: doc.file_name,
          type: doc.file_type,
          importedAt: Date.now(),
        }
      );
      count++;
    }
  }
  return count;
}

export async function indexIntentEmbeddings(
  intents: Record<string, number[]>
): Promise<number> {
  let count = 0;
  for (const [intent, embedding] of Object.entries(intents)) {
    if (embedding && embedding.length > 0) {
      InMemoryVectorStore.add(
        `intent:${intent}`,
        embedding,
        { type: 'intent', intent, importedAt: Date.now() }
      );
      count++;
    }
  }
  return count;
}

export function readProcessorFile(file: File): Promise<ProcessorOutput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (validateProcessorOutput(data)) {
          resolve(data);
        } else {
          reject(new Error('Invalid processor output format'));
        }
      } catch (e) {
        reject(new Error(`Failed to parse JSON: ${e}`));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
