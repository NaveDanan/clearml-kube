import { Node, Edge } from '@xyflow/react';

// Node status types
export type NodeStatus = 'idle' | 'running' | 'completed' | 'error' | 'warning';

// Cloud providers
export type CloudProvider = 'gcp' | 'aws' | 'azure' | 'local';

// Experiment trackers
export type ExperimentTracker = 'clearml' | 'mlflow' | 'wandb' | 'comet' | 'none';

// ML Frameworks
export type MLFramework = 'pytorch' | 'tensorflow' | 'sklearn' | 'xgboost' | 'lightgbm' | 'custom';

// Git providers for training scripts
export type GitProvider = 'github' | 'gitlab' | 'dagshub' | 'azure-devops' | 'bitbucket' | 'custom';

// Training script source type
export type TrainingScriptSource = 'local' | 'git';

// Detected parameter definition from script parsing
export interface DetectedParam {
  name: string;
  type: 'int' | 'float' | 'str' | 'bool' | 'list' | 'unknown';
  default?: string | number | boolean | null;
  help?: string;
  choices?: (string | number)[];
  required?: boolean;
  source: 'argparse' | 'hyperparameter' | 'env' | 'config';
  // Range values for hyperparameters (like YOLOv7 meta format)
  min?: number;
  max?: number;
}

// Terminal output log entry
export interface TerminalLogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
}

// Execution logs for a node
export interface ExecutionLogs {
  startTime?: string;
  endTime?: string;
  duration?: number; // in milliseconds
  exitCode?: number;
  logs: TerminalLogEntry[];
}

// Base node data interface
export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  status: NodeStatus;
  statusMessage?: string;
  lastUpdated?: string;
  // Terminal output and execution logs
  terminalOutput?: string[]; // Raw terminal output lines for backward compatibility
  executionLogs?: ExecutionLogs; // Structured execution logs with timestamps and types
}

// Dataset node configuration
export interface DatasetNodeData extends BaseNodeData {
  type: 'dataset';
  config: DatasetConfig;
}

export interface DatasetConfig {
  [key: string]: unknown;
  // Execution mode: local or cloud
  executionMode?: 'local' | 'cloud';
  source: 'local' | 's3' | 'gcs' | 'azure-blob' | 'minio' | 'clearml' | 'url';
  pathMode?: 'direct' | 'folder-regex'; // 'direct' for single file, 'folder-regex' for folder + regex pattern
  path: string; // For 'direct' mode: direct file path; for 'folder-regex': folder path
  filePattern?: string; // Regex pattern for 'folder-regex' mode (e.g., ".*\.csv$")
  format: string | string[];
  // Reference to a saved connection from settings
  connectionId?: string;
  // S3/MinIO specific
  bucket?: string;
  region?: string;
  endpoint?: string; // For MinIO custom endpoint
  // Azure specific
  container?: string;
  // ClearML specific - dataset selection
  datasetId?: string;
  datasetProject?: string;
  selectedDatasetId?: string;
  selectedDataset?: ClearMLDatasetInfo;
  selectedFilePath?: string; // Selected file/folder path within the ClearML dataset
  clearmlAction?: 'list' | 'download' | 'use'; // 'list' = browse, 'download' = fetch to local, 'use' = get mutable copy
  outputPath?: string; // Local path for downloaded dataset
  // Credentials for all cloud providers
  credentials?: {
    // AWS S3 / MinIO
    accessKey?: string;
    secretKey?: string;
    // Azure Blob Storage
    connectionString?: string;
    accountName?: string;
    accountKey?: string;
    sasToken?: string;
    // Google Cloud Storage
    projectId?: string;
    serviceAccountKey?: string; // JSON key file content
    // ClearML
    clearmlApiHost?: string;
    clearmlWebHost?: string;
    clearmlFilesHost?: string;
    clearmlAccessKey?: string;
    clearmlSecretKey?: string;
  };
  preview?: {
    columns: string[];
    rows: number;
    sampleData?: Record<string, unknown>[];
  };
  matchedFiles?: string[]; // For 'folder-regex' mode: list of matched files
}

// Versioning node configuration
export interface VersioningNodeData extends BaseNodeData {
  type: 'versioning';
  config: VersioningConfig;
}

