'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { DatasetNodeData, DatasetConfig } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { formatToRegexPattern, extensionMap } from './shared/utils';
import { ConnectionCheckResult, NodeExecutionResult } from './shared/types';

// Extended result type for dataset operations
export interface DatasetExecutionResult extends NodeExecutionResult {
  datasetId?: string;
  datasetName?: string;
  version?: string;
  outputPath?: string;
  localPath?: string;
  filesDownloaded?: number;
}

// Node content component for dataset
function DatasetNodeContent({ data }: { data: DatasetNodeData }) {
  const regexPattern = formatToRegexPattern(data.config.format);
  const formatDisplay = Array.isArray(data.config.format) 
    ? data.config.format.join(', ')
    : data.config.format || 'Not set';
  
  // Check if using ClearML with a selected dataset
  const isClearML = data.config.source === 'clearml';
  const hasSelectedDataset = isClearML && data.config.selectedDataset;
  const executionModeDisplay = data.config.executionMode === 'cloud' ? '☁️ Cloud' : '💻 Local';
  
  return (
    <div className="space-y-1 text-xs">
      {/* Mode first */}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Mode:</span>
        <span className="font-medium">{executionModeDisplay}</span>
      </div>
      
      {/* Show ClearML dataset info if selected */}
      {hasSelectedDataset && (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Dataset:</span>
            <span className="font-medium truncate max-w-[120px]" title={`${(data.config.selectedDataset as any).projectName || data.config.selectedDataset!.project} → ${data.config.selectedDataset!.name}`}>
              {(() => {
                const fullPath = (data.config.selectedDataset as any).projectName || data.config.selectedDataset!.project;
                const shortProject = fullPath.split('/').pop() || fullPath;
                return `${shortProject} → ${data.config.selectedDataset!.name}`;
              })()}
            </span>
          </div>
          {data.config.selectedDataset!.version && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version:</span>
              <span className="font-medium">v{data.config.selectedDataset!.version}</span>
            </div>
          )}
        </>
      )}
      
      {/* Show format for non-ClearML sources or when no dataset selected */}
      {(!isClearML || !hasSelectedDataset) && (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Format:</span>
            <span className="font-medium">{formatDisplay}</span>
          </div>
          {regexPattern && (
            <div className="text-[10px] text-muted-foreground break-all">
              <span className="text-muted-foreground">Filter: </span>
              <span className="font-mono">{regexPattern}</span>
            </div>
          )}
          {data.config.path && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Path:</span>
              <span className="font-medium truncate max-w-[150px]">{data.config.path}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Dataset node component
function DatasetNodeComponent(props: NodeProps) {
  const data = props.data as DatasetNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <DatasetNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const DatasetNode = memo(DatasetNodeComponent);

// Utility function to check dataset connection and count files
export async function checkDatasetConnection(config: any): Promise<ConnectionCheckResult> {
  try {
    // Check if path is provided (except for ClearML which uses datasetId or selectedDatasetId)
    if (!config.path && config.source !== 'clearml') {
      return { success: false, fileCount: 0, error: 'Path not configured' };
    }

    // For ClearML, check if we have a dataset selected
    if (config.source === 'clearml') {
      const datasetId = config.selectedDatasetId || config.datasetId;
      if (!datasetId && !config.datasetProject) {
        return { success: false, fileCount: 0, error: 'ClearML Dataset not selected' };
      }
    }

    // Call the API endpoint to check dataset connection
    const response = await fetch('/api/dataset/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: config.source,
        path: config.path,
        format: config.format,
        // S3/MinIO specific
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        // Azure specific
        container: config.container,
        // ClearML specific
        datasetId: config.selectedDatasetId || config.datasetId,
        datasetProject: config.datasetProject,
        connectionId: config.connectionId,
        // Credentials
        credentials: config.credentials,
      }),
    });

    if (!response.ok) {
      return { 
        success: false, 
        fileCount: 0, 
        error: `API request failed: ${response.statusText}` 
      };
    }

    const result = await response.json();
    return {
      success: result.success,
      fileCount: result.fileCount,
      error: result.error,
    };
  } catch (error) {
    return { success: false, fileCount: 0, error: (error as Error).message };
  }
}

// Fetch/download ClearML dataset using the SDK
export async function fetchClearMLDataset(
  config: DatasetConfig
): Promise<DatasetExecutionResult> {
  try {
    // Validate config
    const datasetId = config.selectedDatasetId || config.datasetId;
    if (!datasetId) {
      return { success: false, message: 'ClearML Dataset not selected' };
    }

    if (!config.connectionId) {
      return { success: false, message: 'ClearML connection not configured' };
    }

    // Determine action: 'download' for read-only cached copy, 'use' for mutable copy
    const action = config.clearmlAction === 'use' ? 'download' : 'download';
    // Note: The Python SDK uses Dataset.get() for both - the difference is in how we handle the result
    // For now, both actions use the 'download' action which caches/downloads the dataset

    // Call the versioning/run API to fetch the dataset
    const response = await fetch('/api/versioning/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'clearml-data',
        action: 'download',
        connectionId: config.connectionId,
        datasetId: datasetId,
        datasetName: config.selectedDataset?.name,
        datasetProject: config.selectedDataset?.project,
        outputPath: config.outputPath,
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
      message: result.message || 'Dataset fetched successfully',
      datasetId: result.datasetId || datasetId,
      datasetName: result.datasetName || config.selectedDataset?.name,
      version: config.selectedDataset?.version,
      outputPath: result.outputPath,
      localPath: result.outputPath,
      filesDownloaded: result.filesDownloaded,
      data: result,
    };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

// Execute dataset node - handles both checking and fetching
export async function executeDataset(
  config: DatasetConfig
): Promise<DatasetExecutionResult> {
  // For ClearML sources, fetch the dataset
  if (config.source === 'clearml' && (config.selectedDatasetId || config.datasetId)) {
    return fetchClearMLDataset(config);
  }

  // For other sources, just check the connection (data is accessed directly)
  const checkResult = await checkDatasetConnection(config);
  
  if (!checkResult.success) {
    return { 
      success: false, 
      message: checkResult.error || 'Failed to access dataset' 
    };
  }

  return {
    success: true,
    message: `Dataset accessible with ${checkResult.fileCount} file(s)`,
    outputPath: config.path,
    data: { ...checkResult },
  };
}
