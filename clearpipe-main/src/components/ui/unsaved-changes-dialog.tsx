'use client';

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePipelineStore } from '@/stores/pipeline-store';
import { Icon } from '@iconify/react';

// Types for pending actions
type PendingActionType = 'navigate' | 'new' | 'open' | 'import';

interface PendingAction {
  type: PendingActionType;
  payload?: string; // For navigation: the path; for open: pipeline ID; for import: file content
}

// Context for triggering unsaved changes check from anywhere
interface UnsavedChangesContextValue {
  checkUnsavedChanges: (action: PendingAction, callback: () => void) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (!context) {
    throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider');
  }
  return context;
}

interface UnsavedChangesDialogProps {
  isDirty: boolean;
  children?: React.ReactNode;
}

export function UnsavedChangesDialog({ isDirty, children }: UnsavedChangesDialogProps) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDescription, setPipelineDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const { currentPipeline, savePipeline, saveAsNewPipeline } = usePipelineStore();

  // Function to check for unsaved changes before an action
  const checkUnsavedChanges = useCallback((action: PendingAction, callback: () => void) => {
    if (isDirty) {
      setPendingAction(action);
      setPendingCallback(() => callback);
      setShowDialog(true);
    } else {
      callback();
    }
  }, [isDirty]);

  // Intercept navigation
  useEffect(() => {
    // Handle browser back/forward and refresh
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    // Handle popstate (browser back/forward)
    const handlePopState = () => {
      if (isDirty) {
        // Prevent the navigation
        window.history.pushState(null, '', window.location.href);
        setPendingAction({ type: 'navigate', payload: 'back' });
        setPendingCallback(null);
        setShowDialog(true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    // Push current state to history stack to detect back button
    if (isDirty) {
      window.history.pushState(null, '', window.location.href);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isDirty]);

  // Intercept link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!isDirty) return;

      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      
      if (anchor && anchor.href) {
        const url = new URL(anchor.href);
        // Only intercept internal navigation
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          e.preventDefault();
          setPendingAction({ type: 'navigate', payload: url.pathname + url.search });
          setPendingCallback(null);
          setShowDialog(true);
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isDirty]);

  const executePendingAction = useCallback(() => {
    if (pendingCallback) {
      pendingCallback();
    } else if (pendingAction) {
      if (pendingAction.type === 'navigate') {
        if (pendingAction.payload === 'back') {
          window.history.back();
        } else if (pendingAction.payload) {
          router.push(pendingAction.payload);
        }
      }
    }
    setPendingAction(null);
    setPendingCallback(null);
  }, [pendingAction, pendingCallback, router]);

  const handleDontSave = useCallback(() => {
    setShowDialog(false);
    executePendingAction();
  }, [executePendingAction]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      if (currentPipeline?.id) {
        // Pipeline exists, just save
        await savePipeline(currentPipeline.name, currentPipeline.description || '');
        setShowDialog(false);
        executePendingAction();
      } else {
        // New pipeline, need to show save as dialog
        setPipelineName('');
        setPipelineDescription('');
        setShowDialog(false);
        setShowSaveAsDialog(true);
      }
    } catch (error) {
      console.error('Failed to save pipeline:', error);
    } finally {
      setIsSaving(false);
    }
  }, [currentPipeline, savePipeline, executePendingAction]);

  const handleSaveAs = useCallback(() => {
    setPipelineName(currentPipeline?.name ? `${currentPipeline.name} (Copy)` : '');
    setPipelineDescription(currentPipeline?.description || '');
    setShowDialog(false);
    setShowSaveAsDialog(true);
  }, [currentPipeline]);

  const handleSaveAsConfirm = useCallback(async () => {
    if (!pipelineName.trim()) return;
    
    setIsSaving(true);
    try {
      await saveAsNewPipeline(pipelineName, pipelineDescription);
      setShowSaveAsDialog(false);
      executePendingAction();
    } catch (error) {
      console.error('Failed to save pipeline:', error);
    } finally {
      setIsSaving(false);
    }
  }, [pipelineName, pipelineDescription, saveAsNewPipeline, executePendingAction]);

  const handleCancel = useCallback(() => {
    setShowDialog(false);
    setShowSaveAsDialog(false);
    setPendingAction(null);
    setPendingCallback(null);
  }, []);

  // Get action description for dialog
  const getActionDescription = () => {
    if (!pendingAction) return 'leaving';
    switch (pendingAction.type) {
      case 'new':
        return 'creating a new pipeline';
      case 'open':
        return 'opening another pipeline';
      case 'import':
        return 'importing a pipeline';
      case 'navigate':
      default:
        return 'leaving';
    }
  };

  return (
    <UnsavedChangesContext.Provider value={{ checkUnsavedChanges }}>
      {children}
      
      {/* Unsaved Changes Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon icon="solar:danger-triangle-bold-duotone" className="h-5 w-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes in your pipeline. Do you want to save before {getActionDescription()}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={handleDontSave}
              disabled={isSaving}
            >
              Don&apos;t Save
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveAs}
              disabled={isSaving}
            >
              Save As...
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save As Dialog */}
      <Dialog open={showSaveAsDialog} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Pipeline As</DialogTitle>
            <DialogDescription>
              Give your pipeline a new name and optional description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                placeholder="My ML Pipeline"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description (optional)</label>
              <Input
                value={pipelineDescription}
                onChange={(e) => setPipelineDescription(e.target.value)}
                placeholder="A brief description..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveAsConfirm} 
              disabled={!pipelineName.trim() || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}
