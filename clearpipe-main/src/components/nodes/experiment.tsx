'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { Badge } from '@/components/ui/badge';
import { ExperimentNodeData } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';

// Node content component for experiment tracking
function ExperimentNodeContent({ data }: { data: ExperimentNodeData }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Tracker:</span>
        <span className="font-medium">{data.config.tracker}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Project:</span>
        <span className="font-medium truncate max-w-[150px]">
          {data.config.projectName || 'Not set'}
        </span>
      </div>
      {data.config.experimentName && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Experiment:</span>
          <span className="font-medium truncate max-w-[150px]">
            {data.config.experimentName}
          </span>
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        {data.config.logMetrics && (
          <Badge variant="secondary" className="text-[10px] px-1">Metrics</Badge>
        )}
        {data.config.logArtifacts && (
          <Badge variant="secondary" className="text-[10px] px-1">Artifacts</Badge>
        )}
        {data.config.logHyperparameters && (
          <Badge variant="secondary" className="text-[10px] px-1">Params</Badge>
        )}
      </div>
      {data.config.tags && data.config.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-1">
          {data.config.tags.slice(0, 3).map((tag, idx) => (
            <Badge key={idx} variant="outline" className="text-[10px] px-1">
              {tag}
            </Badge>
          ))}
          {data.config.tags.length > 3 && (
            <span className="text-muted-foreground text-[10px]">
              +{data.config.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Experiment node component
function ExperimentNodeComponent(props: NodeProps) {
  const data = props.data as ExperimentNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <ExperimentNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const ExperimentNode = memo(ExperimentNodeComponent);

// Execute experiment tracking initialization
export async function executeExperiment(config: any): Promise<NodeExecutionResult> {
  try {
    // Check tracker configuration
    if (config.tracker === 'none') {
      return { success: true, message: 'Experiment tracking disabled' };
    }

    if (!config.projectName) {
      return { success: false, message: 'Project name not configured' };
    }

    // Validate credentials based on tracker
    const credentialsValid = validateTrackerCredentials(config);
    if (!credentialsValid) {
      return { 
        success: false, 
        message: `${config.tracker} credentials not configured` 
      };
    }

    // Simulate experiment initialization
    await new Promise(resolve => setTimeout(resolve, 800));

    const experimentId = `exp_${Math.random().toString(36).substring(2, 10)}`;

    return {
      success: true,
      message: `Experiment initialized: ${experimentId}`,
      data: {
        tracker: config.tracker,
        projectName: config.projectName,
        experimentId,
        experimentName: config.experimentName || experimentId,
      },
    };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

// Validate tracker credentials
function validateTrackerCredentials(config: any): boolean {
  const creds = config.credentials || {};
  
  switch (config.tracker) {
    case 'clearml':
      return !!(creds.clearmlAccessKey && creds.clearmlSecretKey);
    case 'mlflow':
      return !!creds.mlflowTrackingUri;
    case 'wandb':
      return !!creds.wandbApiKey;
    case 'comet':
      return !!creds.cometApiKey;
    default:
      return true;
  }
}
