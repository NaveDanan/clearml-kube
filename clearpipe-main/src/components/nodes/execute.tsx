'use client';

import React, { memo } from 'react';
import { NodeProps } from '@xyflow/react';
import { ExecuteNodeData, ExecuteConfig, ExecuteStep } from '@/types/pipeline';
import { BaseNodeComponent } from './base-node-component';
import { NodeExecutionResult } from './shared/types';

// Extended result type for execute
export interface ExecuteExecutionResult extends NodeExecutionResult {
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

// Node content component for execute
function ExecuteNodeContent({ data }: { data: ExecuteNodeData }) {
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

// Execute node component
function ExecuteNodeComponent(props: NodeProps) {
  const data = props.data as ExecuteNodeData & Record<string, unknown>;
  
  return (
    <BaseNodeComponent {...props} data={data}>
      <ExecuteNodeContent data={data} />
    </BaseNodeComponent>
  );
}

export const ExecuteNode = memo(ExecuteNodeComponent);

// Execute a single step
async function executeStep(
  step: ExecuteStep, 
  inputPath: string,
  sourceNodeOutputs?: Record<string, unknown>
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
    const response = await fetch('/api/execute/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        step,
        inputPath,
        sourceNodeOutputs,
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

// Execute steps
export async function runExecute(
  config: ExecuteConfig, 
  inputPath: string,
  sourceNodeOutputs?: Record<string, unknown>
): Promise<ExecuteExecutionResult> {
  try {
    const steps = config.steps || [];
    
    if (steps.length === 0) {
      return { 
        success: false, 
        message: 'No execute steps configured',
        outputPath: inputPath,
        outputPaths: [inputPath],
      };
    }

    const enabledSteps = steps.filter((s) => s.enabled);
    
    if (enabledSteps.length === 0) {
      return { 
        success: true, 
        message: 'No enabled execute steps',
        outputPath: inputPath,
        outputPaths: [inputPath],
      };
    }

    const stepResults: ExecuteExecutionResult['stepResults'] = [];
    let currentPath = inputPath;
    let allOutputPaths: string[] = [];
    // Build source outputs for subsequent steps (include original source outputs + step outputs)
    let currentSourceOutputs: Record<string, unknown> = { 
      ...sourceNodeOutputs,
      outputPath: inputPath 
    };

    // Execute steps sequentially
    for (const step of enabledSteps) {
      const result = await executeStep(step, currentPath, currentSourceOutputs);
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
      
      // Update source outputs for next step (include this step's outputs)
      currentSourceOutputs = {
        ...currentSourceOutputs,
        outputPath: currentPath,
        outputPaths: allOutputPaths,
      };
    }

    return {
      success: true,
      message: `Executed ${enabledSteps.length} steps`,
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
      outputPath: inputPath,
      outputPaths: [inputPath],
    };
  }
}