// ClearML dataset info
export interface ClearMLDatasetInfo {
  id: string;
  name: string;
  project: string;
  projectName?: string; // Human-readable project name
  version?: string;
  tags?: string[];
  createdAt?: string;
  fileCount?: number;
  totalSize?: number;
}

export interface VersioningConfig {
  [key: string]: unknown;
  tool: 'dvc' | 'git-lfs' | 'clearml-data' | 'mlflow-artifacts' | 'custom';
  // Execution mode
  executionMode: 'local' | 'cloud';
  // Connection ID for cloud execution (reference to a saved connection from settings)
  connectionId?: string;
  // Version information
  version: string;
  commitHash?: string;
  remoteUrl?: string;
  // ClearML specific
  clearmlAction?: 'list' | 'version' | 'create' | 'download';
  selectedDatasetId?: string;
  selectedDataset?: ClearMLDatasetInfo;
  newDatasetName?: string;
  newDatasetProject?: string;
  datasetTags?: string[];
  autoVersionAfterCreate?: boolean; // When true, after first run with 'create', switch to 'version' mode
  // Input/output paths
  inputPath?: string; // Path to data to version (for create/version actions)
  inputPaths?: string[]; // Multiple paths to data (for create action with multiple sources)
  outputPath?: string; // Path to download data to (for download action)
  // Credentials (for local mode without connection)
  credentials?: {
    token?: string;
    username?: string;
    password?: string;
    // ClearML specific
    clearmlApiHost?: string;
    clearmlWebHost?: string;
    clearmlFilesHost?: string;
    clearmlAccessKey?: string;
    clearmlSecretKey?: string;
  };
  metadata?: Record<string, unknown>;
}

// Execute node configuration
export interface ExecuteNodeData extends BaseNodeData {
  type: 'execute';
  config: ExecuteConfig;
}

export interface ExecuteConfig {
  [key: string]: unknown;
  steps: ExecuteStep[];
  inputColumns?: string[];
  outputColumns?: string[];
  customCode?: string;
}

// Data source variable mapping - maps a script variable to an output from the previous node
export interface DataSourceVariableMapping {
  variableName: string; // Variable name in the script (e.g., 'DATA_SOURCE')
  sourceOutput: string; // Which output from the previous node to use (e.g., '{{sourceNode.outputPath}}' or 'inputPath' for default)
}

export interface ExecuteStep {
  id: string;
  name: string;
  type: 'normalize' | 'standardize' | 'encode' | 'impute' | 'feature_engineering' | 'custom';
  params: Record<string, unknown>;
  enabled: boolean;
  // Execution mode: local or cloud
  executionMode?: 'local' | 'cloud';
  // Connection ID for cloud execution (reference to a saved connection from settings)
  connectionId?: string;
  // Script execution configuration
  scriptSource?: 'local' | 'inline';
  scriptPath?: string; // Path to the .py file when scriptSource is 'local'
  inlineScript?: string; // Python code when scriptSource is 'inline'
  // Variable configuration
  useDataSourceVariable?: boolean; // Whether to use data source variable replacement (default: true)
  dataSourceVariable?: string; // Variable name to replace with the input data path (default: 'DATA_SOURCE') - deprecated, use dataSourceMappings
  dataSourceMappings?: DataSourceVariableMapping[]; // Multiple variable mappings to outputs from previous node
  useOutputVariables?: boolean; // Whether to use output variable replacement (default: true)
  outputVariables?: string[]; // Variable names that contain output paths (default: ['OUTPUT_PATH'])
  // Virtual environment configuration (for local scripts)
  venvPath?: string; // Path to the virtual environment folder
  venvMode?: 'auto' | 'custom' | 'none'; // 'auto' = auto-detect .venv, 'custom' = user-specified path, 'none' = use system python
}

// Training node configuration
export interface TrainingNodeData extends BaseNodeData {
  type: 'training';
  config: TrainingConfig;
}

// Git repository configuration for training scripts
export interface GitRepoConfig {
  provider: GitProvider;
  repoUrl: string;
  branch?: string;
  commitId?: string;
  entryScript: string; // Path to main training script within repo (e.g., 'train.py' or 'src/train.py')
  // Authentication
  authType?: 'none' | 'token' | 'ssh' | 'oauth';
  connectionId?: string; // Reference to saved git credentials in connections
}

