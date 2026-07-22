'use client';

import { createClient } from './client';
import type { RealtimeChannel, RealtimePresenceState } from '@supabase/supabase-js';

// Types for presence and broadcast payloads
export interface UserPresence {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  cursor?: {
    x: number;
    y: number;
  };
  lastSeen: string;
}

export interface CursorBroadcast {
  userId: string;
  x: number;
  y: number;
}

// Payload types for different pipeline change broadcasts
export interface NodeChangePayload {
  type: 'position' | 'dimensions' | 'select';
  item: { id: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface EdgeChangePayload {
  type: 'add' | 'remove' | 'select';
  item?: { source: string; target: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface NodeDataPayload {
  nodeId: string;
  data: Record<string, unknown>;
}

export interface NodeAddPayload {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NodeDeletePayload {
  nodeId: string;
}

export interface FullSyncPayload {
  nodes: Array<{ id: string; [key: string]: unknown }>;
  edges: Array<{ source: string; target: string; [key: string]: unknown }>;
}

// Array types for batch changes (from React Flow)
export type NodeChangesPayload = Array<{ type: string; id?: string; [key: string]: unknown }>;
export type EdgeChangesPayload = Array<{ type: string; id?: string; [key: string]: unknown }>;

// Union type for all possible payloads
export type PipelineChangePayload =
  | NodeChangePayload
  | EdgeChangePayload
  | NodeDataPayload
  | NodeAddPayload
  | NodeDeletePayload
  | FullSyncPayload
  | NodeChangesPayload
  | EdgeChangesPayload;

export interface PipelineChangeBroadcast {
  type: 'nodes' | 'edges' | 'node_data' | 'node_delete' | 'node_add' | 'full_sync';
  userId: string;
  timestamp: string;
  payload: PipelineChangePayload;
}

// Collaborator colors for visual distinction
const COLLABORATOR_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

// Get consistent color for a user based on their ID
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length];
}

// Class to manage realtime collaboration for a pipeline
export class PipelineRealtimeManager {
  private channel: RealtimeChannel | null = null;
  private pipelineId: string;
  private userId: string;
  private userName: string;
  private userEmail: string;
  private userAvatar?: string;
  private supabase = createClient();

  // Event handlers
  private onPresenceSync?: (users: UserPresence[]) => void;
  private onCursorMove?: (userId: string, x: number, y: number) => void;
  private onPipelineChange?: (change: PipelineChangeBroadcast) => void;
  private onUserJoin?: (user: UserPresence) => void;
  private onUserLeave?: (userId: string) => void;

  constructor(config: {
    pipelineId: string;
    userId: string;
    userName: string;
    userEmail: string;
    userAvatar?: string;
  }) {
    this.pipelineId = config.pipelineId;
    this.userId = config.userId;
    this.userName = config.userName;
    this.userEmail = config.userEmail;
    this.userAvatar = config.userAvatar;
  }

  // Set event handlers
  setHandlers(handlers: {
    onPresenceSync?: (users: UserPresence[]) => void;
    onCursorMove?: (userId: string, x: number, y: number) => void;
    onPipelineChange?: (change: PipelineChangeBroadcast) => void;
    onUserJoin?: (user: UserPresence) => void;
    onUserLeave?: (userId: string) => void;
  }) {
    this.onPresenceSync = handlers.onPresenceSync;
    this.onCursorMove = handlers.onCursorMove;
    this.onPipelineChange = handlers.onPipelineChange;
    this.onUserJoin = handlers.onUserJoin;
    this.onUserLeave = handlers.onUserLeave;
  }

  // Connect to the realtime channel
  async connect(): Promise<boolean> {
    if (this.channel) {
      await this.disconnect();
    }

    const channelName = `pipeline:${this.pipelineId}`;
    console.log('[Realtime] Creating channel:', channelName);
    
    this.channel = this.supabase.channel(channelName, {
      config: {
        presence: {
          key: this.userId,
        },
      },
    });

    // Handle presence sync (when we get the full state)
    this.channel.on('presence', { event: 'sync' }, () => {
      if (!this.channel) return;
      
      const state = this.channel.presenceState<UserPresence>();
      const users = this.parsePresenceState(state);
      console.log('[Realtime] Presence sync, users:', users.length, users.map(u => u.name));
      this.onPresenceSync?.(users);
    });

    // Handle user join
    this.channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      console.log('[Realtime] User join event:', key);
      const presence = newPresences[0] as unknown as UserPresence | undefined;
      if (presence && key !== this.userId) {
        this.onUserJoin?.(presence);
      }
    });

    // Handle user leave
    this.channel.on('presence', { event: 'leave' }, ({ key }) => {
      console.log('[Realtime] User leave event:', key);
      if (key !== this.userId) {
        this.onUserLeave?.(key);
      }
    });

    // Handle cursor broadcasts
    this.channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const cursor = payload as CursorBroadcast;
      if (cursor.userId !== this.userId) {
        this.onCursorMove?.(cursor.userId, cursor.x, cursor.y);
      }
    });

