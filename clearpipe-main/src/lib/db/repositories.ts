import { readDatabase, writeDatabase } from './index';
import type { SecretRow, ConnectionRow, PipelineRow, TeamMemberRow } from './index';

// Re-export types
export type { SecretRow, ConnectionRow, PipelineRow, TeamMemberRow };

// Generate unique ID
const generateId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// ============================================================================
// Secrets Repository
// ============================================================================
export const secretsRepository = {
  async getAll(): Promise<SecretRow[]> {
    const db = readDatabase();
    return [...db.secrets].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async getById(id: string): Promise<SecretRow | undefined> {
    const db = readDatabase();
    return db.secrets.find(s => s.id === id);
  },

  async getByProvider(provider: string): Promise<SecretRow[]> {
    const db = readDatabase();
    return db.secrets
      .filter(s => s.provider === provider)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async create(data: { name: string; provider: string; value: string }): Promise<SecretRow> {
    const db = readDatabase();
    const now = new Date().toISOString();
    
    const secret: SecretRow = {
      id: generateId(),
      name: data.name,
      provider: data.provider,
      value: data.value,
      created_at: now,
      updated_at: now,
    };
    
    db.secrets.push(secret);
    writeDatabase(db);
    
    return secret;
  },

  async update(id: string, data: Partial<{ name: string; provider: string; value: string }>): Promise<SecretRow | undefined> {
    const db = readDatabase();
    const index = db.secrets.findIndex(s => s.id === id);
    
    if (index === -1) return undefined;
    
    const now = new Date().toISOString();
    const secret = db.secrets[index];
    
    if (data.name !== undefined) secret.name = data.name;
    if (data.provider !== undefined) secret.provider = data.provider;
    if (data.value !== undefined) secret.value = data.value;
    secret.updated_at = now;
    
    writeDatabase(db);
    
    return secret;
  },

  async delete(id: string): Promise<boolean> {
    const db = readDatabase();
    const index = db.secrets.findIndex(s => s.id === id);
    
    if (index === -1) return false;
    
    db.secrets.splice(index, 1);
    writeDatabase(db);
    
    return true;
  },
};

// ============================================================================
// Connections Repository
// ============================================================================
export const connectionsRepository = {
  async getAll(): Promise<ConnectionRow[]> {
    const db = readDatabase();
    return [...db.connections].sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  async getById(id: string): Promise<ConnectionRow | undefined> {
    const db = readDatabase();
    return db.connections.find(c => c.id === id);
  },

  async getByProvider(provider: string): Promise<ConnectionRow[]> {
    const db = readDatabase();
    return db.connections
      .filter(c => c.provider === provider)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  async create(data: { name: string; provider: string; config: Record<string, unknown>; isConfigured: boolean }): Promise<ConnectionRow> {
    const db = readDatabase();
    const now = new Date().toISOString();
    
    const connection: ConnectionRow = {
      id: generateId(),
      name: data.name,
      provider: data.provider,
      config: JSON.stringify(data.config),
      is_configured: data.isConfigured ? 1 : 0,
      created_at: now,
      updated_at: now,
    };
    
    db.connections.push(connection);
    writeDatabase(db);
    
    return connection;
  },

  async update(id: string, data: Partial<{ name: string; provider: string; config: Record<string, unknown>; isConfigured: boolean }>): Promise<ConnectionRow | undefined> {
    const db = readDatabase();
    const index = db.connections.findIndex(c => c.id === id);
    
    if (index === -1) return undefined;
    
    const now = new Date().toISOString();
    const connection = db.connections[index];
    
    if (data.name !== undefined) connection.name = data.name;
    if (data.provider !== undefined) connection.provider = data.provider;
    if (data.config !== undefined) connection.config = JSON.stringify(data.config);
    if (data.isConfigured !== undefined) connection.is_configured = data.isConfigured ? 1 : 0;
    connection.updated_at = now;
    
    writeDatabase(db);
    
    return connection;
  },

  async delete(id: string): Promise<boolean> {
    const db = readDatabase();
    const index = db.connections.findIndex(c => c.id === id);
    
    if (index === -1) return false;
    
    db.connections.splice(index, 1);
    writeDatabase(db);
    
    return true;
  },
};

// ============================================================================
// Pipelines Repository
// ============================================================================

// Generate a secure share token (URL-safe, random string)
const generateShareToken = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
};

export const pipelinesRepository = {
  async getAll(): Promise<PipelineRow[]> {
    const db = readDatabase();
    return [...db.pipelines].sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  },

  async getById(id: string): Promise<PipelineRow | undefined> {
    const db = readDatabase();
    return db.pipelines.find(p => p.id === id);
  },

  async getByShareToken(shareToken: string): Promise<PipelineRow | undefined> {
    const db = readDatabase();
    return db.pipelines.find(p => p.shareToken === shareToken && p.isPublic);
  },

  async create(data: { 
    name: string; 
    description?: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version?: string;
    ownerId?: string;
  }): Promise<PipelineRow> {
    const db = readDatabase();
    const now = new Date().toISOString();
    
    const pipeline: PipelineRow = {
      id: generateId(),
      name: data.name,
      description: data.description || null,
      nodes: JSON.stringify(data.nodes),
      edges: JSON.stringify(data.edges),
      version: data.version || '1.0.0',
      shareToken: generateShareToken(),
      ownerId: data.ownerId,
      sharedWith: [],
      isPublic: false,
      created_at: now,
      updated_at: now,
    };
    
    db.pipelines.push(pipeline);
    writeDatabase(db);
    
    return pipeline;
  },

  async update(id: string, data: Partial<{ 
    name: string; 
    description: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version: string;
    isPublic: boolean;
    sharedWith: string[];
  }>): Promise<PipelineRow | undefined> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return undefined;
    
    const now = new Date().toISOString();
    const pipeline = db.pipelines[index];
    
    if (data.name !== undefined) pipeline.name = data.name;
    if (data.description !== undefined) pipeline.description = data.description;
    if (data.nodes !== undefined) pipeline.nodes = JSON.stringify(data.nodes);
    if (data.edges !== undefined) pipeline.edges = JSON.stringify(data.edges);
    if (data.version !== undefined) pipeline.version = data.version;
    if (data.isPublic !== undefined) pipeline.isPublic = data.isPublic;
    if (data.sharedWith !== undefined) pipeline.sharedWith = data.sharedWith;
    pipeline.updated_at = now;
    
    writeDatabase(db);
    
    return pipeline;
  },

  async regenerateShareToken(id: string): Promise<string | undefined> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return undefined;
    
    const newToken = generateShareToken();
    db.pipelines[index].shareToken = newToken;
    db.pipelines[index].updated_at = new Date().toISOString();
    
    writeDatabase(db);
    
    return newToken;
  },

  async setPublicAccess(id: string, isPublic: boolean): Promise<PipelineRow | undefined> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return undefined;
    
    db.pipelines[index].isPublic = isPublic;
    db.pipelines[index].updated_at = new Date().toISOString();
    
    // Generate share token if not exists
    if (isPublic && !db.pipelines[index].shareToken) {
      db.pipelines[index].shareToken = generateShareToken();
    }
    
    writeDatabase(db);
    
    return db.pipelines[index];
  },

  async addSharedUser(id: string, userId: string): Promise<boolean> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return false;
    
    if (!db.pipelines[index].sharedWith) {
      db.pipelines[index].sharedWith = [];
    }
    
    if (!db.pipelines[index].sharedWith!.includes(userId)) {
      db.pipelines[index].sharedWith!.push(userId);
      db.pipelines[index].updated_at = new Date().toISOString();
      writeDatabase(db);
    }
    
    return true;
  },

  async removeSharedUser(id: string, userId: string): Promise<boolean> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return false;
    
    if (db.pipelines[index].sharedWith) {
      db.pipelines[index].sharedWith = db.pipelines[index].sharedWith!.filter(id => id !== userId);
      db.pipelines[index].updated_at = new Date().toISOString();
      writeDatabase(db);
    }
    
    return true;
  },

  async hasAccess(pipelineId: string, userId?: string, shareToken?: string): Promise<boolean> {
    const db = readDatabase();
    const pipeline = db.pipelines.find(p => p.id === pipelineId);
    
    if (!pipeline) return false;
    
    // Check if pipeline is public and token matches
    if (pipeline.isPublic && shareToken && pipeline.shareToken === shareToken) {
      return true;
    }
    
    // Check if user is owner
    if (userId && pipeline.ownerId === userId) {
      return true;
    }
    
    // Check if user is in sharedWith list
    if (userId && pipeline.sharedWith?.includes(userId)) {
      return true;
    }
    
    // If no owner is set (legacy pipelines), allow access to authenticated users
    if (!pipeline.ownerId && userId) {
      return true;
    }
    
    return false;
  },

  async upsert(data: { 
    id?: string;
    name: string; 
    description?: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version?: string;
    ownerId?: string;
  }): Promise<PipelineRow> {
    if (data.id) {
      const existing = await this.getById(data.id);
      if (existing) {
        return (await this.update(data.id, data)) as PipelineRow;
      }
    }
    return this.create(data);
  },

  async delete(id: string): Promise<boolean> {
    const db = readDatabase();
    const index = db.pipelines.findIndex(p => p.id === id);
    
    if (index === -1) return false;
    
    db.pipelines.splice(index, 1);
    writeDatabase(db);
    
    return true;
  },
};

