'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ResizablePanelProps {
  children: React.ReactNode;
  side: 'left' | 'right';
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  collapsedWidth?: number;
  title?: string;
  className?: string;
  isOpen?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

export function ResizablePanel({
  children,
  side,
  defaultWidth = 400,
  minWidth = 100,
  maxWidth = 500,
  collapsedWidth = 40,
  title,
  className,
  isOpen,
  onCollapse,
  onExpand,
}: ResizablePanelProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [width, setWidth] = React.useState(defaultWidth);
  const [isResizing, setIsResizing] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const prevIsOpenRef = React.useRef<boolean | undefined>(undefined);

  // Sync collapsed state with isOpen prop
  React.useEffect(() => {
    if (isOpen !== undefined) {
      // When isOpen is explicitly set, use it to control collapsed state
      if (isOpen && isCollapsed) {
        setIsCollapsed(false);
      } else if (!isOpen && !isCollapsed) {
        setIsCollapsed(true);
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, isCollapsed]);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = side === 'left' 
          ? moveEvent.clientX - startX 
          : startX - moveEvent.clientX;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width, minWidth, maxWidth, side]
  );

  const toggleCollapse = React.useCallback(() => {
    const newCollapsed = !isCollapsed;
    
    if (newCollapsed) {
      // Collapsing - call onCollapse callback
      onCollapse?.();
    } else {
      // Expanding - call onExpand callback
      onExpand?.();
    }
    
    setIsCollapsed(newCollapsed);
  }, [isCollapsed, onCollapse, onExpand]);

  const CollapseIcon = side === 'left' 
    ? (isCollapsed ? ChevronRight : ChevronLeft)
    : (isCollapsed ? ChevronLeft : ChevronRight);

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative flex flex-col bg-card transition-[width] duration-200 ease-in-out',
        side === 'left' ? 'border-r' : 'border-l',
        isResizing && 'transition-none select-none',
        className
      )}
      style={{ width: isCollapsed ? collapsedWidth : width }}
    >
      {/* Collapse button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'absolute top-2 z-10 h-6 w-6',
          side === 'left' ? 'right-1' : 'left-1'
        )}
        onClick={toggleCollapse}
        title={isCollapsed ? 'Expand' : 'Collapse'}
      >
        <CollapseIcon className="h-4 w-4" />
      </Button>

      {/* Collapsed state */}
      {isCollapsed && (
        <div className="flex flex-col items-center pt-10">
          {title && (
            <span
              className="text-xs font-medium text-muted-foreground writing-mode-vertical"
              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            >
              {title}
            </span>
          )}
        </div>
      )}

      {/* Expanded content */}
      {!isCollapsed && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}

      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className={cn(
            'absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors group',
            side === 'left' ? 'right-0' : 'left-0'
          )}
          onMouseDown={handleMouseDown}
        >
          <div className={cn(
            'absolute top-1/2 -translate-y-1/2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
            side === 'left' ? '-right-1.5' : '-left-1.5'
          )}>
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  );
}
