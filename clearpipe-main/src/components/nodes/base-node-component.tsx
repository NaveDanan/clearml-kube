'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings, Trash2, Copy } from 'lucide-react';
import { usePipelineStore } from '@/stores/pipeline-store';
import { BaseNodeProps } from './shared/types';
import {
  getCategoryFromType,
  categoryColorMap,
  categoryIconBgMap,
  statusColorMap,
} from './shared/utils';
import { nodeIconMap, statusIconMap } from './shared/icons';

interface BaseNodeComponentProps extends BaseNodeProps {
  children?: React.ReactNode;
}

export function BaseNodeComponent({ id, data, selected, children }: BaseNodeComponentProps) {
  const { selectNode, deleteNode, duplicateNode } = usePipelineStore();
  
  const Icon = nodeIconMap[data.type];
  const StatusIcon = statusIconMap[data.status];
  const category = getCategoryFromType(data.type);

  const handleConfigure = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectNode(id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateNode(id);
  };

  return (
    <div
      className={cn(
        'relative min-w-[280px] rounded-lg border-2 bg-card shadow-lg transition-all',
        categoryColorMap[category],
        selected && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      {/* Input Handle - Left side */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />

      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className={cn('p-2 rounded-md', categoryIconBgMap[category])}>
            {Icon && <Icon className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="font-semibold text-sm">{data.label}</h3>
            <p className="text-xs text-muted-foreground">{data.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <StatusIcon className={cn('w-4 h-4', statusColorMap[data.status])} />
        </div>
      </div>

      {/* Content - rendered by child component */}
      <div className="p-3">
        {children}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between p-2 border-t border-border/50 bg-muted/30">
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-xs">
            {data.type}
          </Badge>
          {data.statusMessage && (
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
              {data.statusMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 transition-all duration-200 hover:scale-110 hover:bg-accent"
            onClick={handleConfigure}
            title="Configure node"
          >
            <Settings className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 transition-all duration-200 hover:scale-110 hover:bg-accent"
            onClick={handleDuplicate}
            title="Duplicate node"
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive transition-all duration-200 hover:scale-110 hover:bg-destructive/10"
            onClick={handleDelete}
            title="Delete node"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Output Handle - Right side */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
    </div>
  );
}