// Cloud autoscaler configuration
export interface AutoscalerConfig {
  enabled: boolean;
  minNodes: number;
  maxNodes: number;
  targetGpuUtilization?: number; // 0-100, scale up when above this
  scaleDownDelay?: number; // Seconds to wait before scaling down
  spotInstances?: boolean; // Use spot/preemptible instances for cost savings
  timeout?: number; // Max training time in seconds before auto-termination
}

// Virtual environment configuration
export interface TrainingVenvConfig {
  mode: 'auto' | 'requirements' | 'conda' | 'poetry' | 'none';
  requirementsPath?: string; // Path to requirements.txt (relative to repo root)
  condaEnvPath?: string; // Path to environment.yml
  pythonVersion?: string; // e.g., '3.10', '3.11'
  additionalPackages?: string[]; // Extra pip packages to install
}

export interface TrainingConfig {
  [key: string]: unknown;
  
  // Script source configuration
  scriptSource: TrainingScriptSource;
  localScriptPath?: string; // When scriptSource is 'local'
  gitConfig?: GitRepoConfig; // When scriptSource is 'git'
  
  // Execution mode
  executionMode: 'local' | 'cloud';
  connectionId?: string; // Reference to saved cloud connection
  
  // ML Framework (used for parameter detection heuristics)
  framework: MLFramework;
  
  // Cloud provider settings (when executionMode is 'cloud')
  cloudProvider: CloudProvider;
  instanceType: string;
  instanceConfig: {
    gpu?: string;
    gpuCount?: number;
    memory?: string;
    cpuCores?: number;
    diskSize?: string;
  };
  
  // Autoscaler configuration (cloud only)
  autoscaler?: AutoscalerConfig;
  
  // Virtual environment configuration
  venvConfig?: TrainingVenvConfig;
  
  // Auto-detected parameters from script parsing
  detectedParams?: DetectedParam[];
  
  // User-configured parameter values (overrides detected defaults)
  parameterValues: Record<string, string | number | boolean>;
  
  // Common training parameters (fallback when not auto-detected)
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  
  // Data source mappings (similar to Execute node)
  dataSourceMappings?: DataSourceVariableMapping[];
  
  // Output configuration
  outputPath?: string;
  modelOutputPath?: string;
  checkpointPath?: string;
  
  // Experiment tracking integration
  experimentTracker?: ExperimentTracker;
  experimentConfig?: {
    projectName?: string;
    experimentName?: string;
    tags?: string[];
  };
  
  // Legacy credentials (for backward compatibility - prefer connectionId)
  credentials?: {
    // GCP
    gcpProjectId?: string;
    gcpServiceAccountKey?: string;
    // AWS
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
    // Azure
    azureSubscriptionId?: string;
    azureTenantId?: string;
    azureClientId?: string;
    azureClientSecret?: string;
  };
  
  // Job status tracking
  jobId?: string;
  jobStatus?: 'pending' | 'cloning' | 'setup' | 'training' | 'completed' | 'failed' | 'cancelled';
  jobProgress?: {
    currentEpoch?: number;
    totalEpochs?: number;
    currentStep?: number;
    totalSteps?: number;
    metrics?: Record<string, number>;
  };
}

// Experiment tracking node configuration
export interface ExperimentNodeData extends BaseNodeData {
  type: 'experiment';
  config: ExperimentConfig;
}

export interface ExperimentConfig {
  [key: string]: unknown;
  tracker: ExperimentTracker;
  projectName: string;
  experimentName: string;
  credentials: {
    // ClearML
    clearmlApiHost?: string;
    clearmlWebHost?: string;
    clearmlFilesHost?: string;
    clearmlAccessKey?: string;
    clearmlSecretKey?: string;
    // MLflow
    mlflowTrackingUri?: string;
    mlflowUsername?: string;
    mlflowPassword?: string;
    // W&B
    wandbApiKey?: string;
    wandbEntity?: string;
    // Comet
    cometApiKey?: string;
    cometWorkspace?: string;
  };
  logMetrics: boolean;
  logArtifacts: boolean;
  logHyperparameters: boolean;
  tags?: string[];
}

// Report node configuration
export interface ReportNodeData extends BaseNodeData {
  type: 'report';
  config: ReportConfig;
}

