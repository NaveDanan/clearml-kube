import fs from 'fs';
import path from 'path';

// Database file path - stored in project root
const DB_DIR = process.cwd();
const DB_PATH = path.join(DB_DIR, 'clearpipe.db.json');

// Database structure
export interface DatabaseSchema {
  secrets: SecretRow[];
  connections: ConnectionRow[];
  pipelines: PipelineRow[];
  teamMembers: TeamMemberRow[];
}

export interface SecretRow {
  id: string;
  name: string;
  provider: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionRow {
  id: string;
  name: string;
  provider: string;
  config: string; // JSON string
  is_configured: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  nodes: string; // JSON string
  edges: string; // JSON string
  version: string;
  shareToken?: string; // Secure token for sharing
  ownerId?: string; // Owner's user ID
  sharedWith?: string[]; // Array of user IDs with access
  isPublic?: boolean; // Whether pipeline is publicly accessible via shareToken
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  invitedAt: string;
}

// Default empty database
const defaultDatabase: DatabaseSchema = {
  secrets: [],
  connections: [],
  pipelines: [],
  teamMembers: [],
};

// Read database from file
export function readDatabase(): DatabaseSchema {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data) as DatabaseSchema;
    }
  } catch (error) {
    console.error('Error reading database:', error);
  }
  return { ...defaultDatabase };
}

// Write database to file
export function writeDatabase(data: DatabaseSchema): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing database:', error);
    throw error;
  }
}

// Initialize database file if it doesn't exist
export function initializeDatabase(): void {
  if (!fs.existsSync(DB_PATH)) {
    writeDatabase(defaultDatabase);
  }
}

// Initialize on module load
initializeDatabase();

export { DB_PATH };
