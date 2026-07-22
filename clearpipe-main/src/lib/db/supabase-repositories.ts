import { createClient } from '@/lib/supabase/server';

// ============================================================================
// Types
// ============================================================================

export interface SecretRow {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  is_configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  nodes: unknown[];
  edges: unknown[];
  version: string;
  is_public?: boolean;
  share_token?: string;
  share_mode?: 'private' | 'public' | 'verified';
  shared_with?: string[];
  created_at: string;
  updated_at: string;
}

export interface TeamMemberRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  avatar_url?: string;
  invited_at: string;
}

// ============================================================================
// Secrets Repository
// ============================================================================
export const secretsRepository = {
  async getAll(): Promise<SecretRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('secrets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<SecretRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('secrets')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getByProvider(provider: string): Promise<SecretRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('secrets')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(data: { name: string; provider: string; value: string }): Promise<SecretRow> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: secret, error } = await supabase
      .from('secrets')
      .insert({
        user_id: user.id,
        name: data.name,
        provider: data.provider,
        value: data.value,
      })
      .select()
      .single();
    
    if (error) throw error;
    return secret;
  },

  async update(id: string, data: Partial<{ name: string; provider: string; value: string }>): Promise<SecretRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: secret, error } = await supabase
      .from('secrets')
      .update(data)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return secret;
  },

  async delete(id: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { error, count } = await supabase
      .from('secrets')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};

// ============================================================================
// Connections Repository
// ============================================================================
export const connectionsRepository = {
  async getAll(): Promise<ConnectionRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<ConnectionRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('connections')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getByProvider(provider: string): Promise<ConnectionRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', provider)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async create(data: { 
    name: string; 
    provider: string; 
    config: Record<string, unknown>; 
    isConfigured: boolean 
  }): Promise<ConnectionRow> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: connection, error } = await supabase
      .from('connections')
      .insert({
        user_id: user.id,
        name: data.name,
        provider: data.provider,
        config: data.config,
        is_configured: data.isConfigured,
      })
      .select()
      .single();
    
    if (error) throw error;
    return connection;
  },

  async update(id: string, data: Partial<{ 
    name: string; 
    provider: string; 
    config: Record<string, unknown>; 
    isConfigured: boolean 
  }>): Promise<ConnectionRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    // Map isConfigured to is_configured for DB
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.provider !== undefined) updateData.provider = data.provider;
    if (data.config !== undefined) updateData.config = data.config;
    if (data.isConfigured !== undefined) updateData.is_configured = data.isConfigured;
    
    const { data: connection, error } = await supabase
      .from('connections')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return connection;
  },

  async delete(id: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { error, count } = await supabase
      .from('connections')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
    return (count ?? 0) > 0;
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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getById(id: string): Promise<PipelineRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  // Get pipeline by ID without ownership check (for public access verification)
  async getByIdPublic(id: string): Promise<PipelineRow | null> {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getByShareToken(shareToken: string): Promise<PipelineRow | null> {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('share_token', shareToken)
      .eq('is_public', true)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async create(data: { 
    name: string; 
    description?: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version?: string;
  }): Promise<PipelineRow> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .insert({
        user_id: user.id,
        name: data.name,
        description: data.description || null,
        nodes: data.nodes,
        edges: data.edges,
        version: data.version || '1.0.0',
        share_token: generateShareToken(),
        is_public: false,
        shared_with: [],
      })
      .select()
      .single();
    
    if (error) throw error;
    return pipeline;
  },

  async update(id: string, data: Partial<{ 
    name: string; 
    description: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version: string;
    is_public: boolean;
    shared_with: string[];
  }>): Promise<PipelineRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .update(data)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return pipeline;
  },

  async setPublicAccess(id: string, isPublic: boolean): Promise<PipelineRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    // First check if we need to generate a share token
    const existing = await this.getById(id);
    const updateData: Record<string, unknown> = { is_public: isPublic };
    
    // Generate share token if not exists and making public
    if (isPublic && !existing?.share_token) {
      updateData.share_token = generateShareToken();
    }
    
    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return pipeline;
  },

  async updateShareMode(id: string, shareMode: 'private' | 'public' | 'verified'): Promise<PipelineRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .update({ share_mode: shareMode })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return pipeline;
  },

  async regenerateShareToken(id: string): Promise<string | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const newToken = generateShareToken();
    
    const { error } = await supabase
      .from('pipelines')
      .update({ share_token: newToken })
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
    return newToken;
  },

  async addSharedUser(id: string, userId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const existing = await this.getById(id);
    if (!existing) return false;
    
    const sharedWith = existing.shared_with || [];
    if (!sharedWith.includes(userId)) {
      sharedWith.push(userId);
      await this.update(id, { shared_with: sharedWith });
    }
    
    return true;
  },

  async removeSharedUser(id: string, userId: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const existing = await this.getById(id);
    if (!existing) return false;
    
    const sharedWith = (existing.shared_with || []).filter(id => id !== userId);
    await this.update(id, { shared_with: sharedWith });
    
    return true;
  },

  async hasAccess(pipelineId: string, userId?: string, shareToken?: string): Promise<boolean> {
    const supabase = await createClient();
    
    // First, try to get the pipeline - RLS will allow access if:
    // 1. User owns it (user_id matches)
    // 2. Pipeline is public (is_public = true)
    // 3. User is in shared_with array
    try {
      const { data, error } = await supabase
        .from('pipelines')
        .select('id, user_id, is_public, share_token, shared_with')
        .eq('id', pipelineId)
        .maybeSingle();
      
      if (error) {
        console.log('hasAccess: Query error:', error.message, error.code);
        return false;
      }
      
      if (!data) {
        console.log('hasAccess: Pipeline not found or not accessible');
        return false;
      }
      
      console.log('hasAccess: Pipeline found:', { 
        id: data.id, 
        is_public: data.is_public,
        hasShareToken: !!data.share_token,
        owner: data.user_id
      });
      
      // If checking with a share token, validate it matches for public pipelines
      if (shareToken) {
        if (data.is_public && data.share_token === shareToken) {
          console.log('hasAccess: Share token valid, granting access');
          return true;
        }
        // Share token provided but doesn't match - deny
        if (data.share_token !== shareToken) {
          console.log('hasAccess: Share token mismatch');
          return false;
        }
      }
      
      // Check if user is the owner
      if (userId && data.user_id === userId) {
        console.log('hasAccess: User is owner');
        return true;
      }
      
      // Check if user is in shared_with list
      if (userId && data.shared_with?.includes(userId)) {
        console.log('hasAccess: User is in shared_with list');
        return true;
      }
      
      // If pipeline is public and no share token was required, allow read access
      if (data.is_public) {
        console.log('hasAccess: Pipeline is public');
        return true;
      }
      
      console.log('hasAccess: No access granted');
      return false;
    } catch (err) {
      console.error('hasAccess: Unexpected error:', err);
      return false;
    }
  },

  async upsert(data: { 
    id?: string;
    name: string; 
    description?: string; 
    nodes: unknown[]; 
    edges: unknown[]; 
    version?: string;
  }): Promise<PipelineRow> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    // If id provided, try to update first
    if (data.id) {
      const existing = await this.getById(data.id);
      if (existing) {
        const updated = await this.update(data.id, {
          name: data.name,
          description: data.description,
          nodes: data.nodes,
          edges: data.edges,
          version: data.version,
        });
        if (updated) return updated;
      }
    }
    
    // Create new if no id or not found
    return this.create(data);
  },

  async delete(id: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { error, count } = await supabase
      .from('pipelines')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};

