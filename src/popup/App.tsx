import React, { useEffect, useState, useRef } from 'react';
import { getVault, setVault, isVaultEncrypted, IdentityVault, FIELD_LABELS, FIELD_PLACEHOLDERS } from '../utils/storage';
import { setRemoteUrl } from '../embeddings/adapter';
import { InMemoryVectorStore } from '../embeddings/vectorStore';
import { readProcessorFile, indexDocuments, indexIntentEmbeddings, mergeIntoVault } from '../utils/importer';
import { IdentityGraph, GraphNode, GraphEdge } from '../utils/identityGraph';
import { globalFeedbackStore, FeedbackEntry } from '../utils/feedbackStore';
import { generatePassphrase } from '../utils/crypto';

type ImportedDocument = {
  fileName: string;
  textSnippet: string;
  extracted: Record<string, string | null>;
};

InMemoryVectorStore.loadFromStorage().catch(() => {});

type Tab = 'vault' | 'import' | 'graph' | 'feedback' | 'settings';

const App: React.FC = () => {
  const ext = (globalThis as any).chrome;
  const [vault, setVaultData] = useState<IdentityVault | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('vault');
  const [passphrase, setPassphrase] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [embeddingUrl, setEmbeddingUrl] = useState('');
  const [serverStatus, setServerStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [importResult, setImportResult] = useState<string>('');
  const [, setGraph] = useState<IdentityGraph>(new IdentityGraph());
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<{ total: number; byCorrection: Record<string, number> }>({ total: 0, byCorrection: {} });
  const [suggestedMappings, setSuggestedMappings] = useState<Array<{ pattern: string; intent: string; confidence: number }>>([]);
  const [dirPath, setDirPath] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [generatedPassphrase, setGeneratedPassphrase] = useState('');

  // Direct file upload / OCR state
  const [directImports, setDirectImports] = useState<ImportedDocument[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (msg.type === 'FILE_RESULT') {
        setDirectImports(prev => [...prev, {
          fileName: String(msg.fileName),
          textSnippet: String(msg.textSnippet || ''),
          extracted: (msg.extracted || {}) as Record<string, string | null>,
        }]);
      }
    });
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; };
  }, []);

  const handleFiles = async (files: FileList | File[]) => {
    setDirectImports([]);
    workerRef.current?.postMessage({ type: 'PROCESS_FILES', files: Array.from(files as any) });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  };

  const importToVault = async (extracted: Record<string, string | null>) => {
    if (!vault) return;
    const newVault = { ...vault };
    for (const [key, value] of Object.entries(extracted)) {
      if (value && !(newVault as any)[key]) (newVault as any)[key] = value;
    }
    setVaultData(newVault);
    await setVault(newVault);
    setImportResult('Imported extracted fields into vault.');
  };

  // Load initial data
  useEffect(() => {
    isVaultEncrypted().then(setIsEncrypted);
    getVault().then(setVaultData);
    IdentityGraph.loadFromStorage().then(g => {
      setGraph(g);
      setGraphNodes(g.getAllNodes());
      setGraphEdges(g.getEdges());
    });
    globalFeedbackStore.load().then(() => {
      globalFeedbackStore.getAll().then(setFeedbackEntries);
      setFeedbackStats(globalFeedbackStore.getStats());
      setSuggestedMappings(globalFeedbackStore.getSuggestedMappings());
    });
    ext?.storage?.local?.get(['embeddingUrl', 'dirPath'], (res: any) => {
      if (res.embeddingUrl) {
        setEmbeddingUrl(res.embeddingUrl);
        setRemoteUrl(res.embeddingUrl);
      }
      if (res.dirPath) setDirPath(res.dirPath);
    });
  }, []);

  // Check embedding server status
  useEffect(() => {
    if (!embeddingUrl) return;
    const check = async () => {
      try {
        const res = await fetch(embeddingUrl.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(3000) });
        if (res.ok) setServerStatus('online');
        else setServerStatus('offline');
      } catch { setServerStatus('offline'); }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [embeddingUrl]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!vault) return;
    setVaultData({ ...vault, [e.target.name]: e.target.value });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!vault) return;
    const p = isEncrypted ? passphrase : undefined;
    await setVault(vault, p);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAutofill = async () => {
    if (!ext?.tabs) return;
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) ext.tabs.sendMessage(tab.id, { type: 'AUTOFILL_FORM' });
  };

  const toggleEncryption = async () => {
    if (!isEncrypted) {
      const p = generatePassphrase();
      setGeneratedPassphrase(p);
      setPassphrase(p);
      setIsEncrypted(true);
    } else {
      setPassphrase('');
      setGeneratedPassphrase('');
      setIsEncrypted(false);
      if (vault) await setVault(vault, undefined);
    }
  };

  // Processor JSON import
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await readProcessorFile(file);
      const currentVault = vault || await getVault();
      const merged = mergeIntoVault(currentVault, data.merged_fields);
      setVaultData(merged);
      await setVault(merged);

      // Index documents and intents into vector store
      const docCount = await indexDocuments(data.documents);
      let intentCount = 0;
      if (data.intent_embeddings) {
        intentCount = await indexIntentEmbeddings(data.intent_embeddings);
      }

      // Build identity graph
      const g = new IdentityGraph();
      const docsForGraph = data.documents.map(d => ({
        fileName: d.file_name,
        extractedFields: d.extracted_fields,
      }));
      g.buildFromDocuments(data.merged_fields, docsForGraph);
      await g.saveToStorage();
      setGraph(g);
      setGraphNodes(g.getAllNodes());
      setGraphEdges(g.getEdges());

      setImportResult(
        `Imported ${data.document_count} documents, ${docCount} indexed, ` +
        `${intentCount} intent vectors, ${data.documents.length} graph nodes.`
      );
    } catch (err: any) {
      setImportResult(`Import failed: ${err.message}`);
    }
  };

  // Directory scan via server
  const handleScanDir = async () => {
    if (!embeddingUrl) {
      setImportResult('Set embedding server URL first');
      return;
    }
    if (!dirPath) {
      setImportResult('Set directory path first');
      return;
    }
    try {
      const url = embeddingUrl.replace(/\/$/, '') + '/scan';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: dirPath }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.merged_fields && vault) {
        const merged = { ...vault };
        for (const [k, v] of Object.entries(data.merged_fields)) {
          if (v && !(merged as any)[k]) (merged as any)[k] = v;
        }
        setVaultData(merged);
        await setVault(merged);
      }
      setImportResult(`Scanned directory. Found ${data.documents?.length || 0} documents.`);
    } catch (err: any) {
      setImportResult(`Scan failed: ${err.message}`);
    }
  };

  // Embedding URL save
  const saveEmbeddingUrl = () => {
    setRemoteUrl(embeddingUrl || undefined);
    ext?.storage?.local?.set({ embeddingUrl }, () => {
      setImportResult('Embedding endpoint saved.');
    });
  };

  // Directory path save
  const saveDirPath = () => {
    ext?.storage?.local?.set({ dirPath }, () => {
      setImportResult('Directory path saved.');
    });
  };

  const handleFeedbackClear = async () => {
    await globalFeedbackStore.clear();
    setFeedbackEntries([]);
    setFeedbackStats({ total: 0, byCorrection: {} });
    setSuggestedMappings([]);
  };

  const handleGraphClear = async () => {
    const g = new IdentityGraph();
    await g.saveToStorage();
    setGraph(g);
    setGraphNodes([]);
    setGraphEdges([]);
  };

  if (!vault) {
    return <div className="loading">Loading Vault...</div>;
  }

  const VaultFieldRow = ({ fieldKey }: { fieldKey: string }) => {
    const inputType =
      fieldKey === 'dob' ? 'date' :
      fieldKey === 'email' ? 'email' :
      fieldKey === 'phone' ? 'tel' : 'text';
    return (
      <div className="form-group" key={fieldKey}>
        <label>{FIELD_LABELS[fieldKey] || fieldKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
        <input
          type={inputType}
          name={fieldKey}
          value={vault[fieldKey] || ''}
          onChange={handleChange}
          placeholder={FIELD_PLACEHOLDERS[fieldKey] || ''}
        />
      </div>
    );
  };

  const renderVaultTab = () => {
    const orderedKeys = ['name', 'dob', 'pan', 'aadhaar', 'email', 'phone', 'uan', 'passport', 'dl', 'voterid'];
    const extraKeys = Object.keys(vault).filter(k => !orderedKeys.includes(k));
    return (
      <div className="vault-form">
        {orderedKeys.filter(k => vault[k] || FIELD_LABELS[k]).map(k => <VaultFieldRow key={k} fieldKey={k} />)}
        {extraKeys.map(k => <VaultFieldRow key={k} fieldKey={k} />)}
      </div>
    );
  };

  const renderImportTab = () => (
    <div className="tab-content">
      <section className="import-section">
        <h2>Import from Processor JSON</h2>
        <p className="section-desc">Upload the output.json from the Python processor to populate your vault and build the identity graph.</p>
        <input type="file" accept=".json" onChange={handleImportFile} />
      </section>

      <section className="import-section">
        <h2>Directory Scan (via Server)</h2>
        <p className="section-desc">Configure the processor's server URL and a directory path to scan documents remotely.</p>
        <div className="config-row">
          <label>Server URL</label>
          <input
            type="text"
            value={embeddingUrl}
            onChange={e => setEmbeddingUrl(e.target.value)}
            placeholder="http://127.0.0.1:8765"
          />
          <button className="btn-sm" onClick={saveEmbeddingUrl}>Save</button>
          <span className={`status-dot ${serverStatus}`} title={`Server ${serverStatus}`} />
        </div>
        <div className="config-row">
          <label>Directory Path</label>
          <input
            type="text"
            value={dirPath}
            onChange={e => setDirPath(e.target.value)}
            placeholder="C:\Users\...\docs"
          />
          <button className="btn-sm" onClick={saveDirPath}>Save</button>
        </div>
        <button className="btn" onClick={handleScanDir} disabled={serverStatus !== 'online'}>
          Scan Directory
        </button>
        {serverStatus !== 'online' && (
          <p className="hint">Server must be online to scan. Start: <code>python scripts/processor.py --server</code></p>
        )}
      </section>

      <section className="import-section">
        <h2>Direct File Upload (OCR)</h2>
        <p className="section-desc">Upload identity documents (images, PDFs) directly for OCR extraction.</p>
        <input type="file" multiple accept="image/*,.pdf" onChange={handleFileInput} />
        {directImports.length > 0 && (
          <div className="imports-list">
            {directImports.map((it, idx) => (
              <div key={idx} className="import-card">
                <strong>{it.fileName}</strong>
                <div className="snippet">{it.textSnippet}</div>
                <div className="extracted">
                  {Object.entries(it.extracted).map(([key, value]) =>
                    value ? <div key={key}><strong>{key}:</strong> {value}</div> : null
                  )}
                </div>
                <button className="btn-sm" onClick={() => importToVault(it.extracted)}>Import to Vault</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {importResult && <div className="result-banner">{importResult}</div>}
    </div>
  );

  const renderGraphTab = () => (
    <div className="tab-content">
      <div className="graph-header">
        <h2>Identity Graph</h2>
        <button className="btn-sm danger" onClick={handleGraphClear}>Clear Graph</button>
      </div>
      <p className="section-desc">{graphNodes.length} nodes, {graphEdges.length} edges</p>

      <div className="graph-visual">
        {graphNodes.map(node => (
          <div key={node.id} className={`graph-node type-${node.type}`}>
            <div className="node-label">{node.label}</div>
            <div className="node-type">{node.type}</div>
            {Object.entries(node.properties).length > 0 && (
              <div className="node-props">
                {Object.entries(node.properties).map(([k, v]) => (
                  <div key={k} className="prop"><span>{k}:</span> {v}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="graph-edges">
        <h3>Relationships</h3>
        {graphEdges.length === 0 && <p className="hint">No relationships yet. Import documents to build the graph.</p>}
        {graphEdges.map((edge, i) => (
          <div key={i} className="edge-row">
            <span className="edge-from">{edge.from}</span>
            <span className="edge-arrow">—[{edge.type}]→</span>
            <span className="edge-to">{edge.to}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderFeedbackTab = () => (
    <div className="tab-content">
      <div className="feedback-header">
        <h2>Learning System</h2>
        <button className="btn-sm danger" onClick={handleFeedbackClear}>Clear All</button>
      </div>
      <p className="section-desc">Tracks user corrections so the system adapts over time.</p>

      <div className="feedback-stats">
        <div className="stat-card">
          <div className="stat-value">{feedbackStats.total}</div>
          <div className="stat-label">Total Corrections</div>
        </div>
        {Object.entries(feedbackStats.byCorrection).slice(0, 6).map(([key, count]) => (
          <div key={key} className="stat-card">
            <div className="stat-value">{count}</div>
            <div className="stat-label">{key}</div>
          </div>
        ))}
      </div>

      {suggestedMappings.length > 0 && (
        <section>
          <h3>Suggested Mappings</h3>
          <div className="mappings-list">
            {suggestedMappings.map((m, i) => (
              <div key={i} className="mapping-row">
                <code>"{m.pattern}"</code> → <strong>{m.intent}</strong>
                <span className="confidence">{(m.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3>Recent Corrections</h3>
        {feedbackEntries.length === 0 && <p className="hint">No corrections yet. Corrections will appear here when you provide feedback on autofill results.</p>}
        <div className="feedback-list">
          {feedbackEntries.slice().reverse().slice(0, 20).map((entry, i) => (
            <div key={i} className="feedback-row">
              <div className="fb-field"><strong>Field:</strong> {entry.fieldText}</div>
              <div className="fb-correction"><strong>Corrected to:</strong> {entry.correctedTo}</div>
              <div className="fb-context"><strong>Context:</strong> {entry.contextText}</div>
              <div className="fb-time">{new Date(entry.timestamp).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="tab-content">
      <section>
        <h2>Security</h2>
        <div className="config-row">
          <label>Encrypt Vault (AES-256-GCM)</label>
          <button className={`btn-sm ${isEncrypted ? 'danger' : ''}`} onClick={toggleEncryption}>
            {isEncrypted ? 'Disable Encryption' : 'Enable Encryption'}
          </button>
        </div>
        {isEncrypted && (
          <div className="encryption-info">
            <p>Your vault will be encrypted with a passphrase before storage.</p>
            {generatedPassphrase && (
              <div className="passphrase-display">
                <strong>Your Passphrase (save this!):</strong>
                <code>{generatedPassphrase}</code>
                <button className="btn-sm" onClick={() => {
                  navigator.clipboard.writeText(generatedPassphrase);
                  setImportResult('Passphrase copied to clipboard.');
                }}>Copy</button>
              </div>
            )}
            <div className="config-row">
              <label>Passphrase</label>
              <input
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
              />
              <button className="btn-sm" onClick={() => setShowPassphrase(!showPassphrase)}>
                {showPassphrase ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Embedding Engine</h2>
        <p className="section-desc">The extension can use a local embedding server (Python processor) or a built-in fallback.</p>
        <div className="config-row">
          <label>Server URL</label>
          <input
            type="text"
            value={embeddingUrl}
            onChange={e => setEmbeddingUrl(e.target.value)}
            placeholder="http://127.0.0.1:8765"
          />
          <button className="btn-sm" onClick={saveEmbeddingUrl}>Save</button>
          <span className={`status-dot ${serverStatus}`} />
        </div>
        <div className="vector-info">
          <span>Vector store: {InMemoryVectorStore.size()} vectors</span>
        </div>
      </section>

      <section>
        <h2>About</h2>
        <p>IdentityCopilot v1.0.0</p>
        <p>A browser-native AI assistant that understands forms like a human.</p>
      </section>
    </div>
  );

  return (
    <div className="app-container">
      <header className="header">
        <h1>IdentityCopilot</h1>
        <p>AI-powered form autofill assistant</p>
      </header>

      <nav className="tabs">
        {(['vault', 'import', 'graph', 'feedback', 'settings'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className="tab-panel">
        {activeTab === 'vault' && renderVaultTab()}
        {activeTab === 'import' && renderImportTab()}
        {activeTab === 'graph' && renderGraphTab()}
        {activeTab === 'feedback' && renderFeedbackTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </main>

      <footer className="footer-actions">
        <button className={`btn-save ${saved ? 'saved' : ''}`} onClick={handleSave}>
          {saved ? 'Saved ✓' : 'Save Vault'}
        </button>
        <button className="btn-autofill" onClick={handleAutofill}>
          Autofill Form ✨
        </button>
      </footer>
    </div>
  );
};

export default App;