    // Handle pipeline changes
    this.channel.on('broadcast', { event: 'pipeline_change' }, ({ payload }) => {
      const change = payload as PipelineChangeBroadcast;
      console.log('[Realtime] Pipeline change received:', change.type, 'from:', change.userId);
      if (change.userId !== this.userId) {
        this.onPipelineChange?.(change);
      }
    });

    // Subscribe and track presence
    return new Promise((resolve) => {
      this.channel!.subscribe(async (status) => {
        console.log('[Realtime] Channel status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Channel subscribed, tracking presence...');
          // Track our presence
          try {
            await this.channel!.track({
              id: this.userId,
              name: this.userName,
              email: this.userEmail,
              avatarUrl: this.userAvatar,
              color: getUserColor(this.userId),
              lastSeen: new Date().toISOString(),
            } as UserPresence);
            console.log('[Realtime] Presence tracked successfully');
            resolve(true);
          } catch (err) {
            console.error('[Realtime] Failed to track presence:', err);
            resolve(false);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[Realtime] Channel error or timeout:', status);
          resolve(false);
        } else if (status === 'CLOSED') {
          console.log('[Realtime] Channel closed');
        }
      });
    });
  }

  // Disconnect from the channel
  async disconnect() {
    if (this.channel) {
      try {
        await this.channel.untrack();
        if (this.supabase) {
          await this.supabase.removeChannel(this.channel);
        }
      } catch (err) {
        console.warn('[Realtime] Error during disconnect:', err);
      }
      this.channel = null;
    }
  }

  // Broadcast cursor position (throttled on caller side)
  broadcastCursor(x: number, y: number) {
    if (!this.channel) return;

    this.channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: {
        userId: this.userId,
        x,
        y,
      } as CursorBroadcast,
    });
  }

  // Broadcast pipeline changes
  broadcastPipelineChange(
    type: PipelineChangeBroadcast['type'],
    payload: PipelineChangePayload
  ) {
    if (!this.channel) return;

    this.channel.send({
      type: 'broadcast',
      event: 'pipeline_change',
      payload: {
        type,
        userId: this.userId,
        timestamp: new Date().toISOString(),
        payload,
      } as PipelineChangeBroadcast,
    });
  }

  // Update presence (e.g., cursor in presence state for smoother updates)
  async updatePresence(cursor?: { x: number; y: number }) {
    if (!this.channel) return;

    await this.channel.track({
      id: this.userId,
      name: this.userName,
      email: this.userEmail,
      avatarUrl: this.userAvatar,
      color: getUserColor(this.userId),
      cursor,
      lastSeen: new Date().toISOString(),
    } as UserPresence);
  }

  // Parse presence state into array of users
  private parsePresenceState(state: RealtimePresenceState<UserPresence>): UserPresence[] {
    const users: UserPresence[] = [];
    
    for (const [, presences] of Object.entries(state)) {
      if (presences && presences.length > 0) {
        // Take the most recent presence for each user
        users.push(presences[0] as UserPresence);
      }
    }
    
    return users;
  }

  // Check if connected
  isConnected(): boolean {
    return this.channel !== null;
  }

  // Get current user ID
  getCurrentUserId(): string {
    return this.userId;
  }
}

// Singleton pattern for managing multiple pipeline connections
class RealtimeService {
  private managers: Map<string, PipelineRealtimeManager> = new Map();

  getManager(pipelineId: string): PipelineRealtimeManager | undefined {
    return this.managers.get(pipelineId);
  }

  createManager(config: {
    pipelineId: string;
    userId: string;
    userName: string;
    userEmail: string;
    userAvatar?: string;
  }): PipelineRealtimeManager {
    // Clean up existing manager for this pipeline
    const existing = this.managers.get(config.pipelineId);
    if (existing) {
      existing.disconnect();
    }

    const manager = new PipelineRealtimeManager(config);
    this.managers.set(config.pipelineId, manager);
    return manager;
  }

  async disconnectAll() {
    for (const manager of this.managers.values()) {
      await manager.disconnect();
    }
    this.managers.clear();
  }

  async disconnectPipeline(pipelineId: string) {
    const manager = this.managers.get(pipelineId);
    if (manager) {
      await manager.disconnect();
      this.managers.delete(pipelineId);
    }
  }
}

export const realtimeService = new RealtimeService();
