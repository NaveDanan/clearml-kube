'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { usePipelineStore } from '@/stores/pipeline-store';
import { 
  PipelineRealtimeManager, 
  realtimeService, 
  getUserColor,
  type UserPresence,
  type PipelineChangeBroadcast,
  type PipelineChangePayload,
} from '@/lib/supabase/realtime';
import { 
  PipelineMemberRole, 
  PipelineMember, 
  RolePermissions, 
  getRolePermissions 
} from '@/types/pipeline';

interface CollaboratorCursor {
  x: number;
  y: number;
  lastUpdate: number;
}

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  color: string;
  cursor?: CollaboratorCursor;
  isOnline: boolean;
  joinedAt: string;
  role?: PipelineMemberRole;
}

interface CollaborationContextType {
  collaborators: Collaborator[];
  currentUserId: string | null;
  currentUserRole: PipelineMemberRole | null;
  permissions: RolePermissions;
  isOwner: boolean;
  isConnected: boolean;
  isShareCanvasEnabled: boolean;
  pipelineMembers: PipelineMember[];
  updateCursorPosition: (x: number, y: number) => void;
  broadcastPipelineChange: (type: PipelineChangeBroadcast['type'], payload: PipelineChangePayload) => void;
  setShareCanvasEnabled: (enabled: boolean) => void;
  refreshMembers: () => Promise<void>;
  updateMemberRole: (memberId: string, role: PipelineMemberRole) => Promise<boolean>;
  removeMember: (memberId: string) => Promise<boolean>;
}

const CollaborationContext = createContext<CollaborationContextType | null>(null);

export function useCollaboration() {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error('useCollaboration must be used within a CollaborationProvider');
  }
  return context;
}

interface CollaborationProviderProps {
  children: React.ReactNode;
  pipelineId?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userAvatar?: string;
  isShareCanvasEnabled?: boolean;
  onShareCanvasEnabledChange?: (enabled: boolean) => void;
}

// Default permissions for non-authenticated users
const defaultPermissions: RolePermissions = {
  canEdit: false,
  canInviteMembers: false,
  canRemoveMembers: false,
  canChangeSettings: false,
  canAssignSupervisor: false,
  canDeletePipeline: false,
};

