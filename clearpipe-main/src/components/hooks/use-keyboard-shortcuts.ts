'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { usePipelineStore } from '@/stores/pipeline-store';

interface KeyboardShortcutsOptions {
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  canvasRef?: React.RefObject<HTMLDivElement | null>;
  onSave?: () => void;
  onSaveAs?: () => void;
}

/**
 * Custom hook for handling keyboard shortcuts in the pipeline canvas
 * Based on the shortcuts defined in docs/shortcuts.md
 */
export function useKeyboardShortcuts({
  onToggleLeftSidebar,
  onToggleRightSidebar,
  canvasRef,
  onSave,
  onSaveAs,
}: KeyboardShortcutsOptions = {}) {
  const reactFlow = useReactFlow();
  const lastActionTimeRef = useRef<number>(0);

  const {
    nodes,
    edges,
    selectedNodeId,
    selectNode,
    deleteNode,
    duplicateNode,
    copyNode,
    pasteNode,
    nudgeSelectedNodes,
    selectAllNodes,
  } = usePipelineStore();

  // Check if the canvas or its children have focus
  const isCanvasFocused = useCallback(() => {
    if (!canvasRef?.current) return true; // Default to true if no ref provided
    
    const activeElement = document.activeElement;
    
    // Don't trigger shortcuts if user is typing in an input, textarea, or contenteditable
    if (
      activeElement?.tagName === 'INPUT' ||
      activeElement?.tagName === 'TEXTAREA' ||
      activeElement?.getAttribute('contenteditable') === 'true'
    ) {
      return false;
    }

    // Check if focus is within a dialog or modal
    if (activeElement?.closest('[role="dialog"]')) {
      return false;
    }

    return true;
  }, [canvasRef]);

  // Prevent duplicate actions within a short time frame
  const debounceAction = useCallback((action: () => void, delay: number = 100) => {
    const now = Date.now();
    if (now - lastActionTimeRef.current > delay) {
      lastActionTimeRef.current = now;
      action();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if canvas is focused
      if (!isCanvasFocused()) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      // ==========================================
      // General & Canvas Navigation
      // ==========================================

      // Save Pipeline - Ctrl/Cmd + S
      if (ctrlOrCmd && key === 's' && !event.shiftKey) {
        event.preventDefault();
        debounceAction(() => {
          onSave?.();
        });
        return;
      }

      // Save Pipeline As - Ctrl/Cmd + Shift + S
      if (ctrlOrCmd && key === 's' && event.shiftKey) {
        event.preventDefault();
        debounceAction(() => {
          onSaveAs?.();
        });
        return;
      }

      // Undo - Ctrl/Cmd + Z
      if (ctrlOrCmd && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        debounceAction(() => {
          const store = usePipelineStore.getState();
          if (store.canUndo()) {
            store.undo();
          }
        });
        return;
      }

      // Redo - Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z (Mac)
      if (
        (ctrlOrCmd && key === 'y') ||
        (ctrlOrCmd && key === 'z' && event.shiftKey && isMac)
      ) {
        event.preventDefault();
        debounceAction(() => {
          const store = usePipelineStore.getState();
          if (store.canRedo()) {
            store.redo();
          }
        });
        return;
      }

      // Zoom In - +
      if (key === '+' || key === '=') {
        event.preventDefault();
        debounceAction(() => {
          reactFlow.zoomIn({ duration: 200 });
        });
        return;
      }

      // Zoom Out - -
      if (key === '-') {
        event.preventDefault();
        debounceAction(() => {
          reactFlow.zoomOut({ duration: 200 });
        });
        return;
      }

      // Fit View - Space
      if (key === ' ' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        debounceAction(() => {
          reactFlow.fitView({ padding: 0.2, duration: 300 });
        });
        return;
      }

      // ==========================================
      // Node & Edge Manipulation
      // ==========================================

      // Delete Node/Edge - Backspace or Delete
      if (key === 'backspace' || key === 'delete') {
        event.preventDefault();
        debounceAction(() => {
          if (selectedNodeId) {
            deleteNode(selectedNodeId);
          }
          // Also delete selected edges through React Flow's internal handling
        });
        return;
      }

      // Select All - Ctrl/Cmd + A
      if (ctrlOrCmd && key === 'a') {
        event.preventDefault();
        debounceAction(() => {
          selectAllNodes();
        });
        return;
      }

      // Duplicate Node - Ctrl/Cmd + D
      if (ctrlOrCmd && key === 'd') {
        event.preventDefault();
        debounceAction(() => {
          if (selectedNodeId) {
            duplicateNode(selectedNodeId);
          }
        });
        return;
      }

      // Copy Node - Ctrl/Cmd + C
      if (ctrlOrCmd && key === 'c') {
        event.preventDefault();
        debounceAction(() => {
          if (selectedNodeId) {
            copyNode(selectedNodeId);
          }
        });
        return;
      }

      // Paste Node - Ctrl/Cmd + V
      if (ctrlOrCmd && key === 'v') {
        event.preventDefault();
        debounceAction(() => {
          // Get the center of the current viewport for paste position
          const viewport = reactFlow.getViewport();
          const { width, height } = reactFlow.getNodes().length > 0 
            ? { width: window.innerWidth, height: window.innerHeight }
            : { width: 800, height: 600 };
          
          const centerX = (-viewport.x + width / 2) / viewport.zoom;
          const centerY = (-viewport.y + height / 2) / viewport.zoom;
          
          pasteNode({ x: centerX, y: centerY });
        });
        return;
      }

      // Move Selection - Arrow Keys
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10; // Larger step with Shift
        let dx = 0;
        let dy = 0;

        switch (key) {
          case 'arrowup':
            dy = -step;
            break;
          case 'arrowdown':
            dy = step;
            break;
          case 'arrowleft':
            dx = -step;
            break;
          case 'arrowright':
            dx = step;
            break;
        }

        debounceAction(() => {
          nudgeSelectedNodes(dx, dy);
        }, 50);
        return;
      }

      // ==========================================
      // Interface
      // ==========================================

      // Toggle Left Sidebar (Node Palette) - Ctrl/Cmd + B
      if (ctrlOrCmd && key === 'b') {
        event.preventDefault();
        debounceAction(() => {
          onToggleLeftSidebar?.();
        });
        return;
      }

      // Toggle Right Sidebar (Properties) - Ctrl/Cmd + P
      if (ctrlOrCmd && key === 'p') {
        event.preventDefault();
        debounceAction(() => {
          onToggleRightSidebar?.();
        });
        return;
      }

      // Close Modal - Escape
      if (key === 'escape') {
        // Deselect node when pressing Escape
        debounceAction(() => {
          selectNode(null);
        });
        return;
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isCanvasFocused,
    debounceAction,
    reactFlow,
    selectedNodeId,
    deleteNode,
    duplicateNode,
    copyNode,
    pasteNode,
    nudgeSelectedNodes,
    selectAllNodes,
    selectNode,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onSave,
    onSaveAs,
  ]);
}

export default useKeyboardShortcuts;