// ============================================================================
// Team Members Repository
// ============================================================================
export const teamMembersRepository = {
  async getAll(): Promise<TeamMemberRow[]> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('user_id', user.id)
      .order('invited_at', { ascending: false });
    
    if (error) {
      // If table doesn't exist, return empty array
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('team_members table does not exist yet');
        return [];
      }
      throw error;
    }
    return data || [];
  },

  async getById(id: string): Promise<TeamMemberRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
    return data;
  },

  async getByEmail(email: string): Promise<TeamMemberRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('user_id', user.id)
      .ilike('email', email)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
    return data;
  },

  async create(data: { name: string; email: string; avatarUrl?: string }): Promise<TeamMemberRow> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const { data: member, error } = await supabase
      .from('team_members')
      .insert({
        user_id: user.id,
        name: data.name,
        email: data.email,
        avatar_url: data.avatarUrl || null,
        invited_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) throw error;
    return member;
  },

  async update(id: string, data: Partial<{ name: string; email: string; avatarUrl: string }>): Promise<TeamMemberRow | null> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.avatarUrl !== undefined) updateData.avatar_url = data.avatarUrl;
    
    const { data: member, error } = await supabase
      .from('team_members')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return member;
  },

  async delete(id: string): Promise<boolean> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) throw new Error('Unauthorized');
    
    // First check if the member exists
    const existing = await this.getById(id);
    if (!existing) return false;
    
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    
    if (error) throw error;
    return true;
  },
};
