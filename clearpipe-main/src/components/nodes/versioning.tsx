'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { VersioningNodeData, VersioningConfig, PipelineNode, PipelineEdge } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';
import { getConnectedSourceNode, resolveOutputVariable } from './shared/utils';

// Extended result type for versioning
export interface VersioningExecutionResult extends NodeExecutionResult {
  datasetId?: string;
  datasetName?: string;
  version?: string;
  commitHash?: string;
  outputPath?: string;
  inputPath?: string; // Single input path (for backward compatibility)
  inputPaths?: string[]; // Multiple input paths (data paths used)
  // For auto-version feature: indicates config should be updated after create
  shouldSwitchToVersion?: boolean;
  createdDataset?: {
    id: string;
    name: string;
    project: string;
  };
  datasets?: Array<{
    id: string;
    name: string;
    project: string;
    version?: string;
    tags?: string[];
    createdAt?: string;
    fileCount?: number;
    totalSize?: number;
  }>;
}

// Node content component for versioning
function VersioningNodeContent({ data }: { data: VersioningNodeData }) {
  const executionModeDisplay = data.config.executionMode === 'cloud' ? '☁️ Cloud' : '💻 Local';
  
  // Action display mapping
  const actionDisplay: Record<string, string> = {
    list: '📋 List',
    download: '⬇️ Download',
    version: '📤 Version',
    create: '➕ Create',
  };
  
  return (
    <div className="space-y-1 text-xs">
      {/* Mode first */}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Mode:</span>
        <span className="font-medium">{executionModeDisplay}</span>
      </div>
      {/* Tool - only show in local mode or if explicitly set */}
      {(data.config.executionMode === 'local' || !data.config.connectionId) && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tool:</span>
          <span className="font-medium">{data.config.tool || 'Not set'}</span>
        </div>
      )}
      {/* Action - show for cloud mode with connection */}
      {data.config.executionMode === 'cloud' && data.config.connectionId && data.config.clearmlAction && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Action:</span>
          <span className="font-medium">{actionDisplay[data.config.clearmlAction] || data.config.clearmlAction}</span>
        </div>
      )}
      {data.config.selectedDataset && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Dataset:</span>
          <span className="font-medium truncate max-w-[120px]" title={`${(data.config.selectedDataset as any).projectName || data.config.selectedDataset.project} → ${data.config.selectedDataset.name}`}>
            {(() => {
              const fullPath = (data.config.selectedDataset as any).projectName || data.config.selectedDataset.project;
              const shortProject = fullPath.split('/').pop() || fullPath;
              return `${shortProject} → ${data.config.selectedDataset.name}`;
            })()}
          </span>
        </div>
      )}
      {data.config.version && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Version:</span>
          <span className="font-medium">{data.config.version}</span>
        </div>
      )}
      {data.config.commitHash && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Commit:</span>
          <span className="font-medium font-mono text-[10px]">
            {data.config.commitHash.substring(0, 7)}
          </span>
        </div>
      )}
      {data.config.remoteUrl && !data.config.selectedDataset && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remote:</span>
          <span className="font-medium truncate max-w-[150px]">{data.config.remoteUrl}</span>
        </div>
      )}
    </div>
  );
}

