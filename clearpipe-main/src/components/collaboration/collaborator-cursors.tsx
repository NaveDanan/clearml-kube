'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Cursor,
  CursorBody,
  CursorName,
  CursorPointer,
} from '@/components/kibo-ui/cursor';
import { useOtherCollaborators, type Collaborator } from './collaboration-context';
import { cn } from '@/lib/utils';

interface CollaboratorCursorsProps {
  containerRef?: React.RefObject<HTMLElement>;
}

export function CollaboratorCursors({ containerRef }: CollaboratorCursorsProps) {
  const otherCollaborators = useOtherCollaborators();
  const [visibleCursors, setVisibleCursors] = useState<Map<string, boolean>>(new Map());
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Track container size for cursor positioning
  useEffect(() => {
    const updateSize = () => {
      const container = containerRef?.current || wrapperRef.current?.parentElement;
      if (container) {
        setContainerSize({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [containerRef]);

  // Hide cursors that haven't been updated recently
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const newVisibleCursors = new Map<string, boolean>();
      
      otherCollaborators.forEach(collaborator => {
        if (collaborator.cursor) {
          // Hide cursor if it hasn't been updated in 5 seconds
          const isVisible = now - collaborator.cursor.lastUpdate < 5000;
          newVisibleCursors.set(collaborator.id, isVisible);
        }
      });
      
      setVisibleCursors(newVisibleCursors);
    }, 1000);

    return () => clearInterval(interval);
  }, [otherCollaborators]);

  // Only show cursors for collaborators who have cursor positions
  const collaboratorsWithCursors = otherCollaborators.filter(
    c => c.cursor && (visibleCursors.get(c.id) ?? true)
  );

  if (collaboratorsWithCursors.length === 0) {
    return <div ref={wrapperRef} className="hidden" />;
  }

  return (
    <div ref={wrapperRef} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {collaboratorsWithCursors.map((collaborator) => (
        <CollaboratorCursor 
          key={collaborator.id} 
          collaborator={collaborator}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />
      ))}
    </div>
  );
}

interface CollaboratorCursorProps {
  collaborator: Collaborator;
  containerWidth: number;
  containerHeight: number;
}

function CollaboratorCursor({ collaborator, containerWidth, containerHeight }: CollaboratorCursorProps) {
  const { cursor, name, color } = collaborator;
  
  if (!cursor) return null;

  // Convert percentage position to pixels
  const x = (cursor.x / 100) * containerWidth;
  const y = (cursor.y / 100) * containerHeight;

  // Get first name or username
  const displayName = name.split(' ')[0] || name;

  return (
    <div
      className="absolute transition-all duration-100 ease-out"
      style={{
        left: x,
        top: y,
        transform: 'translate(-2px, -2px)',
      }}
    >
      <Cursor>
        <CursorPointer style={{ color }} />
        <CursorBody 
          className="shadow-sm border"
          style={{ 
            backgroundColor: `${color}15`,
            color: color,
            borderColor: `${color}30`,
          }}
        >
          <CursorName className="font-medium text-xs">{displayName}</CursorName>
        </CursorBody>
      </Cursor>
    </div>
  );
}

export default CollaboratorCursors;
