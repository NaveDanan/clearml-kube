'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { ExecuteNodeData, ExecuteConfig, ExecuteStep } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';
import { getConnectedSourceNode, resolveOutputVariable } from './shared/utils';
import type { PipelineNode, PipelineEdge } from '@/types/pipeline';

// Extended result type for preprocessing
export interface PreprocessingExecutionResult extends NodeExecutionResult {
  outputPath?: string;
  outputPaths?: string[]; // Multiple output paths
  stepResults?: {
    stepId: string;
    stepName: string;
    success: boolean;
    outputPath?: string;
    outputPaths?: string[];
    error?: string;
    stdout?: string;
    stderr?: string;
  }[];
}

// Node content component for preprocessing
function PreprocessingNodeContent({ data }: { data: ExecuteNodeData }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Steps:</span>
        <span className="font-medium">{data.config.steps?.length || 0} configured</span>
      </div>
      {data.config.steps?.slice(0, 2).map((step) => (
        <div key={step.id} className="text-muted-foreground truncate">
          • {step.name}
        </div>
      ))}
      {(data.config.steps?.length || 0) > 2 && (
        <div className="text-muted-foreground">
          +{data.config.steps!.length - 2} more...
        </div>
      )}
      {data.config.inputColumns && data.config.inputColumns.length > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Input:</span>
          <span className="font-medium">{data.config.inputColumns.length} columns</span>
        </div>
      )}
    </div>
  );
}

// Preprocessing node component
function PreprocessingNodeComponent(props: NodeProps) {
  const data = props.data as ExecuteNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <PreprocessingNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const PreprocessingNode = memo(PreprocessingNodeComponent);

// Execute a single preprocessing step
async function executeStep(
  step: ExecuteStep, 
  inputPath: string
): Promise<{
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  error?: string;
  stdout?: string;
  stderr?: string;
  stepId: string;
  stepName: string;
}> {
  try {
    const response = await fetch('/api/preprocessing/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        step,
        inputPath,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `API request failed: ${response.statusText}`,
        stepId: step.id,
        stepName: step.name,
      };
    }

    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      stepId: step.id,
      stepName: step.name,
    };
  }
}

// Execute preprocessing steps
export async function executePreprocessing(
  config: ExecuteConfig, 
  inputPath: string,
  nodes?: PipelineNode[],
  edges?: PipelineEdge[],
  nodeId?: string
): Promise<PreprocessingExecutionResult> {
  // Resolve input path variable if it references a connected node output
  let resolvedInputPath = inputPath;
  
  try {
    if (inputPath && inputPath.includes('{{sourceNode.') && nodes && edges && nodeId) {
      const connectedNode = getConnectedSourceNode(nodeId, nodes, edges);
      
      if (connectedNode) {
        // Try to resolve the variable
        const resolved = resolveOutputVariable(inputPath, connectedNode.node.data as any);
        
        if (resolved) {
          resolvedInputPath = resolved;
        } else {
          return {
            success: false,
            message: `Could not resolve input variable: ${inputPath}. Connected node may not have the specified output.`,
            outputPath: inputPath,
            outputPaths: [inputPath],
          };
        }
      } else {
        return {
          success: false,
          message: `No connected node found to resolve variable: ${inputPath}`,
          outputPath: inputPath,
          outputPaths: [inputPath],
        };
      }
    }
    
    const steps = config.steps || [];
    
    if (steps.length === 0) {
      return { 
        success: false, 
        message: 'No preprocessing steps configured',
        outputPath: resolvedInputPath,
        outputPaths: [resolvedInputPath],
      };
    }

    const enabledSteps = steps.filter((s) => s.enabled);
    
    if (enabledSteps.length === 0) {
      return { 
        success: true, 
        message: 'No enabled preprocessing steps',
        outputPath: resolvedInputPath,
        outputPaths: [resolvedInputPath],
      };
    }

    const stepResults: PreprocessingExecutionResult['stepResults'] = [];
    let currentPath = resolvedInputPath;
    let allOutputPaths: string[] = [];

    // Execute steps sequentially
    for (const step of enabledSteps) {
      const result = await executeStep(step, currentPath);
      stepResults.push(result);

      if (!result.success) {
        return {
          success: false,
          message: `Step "${step.name}" failed: ${result.error}`,
          outputPath: currentPath,
          outputPaths: allOutputPaths.length > 0 ? allOutputPaths : [currentPath],
          stepResults,
          data: {
            stepsExecuted: stepResults.filter(r => r.success).length,
            totalSteps: enabledSteps.length,
            failedStep: step.name,
          },
        };
      }

      // Update the current path for the next step (use first output as primary)
      if (result.outputPath) {
        currentPath = result.outputPath;
      }
      
      // Collect all output paths from this step
      if (result.outputPaths && result.outputPaths.length > 0) {
        allOutputPaths = result.outputPaths;
      } else if (result.outputPath) {
        allOutputPaths = [result.outputPath];
      }
    }

    return {
      success: true,
      message: `Executed ${enabledSteps.length} preprocessing steps`,
      outputPath: currentPath,
      outputPaths: allOutputPaths,
      stepResults,
      data: {
        stepsExecuted: enabledSteps.length,
        totalSteps: steps.length,
        outputPath: currentPath,
        outputPaths: allOutputPaths,
      },
    };
  } catch (error) {
    return { 
      success: false, 
      message: (error as Error).message,
      outputPath: resolvedInputPath,
      outputPaths: [resolvedInputPath],
    };
  }
}