export function CollaborationProvider({
  children,
  pipelineId,
  userId,
  userName,
  userEmail,
  userAvatar,
  isShareCanvasEnabled = false,
  onShareCanvasEnabledChange,
}: CollaborationProviderProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [shareCanvasEnabled, setShareCanvasEnabledState] = useState(isShareCanvasEnabled);
  const [pipelineMembers, setPipelineMembers] = useState<PipelineMember[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<PipelineMemberRole | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [permissions, setPermissions] = useState<RolePermissions>(defaultPermissions);
  const managerRef = useRef<PipelineRealtimeManager | null>(null);
  const lastCursorBroadcastRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pipelineMembersRef = useRef<PipelineMember[]>([]);
  const hasFetchedMembersRef = useRef(false);

  // Handle Share Canvas enabled changes
  const setShareCanvasEnabled = useCallback((enabled: boolean) => {
    setShareCanvasEnabledState(enabled);
    onShareCanvasEnabledChange?.(enabled);
  }, [onShareCanvasEnabledChange]);

  // Fetch pipeline members and determine user role
  const fetchPipelineMembers = useCallback(async () => {
    if (!pipelineId) return;
    
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/members`);
      if (res.ok) {
        const data = await res.json();
        pipelineMembersRef.current = data.members || [];
        setPipelineMembers(data.members || []);
        setIsOwner(data.isOwner || false);
        setCurrentUserRole(data.currentUserRole || null);
        
        // Calculate permissions based on role
        const role = data.currentUserRole || 'member';
        setPermissions(getRolePermissions(role, data.isOwner));
      }
    } catch (err) {
      console.error('Failed to fetch pipeline members:', err);
    }
  }, [pipelineId]);

  // Refresh members (exposed to context)
  const refreshMembers = useCallback(async () => {
    await fetchPipelineMembers();
  }, [fetchPipelineMembers]);

  // Update member role
  const updateMemberRole = useCallback(async (memberId: string, role: PipelineMemberRole): Promise<boolean> => {
    if (!pipelineId) return false;
    
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      
      if (res.ok) {
        await refreshMembers();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update member role:', err);
      return false;
    }
  }, [pipelineId, refreshMembers]);

  // Remove member
  const removeMember = useCallback(async (memberId: string): Promise<boolean> => {
    if (!pipelineId) return false;
    
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/members/${memberId}`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        await refreshMembers();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to remove member:', err);
      return false;
    }
  }, [pipelineId, refreshMembers]);

  // Send heartbeat for presence tracking
  const sendHeartbeat = useCallback(async () => {
    if (!pipelineId || !userId) return;
    
    try {
      await fetch(`/api/pipelines/${pipelineId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat' }),
      });
    } catch (err) {
      // Silently fail heartbeats
    }
  }, [pipelineId, userId]);

  // Get pipeline store functions for syncing changes
  const { 
    nodes, 
    edges, 
    onNodesChange, 
    onEdgesChange 
  } = usePipelineStore();
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  // Keep refs updated
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // Convert UserPresence to Collaborator - use ref to avoid dependency issues
  const userPresenceToCollaborator = useCallback((presence: UserPresence): Collaborator => {
    // Find member info if available - use ref to avoid triggering re-renders
    const member = pipelineMembersRef.current.find(m => m.userId === presence.id || m.email === presence.email);
    
    return {
      id: presence.id,
      name: presence.name,
      email: presence.email,
      avatarUrl: presence.avatarUrl,
      color: presence.color,
      cursor: presence.cursor ? {
        x: presence.cursor.x,
        y: presence.cursor.y,
        lastUpdate: Date.now(),
      } : undefined,
      isOnline: true,
      joinedAt: presence.lastSeen,
      role: member?.role,
    };
  }, []); // No dependencies - uses ref

  // Handle incoming pipeline changes from other users
  const handlePipelineChange = useCallback((change: PipelineChangeBroadcast) => {
    const { type, payload } = change;

    switch (type) {
      case 'nodes':
        // Apply node position/dimension changes
        if (Array.isArray(payload)) {
          onNodesChange(payload as Parameters<typeof onNodesChange>[0]);
        }
        break;

      case 'edges':
        // Apply edge changes
        if (Array.isArray(payload)) {
          onEdgesChange(payload as Parameters<typeof onEdgesChange>[0]);
        }
        break;

      case 'node_data': {
        // Update specific node data
        const nodeDataPayload = payload as any;
        if (nodeDataPayload.nodeId && nodeDataPayload.data) {
          usePipelineStore.getState().updateNodeData(nodeDataPayload.nodeId, nodeDataPayload.data);
        }
        break;
      }

      case 'node_add': {
        // Add a new node
        const nodeAddPayload = payload as any;
        if (nodeAddPayload.type && nodeAddPayload.position) {
          // Use store directly to avoid triggering broadcasts
          const { nodes: currentNodes } = usePipelineStore.getState();
          if (!currentNodes.find(n => n.id === nodeAddPayload.id)) {
            usePipelineStore.setState({
              nodes: [...currentNodes, nodeAddPayload],
              isDirty: true,
            });
          }
        }
        break;
      }

      case 'node_delete': {
        // Delete a node
        const nodeDeletePayload = payload as any;
        if (nodeDeletePayload.nodeId) {
          const { nodes: currentNodes, edges: currentEdges } = usePipelineStore.getState();
          usePipelineStore.setState({
            nodes: currentNodes.filter(n => n.id !== nodeDeletePayload.nodeId),
            edges: currentEdges.filter(e => e.source !== nodeDeletePayload.nodeId && e.target !== nodeDeletePayload.nodeId),
            isDirty: true,
          });
        }
        break;
      }

      case 'full_sync': {
        // Full state sync (used for initial sync or recovery)
        const fullSyncPayload = payload as any;
        if (fullSyncPayload.nodes && fullSyncPayload.edges) {
          usePipelineStore.setState({
            nodes: fullSyncPayload.nodes,
            edges: fullSyncPayload.edges,
            isDirty: true,
          });
        }
        break;
      }
    }
  }, [onNodesChange, onEdgesChange]);

  // Connect to realtime channel
  useEffect(() => {
    // Log connection attempt details
    console.log('[Collaboration] Connection check:', {
      pipelineId,
      userId,
      userName,
      hasManager: !!managerRef.current,
    });

    if (!pipelineId) {
      console.log('[Collaboration] No pipeline ID, skipping connection');
      setCollaborators([]);
      setIsConnected(false);
      return;
    }

    if (!userId) {
      console.log('[Collaboration] No user ID, skipping connection');
      setCollaborators([]);
      setIsConnected(false);
      return;
    }

    // Fetch pipeline members first (only once per pipeline)
    if (!hasFetchedMembersRef.current) {
      hasFetchedMembersRef.current = true;
      fetchPipelineMembers();
    }

    console.log('[Collaboration] Connecting to channel for pipeline:', pipelineId);

    // Create and configure the realtime manager
    const manager = realtimeService.createManager({
      pipelineId,
      userId,
      userName: userName || 'Anonymous',
      userEmail: userEmail || '',
      userAvatar,
    });

    manager.setHandlers({
      onPresenceSync: (users) => {
        console.log('[Collaboration] Presence sync, users:', users.length);
        setCollaborators(users.map(userPresenceToCollaborator));
      },

      onCursorMove: (cursorUserId, x, y) => {
        setCollaborators(prev => prev.map(c =>
          c.id === cursorUserId
            ? { ...c, cursor: { x, y, lastUpdate: Date.now() } }
            : c
        ));
      },

      onPipelineChange: handlePipelineChange,

      onUserJoin: (user) => {
        console.log('[Collaboration] User joined:', user.name);
        setCollaborators(prev => {
          // Check if user already exists
          if (prev.find(c => c.id === user.id)) {
            return prev.map(c => c.id === user.id ? userPresenceToCollaborator(user) : c);
          }
          return [...prev, userPresenceToCollaborator(user)];
        });
        // Note: Not refreshing members on every join to avoid excessive API calls
      },

      onUserLeave: (leftUserId) => {
        console.log('[Collaboration] User left:', leftUserId);
        setCollaborators(prev => prev.map(c =>
          c.id === leftUserId ? { ...c, isOnline: false } : c
        ).filter(c => c.isOnline)); // Remove offline users after a moment
      },
    });

    managerRef.current = manager;

    // Connect to the channel
    manager.connect().then((connected) => {
      console.log('[Collaboration] Connection result:', connected);
      setIsConnected(connected);
      if (!connected) {
        console.warn('[Collaboration] Failed to connect to collaboration channel');
      } else {
        console.log('[Collaboration] Successfully connected to channel');
        // Start heartbeat for presence tracking
        sendHeartbeat();
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, 30000); // Every 30 seconds
      }
    }).catch((err) => {
      console.error('[Collaboration] Connection error:', err);
      setIsConnected(false);
    });

    // Cleanup on unmount or when deps change
    return () => {
      console.log('[Collaboration] Disconnecting from pipeline:', pipelineId);
      realtimeService.disconnectPipeline(pipelineId);
      managerRef.current = null;
      setIsConnected(false);
      setCollaborators([]);
      
      // Clear heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      
      // Send disconnect presence update
      if (userId) {
        fetch(`/api/pipelines/${pipelineId}/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect' }),
        }).catch(() => {});
      }
      
      // Reset fetch flag for next connection
      hasFetchedMembersRef.current = false;
    };
  }, [pipelineId, userId, userName, userEmail, userAvatar]); // Minimal stable dependencies

  // Throttled cursor position update
  const updateCursorPosition = useCallback((x: number, y: number) => {
    const now = Date.now();
    
    // Throttle to max 20 updates per second (50ms)
    if (now - lastCursorBroadcastRef.current < 50) return;
    lastCursorBroadcastRef.current = now;

    // Broadcast cursor position via realtime
    managerRef.current?.broadcastCursor(x, y);

    // Update local collaborator state for current user
    if (userId) {
      setCollaborators(prev => prev.map(c =>
        c.id === userId
          ? { ...c, cursor: { x, y, lastUpdate: now } }
          : c
      ));
    }
  }, [userId]);

  // Broadcast pipeline changes
  const broadcastPipelineChange = useCallback((
    type: PipelineChangeBroadcast['type'],
    payload: PipelineChangePayload
  ) => {
    managerRef.current?.broadcastPipelineChange(type, payload);
  }, []);

  return (
    <CollaborationContext.Provider
      value={{
        collaborators,
        currentUserId: userId || null,
        currentUserRole,
        permissions,
        isOwner,
        isConnected,
        isShareCanvasEnabled: shareCanvasEnabled,
        pipelineMembers,
        updateCursorPosition,
        broadcastPipelineChange,
        setShareCanvasEnabled,
        refreshMembers,
        updateMemberRole,
        removeMember,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
}

// Hook to get only other collaborators (not current user)
export function useOtherCollaborators() {
  const { collaborators, currentUserId } = useCollaboration();
  return collaborators.filter(c => c.id !== currentUserId && c.isOnline);
}

// Hook to get all online collaborators including current user
export function useOnlineCollaborators() {
  const { collaborators } = useCollaboration();
  return collaborators.filter(c => c.isOnline);
}

// Hook to broadcast pipeline changes - use this when modifying the pipeline
export function useBroadcastChange() {
  const { broadcastPipelineChange } = useCollaboration();
  return broadcastPipelineChange;
}

// Safe version of useBroadcastChange that can be used outside CollaborationProvider
// Returns a no-op function if not in a collaboration context
export function useSafeBroadcastChange() {
  const context = useContext(CollaborationContext);
  if (!context) {
    // Return a no-op function when not in collaboration context
    return (() => {}) as (type: PipelineChangeBroadcast['type'], payload: PipelineChangePayload) => void;
  }
  return context.broadcastPipelineChange;
}

// Hook to get current user's permissions
export function usePermissions() {
  const { permissions, isOwner, currentUserRole } = useCollaboration();
  return { permissions, isOwner, currentUserRole };
}

// Hook to get pipeline members
export function usePipelineMembers() {
  const { pipelineMembers, refreshMembers, updateMemberRole, removeMember } = useCollaboration();
  return { pipelineMembers, refreshMembers, updateMemberRole, removeMember };
}

// Hook to check if current user can perform an action
export function useCanPerformAction(action: keyof RolePermissions) {
  const { permissions } = useCollaboration();
  return permissions[action];
}
