'use client';

import { useCallback } from 'react';
import { X, Settings, Database, GitBranch, Wand2, Cpu, BarChart3, FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { usePipelineStore } from '@/stores/pipeline-store';
import { TerminalMonitor } from '@/components/ui/terminal-monitor';
import { useSafeBroadcastChange } from '@/components/collaboration';

// Import configuration panels from separate files
import { DatasetConfigPanel } from './dataset-conf-panel';
import { VersioningConfigPanel } from './versioning-conf-panel';
import { ExecuteConfigPanel } from './execute-conf-panel';
import { TrainingConfigPanel } from './training-conf-panel';
import { ExperimentConfigPanel } from './experiment-conf-panel';

import type {
  PipelineNodeData,
  DatasetNodeData,
  VersioningNodeData,
  ExecuteNodeData,
  TrainingNodeData,
  ExperimentNodeData,
  ReportNodeData,
  ReportConfig as ReportConfigType,
} from '@/types/pipeline';

const nodeIcons: Record<string, React.ReactNode> = {
  dataset: <Database className="h-5 w-5" />,
  versioning: <GitBranch className="h-5 w-5" />,
  execute: <Wand2 className="h-5 w-5" />,
  training: <Cpu className="h-5 w-5" />,
  experiment: <BarChart3 className="h-5 w-5" />,
  report: <FileText className="h-5 w-5" />,
};

// Report Configuration Panel
interface ReportConfigPanelProps {
  config: ReportConfigType;
  onUpdate: (updates: Partial<ReportConfigType>) => void;
}

function ReportConfigPanel({ config, onUpdate }: ReportConfigPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="reportTitle">Report Title</Label>
        <Input
          id="reportTitle"
          value={config.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
        />
      </div>
      
      <div className="space-y-2">
        <Label>Output Format</Label>
        <Select value={config.outputFormat} onValueChange={(value) => onUpdate({ outputFormat: value as ReportConfigType['outputFormat'] })}>
          <SelectTrigger>
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="html">HTML</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="markdown">Markdown</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="exportPath">Export Path</Label>
        <Input
          id="exportPath"
          value={config.exportPath || ''}
          onChange={(e) => onUpdate({ exportPath: e.target.value })}
          placeholder="e.g., ./reports/model_report"
        />
      </div>
      
      <Separator />
      <Label className="text-sm font-semibold">Report Sections</Label>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="includeMetrics">Include Metrics</Label>
          <input
            type="checkbox"
            id="includeMetrics"
            checked={config.includeMetrics}
            onChange={(e) => onUpdate({ includeMetrics: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="includeVisualizations">Include Visualizations</Label>
          <input
            type="checkbox"
            id="includeVisualizations"
            checked={config.includeVisualizations}
            onChange={(e) => onUpdate({ includeVisualizations: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="includeModelCard">Include Model Card</Label>
          <input
            type="checkbox"
            id="includeModelCard"
            checked={config.includeModelCard}
            onChange={(e) => onUpdate({ includeModelCard: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
      </div>
      
      <Separator />
      
      <div className="space-y-2">
        <Label>Custom Sections</Label>
        <div className="space-y-2">
          {(!config.customSections || config.customSections.length === 0) ? (
            <p className="text-sm text-muted-foreground">No custom sections</p>
          ) : (
            config.customSections.map((section) => (
              <Card key={section.id} className="p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{section.title}</span>
                  <Badge variant="outline">{section.type}</Badge>
                </div>
              </Card>
            ))
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            const newSection = {
              id: `section-${Date.now()}`,
              title: 'New Section',
              content: '',
              type: 'text' as const,
            };
            onUpdate({ customSections: [...(config.customSections || []), newSection] });
          }}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Section
        </Button>
      </div>
    </div>
  );
}

// Main NodeConfigPanel component
export function NodeConfigPanel() {
  const { nodes, selectedNodeId, selectNode, updateNodeData } = usePipelineStore();
  
  // Get collaboration broadcast function (safe to use outside provider)
  const broadcastPipelineChange = useSafeBroadcastChange();
  
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const nodeData = selectedNode?.data as PipelineNodeData | undefined;
  const nodeType = nodeData?.type;
  
  const handleClose = useCallback(() => {
    selectNode(null);
  }, [selectNode]);
  
  const handleUpdateConfig = useCallback(
    (updates: Record<string, unknown>) => {
      if (!selectedNodeId || !nodeData) return;
      const currentConfig = nodeData.config as Record<string, unknown>;
      const newData = {
        config: { ...currentConfig, ...updates },
      } as unknown as Partial<PipelineNodeData>;
      updateNodeData(selectedNodeId, newData);
      
      // Broadcast to collaborators
      broadcastPipelineChange('node_data', { nodeId: selectedNodeId, data: newData });
    },
    [nodeData, selectedNodeId, updateNodeData, broadcastPipelineChange]
  );
  
  const handleUpdateBase = useCallback(
    (updates: Partial<PipelineNodeData>) => {
      if (!selectedNodeId) return;
      updateNodeData(selectedNodeId, updates);
      
      // Broadcast to collaborators
      broadcastPipelineChange('node_data', { nodeId: selectedNodeId, data: updates });
    },
    [selectedNodeId, updateNodeData, broadcastPipelineChange]
  );
  
  if (!selectedNode || !selectedNodeId || !nodeData) {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b pl-10">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <h2 className="font-semibold text-lg">Configuration</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Select a node to configure
          </p>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            Click on a node in the canvas to view and edit its configuration
          </p>
        </div>
      </div>
    );
  }
  
  // After the guard, nodeData is guaranteed to exist, so nodeType is defined
  const safeNodeType = nodeData.type;
  
  const renderConfigPanel = () => {
    switch (safeNodeType) {
      case 'dataset':
        return (
          <DatasetConfigPanel
            config={(nodeData as DatasetNodeData).config}
            onUpdate={handleUpdateConfig}
            nodeId={selectedNodeId}
          />
        );
      case 'versioning':
        return (
          <VersioningConfigPanel
            config={(nodeData as VersioningNodeData).config}
            onUpdate={handleUpdateConfig}
            nodeId={selectedNodeId}
          />
        );
      case 'execute':
        return (
          <ExecuteConfigPanel
            config={(nodeData as ExecuteNodeData).config}
            onUpdate={handleUpdateConfig}
            nodeId={selectedNodeId}
          />
        );
      case 'training':
        return (
          <TrainingConfigPanel
            config={(nodeData as TrainingNodeData).config}
            onUpdate={handleUpdateConfig}
            nodeId={selectedNodeId}
          />
        );
      case 'experiment':
        return (
          <ExperimentConfigPanel
            config={(nodeData as ExperimentNodeData).config}
            onUpdate={handleUpdateConfig}
          />
        );
      case 'report':
        return (
          <ReportConfigPanel
            config={(nodeData as ReportNodeData).config}
            onUpdate={handleUpdateConfig}
          />
        );
      default:
        return <div>Unknown node type</div>;
    }
  };
  
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b pl-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {nodeIcons[safeNodeType]}
            <h2 className="font-semibold text-lg">
              {safeNodeType.charAt(0).toUpperCase() + safeNodeType.slice(1)} Node
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="outline" className="w-fit mt-1">
          ID: {selectedNodeId}
        </Badge>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <Tabs defaultValue="config" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="config">Configuration</TabsTrigger>
              <TabsTrigger value="general">General</TabsTrigger>
            </TabsList>
            
            <TabsContent value="config" className="mt-4 space-y-4">
              {renderConfigPanel()}
            </TabsContent>
            
            <TabsContent value="general" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={nodeData.label}
                  onChange={(e) => handleUpdateBase({ label: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={nodeData.description}
                  onChange={(e) => handleUpdateBase({ description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Status</Label>
                  <Badge variant={nodeData.status === 'completed' ? 'default' : 'secondary'}>
                    {nodeData.status}
                  </Badge>
                </div>
              </div>
              
              {/* Terminal Output Monitor Section */}
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Execution Output</Label>
                {nodeData.executionLogs ? (
                  <TerminalMonitor 
                    logs={nodeData.executionLogs}
                    isExecuting={nodeData.status === 'running'}
                    maxHeight="h-80"
                  />
                ) : (
                  <div className="border rounded-lg bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">
                      {nodeData.status === 'running' 
                        ? 'Waiting for execution output...' 
                        : 'No execution output available. Execute this node to see logs here.'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
