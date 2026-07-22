'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { 
  TrainingNodeData, 
  TrainingConfig, 
  DetectedParam,
  GitRepoConfig,
} from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';

// Node content component for training - shows summary of configuration
function TrainingNodeContent({ data }: { data: TrainingNodeData }) {
  const config = data.config;
  
  // Get script display info
  const getScriptDisplay = () => {
    if (config.scriptSource === 'git' && config.gitConfig) {
      const repoName = config.gitConfig.repoUrl?.split('/').pop()?.replace('.git', '') || 'repo';
      return `${repoName}/${config.gitConfig.entryScript || 'train.py'}`;
    } else if (config.localScriptPath) {
      const parts = config.localScriptPath.split(/[/\\]/);
      return parts[parts.length - 1] || 'Not set';
    }
    return 'Not configured';
  };

  // Count configured parameters
  const paramCount = Object.keys(config.parameterValues || {}).length;
  const detectedCount = config.detectedParams?.length || 0;

  // Get execution mode display
  const getExecutionDisplay = () => {
    if (config.executionMode === 'cloud') {
      const provider = config.cloudProvider?.toUpperCase() || 'Cloud';
      const instance = config.instanceType || '';
      return `${provider} ${instance}`.trim();
    }
    return 'Local';
  };

  // Get job status display
  const getStatusDisplay = () => {
    if (config.jobStatus) {
      const statusMap: Record<string, string> = {
        pending: '⏳ Pending',
        cloning: '📥 Cloning repo...',
        setup: '🔧 Setting up env...',
        training: '🏃 Training...',
        completed: '✅ Completed',
        failed: '❌ Failed',
        cancelled: '🚫 Cancelled',
      };
      return statusMap[config.jobStatus] || config.jobStatus;
    }
    return null;
  };

  // Get progress display
  const getProgressDisplay = () => {
    if (config.jobProgress) {
      const { currentEpoch, totalEpochs, metrics } = config.jobProgress;
      if (currentEpoch !== undefined && totalEpochs !== undefined) {
        const progress = `Epoch ${currentEpoch}/${totalEpochs}`;
        if (metrics?.loss !== undefined) {
          return `${progress} • Loss: ${metrics.loss.toFixed(4)}`;
        }
        return progress;
      }
    }
    return null;
  };

  const statusDisplay = getStatusDisplay();
  const progressDisplay = getProgressDisplay();

  return (
    <div className="space-y-1.5 text-xs">
      {/* Script Info */}
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">Script:</span>
        <span className="font-medium truncate max-w-[140px]" title={getScriptDisplay()}>
          {getScriptDisplay()}
        </span>
      </div>

      {/* Framework */}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Framework:</span>
        <span className="font-medium capitalize">{config.framework || 'Not set'}</span>
      </div>

      {/* Execution Mode */}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Execution:</span>
        <span className="font-medium">{getExecutionDisplay()}</span>
      </div>

      {/* Parameters */}
      {(detectedCount > 0 || paramCount > 0) && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Parameters:</span>
          <span className="font-medium">
            {paramCount} / {detectedCount} configured
          </span>
        </div>
      )}

      {/* Job Status */}
      {statusDisplay && (
        <div className="pt-1 border-t border-border/50">
          <div className="text-center font-medium">{statusDisplay}</div>
          {progressDisplay && (
            <div className="text-center text-muted-foreground text-[10px] mt-0.5">
              {progressDisplay}
            </div>
          )}
        </div>
      )}

      {/* Quick metrics display when completed */}
      {config.jobStatus === 'completed' && config.jobProgress?.metrics && (
        <div className="pt-1 border-t border-border/50 grid grid-cols-2 gap-1">
          {Object.entries(config.jobProgress.metrics).slice(0, 4).map(([key, value]) => (
            <div key={key} className="text-center">
              <div className="text-[10px] text-muted-foreground capitalize">{key}</div>
              <div className="font-mono text-xs">{typeof value === 'number' ? value.toFixed(4) : value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Training node component
function TrainingNodeComponent(props: NodeProps) {
  const data = props.data as TrainingNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <TrainingNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const TrainingNode = memo(TrainingNodeComponent);

// ============================================================================
// Training Execution Functions
// ============================================================================

/**
 * Clone a git repository for training
 */
export async function cloneTrainingRepo(
  gitConfig: GitRepoConfig,
  authToken?: string
): Promise<{ success: boolean; localPath?: string; error?: string }> {
  try {
    const response = await fetch('/api/training/clone-repo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoUrl: gitConfig.repoUrl,
        branch: gitConfig.branch,
        commitId: gitConfig.commitId,
        authToken: authToken,
      }),
    });

    const result = await response.json();
    return {
      success: result.success,
      localPath: result.localPath,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clone repository',
    };
  }
}

/**
 * Parse a training script to detect parameters
 */
export async function parseTrainingScript(
  scriptPath?: string,
  scriptContent?: string
): Promise<{ success: boolean; params?: DetectedParam[]; framework?: string; error?: string }> {
  try {
    const response = await fetch('/api/training/parse-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptPath,
        scriptContent,
      }),
    });

    const result = await response.json();
    return {
      success: result.success,
      params: result.params,
      framework: result.framework,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to parse script',
    };
  }
}

/**
 * Execute training job
 */
export async function executeTraining(
  config: TrainingConfig,
  inputPath?: string,
  sourceNodeOutputs?: Record<string, string>
): Promise<NodeExecutionResult> {
  try {
    const jobId = `training_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Step 1: If git source, clone the repo first
    let clonedRepoPath: string | undefined;
    
    if (config.scriptSource === 'git' && config.gitConfig) {
      // Get auth token from connection if available
      // Note: In production, this would fetch from the connections API
      const authToken = config.gitConfig.connectionId 
        ? undefined // Would fetch from connections API
        : undefined;
      
      const cloneResult = await cloneTrainingRepo(config.gitConfig, authToken);
      
      if (!cloneResult.success) {
        return {
          success: false,
          message: `Failed to clone repository: ${cloneResult.error}`,
        };
      }
      
      clonedRepoPath = cloneResult.localPath;
    }

    // Step 2: Start the training job
    const response = await fetch('/api/training/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        scriptSource: config.scriptSource,
        localScriptPath: config.localScriptPath,
        clonedRepoPath,
        entryScript: config.gitConfig?.entryScript,
        parameterValues: config.parameterValues || {},
        venvConfig: config.venvConfig,
        dataSourceMappings: config.dataSourceMappings,
        inputPath,
        sourceNodeOutputs,
        outputPath: config.outputPath,
        modelOutputPath: config.modelOutputPath,
        checkpointPath: config.checkpointPath,
        executionMode: config.executionMode,
        cloudProvider: config.cloudProvider,
        instanceType: config.instanceType,
        connectionId: config.connectionId,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'Training failed to start',
      };
    }

    return {
      success: true,
      message: `Training job started (${jobId})`,
      data: {
        jobId,
        status: result.status,
        logs: result.logs,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Poll training job status
 */
export async function getTrainingStatus(jobId: string): Promise<{
  success: boolean;
  status?: string;
  logs?: string[];
  duration?: number;
  exitCode?: number;
  error?: string;
}> {
  try {
    const response = await fetch(`/api/training/run?jobId=${encodeURIComponent(jobId)}`);
    const result = await response.json();
    
    return {
      success: result.success,
      status: result.status,
      logs: result.logs,
      duration: result.duration,
      exitCode: result.exitCode,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get status',
    };
  }
}

/**
 * Cancel a running training job
 */
export async function cancelTraining(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/training/run?jobId=${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    
    return {
      success: result.success,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel job',
    };
  }
}

/**
 * Validate cloud credentials for training
 */
export function validateCloudCredentials(config: TrainingConfig): boolean {
  if (config.executionMode === 'local') {
    return true;
  }

  // If using a connection, assume it's valid (connection validation happens elsewhere)
  if (config.connectionId) {
    return true;
  }

  // Legacy credential validation
  const creds = config.credentials || {};
  
  switch (config.cloudProvider) {
    case 'gcp':
      return !!(creds.gcpProjectId && creds.gcpServiceAccountKey);
    case 'aws':
      return !!(creds.awsAccessKeyId && creds.awsSecretAccessKey);
    case 'azure':
      return !!(creds.azureSubscriptionId && creds.azureClientId && creds.azureClientSecret);
    default:
      return true;
  }
}

/**
 * Get list of branches for a git repository
 */
export async function listGitBranches(
  repoUrl: string,
  authToken?: string
): Promise<{ success: boolean; branches?: string[]; error?: string }> {
  try {
    const params = new URLSearchParams({ repoUrl });
    if (authToken) {
      params.append('authToken', authToken);
    }
    
    const response = await fetch(`/api/training/clone-repo?${params.toString()}`);
    const result = await response.json();
    
    return {
      success: result.success,
      branches: result.branches,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list branches',
    };
  }
}
