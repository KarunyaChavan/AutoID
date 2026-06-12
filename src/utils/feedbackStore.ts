// Feedback Store — learning system that records user corrections
// so the system can adapt over time.

export interface FeedbackEntry {
  timestamp: number;
  fieldText: string;
  contextText: string;
  detectedAs: string | null;
  correctedTo: string;
  pageUrl: string;
}

export class FeedbackStore {
  private entries: FeedbackEntry[] = [];

  async load(): Promise<void> {
    const ext = (globalThis as any).chrome;
    if (!ext?.storage?.local) return;
    return new Promise((resolve) => {
      ext.storage.local.get(['feedbackEntries'], (result: any) => {
        if (Array.isArray(result.feedbackEntries)) {
          this.entries = result.feedbackEntries;
        }
        resolve();
      });
    });
  }

  async add(entry: FeedbackEntry): Promise<void> {
    this.entries.push(entry);
    await this.persist();
  }

  async getAll(): Promise<FeedbackEntry[]> {
    return this.entries;
  }

  getStats(): { total: number; byCorrection: Record<string, number> } {
    const byCorrection: Record<string, number> = {};
    for (const e of this.entries) {
      byCorrection[e.correctedTo] = (byCorrection[e.correctedTo] || 0) + 1;
    }
    return { total: this.entries.length, byCorrection };
  }

  // Get suggested field mappings based on common corrections
  getSuggestedMappings(): Array<{ pattern: string; intent: string; confidence: number }> {
    const corrections: Record<string, Record<string, number>> = {};
    for (const e of this.entries) {
      const key = e.fieldText.toLowerCase().trim();
      if (!corrections[key]) corrections[key] = {};
      corrections[key][e.correctedTo] = (corrections[key][e.correctedTo] || 0) + 1;
    }

    const suggestions: Array<{ pattern: string; intent: string; confidence: number }> = [];
    for (const [pattern, intents] of Object.entries(corrections)) {
      const total = Object.values(intents).reduce((a, b) => a + b, 0);
      for (const [intent, count] of Object.entries(intents)) {
        if (count >= 2) {
          suggestions.push({ pattern, intent, confidence: count / total });
        }
      }
    }
    suggestions.sort((a, b) => b.confidence - a.confidence);
    return suggestions;
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    const ext = (globalThis as any).chrome;
    if (!ext?.storage?.local) return;
    return new Promise((resolve) => {
      ext.storage.local.set({ feedbackEntries: this.entries }, () => resolve());
    });
  }
}

export const globalFeedbackStore = new FeedbackStore();