// Versioning node component
function VersioningNodeComponent(props: NodeProps) {
  const data = props.data as VersioningNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <VersioningNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const VersioningNode = memo(VersioningNodeComponent);

// List ClearML datasets
export async function listClearMLDatasets(
  config: VersioningConfig
): Promise<VersioningExecutionResult> {
  try {
    const response = await fetch('/api/versioning/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        connectionId: config.connectionId,
        credentials: config.credentials,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { 
        success: false, 
        message: error.error || `API request failed: ${response.statusText}` 
      };
    }

    const result = await response.json();
    return {
      success: true,
      message: `Found ${result.datasets?.length || 0} datasets`,
      datasets: result.datasets,
    };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

// Execute versioning node
export async function executeVersioning(
  config: VersioningConfig,
  inputPath?: string,
  nodes?: PipelineNode[],
  edges?: PipelineEdge[],
  nodeId?: string,
  sourceNodeOutputs?: Record<string, string> // Runtime outputs from the source node
): Promise<VersioningExecutionResult> {
  try {
    // Check if tool is configured
    if (!config.tool) {
      return { success: false, message: 'Versioning tool not configured' };
    }

    // Resolve input path variable if it references a connected node output
    let resolvedInputPath = inputPath || config.inputPath;
    
    if (resolvedInputPath && resolvedInputPath.includes('{{sourceNode.') && nodes && edges && nodeId) {
      const connectedNode = getConnectedSourceNode(nodeId, nodes, edges);
      
      if (connectedNode) {
        // Pass runtime outputs to resolveOutputVariable
        const resolved = resolveOutputVariable(resolvedInputPath, connectedNode.node.data as any, sourceNodeOutputs);
        
        if (resolved) {
          resolvedInputPath = resolved;
        } else {
          // Check if the variable is defined in source node's step output variables (for Execute nodes)
          // If so, it means the variable is valid but we don't have a runtime value
          const varMatch = resolvedInputPath.match(/\{\{sourceNode\.(\w+)\}\}/);
          const varName = varMatch ? varMatch[1] : null;
          
          if (varName && connectedNode.node.data.type === 'execute') {
            const executeConfig = (connectedNode.node.data as any).config;
            const steps = executeConfig?.steps || [];
            const isDefinedInSteps = steps.some((step: any) => 
              step.outputVariables?.includes(varName)
            );
            
            if (isDefinedInSteps && !sourceNodeOutputs) {
              return {
                success: false,
                message: `Variable ${resolvedInputPath} is defined in the Execute node but no runtime value is available. Make sure to run the Execute node first.`,
              };
            }
          }
          
          return {
            success: false,
            message: `Could not resolve input variable: ${resolvedInputPath}. Connected node may not have the specified output.`,
          };
        }
      }
    }

    // Resolve multiple input paths if available
    let resolvedInputPaths: string[] = [];
    if (config.inputPaths && config.inputPaths.length > 0) {
      for (const path of config.inputPaths) {
        if (path.includes('{{sourceNode.') && nodes && edges && nodeId) {
          const connectedNode = getConnectedSourceNode(nodeId, nodes, edges);
          if (connectedNode) {
            // Pass runtime outputs to resolveOutputVariable
            const resolved = resolveOutputVariable(path, connectedNode.node.data as any, sourceNodeOutputs);
            if (resolved) {
              resolvedInputPaths.push(resolved);
            } else {
              resolvedInputPaths.push(path); // Keep original if can't resolve
            }
          } else {
            resolvedInputPaths.push(path);
          }
        } else {
          resolvedInputPaths.push(path);
        }
      }
    } else if (resolvedInputPath) {
      resolvedInputPaths = [resolvedInputPath];
    }

    // For ClearML Data tool
    if (config.tool === 'clearml-data') {
      const response = await fetch('/api/versioning/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: config.tool,
          action: config.clearmlAction,
          connectionId: config.connectionId,
          credentials: config.credentials,
          datasetId: config.selectedDatasetId,
          datasetName: config.newDatasetName || config.selectedDataset?.name,
          datasetProject: config.newDatasetProject || config.selectedDataset?.project,
          inputPath: resolvedInputPath,
          inputPaths: resolvedInputPaths,
          outputPath: config.outputPath,
          version: config.version,
          tags: config.datasetTags,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        return { 
          success: false, 
          message: error.error || `API request failed: ${response.statusText}` 
        };
      }

      const result = await response.json();
      
      // Determine if we should switch to version mode after create
      const shouldSwitchToVersion = 
        config.clearmlAction === 'create' && 
        config.autoVersionAfterCreate === true && 
        result.datasetId;
      
      return {
        success: true,
        message: result.message || `Versioning operation completed`,
        datasetId: result.datasetId,
        datasetName: result.datasetName || config.newDatasetName,
        version: result.version,
        outputPath: result.outputPath || config.outputPath,
        inputPath: resolvedInputPath,
        inputPaths: resolvedInputPaths,
        shouldSwitchToVersion,
        createdDataset: shouldSwitchToVersion ? {
          id: result.datasetId,
          name: result.datasetName || config.newDatasetName || '',
          project: result.datasetProject || config.newDatasetProject || '',
        } : undefined,
        data: result,
      };
    }

    // For other tools (DVC, Git LFS, etc.) - basic implementation
    const response = await fetch('/api/versioning/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: config.tool,
        executionMode: config.executionMode,
        connectionId: config.connectionId,
        version: config.version,
        remoteUrl: config.remoteUrl,
        inputPath: resolvedInputPath,
        credentials: config.credentials,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return { 
        success: false, 
        message: error.error || `API request failed: ${response.statusText}` 
      };
    }

    const result = await response.json();
    return {
      success: true,
      message: result.message || `Version ${config.version} created`,
      version: result.version,
      commitHash: result.commitHash,
      data: result,
    };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}
