'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  ConnectionMode,
  Panel,
  Connection,
  EdgeChange,
  NodeChange,
  IsValidConnection,
  Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Unlink } from 'lucide-react';

import { nodeTypes } from '@/components/nodes';
import { NodePalette } from '@/components/pipeline/node-palette';
import { NodeConfigPanel } from '@/components/pipeline/node-config-panel';
import { PipelineToolbar } from '@/components/pipeline/pipeline-toolbar';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { usePipelineStore } from '@/stores/pipeline-store';
import { PipelineNodeData, PipelineNode } from '@/types/pipeline';
import { 
  CollaborationProvider, 
  useCollaboration 
} from '@/components/collaboration';
import { CollaboratorCursors } from '@/components/collaboration/collaborator-cursors';
import { useAuth } from '@/lib/supabase/use-auth';
import { useKeyboardShortcuts } from '@/components/hooks/use-keyboard-shortcuts';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';

// Edge context menu state
interface EdgeContextMenu {
  edgeId: string;
  x: number;
  y: number;
}

function PipelineCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getZoom } = useReactFlow();
  const [zoom, setZoom] = useState<number>(0.8);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const zoomTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenu | null>(null);
  
  // Refs for keyboard shortcut callbacks
  const onSaveRef = useRef<(() => void) | null>(null);
  const onSaveAsRef = useRef<(() => void) | null>(null);
  
  // Collaboration cursor tracking and broadcasting
  const { updateCursorPosition, broadcastPipelineChange, isConnected } = useCollaboration();
  
  // Get sidebar states from store
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    selectNode,
    isConfigPanelOpen,
    isLeftSidebarOpen,
    isRightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
    setLeftSidebarOpen,
    setRightSidebarOpen,
    setDragging,
    pushHistory,
  } = usePipelineStore();
  
  // Initialize keyboard shortcuts
  useKeyboardShortcuts({
    onToggleLeftSidebar: toggleLeftSidebar,
    onToggleRightSidebar: toggleRightSidebar,
    canvasRef: reactFlowWrapper,
    onSave: () => onSaveRef.current?.(),
    onSaveAs: () => onSaveAsRef.current?.(),
  });
  
  // Track mouse movement on canvas for collaboration
  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (reactFlowWrapper.current) {
      const rect = reactFlowWrapper.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      updateCursorPosition(x, y);
    }
  }, [updateCursorPosition]);

  // Update zoom level and show indicator
  const handleZoom = useCallback(() => {
    const currentZoom = getZoom();
    setZoom(currentZoom);
    setShowZoomIndicator(true);

    // Clear existing timeout
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }

    // Hide indicator after 2 seconds
    zoomTimeoutRef.current = setTimeout(() => {
      setShowZoomIndicator(false);
    }, 2000);
  }, [getZoom]);

  // Listen to wheel events for zoom
  useEffect(() => {
    const canvas = reactFlowWrapper.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      // Only track zoom if ctrl/cmd is pressed (standard zoom modifier)
      if (e.ctrlKey || e.metaKey) {
        // Small delay to let ReactFlow process the zoom
        setTimeout(handleZoom, 50);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [handleZoom]);

  // Also listen for zoom button clicks via mutation observer
  useEffect(() => {
    const canvas = reactFlowWrapper.current;
    if (!canvas) return;

    const observer = new MutationObserver(() => {
      handleZoom();
    });

    observer.observe(canvas, { 
      attributes: true, 
      subtree: true, 
      attributeFilter: ['transform', 'style'] 
    });

    return () => observer.disconnect();
  }, [handleZoom]);

  // Wrap onNodesChange to broadcast changes to collaborators
  const handleNodesChange = useCallback((changes: NodeChange<PipelineNode>[]) => {
    onNodesChange(changes);
    
    // Only broadcast meaningful changes (position, dimensions, etc.)
    // Filter out selection changes which are local-only
    const broadcastableChanges = changes.filter(
      change => change.type === 'position' || change.type === 'dimensions'
    );
    
    if (broadcastableChanges.length > 0 && isConnected) {
      broadcastPipelineChange('nodes', broadcastableChanges);
    }
  }, [onNodesChange, broadcastPipelineChange, isConnected]);

  // Wrap onEdgesChange to broadcast changes to collaborators
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);
    
    // Broadcast edge changes (add, remove, etc.)
    if (changes.length > 0 && isConnected) {
      broadcastPipelineChange('edges', changes);
    }
  }, [onEdgesChange, broadcastPipelineChange, isConnected]);

  // Wrap onConnect to broadcast new connections
  const handleConnect = useCallback((connection: Connection) => {
    onConnect(connection);
    
    if (isConnected) {
      broadcastPipelineChange('edges', [{ type: 'add', item: connection }]);
    }
  }, [onConnect, broadcastPipelineChange, isConnected]);

  // Wrap addNode to broadcast new nodes
  const handleAddNode = useCallback((type: PipelineNodeData['type'], position: { x: number; y: number }) => {
    const newNodeId = addNode(type, position);
    
    if (isConnected) {
      // Get the newly added node and broadcast it
      const newNode = usePipelineStore.getState().nodes.find(n => n.id === newNodeId);
      if (newNode) {
        broadcastPipelineChange('node_add', newNode);
      }
    }
    
    return newNodeId;
  }, [addNode, broadcastPipelineChange, isConnected]);

  // Validate connection: source must have output (right), target must have input (left)
  const isValidConnection = useCallback((connection: Connection | any) => {
    // Prevent connections from source to source or target to target
    if (connection.sourceHandle === connection.targetHandle) {
      return false;
    }
    
    // Ensure source is connecting FROM right (output) and target is connecting TO left (input)
    if (connection.sourceHandle !== 'source' || connection.targetHandle !== 'target') {
      return false;
    }
    
    // Prevent self-connections
    if (connection.source === connection.target) {
      return false;
    }
    
    return true;
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow') as PipelineNodeData['type'];

      if (!type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      handleAddNode(type, position);
    },
    [screenToFlowPosition, handleAddNode]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  // Handle node drag start - push history before starting drag
  const onNodeDragStart = useCallback(() => {
    pushHistory();
    setDragging(true);
  }, [pushHistory, setDragging]);

  // Handle node drag stop - end drag state
  const onNodeDragStop = useCallback(() => {
    setDragging(false);
  }, [setDragging]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    setEdgeContextMenu(null);
  }, [selectNode]);

  // Handle right-click on edge to show context menu
  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setEdgeContextMenu({
        edgeId: edge.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    []
  );

  // Delete edge (unlink connection)
  const handleDeleteEdge = useCallback(() => {
    if (edgeContextMenu) {
      const newEdges = usePipelineStore.getState().edges.filter(
        (edge) => edge.id !== edgeContextMenu.edgeId
      );
      usePipelineStore.setState({ edges: newEdges, isDirty: true });
      setEdgeContextMenu(null);
    }
  }, [edgeContextMenu]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setEdgeContextMenu(null);
    };

    if (edgeContextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [edgeContextMenu]);

  // Handle left sidebar collapse
  const handleLeftSidebarCollapse = useCallback(() => {
    setLeftSidebarOpen(false);
  }, [setLeftSidebarOpen]);

  // Handle right sidebar collapse
  const handleConfigPanelCollapse = useCallback(() => {
    selectNode(null);
    setRightSidebarOpen(false);
  }, [selectNode, setRightSidebarOpen]);

  // Handle edge reconnection for established connections
  const onReconnect = useCallback((oldEdge: any, newConnection: Connection) => {
    // Validate the new connection
    if (!isValidConnection(newConnection)) {
      return;
    }

    // Remove old edge and add new one through store
    const { nodes: currentNodes, edges: currentEdges, deleteNode: _, ...storeActions } = usePipelineStore.getState();
    const newEdges = currentEdges
      .filter(edge => edge.id !== oldEdge.id)
      .concat([{
        id: oldEdge.id, // Keep the same edge ID
        source: newConnection.source || '',
        target: newConnection.target || '',
        sourceHandle: newConnection.sourceHandle,
        targetHandle: newConnection.targetHandle,
        type: 'smoothstep',
        animated: true,
      } as any]);

    // Update edges in store
    usePipelineStore.setState({ edges: newEdges, isDirty: true });
  }, [isValidConnection]);

  return (
    <div className="flex h-screen w-full">
      {/* Left Sidebar - Node Palette */}
      <ResizablePanel
        side="left"
        defaultWidth={380}
        minWidth={100}
        maxWidth={450}
        title="Node Palette"
        isOpen={isLeftSidebarOpen}
        onCollapse={handleLeftSidebarCollapse}
        onExpand={() => setLeftSidebarOpen(true)}
      >
        <NodePalette onDragStart={onDragStart} />
      </ResizablePanel>

      {/* Main Canvas */}
      <div 
        className="flex-1 h-full relative" 
        ref={reactFlowWrapper}
        onMouseMove={handleMouseMove}
        tabIndex={0}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onReconnect={onReconnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onEdgeContextMenu={onEdgeContextMenu}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Strict}
          isValidConnection={isValidConnection}
          snapToGrid
          snapGrid={[15, 15]}
          defaultEdgeOptions={{
            type: 'smoothstep',
            animated: true,
          }}
          defaultViewport={{ x: 0, y: 0, zoom: 1.0 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={15} size={1} />
          <Controls className="!bg-neutral-100 !border-neutral-200 !shadow-md !text-neutral-700 [&>button]:!bg-neutral-100 [&>button]:!border-neutral-200 [&>button]:!fill-neutral-700 [&>button:hover]:!bg-neutral-200" />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="!bg-background border rounded-lg"
          />
          <Panel position="top-center">
            <PipelineToolbar onSaveRef={onSaveRef} onSaveAsRef={onSaveAsRef} />
          </Panel>
        </ReactFlow>

        {/* Zoom Indicator - Positioned outside ReactFlow for better visibility */}
        {showZoomIndicator && (
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-neutral-500 text-white px-3 py-1 rounded-md text-sm font-medium shadow-lg pointer-events-none z-10">
            {(zoom * 100).toFixed(0)}%
          </div>
        )}

        {/* Edge Context Menu */}
        {edgeContextMenu && (
          <div
            className="absolute z-50 bg-popover border border-border rounded-md shadow-md p-1"
            style={{
              left: edgeContextMenu.x,
              top: edgeContextMenu.y,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleDeleteEdge}
              className="flex items-center justify-center w-8 h-8 rounded-sm hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              title="Unlink connection"
            >
              <Unlink className="w-4 h-4 text-red-500" />
            </button>
          </div>
        )}
        
        {/* Collaborator Cursors */}
        <CollaboratorCursors />
      </div>

      {/* Right Sidebar - Node Configuration */}
      <ResizablePanel
        side="right"
        defaultWidth={480}
        minWidth={480}
        maxWidth={550}
        title="Configuration"
        isOpen={isConfigPanelOpen && isRightSidebarOpen}
        onCollapse={handleConfigPanelCollapse}
        onExpand={() => setRightSidebarOpen(true)}
      >
        <NodeConfigPanel />
      </ResizablePanel>
    </div>
  );
}

export function PipelineCanvas() {
  // Get current pipeline ID and dirty state from store
  const currentPipeline = usePipelineStore((state) => state.currentPipeline);
  const isDirty = usePipelineStore((state) => state.isDirty);
  
  // Get current user info for collaboration
  const { user, loading: authLoading } = useAuth();
  
  // Debug logging for collaboration
  useEffect(() => {
    console.log('[Collaboration] State:', {
      pipelineId: currentPipeline?.id,
      userId: user?.id,
      userName: user?.name || user?.email?.split('@')[0],
      authLoading,
    });
  }, [currentPipeline?.id, user, authLoading]);
  
  return (
    <ReactFlowProvider>
      <UnsavedChangesDialog isDirty={isDirty}>
        <CollaborationProvider 
          pipelineId={currentPipeline?.id}
          userId={user?.id}
          userName={user?.name || user?.email?.split('@')[0]}
          userEmail={user?.email}
          userAvatar={user?.avatarUrl}
        >
          <PipelineCanvasInner />
        </CollaborationProvider>
      </UnsavedChangesDialog>
    </ReactFlowProvider>
  );
}
