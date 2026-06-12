#!/usr/bin/env python3
"""
IdentityCopilot Document Processor

Usage:
  python processor.py --dir ./docs --output ./output.json
  python processor.py --server --port 8765
  python processor.py --dir ./docs --output ./output.json --build-intents
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError:
    Image = None

# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------
_ocr_reader = None

def get_ocr_reader():
    global _ocr_reader
    if _ocr_reader is not None:
        return _ocr_reader
    try:
        import easyocr
        _ocr_reader = easyocr.Reader(["en"], gpu=False)
        return _ocr_reader
    except Exception as exc:
        print(f"[INFO] easyocr failed ({exc}), falling back to pytesseract")
        return None

def ocr_image(path: str) -> str:
    reader = get_ocr_reader()
    if reader:
        try:
            results = reader.readtext(path, detail=0, paragraph=True)
            return "\n".join(results)
        except Exception as exc:
            print(f"  [WARN] easyocr read failed ({exc}), trying pytesseract")
    try:
        import pytesseract
        img = Image.open(path)
        return pytesseract.image_to_string(img)
    except Exception as exc:
        return f"[OCR error: {exc}]"

def ocr_pdf(path: str) -> str:
    try:
        import fitz
        doc = fitz.open(path)
        texts = []
        for page in doc:
            t = page.get_text()
            if t and len(t.strip()) > 20:
                texts.append(t)
            else:
                pix = page.get_pixmap(dpi=200)
                img_path = f"/tmp/_ocr_page_{page.number}.png"
                pix.save(img_path)
                texts.append(ocr_image(img_path))
                os.remove(img_path)
        return "\n".join(texts)
    except ImportError:
        return f"[PDF parsing not available for {path}]"

# ---------------------------------------------------------------------------
# Field extraction — comprehensive patterns for Indian identity documents
# ---------------------------------------------------------------------------
PATTERNS: dict[str, list[str]] = {
    "pan": [
        r"\b[A-Z]{5}[0-9]{4}[A-Z]\b",
    ],
    "aadhaar": [
        r"\b\d{4}\s?\d{4}\s?\d{4}\b",
    ],
    "uan": [
        r"\b\d{12}\b",
    ],
    "passport": [
        r"\b[A-Z]\d{7}\b",
    ],
    "dl": [
        r"\b[A-Z]{2}-?\d{2}20\d{2}\d{7}\b",
    ],
    "voterid": [
        r"\b[A-Z]{3}\d{7}\b",
    ],
    "email": [
        r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
    ],
    "phone": [
        r"\+?\d[\d\s\-\(\)]{7,}\d",
    ],
    "dob": [
        r"\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b",
        r"\b(\d{4}[/\-]\d{2}[/\-]\d{2})\b",
    ],
    "name": [
        r"Name\s*[:\-]\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})",
        r"(?:Name|Full Name|Applicant Name|Employee Name)\s*[:\-]\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})",
    ],
}

# UAN pattern needs context — 12 digits near "UAN"/"EPFO"
_UAN_CONTEXT = re.compile(r'\b(UAN|Universal\s*Account\s*Number|EPFO)\b.*?(\d{12})', re.IGNORECASE | re.DOTALL)

def extract_fields(text: str) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for key, patterns in PATTERNS.items():
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                out[key] = m.group(0) if m.lastindex is None else m.group(1)
                break

    # Context-sensitive UAN extraction
    uan_m = _UAN_CONTEXT.search(text)
    if uan_m:
        out["uan"] = uan_m.group(2)

    return out

# ---------------------------------------------------------------------------
# Embedding generation
# ---------------------------------------------------------------------------
_model = None

def get_embedder():
    global _model
    if _model is not None:
        return _model
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        return _model
    except ImportError:
        return None

def embed_text(text: str) -> list[float]:
    model = get_embedder()
    if model:
        return model.encode(text, normalize_embeddings=True).tolist()
    return []

# ---------------------------------------------------------------------------
# Intent reference embeddings
# ---------------------------------------------------------------------------
INTENT_SAMPLES: dict[str, list[str]] = {
    "pan": [
        "PAN", "Permanent Account Number", "Income Tax Number", "Tax ID", "PAN No",
        "Income Tax ID", "IT Number", "Taxpayer ID", "PAN Card Number",
    ],
    "aadhaar": [
        "Aadhaar", "Aadhaar Number", "UIDAI", "Aadhar", "National ID",
        "Aadhaar Card", "Unique Identification Number", "12 Digit ID",
    ],
    "uan": [
        "UAN", "Universal Account Number", "EPFO Number", "EPFO", "PF Account",
        "Provident Fund Number", "UAN Number",
    ],
    "passport": [
        "Passport", "Passport Number", "Passport No", "Travel Document",
    ],
    "dl": [
        "Driving License", "Driving Licence", "DL Number", "Driver License",
        "Motor Vehicle License",
    ],
    "voterid": [
        "Voter ID", "Voter ID Card", "Voter Identity", "Elector ID", "Elector Photo ID",
        "EPIC Card", "EPIC Number",
    ],
    "name": [
        "Name", "Full Name", "First Name", "Last Name", "Applicant Name",
        "Employee Name", "Your Name", "Given Name", "Surname",
    ],
    "dob": [
        "Date of Birth", "DOB", "Birth Date", "Date Of Birth",
        "Birthday", "DD/MM/YYYY",
    ],
    "email": [
        "Email", "Email Address", "E-mail", "Email ID",
        "Electronic Mail", "Mail ID",
    ],
    "phone": [
        "Phone", "Mobile", "Phone Number", "Mobile Number", "Contact Number",
        "Telephone", "Cell Phone", "Phone No",
    ],
}

def build_intent_embeddings() -> dict[str, list[float]]:
    model = get_embedder()
    if not model:
        return {}
    result: dict[str, list[float]] = {}
    for intent, samples in INTENT_SAMPLES.items():
        if samples:
            emb = model.encode(samples, normalize_embeddings=True)
            avg = emb.mean(axis=0).tolist()
            result[intent] = avg
    return result

# ---------------------------------------------------------------------------
# Document scanning
# ---------------------------------------------------------------------------
SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".pdf"}

def scan_directory(dir_path: str) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    base = Path(dir_path)
    if not base.exists():
        print(f"[ERROR] Directory not found: {dir_path}")
        return docs

    files = sorted(base.rglob("*"))
    for fpath in files:
        if not fpath.is_file():
            continue
        ext = fpath.suffix.lower()
        if ext not in SUPPORTED_EXTS:
            continue
        print(f"  Processing: {fpath.relative_to(base)}")
        text = ""
        if ext == ".pdf":
            text = ocr_pdf(str(fpath))
        else:
            text = ocr_image(str(fpath))

        fields = extract_fields(text)
        emb = embed_text(text) if text.strip() else []

        docs.append({
            "file_name": str(fpath),
            "file_type": "pdf" if ext == ".pdf" else "image",
            "relative_path": str(fpath.relative_to(base)),
            "extracted_text": text[:2000],
            "extracted_fields": fields,
            "embedding": emb,
        })

    return docs

def merge_fields(docs: list[dict[str, Any]]) -> dict[str, str | None]:
    merged: dict[str, str | None] = {}
    for doc in docs:
        for key, val in doc.get("extracted_fields", {}).items():
            if val and key not in merged:
                merged[key] = val
    return merged

# ---------------------------------------------------------------------------
# Server mode (Flask)
# ---------------------------------------------------------------------------
def start_server(port: int):
    try:
        from flask import Flask, jsonify, request
        from flask_cors import CORS
    except ImportError:
        print("[ERROR] flask + flask-cors required for server mode")
        print("  pip install flask flask-cors")
        sys.exit(1)

    app = Flask(__name__)
    CORS(app)

    model = get_embedder()

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "model_loaded": model is not None})

    @app.route("/embed", methods=["POST"])
    def embed():
        data = request.get_json(force=True)
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "text required"}), 400
        if model is None:
            return jsonify({"embedding": [0.0] * 384})
        embedding = model.encode(text, normalize_embeddings=True).tolist()
        return jsonify({"embedding": embedding})

    @app.route("/scan", methods=["POST"])
    def scan():
        data = request.get_json(force=True)
        dir_path = data.get("dir") or "."
        docs = scan_directory(dir_path)
        merged = merge_fields(docs)
        return jsonify({"documents": docs, "merged_fields": merged})

    print(f"[server] Starting embedding server on http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="IdentityCopilot Document Processor")
    parser.add_argument("--dir", type=str, help="Directory with documents to process")
    parser.add_argument("--output", type=str, default="./identity-copilot-output.json", help="Output JSON path")
    parser.add_argument("--server", action="store_true", help="Start HTTP embedding server")
    parser.add_argument("--port", type=int, default=8765, help="Server port")
    parser.add_argument("--build-intents", action="store_true", help="Include intent reference embeddings")
    args = parser.parse_args()

    if args.server:
        start_server(args.port)
        return

    if not args.dir:
        print("[ERROR] Provide --dir for scan mode, or --server for server mode")
        sys.exit(1)

    print(f"[scan] Scanning directory: {args.dir}")
    docs = scan_directory(args.dir)
    merged = merge_fields(docs)

    output: dict[str, Any] = {
        "version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "source_dir": args.dir,
        "document_count": len(docs),
        "documents": docs,
        "merged_fields": merged,
    }

    if args.build_intents:
        print("[scan] Building intent reference embeddings...")
        intents = build_intent_embeddings()
        output["intent_embeddings"] = intents

    out_path = args.output
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"[scan] Done. {len(docs)} documents processed.")
    print(f"[scan] Output written to: {out_path}")
    print(f"[scan] Merged fields:")
    for k, v in merged.items():
        print(f"        {k}: {v or '(not found)'}")

if __name__ == "__main__":
    main()
