'use client';

import { useState, useEffect } from 'react';
import { Keyboard, Monitor, Apple } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// Keyboard shortcuts data
const shortcutsData = {
  general: {
    title: 'General & Canvas Navigation',
    shortcuts: [
      { action: 'Save Pipeline', windows: 'Ctrl + S', mac: '⌘ + S', description: 'Saves the current pipeline state' },
      { action: 'Save Pipeline As...', windows: 'Ctrl + Shift + S', mac: '⌘ + Shift + S', description: 'Saves as a new entry or exports as JSON' },
      { action: 'Undo', windows: 'Ctrl + Z', mac: '⌘ + Z', description: 'Reverts the last action' },
      { action: 'Redo', windows: 'Ctrl + Y', mac: '⌘ + Shift + Z', description: 'Reapplies a reverted action' },
      { action: 'Zoom In', windows: '+ / Wheel Up', mac: '+ / Wheel Up', description: 'Zooms into the canvas' },
      { action: 'Zoom Out', windows: '- / Wheel Down', mac: '- / Wheel Down', description: 'Zooms out of the canvas' },
      { action: 'Fit View', windows: 'Space', mac: 'Space', description: 'Centers and zooms to fit all nodes' },
      { action: 'Pan Canvas', windows: 'Mouse Drag', mac: 'Mouse Drag', description: 'Click and drag on empty area' },
    ],
  },
  nodes: {
    title: 'Node & Edge Manipulation',
    shortcuts: [
      { action: 'Delete Node/Edge', windows: 'Backspace / Delete', mac: 'Backspace / Delete', description: 'Removes selected node(s) or connection(s)' },
      { action: 'Multi-Select', windows: 'Shift + Mouse Drag', mac: 'Shift + Mouse Drag', description: 'Drag a selection box' },
      { action: 'Add to Selection', windows: 'Ctrl + Click', mac: '⌘ + Click', description: 'Add/remove individual nodes from selection' },
      { action: 'Select All', windows: 'Ctrl + A', mac: '⌘ + A', description: 'Selects all nodes and edges' },
      { action: 'Move Selection', windows: 'Arrow Keys', mac: 'Arrow Keys', description: 'Nudges selected nodes' },
      { action: 'Duplicate Node', windows: 'Ctrl + D', mac: '⌘ + D', description: 'Duplicates selected node(s)' },
      { action: 'Copy Node', windows: 'Ctrl + C', mac: '⌘ + C', description: 'Copies selected node to clipboard' },
      { action: 'Paste Node', windows: 'Ctrl + V', mac: '⌘ + V', description: 'Pastes node from clipboard' },
    ],
  },
  interface: {
    title: 'Interface',
    shortcuts: [
      { action: 'Toggle Sidebar', windows: 'Ctrl + B', mac: '⌘ + B', description: 'Expands/collapses the left node palette' },
      { action: 'Toggle Properties', windows: 'Ctrl + P', mac: '⌘ + P', description: 'Expands/collapses the right configuration panel' },
      { action: 'Close Modal', windows: 'Esc', mac: 'Esc', description: 'Closes any open dialogs or modals' },
    ],
  },
};

// Keyboard shortcut key badge component
function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-2 py-1 text-xs font-semibold text-muted-foreground bg-muted border border-border rounded-md shadow-sm">
      {children}
    </kbd>
  );
}

// Platform toggle component
function PlatformToggle({ 
  platform, 
  onPlatformChange 
}: { 
  platform: 'windows' | 'mac'; 
  onPlatformChange: (platform: 'windows' | 'mac') => void;
}) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      <button
        onClick={() => onPlatformChange('windows')}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
          platform === 'windows' 
            ? "bg-background text-foreground shadow-sm" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Monitor className="h-3.5 w-3.5" />
        Windows / Linux
      </button>
      <button
        onClick={() => onPlatformChange('mac')}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all",
          platform === 'mac' 
            ? "bg-background text-foreground shadow-sm" 
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Apple className="h-3.5 w-3.5" />
        macOS
      </button>
    </div>
  );
}

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({ 
  open, 
  onOpenChange 
}: KeyboardShortcutsDialogProps) {
  // Detect initial platform
  const [platform, setPlatform] = useState<'windows' | 'mac'>('windows');
  
  useEffect(() => {
    // Auto-detect platform on mount
    if (typeof navigator !== 'undefined') {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      setPlatform(isMac ? 'mac' : 'windows');
    }
  }, []);
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Speed up your workflow with these keyboard shortcuts.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex justify-center py-2">
          <PlatformToggle platform={platform} onPlatformChange={setPlatform} />
        </div>
        
        <ScrollArea className="h-[450px] pr-4">
          <div className="space-y-6">
            {Object.entries(shortcutsData).map(([key, section]) => (
              <div key={key} className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                <div className="space-y-2">
                  {section.shortcuts.map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{shortcut.action}</p>
                        <p className="text-xs text-muted-foreground truncate">{shortcut.description}</p>
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <KeyBadge>{platform === 'mac' ? shortcut.mac : shortcut.windows}</KeyBadge>
                      </div>
                    </div>
                  ))}
                </div>
                {key !== 'interface' && <Separator />}
              </div>
            ))}
          </div>
        </ScrollArea>
        
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            💡 Tip: Some shortcuts require the canvas to be focused (clicked) to work correctly.
          </p>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