export interface ReportConfig {
  [key: string]: unknown;
  title: string;
  includeMetrics: boolean;
  includeVisualizations: boolean;
  includeModelCard: boolean;
  outputFormat: 'html' | 'pdf' | 'markdown' | 'json';
  customSections?: ReportSection[];
  exportPath?: string;
}

export interface ReportSection {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'chart' | 'table' | 'code';
}

// Union type for all node data
export type PipelineNodeData =
  | DatasetNodeData
  | VersioningNodeData
  | ExecuteNodeData
  | TrainingNodeData
  | ExperimentNodeData
  | ReportNodeData;

// Pipeline node type (React Flow node with our data)
export type PipelineNode = Node<PipelineNodeData>;

// Pipeline edge with custom data
export interface PipelineEdgeData extends Record<string, unknown> {
  animated?: boolean;
  dataFlow?: 'success' | 'error' | 'conditional';
}

export type PipelineEdge = Edge<PipelineEdgeData>;

// Pipeline definition
export interface Pipeline {
  id: string;
  name: string;
  description?: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  createdAt: string;
  updatedAt: string;
  version: string;
  metadata?: Record<string, unknown>;
}

// Node type definitions for the palette
export interface NodeTypeDefinition {
  type: PipelineNodeData['type'];
  label: string;
  description: string;
  icon: string;
  category: 'data' | 'scripts' | 'training' | 'tracking' | 'output';
  defaultConfig: Partial<PipelineNodeData['config']>;
}

// Execution status
export interface ExecutionStatus {
  nodeId: string;
  status: NodeStatus;
  progress?: number;
  message?: string;
  startTime?: string;
  endTime?: string;
  logs?: string[];
  metrics?: Record<string, number>;
}

// Real-time update types
export type UpdateType = 'websocket' | 'sse' | 'polling';

export interface RealTimeConfig {
  nodeType: PipelineNodeData['type'];
  updateType: UpdateType;
  interval?: number; // For polling
  endpoint?: string;
}

// ============================================================================
// Pipeline Sharing & Collaboration Types
// ============================================================================

// Pipeline member roles
export type PipelineMemberRole = 'manager' | 'supervisor' | 'member';

// Pipeline member status
export type PipelineMemberStatus = 'pending' | 'active' | 'revoked';

// Pipeline member interface
export interface PipelineMember {
  id: string;
  pipelineId: string;
  userId?: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  role: PipelineMemberRole;
  status: PipelineMemberStatus;
  invitedBy?: string;
  invitedAt: string;
  joinedAt?: string;
  lastSeenAt?: string;
  isOnline?: boolean;
}

// Pipeline presence for real-time tracking
export interface PipelinePresence {
  id: string;
  pipelineId: string;
  userId: string;
  userEmail: string;
  userName?: string;
  userAvatar?: string;
  cursorX?: number;
  cursorY?: number;
  isOnline: boolean;
  lastHeartbeat: string;
  connectedAt: string;
}

// Share settings for a pipeline
export interface PipelineShareSettings {
  id: string;
  name: string;
  isPublic: boolean;
  shareMode: 'private' | 'public' | 'verified';
  shareToken?: string;
  shareUrl: string;
  managerId: string;
  members: PipelineMember[];
  onlineUsers: PipelinePresence[];
}

// Role permissions
export interface RolePermissions {
  canEdit: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
  canChangeSettings: boolean;
  canAssignSupervisor: boolean;
  canDeletePipeline: boolean;
}

// Get permissions for a role
export function getRolePermissions(role: PipelineMemberRole, isOwner: boolean = false): RolePermissions {
  if (isOwner || role === 'manager') {
    return {
      canEdit: true,
      canInviteMembers: true,
      canRemoveMembers: true,
      canChangeSettings: true,
      canAssignSupervisor: true,
      canDeletePipeline: isOwner,
    };
  }
  
  if (role === 'supervisor') {
    return {
      canEdit: true,
      canInviteMembers: true,
      canRemoveMembers: true, // Can only remove regular members
      canChangeSettings: true,
      canAssignSupervisor: false,
      canDeletePipeline: false,
    };
  }
  
  // Regular member
  return {
    canEdit: true,
    canInviteMembers: false,
    canRemoveMembers: false,
    canChangeSettings: false,
    canAssignSupervisor: false,
    canDeletePipeline: false,
  };
}