// ============================================================================
// Team Members Repository
// ============================================================================
export const teamMembersRepository = {
  async getAll(): Promise<TeamMemberRow[]> {
    const db = readDatabase();
    // Handle case where teamMembers doesn't exist yet
    if (!db.teamMembers) {
      db.teamMembers = [];
      writeDatabase(db);
    }
    return [...db.teamMembers].sort((a, b) => 
      new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime()
    );
  },

  async getById(id: string): Promise<TeamMemberRow | undefined> {
    const db = readDatabase();
    if (!db.teamMembers) return undefined;
    return db.teamMembers.find(m => m.id === id);
  },

  async getByEmail(email: string): Promise<TeamMemberRow | undefined> {
    const db = readDatabase();
    if (!db.teamMembers) return undefined;
    return db.teamMembers.find(m => m.email.toLowerCase() === email.toLowerCase());
  },

  async create(data: { name: string; email: string; avatarUrl?: string }): Promise<TeamMemberRow> {
    const db = readDatabase();
    
    // Ensure teamMembers array exists
    if (!db.teamMembers) {
      db.teamMembers = [];
    }
    
    const member: TeamMemberRow = {
      id: generateId(),
      name: data.name,
      email: data.email,
      avatarUrl: data.avatarUrl,
      invitedAt: new Date().toISOString(),
    };
    
    db.teamMembers.push(member);
    writeDatabase(db);
    
    return member;
  },

  async update(id: string, data: Partial<{ name: string; email: string; avatarUrl: string }>): Promise<TeamMemberRow | undefined> {
    const db = readDatabase();
    if (!db.teamMembers) return undefined;
    
    const index = db.teamMembers.findIndex(m => m.id === id);
    if (index === -1) return undefined;
    
    const member = db.teamMembers[index];
    
    if (data.name !== undefined) member.name = data.name;
    if (data.email !== undefined) member.email = data.email;
    if (data.avatarUrl !== undefined) member.avatarUrl = data.avatarUrl;
    
    writeDatabase(db);
    
    return member;
  },

  async delete(id: string): Promise<boolean> {
    const db = readDatabase();
    if (!db.teamMembers) return false;
    
    const index = db.teamMembers.findIndex(m => m.id === id);
    if (index === -1) return false;
    
    db.teamMembers.splice(index, 1);
    writeDatabase(db);
    
    return true;
  },
};
