import { create } from 'zustand';
import {
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
} from '@xyflow/react';
import {
  Pipeline,
  PipelineNode,
  PipelineEdge,
  PipelineNodeData,
  NodeStatus,
  ExecutionLogs,
} from '@/types/pipeline';

// History entry for undo/redo
interface HistoryEntry {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

// Maximum history size
const MAX_HISTORY_SIZE = 50;

interface PipelineState {
  // Current pipeline data
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  
  // Selected node for configuration panel
  selectedNodeId: string | null;
  
  // Pipeline metadata
  currentPipeline: Pipeline | null;
  savedPipelines: Pipeline[];
  
  // UI State
  isConfigPanelOpen: boolean;
  isDirty: boolean;
  isLoading: boolean;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  
  // History for undo/redo
  history: HistoryEntry[];
  historyIndex: number;
  
  // Drag state (to avoid pushing history during drag)
  isDragging: boolean;
  
  // Clipboard for copy/paste
  clipboard: PipelineNode | null;
  
  // Node actions
  onNodesChange: OnNodesChange<PipelineNode>;
  onEdgesChange: OnEdgesChange<PipelineEdge>;
  onConnect: OnConnect;
  
  // CRUD operations
  addNode: (type: PipelineNodeData['type'], position: { x: number; y: number }) => string;
  updateNodeData: (nodeId: string, data: Partial<PipelineNodeData>) => void;
  updateNodeStatus: (nodeId: string, status: NodeStatus, message?: string) => void;
  updateNodeExecutionLogs: (nodeId: string, logs: ExecutionLogs) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  
  // Selection
  selectNode: (nodeId: string | null) => void;
  selectAllNodes: () => void;
  
  // Copy/Paste
  copyNode: (nodeId: string) => void;
  pasteNode: (position: { x: number; y: number }) => void;
  
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  pushHistory: () => void;
  
  // Drag state management
  setDragging: (isDragging: boolean) => void;
  
  // Node manipulation
  nudgeSelectedNodes: (dx: number, dy: number) => void;
  
  // Sidebar controls
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
  
  // Pipeline operations
  fetchPipelines: () => Promise<void>;
  savePipeline: (name: string, description?: string) => Promise<void>;
  saveAsNewPipeline: (name: string, description?: string) => Promise<void>;
  loadPipeline: (pipelineId: string, shareToken?: string) => Promise<void>;
  createNewPipeline: () => void;
  deletePipeline: (pipelineId: string) => Promise<void>;
  exportPipeline: () => string;
  importPipeline: (jsonString: string) => boolean;
  
  // UI actions
  setConfigPanelOpen: (open: boolean) => void;
  
