import { NodeProps } from '@xyflow/react';
import { PipelineNodeData, NodeStatus } from '@/types/pipeline';

// Base node props interface
export interface BaseNodeProps extends NodeProps {
  data: PipelineNodeData & Record<string, unknown>;
}

// Connection check result
export interface ConnectionCheckResult {
  success: boolean;
  fileCount: number;
  error?: string;
}

// Node execution result
export interface NodeExecutionResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// Status icon mapping type
export type StatusIconMap = Record<NodeStatus, React.ComponentType<{ className?: string }>>;

// Category type
export type NodeCategory = 'data' | 'scripts' | 'training' | 'tracking' | 'output';
