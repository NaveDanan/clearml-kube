import {
  Database,
  GitBranch,
  Wand2,
  Cpu,
  FlaskConical,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { NodeStatus } from '@/types/pipeline';

// Icon mapping for node types
export const nodeIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  dataset: Database,
  versioning: GitBranch,
  execute: Wand2,
  training: Cpu,
  experiment: FlaskConical,
  report: FileText,
};

// Icon mapping for node statuses
export const statusIconMap: Record<NodeStatus, React.ComponentType<{ className?: string }>> = {
  idle: AlertCircle,
  running: Loader2,
  completed: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
};

// Re-export icons for convenience
export {
  Database,
  GitBranch,
  Wand2,
  Cpu,
  FlaskConical,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
};