  // Reset
  reset: () => void;
}

// Default node configurations
const getDefaultNodeData = (type: PipelineNodeData['type']): PipelineNodeData => {
  const baseData = {
    status: 'idle' as NodeStatus,
    lastUpdated: new Date().toISOString(),
  };

  switch (type) {
    case 'dataset':
      return {
        ...baseData,
        type: 'dataset',
        label: 'Dataset',
        description: 'Load and configure your data source',
        config: {
          source: 'local',
          path: '',
          format: 'csv',
        } as any,
      };
    case 'versioning':
      return {
        ...baseData,
        type: 'versioning',
        label: 'Data Versioning',
        description: 'Version your data and models',
        config: {
          tool: 'dvc',
          version: '1.0.0',
        } as any,
      };
    case 'execute':
      return {
        ...baseData,
        type: 'execute',
        label: 'Execute',
        description: 'Run and Schedule scripts or code snippets',
        config: {
          steps: [],
        } as any,
      };
    case 'training':
      return {
        ...baseData,
        type: 'training',
        label: 'Model Training',
        description: 'Train ML models on cloud or local',
        config: {
          scriptSource: 'local',
          executionMode: 'local',
          framework: 'pytorch',
          cloudProvider: 'local',
          instanceType: 'local',
          instanceConfig: {},
          parameterValues: {},
          venvConfig: {
            mode: 'auto',
          },
        } as any,
      };
    case 'experiment':
      return {
        ...baseData,
        type: 'experiment',
        label: 'Experiment Tracking',
        description: 'Track experiments and metrics',
        config: {
          tracker: 'clearml',
          projectName: '',
          experimentName: '',
          credentials: {},
          logMetrics: true,
          logArtifacts: true,
          logHyperparameters: true,
        } as any,
      };
    case 'report':
      return {
        ...baseData,
        type: 'report',
        label: 'Model Report',
        description: 'Generate model report and documentation',
        config: {
          title: 'Model Report',
          includeMetrics: true,
          includeVisualizations: true,
          includeModelCard: true,
          outputFormat: 'html',
        } as any,
      };
    default:
      throw new Error(`Unknown node type: ${type}`);
  }
};

// Nanoid polyfill for browser
const generateId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const usePipelineStore = create<PipelineState>()((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  currentPipeline: null,
  savedPipelines: [],
  isConfigPanelOpen: false,
  isDirty: false,
  isLoading: false,
  isLeftSidebarOpen: true,
  isRightSidebarOpen: true,
  history: [],
  historyIndex: -1,
  isDragging: false,
  clipboard: null,

  // Push current state to history (called before making changes)
  pushHistory: () => {
    const { nodes, edges, history, historyIndex } = get();
    
    // Remove any future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);
    
    // Add current state
    newHistory.push({
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    
    // Limit history size
    if (newHistory.length > MAX_HISTORY_SIZE) {
      newHistory.shift();
    }
    
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  canUndo: () => {
    const { historyIndex } = get();
    return historyIndex > 0;
  },

  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },

  undo: () => {
    const { history, historyIndex, canUndo } = get();
    if (!canUndo()) return;
    
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    
    set({
      nodes: JSON.parse(JSON.stringify(entry.nodes)),
      edges: JSON.parse(JSON.stringify(entry.edges)),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  redo: () => {
    const { history, historyIndex, canRedo } = get();
    if (!canRedo()) return;
    
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    
    set({
      nodes: JSON.parse(JSON.stringify(entry.nodes)),
      edges: JSON.parse(JSON.stringify(entry.edges)),
      historyIndex: newIndex,
      isDirty: true,
    });
  },

  // Set drag state - used by canvas to track drag start/end
  setDragging: (isDragging) => {
    set({ isDragging });
  },

  copyNode: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (node) {
      set({ clipboard: JSON.parse(JSON.stringify(node)) });
    }
  },

  pasteNode: (position) => {
    const { clipboard, pushHistory } = get();
    if (!clipboard) return;
    
    pushHistory();
    
    const newId = generateId();
    const newNode: PipelineNode = {
      ...JSON.parse(JSON.stringify(clipboard)),
      id: newId,
      position,
      data: {
        ...clipboard.data,
        label: `${clipboard.data.label} (copy)`,
      } as PipelineNodeData,
    };

    set({
      nodes: [...get().nodes, newNode],
      isDirty: true,
    });
  },

  selectAllNodes: () => {
    const { nodes } = get();
    // Select all nodes by marking them as selected in React Flow
    const selectedNodes = nodes.map(node => ({
      ...node,
      selected: true,
    }));
    
    set({
      nodes: selectedNodes,
      // If there are nodes, select the first one for the config panel
      selectedNodeId: nodes.length > 0 ? nodes[0].id : null,
      isConfigPanelOpen: nodes.length > 0,
    });
  },

  nudgeSelectedNodes: (dx, dy) => {
    const { nodes, pushHistory } = get();
    const selectedNodes = nodes.filter(n => n.selected);
    
    if (selectedNodes.length === 0) return;
    
    pushHistory();
    
    set({
      nodes: nodes.map(node => 
        node.selected
          ? {
              ...node,
              position: {
                x: node.position.x + dx,
                y: node.position.y + dy,
              },
            }
          : node
      ),
      isDirty: true,
    });
  },

  toggleLeftSidebar: () => {
    set(state => ({ isLeftSidebarOpen: !state.isLeftSidebarOpen }));
  },

  toggleRightSidebar: () => {
    const { selectedNodeId, isConfigPanelOpen } = get();
    if (selectedNodeId && isConfigPanelOpen) {
      // Close the config panel if it's open
      set({ isConfigPanelOpen: false, selectedNodeId: null });
    }
    set(state => ({ isRightSidebarOpen: !state.isRightSidebarOpen }));
  },

  setLeftSidebarOpen: (open) => {
    set({ isLeftSidebarOpen: open });
  },

  setRightSidebarOpen: (open) => {
    set({ isRightSidebarOpen: open });
  },

  onNodesChange: (changes) => {
    const { pushHistory, isDragging } = get();
    
    // Push to history for significant changes (not just selection)
    // Skip position changes during drag - history will be pushed on drag end
    const significantChanges = changes.filter(
      c => c.type === 'remove' || c.type === 'dimensions' || (c.type === 'position' && !isDragging)
    );
    if (significantChanges.length > 0) {
      pushHistory();
    }
    
    set({
      nodes: applyNodeChanges(changes, get().nodes) as PipelineNode[],
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    const { pushHistory } = get();
    
    // Push to history for edge changes
    if (changes.some(c => c.type === 'remove' || c.type === 'add')) {
      pushHistory();
    }
    
    set({
      edges: applyEdgeChanges(changes, get().edges) as PipelineEdge[],
      isDirty: true,
    });
  },

  onConnect: (connection: Connection) => {
    const { pushHistory } = get();
    pushHistory();
    
    set({
      edges: addEdge(
        {
          ...connection,
          type: 'smoothstep',
          animated: true,
        },
        get().edges
      ) as PipelineEdge[],
      isDirty: true,
    });
  },

  addNode: (type, position) => {
    const { pushHistory } = get();
    pushHistory();
    
    const id = generateId();
    const newNode: PipelineNode = {
      id,
      type,
      position,
      data: getDefaultNodeData(type),
    };

    set({
      nodes: [...get().nodes, newNode],
      isDirty: true,
    });

    return id;
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...data,
                lastUpdated: new Date().toISOString(),
              } as PipelineNodeData,
            }
          : node
      ),
      isDirty: true,
    });
  },

  updateNodeStatus: (nodeId, status, message) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                status,
                statusMessage: message,
                lastUpdated: new Date().toISOString(),
              } as PipelineNodeData,
            }
          : node
      ),
    });
  },

  updateNodeExecutionLogs: (nodeId, logs) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                executionLogs: logs,
                lastUpdated: new Date().toISOString(),
              } as PipelineNodeData,
            }
          : node
      ),
    });
  },

  deleteNode: (nodeId) => {
    const { pushHistory } = get();
    pushHistory();
    
    set({
      nodes: get().nodes.filter((node) => node.id !== nodeId),
      edges: get().edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      isDirty: true,
    });
  },

  duplicateNode: (nodeId) => {
    const { pushHistory, nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    pushHistory();
    
    const newId = generateId();
    const newNode: PipelineNode = {
      ...node,
      id: newId,
      selected: true, // Select the duplicated node
      position: {
        x: node.position.x + 50,
        y: node.position.y + 50,
      },
      data: {
        ...node.data,
        label: `${node.data.label} (copy)`,
      } as PipelineNodeData,
    };

    // Deselect all existing nodes and add the new selected node
    const updatedNodes = nodes.map(n => ({ ...n, selected: false }));

    set({
      nodes: [...updatedNodes, newNode],
      selectedNodeId: newId, // Focus on the duplicated node
      isConfigPanelOpen: true, // Open config panel for the new node
      isDirty: true,
    });
  },

  selectNode: (nodeId) => {
    set({
      selectedNodeId: nodeId,
      isConfigPanelOpen: nodeId !== null,
    });
  },

  fetchPipelines: async () => {
    set({ isLoading: true });
    try {
      const response = await fetch('/api/pipelines');
      if (!response.ok) throw new Error('Failed to fetch pipelines');
      const pipelines = await response.json();
      set({ savedPipelines: pipelines });
    } catch (error) {
      console.error('Error fetching pipelines:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  savePipeline: async (name, description) => {
    const { nodes, edges, currentPipeline } = get();
    const now = new Date().toISOString();

    const pipelineData = {
      id: currentPipeline?.id,
      name,
      description,
      nodes,
      edges,
      version: '1.0.0',
    };

    try {
      const response = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipelineData),
      });

      if (!response.ok) throw new Error('Failed to save pipeline');

      const savedPipeline = await response.json();
      
      // Update local state
      const { savedPipelines } = get();
      const existingIndex = savedPipelines.findIndex((p) => p.id === savedPipeline.id);
      const updatedPipelines =
        existingIndex >= 0
          ? savedPipelines.map((p, i) => (i === existingIndex ? savedPipeline : p))
          : [...savedPipelines, savedPipeline];

      set({
        currentPipeline: savedPipeline,
        savedPipelines: updatedPipelines,
        isDirty: false,
      });

      // Update URL to include pipeline ID (for sharing)
      if (typeof window !== 'undefined') {
        const newUrl = `/canvas/${savedPipeline.id}`;
        // Only update if we're not already on this URL
        if (window.location.pathname !== newUrl) {
          window.history.replaceState(null, '', newUrl);
        }
      }

      return savedPipeline;
    } catch (error) {
      console.error('Error saving pipeline:', error);
      throw error;
    }
  },

  saveAsNewPipeline: async (name, description) => {
    const { nodes, edges } = get();

    const pipelineData = {
      id: undefined, // No ID means create a new pipeline
      name,
      description,
      nodes,
      edges,
      version: '1.0.0',
    };

    try {
      const response = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pipelineData),
      });

      if (!response.ok) throw new Error('Failed to save pipeline');

      const newPipeline = await response.json();
      
      // Update local state with the new pipeline
      const { savedPipelines } = get();
      const updatedPipelines = [...savedPipelines, newPipeline];

      set({
        currentPipeline: newPipeline,
        savedPipelines: updatedPipelines,
        isDirty: false,
      });

      // Update URL to include the new pipeline ID
      if (typeof window !== 'undefined') {
        const newUrl = `/canvas/${newPipeline.id}`;
        if (window.location.pathname !== newUrl) {
          window.history.replaceState(null, '', newUrl);
        }
      }

      return newPipeline;
    } catch (error) {
      console.error('Error saving pipeline as:', error);
      throw error;
    }
  },

  loadPipeline: async (pipelineId, shareToken) => {
    set({ isLoading: true });
    try {
      const url = shareToken 
        ? `/api/pipelines/${pipelineId}?token=${shareToken}`
        : `/api/pipelines/${pipelineId}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load pipeline');
      
      const pipeline = await response.json();
      
      set({
        nodes: pipeline.nodes,
        edges: pipeline.edges,
        currentPipeline: pipeline,
        selectedNodeId: null,
        isConfigPanelOpen: false,
        isDirty: false,
      });

      // Update URL to include pipeline ID (but preserve token if present)
      if (typeof window !== 'undefined') {
        const currentUrl = new URL(window.location.href);
        const newPath = `/canvas/${pipelineId}`;
        if (currentUrl.pathname !== newPath) {
          // Preserve the token in the URL if it exists
          const tokenParam = shareToken ? `?token=${shareToken}` : '';
          window.history.replaceState(null, '', `${newPath}${tokenParam}`);
        }
      }
    } catch (error) {
      console.error('Error loading pipeline:', error);
      // Fallback to local state
      const pipeline = get().savedPipelines.find((p) => p.id === pipelineId);
      if (pipeline) {
        set({
          nodes: pipeline.nodes,
          edges: pipeline.edges,
          currentPipeline: pipeline,
          selectedNodeId: null,
          isConfigPanelOpen: false,
          isDirty: false,
        });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  createNewPipeline: () => {
    set({
      nodes: [],
      edges: [],
      currentPipeline: null,
      selectedNodeId: null,
      isConfigPanelOpen: false,
      isDirty: false,
    });

    // Navigate to home/new canvas
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  },

  deletePipeline: async (pipelineId) => {
    try {
      const response = await fetch(`/api/pipelines/${pipelineId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete pipeline');

      set({
        savedPipelines: get().savedPipelines.filter((p) => p.id !== pipelineId),
        currentPipeline:
          get().currentPipeline?.id === pipelineId ? null : get().currentPipeline,
      });
    } catch (error) {
      console.error('Error deleting pipeline:', error);
      throw error;
    }
  },

  exportPipeline: () => {
    const { nodes, edges, currentPipeline } = get();
    const exportData = {
      ...currentPipeline,
      nodes,
      edges,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(exportData, null, 2);
  },

  importPipeline: (jsonString) => {
    try {
      const data = JSON.parse(jsonString);
      if (data.nodes && data.edges) {
        set({
          nodes: data.nodes,
          edges: data.edges,
          currentPipeline: data.id ? data : null,
          isDirty: true,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  setConfigPanelOpen: (open) => {
    set({ isConfigPanelOpen: open });
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      currentPipeline: null,
      isConfigPanelOpen: false,
      isDirty: false,
      history: [],
      historyIndex: -1,
      clipboard: null,
    });
  },
}));
