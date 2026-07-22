'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Database,
  GitBranch,
  Wand2,
  Cpu,
  FlaskConical,
  FileText,
  GripVertical,
} from 'lucide-react';
import { nodeTypeDefinitions, categoryLabels } from '@/config/node-definitions';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Database,
  GitBranch,
  Wand2,
  Cpu,
  FlaskConical,
  FileText,
};

interface NodePaletteProps {
  onDragStart: (event: React.DragEvent, nodeType: string) => void;
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const [panelWidth, setPanelWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Determine display mode based on width
  const isCompact = panelWidth < 150; // Icon only mode
  const isCondensed = panelWidth >= 150 && panelWidth < 300; // Icon + label only
  // Group nodes by category
  const nodesByCategory = nodeTypeDefinitions.reduce((acc, node) => {
    if (!acc[node.category]) {
      acc[node.category] = [];
    }
    acc[node.category].push(node);
    return acc;
  }, {} as Record<string, typeof nodeTypeDefinitions>);

  const categoryColorMap: Record<string, string> = {
    data: 'border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/20',
    scripts: 'border-purple-500/50 bg-purple-500/10 hover:bg-purple-500/20',
    training: 'border-orange-500/50 bg-orange-500/10 hover:bg-orange-500/20',
    tracking: 'border-green-500/50 bg-green-500/10 hover:bg-green-500/20',
    output: 'border-pink-500/50 bg-pink-500/10 hover:bg-pink-500/20',
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <motion.div
        className={cn(
          "p-4 border-b",
          isCompact ? "pr-4" : "pr-10"
        )}
        layout="position"
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <h2 className={cn(
          "font-semibold",
          isCompact ? "text-base" : "text-lg"
        )}>
          {isCompact ? "Nodes" : "Node Palette"}
        </h2>
        <AnimatePresence mode="wait">
          {!isCompact && (
            <motion.p
              className="text-xs text-muted-foreground mt-1"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              Drag nodes onto the canvas
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
      
      <ScrollArea className="flex-1 p-4">
        <div className={cn(
          isCompact ? "space-y-3" : "space-y-6"
        )}>
          {Object.entries(nodesByCategory).map(([category, nodes]) => (
            <motion.div
              key={category}
              layout="position"
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              <AnimatePresence mode="wait">
                {!isCompact && (
                  <motion.h3
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    {categoryLabels[category] || category}
                  </motion.h3>
                )}
              </AnimatePresence>
              <div className={cn(
                isCompact ? "space-y-2" : "space-y-2"
              )}>
                {nodes.map((node) => {
                  const Icon = iconMap[node.icon] || Database;
                  
                  if (isCompact) {
                    // Icon only mode (< 150px)
                    return (
                      <motion.div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, node.type)}
                        title={`${node.label}: ${node.description}`}
                        className={cn(
                          'flex items-center justify-center p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors',
                          categoryColorMap[category]
                        )}
                        layout="position"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      >
                        <div className="p-2 rounded-md bg-background/50">
                          <Icon className="w-5 h-5" />
                        </div>
                      </motion.div>
                    );
                  }
                  
                  if (isCondensed) {
                    // Icon + label only mode (150px - 300px)
                    return (
                      <motion.div
                        key={node.type}
                        draggable
                        onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, node.type)}
                        title={node.description}
                        className={cn(
                          'flex items-center gap-2 p-2.5 rounded-lg border cursor-grab active:cursor-grabbing transition-colors',
                          categoryColorMap[category]
                        )}
                        layout="position"
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                      >
                        <GripVertical className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <div className="p-1.5 rounded-md bg-background/50 flex-shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <p className="font-medium text-xs truncate flex-1 min-w-0">
                          {node.label}
                        </p>
                      </motion.div>
                    );
                  }
                  
                  // Full mode (>= 300px)
                  return (
                    <motion.div
                      key={node.type}
                      draggable
                      onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, node.type)}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-colors',
                        categoryColorMap[category]
                      )}
                      layout="position"
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="p-2 rounded-md bg-background/50 flex-shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{node.label}</p>
                        <AnimatePresence mode="wait">
                          {!isCondensed && !isCompact && (
                            <motion.p
                              className="text-xs text-muted-foreground truncate"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3, ease: "easeInOut" }}
                            >
                              {node.description}
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <AnimatePresence mode="wait">
                {!isCompact && (
                  <motion.div
                    initial={{ opacity: 0, scaleX: 0 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    exit={{ opacity: 0, scaleX: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    style={{ transformOrigin: "left" }}
                  >
                    <Separator className="mt-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
