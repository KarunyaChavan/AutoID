# IdentityCopilot

Browser-native AI assistant that understands forms like a human.

Current autofill systems answer: "What is this field called?"

IdentityCopilot answers: "What information is this field asking for?"

That distinction is the core innovation. Instead of matching field names to database keys, IdentityCopilot understands the semantic intent behind every form field, enabling accurate autofill across any website regardless of how fields are labeled.

---

## The Problem

Government portals, banking websites, insurance platforms, job applications, and university admissions forms all ask for the same identity information. But every website labels fields differently:

- "Permanent Account Number"
- "Tax ID"
- "Income Tax Number"
- "PAN No"

All mean the same thing. Traditional autofill systems fail here because they rely on exact field name matching. IdentityCopilot understands that these variations all refer to the same piece of information.

## Key Features

- **Semantic Field Detection** — Understands what a form field is asking for, not just what it is called. Uses NLP embeddings to match field intent across language variations.
- **Secure Identity Vault** — Stores your identity information (PAN, Aadhaar, Name, DOB, Email, Phone, UAN, Passport, Driving License, and more) encrypted at rest with AES-256-GCM.
- **OCR Document Import** — Upload scanned documents or PDFs. The system extracts identity information automatically using OCR technology, populating your vault without manual data entry.
- **Directory Scanning** — Configure a local directory. The system processes all documents in that directory, extracts identity fields, and builds a searchable knowledge graph.
- **Identity Graph** — A knowledge graph that understands relationships between your documents and identity attributes. It knows that a Passport or Aadhaar can serve as address proof, enabling intelligent document requirement reasoning.
- **Adaptive Learning** — Records user corrections and adapts over time. If you correct a field classification, the system learns from that feedback for future forms.
- **Local-First Architecture** — Nothing leaves your device unless you configure a remote server. All processing can happen entirely offline.
- **Zero-Knowledge Ready** — Server never sees your raw identity data. Only encrypted blobs are transmitted when cloud features are used.


## Project Structure

```
IdentityCopilot/
  scripts/
    processor.py              Python document processor CLI
    requirements.txt          Python dependencies
  src/
    content/
      index.ts                Content script entry point
      formDetector.ts         DOM form field scanner
      ruleEngine.ts           Keyword-based field matcher
      semanticEngine.ts       Embedding-based field classifier
    popup/
      App.tsx                 Main popup UI (5 tabs)
      App.scss                Styles
      processor.worker.ts     Web Worker for OCR
    embeddings/
      adapter.ts              Embedding adapter (local + remote)
      persistence.ts          IndexedDB persistence
      vectorStore.ts          In-memory vector store
    utils/
      storage.ts              Identity vault with encryption
      crypto.ts               AES-256-GCM utilities
      importer.ts             Processor JSON import
      identityGraph.ts        Knowledge graph
      feedbackStore.ts        Learning system
  dist/                       Built extension output
```

## How It Works

```
User uploads documents (images, PDFs)
              |
              v
    OCR Engine extracts text
              |
              v
  Identity fields extracted via pattern matching
              |
              v
    Fields stored in encrypted vault
              |
              v
  Form field detected on web page
              |
              v
  Semantic engine classifies field intent
              |
              v
    Matching vault data auto-filled
              |
              v
    User corrections feed back into learning system
```

## Architecture

The system has two main components:

### Browser Extension (Chrome Manifest V3)

Built with React and TypeScript, the extension provides:

- A popup interface for managing your identity vault
- A content script injected into web pages that detects and classifies form fields
- A rules engine for fast keyword-based matching
- A semantic engine for embedding-based field classification
- An in-memory vector store for similarity search across intents and documents
- A Web Worker for client-side OCR processing of uploaded documents

### Python Document Processor

A standalone CLI tool that:

- Scans directories for images and PDFs
- Runs OCR to extract text from documents
- Identifies identity fields using regex patterns for Indian documents (PAN, Aadhaar, UAN, Passport, Driving License, Voter ID)
- Generates embedding vectors using Sentence Transformers (all-MiniLM-L6-v2)
- Outputs structured JSON for import into the browser extension
- Can run as a local HTTP server for live embedding queries

## Quick Start

### Prerequisites

- Google Chrome browser
- Python 3.9+ (for the document processor)

### Install the Extension

1. Run `npm install` then `npm run build` in the project directory
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable Developer mode
4. Click "Load unpacked" and select the `dist` folder

### Install the Python Processor

```bash
pip install -r scripts/requirements.txt
```

### Process Your Documents

```bash
python scripts/processor.py --dir /path/to/your/documents --output output.json --build-intents
```

### Import Into the Extension

1. Click the IdentityCopilot icon in Chrome
2. Go to the Import tab
3. Upload the `output.json` file
4. Your vault is now populated with extracted identity data

### Autofill Forms

Navigate to any form page and click "Autofill Form" in the extension popup. Matching fields will be filled automatically.