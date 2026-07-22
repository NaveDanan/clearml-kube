import { create } from 'zustand';

// Cloud provider types
export type CloudProviderType = 'aws' | 'gcp' | 'azure' | 'minio' | 'clearml';

// Secret types for different providers (value is never exposed to UI)
export interface Secret {
  id: string;
  name: string;
  provider: CloudProviderType;
  createdAt: string;
  hasValue: boolean; // Indicates if a value is stored
}

// Connection configurations for each provider
export interface AWSConnection {
  id: string;
  name: string;
  provider: 'aws';
  region: string;
  bucket?: string;
  accessKeySecretId?: string; // Reference to secret
  secretKeySecretId?: string; // Reference to secret
  isConfigured: boolean;
}

export interface GCPConnection {
  id: string;
  name: string;
  provider: 'gcp';
  projectId: string;
  bucket?: string;
  serviceAccountKeySecretId?: string; // Reference to secret
  isConfigured: boolean;
}

export interface AzureConnection {
  id: string;
  name: string;
  provider: 'azure';
  subscriptionId?: string;
  tenantId?: string;
  clientId?: string;
  container?: string;
  accountName?: string;
  // References to secrets
  clientSecretSecretId?: string;
  connectionStringSecretId?: string;
  accountKeySecretId?: string;
  sasTokenSecretId?: string;
  isConfigured: boolean;
}

export interface MinIOConnection {
  id: string;
  name: string;
  provider: 'minio';
  endpoint: string;
  bucket?: string;
  accessKeySecretId?: string; // Reference to secret
  secretKeySecretId?: string; // Reference to secret
  isConfigured: boolean;
}

export interface ClearMLConnection {
  id: string;
  name: string;
  provider: 'clearml';
  apiHost: string;
  webHost: string;
  filesHost: string;
  accessKeySecretId?: string; // Reference to secret
  secretKeySecretId?: string; // Reference to secret
  isConfigured: boolean;
}

export type CloudConnection = 
  | AWSConnection 
  | GCPConnection 
  | AzureConnection 
  | MinIOConnection 
  | ClearMLConnection;

interface SettingsState {
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Secrets management
  secrets: Secret[];
  fetchSecrets: () => Promise<void>;
  addSecret: (secret: { name: string; value: string; provider: CloudProviderType }) => Promise<string>;
  removeSecret: (id: string) => Promise<void>;
  getSecretsByProvider: (provider: CloudProviderType) => Secret[];
  
  // Connections management
  connections: CloudConnection[];
  fetchConnections: () => Promise<void>;
  addConnection: (connection: Omit<CloudConnection, 'id'>) => Promise<string>;
  updateConnection: (id: string, updates: Partial<CloudConnection>) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  getConnectionsByProvider: (provider: CloudProviderType) => CloudConnection[];
  getConnection: (id: string) => CloudConnection | undefined;
  
  // Get credentials for a connection (resolves secret references via API)
  getConnectionCredentials: (connectionId: string) => Promise<Record<string, string>>;
  
  // Initialize - fetch all data
  initialize: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  isLoading: false,
  error: null,
  secrets: [],
  connections: [],

  initialize: async () => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([
        get().fetchSecrets(),
        get().fetchConnections(),
      ]);
    } catch (error) {
      set({ error: (error as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  // ============================================================================
  // Secrets
  // ============================================================================
  fetchSecrets: async () => {
    try {
      const response = await fetch('/api/secrets');
      if (!response.ok) throw new Error('Failed to fetch secrets');
      const secrets = await response.json();
      set({ secrets });
    } catch (error) {
      console.error('Error fetching secrets:', error);
      throw error;
    }
  },

  addSecret: async (secret) => {
    try {
      const response = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secret),
      });
      
      if (!response.ok) throw new Error('Failed to create secret');
      
      const newSecret = await response.json();
      set({ secrets: [...get().secrets, newSecret] });
      return newSecret.id;
    } catch (error) {
      console.error('Error creating secret:', error);
      throw error;
    }
  },

  removeSecret: async (id) => {
    try {
      const response = await fetch(`/api/secrets/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete secret');
      
      set({ secrets: get().secrets.filter((s) => s.id !== id) });
    } catch (error) {
      console.error('Error deleting secret:', error);
      throw error;
    }
  },

  getSecretsByProvider: (provider) => {
    return get().secrets.filter((s) => s.provider === provider);
  },

  // ============================================================================
  // Connections
  // ============================================================================
  fetchConnections: async () => {
    try {
      const response = await fetch('/api/connections');
      if (!response.ok) throw new Error('Failed to fetch connections');
      const connections = await response.json();
      set({ connections });
    } catch (error) {
      console.error('Error fetching connections:', error);
      throw error;
    }
  },

  addConnection: async (connection) => {
    try {
      const response = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connection),
      });
      
      if (!response.ok) throw new Error('Failed to create connection');
      
      const newConnection = await response.json();
      set({ connections: [...get().connections, newConnection] });
      return newConnection.id;
    } catch (error) {
      console.error('Error creating connection:', error);
      throw error;
    }
  },

  updateConnection: async (id, updates) => {
    try {
      const response = await fetch(`/api/connections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      
      if (!response.ok) throw new Error('Failed to update connection');
      
      const updatedConnection = await response.json();
      set({
        connections: get().connections.map((c) =>
          c.id === id ? updatedConnection : c
        ),
      });
    } catch (error) {
      console.error('Error updating connection:', error);
      throw error;
    }
  },

  removeConnection: async (id) => {
    try {
      const response = await fetch(`/api/connections/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) throw new Error('Failed to delete connection');
      
      set({ connections: get().connections.filter((c) => c.id !== id) });
    } catch (error) {
      console.error('Error deleting connection:', error);
      throw error;
    }
  },

  getConnectionsByProvider: (provider) => {
    return get().connections.filter((c) => c.provider === provider);
  },

  getConnection: (id) => {
    return get().connections.find((c) => c.id === id);
  },

  getConnectionCredentials: async (connectionId) => {
    try {
      const response = await fetch(`/api/connections/${connectionId}/credentials`);
      if (!response.ok) throw new Error('Failed to fetch credentials');
      return await response.json();
    } catch (error) {
      console.error('Error fetching credentials:', error);
      return {};
    }
  },
}));
