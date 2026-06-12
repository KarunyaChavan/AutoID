// Identity Graph — a simple knowledge graph mapping identity documents
// and their relationships, enabling semantic reasoning about what documents
// can satisfy various requirements.

export interface GraphNode {
  id: string;
  type: 'person' | 'document' | 'attribute' | 'requirement';
  label: string;
  properties: Record<string, string>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string;
  label: string;
}

export interface GraphQuery {
  nodeId: string;
  edgeTypes?: string[];
  maxDepth?: number;
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class IdentityGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getEdges(): GraphEdge[] {
    return this.edges;
  }

  getEdgesFrom(nodeId: string): GraphEdge[] {
    return this.edges.filter(e => e.from === nodeId);
  }

  getEdgesTo(nodeId: string): GraphEdge[] {
    return this.edges.filter(e => e.to === nodeId);
  }

  query(query: GraphQuery): GraphPath[] {
    const paths: GraphPath[] = [];
    const visited = new Set<string>();
    const maxDepth = query.maxDepth ?? 3;

    const dfs = (currentId: string, path: GraphPath, depth: number) => {
      if (depth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) return;

      const currentPath: GraphPath = {
        nodes: [...path.nodes, node],
        edges: [...path.edges],
      };

      if (depth > 0) {
        paths.push(currentPath);
      }

      for (const edge of this.edges) {
        if (edge.from === currentId) {
          const typeMatch = !query.edgeTypes || query.edgeTypes.length === 0 || query.edgeTypes.includes(edge.type);
          if (typeMatch) {
            currentPath.edges.push(edge);
            dfs(edge.to, currentPath, depth + 1);
            currentPath.edges.pop();
          }
        }
      }

      visited.delete(currentId);
    };

    dfs(query.nodeId, { nodes: [], edges: [] }, 0);
    return paths;
  }

  findDocumentsForRequirement(requirementLabel: string): GraphNode[] {
    // Find a requirement node matching the label, then find all documents
    // connected to it (directly or transitively)
    const reqNode = Array.from(this.nodes.values()).find(
      n => n.type === 'requirement' && n.label.toLowerCase().includes(requirementLabel.toLowerCase())
    );
    if (!reqNode) return [];

    const paths = this.query({ nodeId: reqNode.id, maxDepth: 3 });
    const docIds = new Set<string>();
    for (const path of paths) {
      for (const node of path.nodes) {
        if (node.type === 'document') docIds.add(node.id);
      }
    }
    return Array.from(docIds).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: this.getAllNodes(),
      edges: this.edges,
    };
  }

  static fromJSON(data: { nodes: GraphNode[]; edges: GraphEdge[] }): IdentityGraph {
    const g = new IdentityGraph();
    for (const n of data.nodes) g.addNode(n);
    for (const e of data.edges) g.addEdge(e);
    return g;
  }

  static async loadFromStorage(): Promise<IdentityGraph> {
    const ext = (globalThis as any).chrome;
    if (!ext?.storage?.local) return new IdentityGraph();
    return new Promise((resolve) => {
      ext.storage.local.get(['identityGraph'], (result: any) => {
        if (result.identityGraph) {
          resolve(IdentityGraph.fromJSON(result.identityGraph));
        } else {
          resolve(new IdentityGraph());
        }
      });
    });
  }

  async saveToStorage(): Promise<void> {
    const ext = (globalThis as any).chrome;
    if (!ext?.storage?.local) return;
    return new Promise((resolve) => {
      ext.storage.local.set({ identityGraph: this.toJSON() }, () => resolve());
    });
  }

  // Build graph from imported document data
  buildFromDocuments(
    mergedFields: Record<string, string | null>,
    documents: Array<{ fileName: string; extractedFields: Record<string, string | null> }>
  ): void {
    const personId = 'person:user';
    this.addNode({
      id: personId,
      type: 'person',
      label: 'User',
      properties: {},
    });

    for (const [key, value] of Object.entries(mergedFields)) {
      if (value) {
        this.addNode({
          id: `attr:${key}`,
          type: 'attribute',
          label: key.toUpperCase(),
          properties: { value },
        });
        this.addEdge({ from: personId, to: `attr:${key}`, type: 'has_attribute', label: `has ${key}` });
      }
    }

    for (const doc of documents) {
      const docId = `doc:${doc.fileName}`;
      this.addNode({
        id: docId,
        type: 'document',
        label: doc.fileName,
        properties: {},
      });
      this.addEdge({ from: personId, to: docId, type: 'owns', label: 'owns' });

      for (const [key, value] of Object.entries(doc.extractedFields)) {
        if (value && mergedFields[key] === value) {
          const attrId = `attr:${key}`;
          this.addEdge({ from: docId, to: attrId, type: 'proves', label: `proves ${key}` });
        }
      }
    }

    // Add common requirement nodes
    const requirements: Array<{ id: string; label: string; satisfiedBy: string[] }> = [
      { id: 'req:id-proof', label: 'ID Proof', satisfiedBy: ['pan', 'aadhaar', 'passport', 'dl'] },
      { id: 'req:address-proof', label: 'Address Proof', satisfiedBy: ['aadhaar', 'passport', 'dl'] },
      { id: 'req:age-proof', label: 'Age Proof', satisfiedBy: ['dob', 'aadhaar', 'passport', 'dl', 'pan'] },
    ];

    for (const req of requirements) {
      this.addNode({
        id: req.id,
        type: 'requirement',
        label: req.label,
        properties: {},
      });
      for (const attr of req.satisfiedBy) {
        if (mergedFields[attr]) {
          this.addEdge({
            from: `attr:${attr}`,
            to: req.id,
            type: 'satisfies',
            label: `satisfies ${req.label}`,
          });
        }
      }
    }
  }
}
