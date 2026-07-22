'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Plus, RefreshCw, CheckCircle2, XCircle, ChevronDown, Download, Upload, List, FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ToggleSwitch from '@/components/ui/toggle-switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { usePipelineStore } from '@/stores/pipeline-store';
import { useSettingsStore } from '@/stores/settings-store';
import { ControlledSettingsDialog } from '@/components/ui/settings-dialog';
import { PathInputWithSuggestions, providerInfo } from './dataset-conf-panel';
import { MultiPathInputWithSuggestions } from './shared-components';
import type { VersioningConfig, ClearMLDatasetInfo } from '@/types/pipeline';

// Pagination constants for datasets
const DATASETS_PAGE_SIZE = 5;

// Map connection providers to versioning tools
const providerToToolMap: Record<string, VersioningConfig['tool']> = {
  clearml: 'clearml-data',
  // Add more mappings as needed
};

// Map versioning tools to connection providers
const toolToProviderMap: Record<VersioningConfig['tool'], string | undefined> = {
  'clearml-data': 'clearml',
  'dvc': undefined,
  'git-lfs': undefined,
  'mlflow-artifacts': undefined,
  'custom': undefined,
};

// Helper function to increment a version string by 0.0.1
// e.g., "1.0.0" -> "1.0.1", "v1.2.3" -> "1.2.4", "2.5" -> "2.5.1"
function incrementVersion(version: string | undefined): string {
  if (!version) {
    return '1.0.1';
  }
  
  // Remove 'v' prefix if present
  const cleanVersion = version.replace(/^v/i, '').trim();
  
  // Split by dots
  const parts = cleanVersion.split('.');
  
  if (parts.length === 0 || !parts.every(p => /^\d+$/.test(p))) {
    // If version doesn't match expected format, return next logical version
    return '1.0.1';
  }
  
  // Ensure we have at least 3 parts (major.minor.patch)
  while (parts.length < 3) {
    parts.push('0');
  }
  
  // Increment the patch version (last part)
  const patchIndex = parts.length - 1;
  parts[patchIndex] = String(parseInt(parts[patchIndex], 10) + 1);
  
  return parts.join('.');
}

// Versioning Configuration Panel
interface VersioningConfigPanelProps {
  config: VersioningConfig;
  onUpdate: (updates: Partial<VersioningConfig>) => void;
  nodeId?: string;
}

export function VersioningConfigPanel({ config, onUpdate, nodeId }: VersioningConfigPanelProps) {
  const { nodes, edges } = usePipelineStore();
  const { connections, fetchConnections } = useSettingsStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [loadingMoreDatasets, setLoadingMoreDatasets] = useState(false);
  const [allDatasets, setAllDatasets] = useState<ClearMLDatasetInfo[]>([]);
  const [displayedDatasetsCount, setDisplayedDatasetsCount] = useState(DATASETS_PAGE_SIZE);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [hasFetchedDatasets, setHasFetchedDatasets] = useState(false);
  const previousConnectionIdRef = useRef<string | undefined>(undefined);
  
  // Fetch connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);
  
  // Get configured connections based on current execution mode and tool
  const getRelevantConnections = () => {
    if (config.executionMode !== 'cloud') return [];
    
    // If a tool is selected, show only matching connections
    const toolProvider = toolToProviderMap[config.tool];
    if (toolProvider) {
      return connections.filter(conn => conn.provider === toolProvider && conn.isConfigured);
    }
    
    // Show all configured connections
    return connections.filter(conn => conn.isConfigured);
  };
  
  const relevantConnections = getRelevantConnections();
  
  // Get datasets to display (with pagination)
  const displayedDatasets = allDatasets.slice(0, displayedDatasetsCount);
  const hasMoreDatasets = allDatasets.length > displayedDatasetsCount;
  
  // Fetch ClearML datasets
  const fetchDatasets = async (isLoadingMore = false) => {
    if (!config.connectionId) {
      return;
    }
    
    if (isLoadingMore) {
      setLoadingMoreDatasets(true);
    } else {
      setLoadingDatasets(true);
      setDatasetsError(null);
    }
    
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
        throw new Error(error.error || 'Failed to fetch datasets');
      }
      
      const result = await response.json();
      setAllDatasets(result.datasets || []);
      setDisplayedDatasetsCount(DATASETS_PAGE_SIZE);
      setHasFetchedDatasets(true);
    } catch (error) {
      setDatasetsError((error as Error).message);
      setAllDatasets([]);
    } finally {
      setLoadingDatasets(false);
      setLoadingMoreDatasets(false);
    }
  };
  
  // Load more datasets
  const handleLoadMoreDatasets = () => {
    setDisplayedDatasetsCount(prev => prev + DATASETS_PAGE_SIZE);
  };
  
  // Auto-fetch datasets when cloud connection is established
  useEffect(() => {
    if (
      config.executionMode === 'cloud' && 
      config.connectionId && 
      config.connectionId !== previousConnectionIdRef.current
    ) {
      previousConnectionIdRef.current = config.connectionId;
      fetchDatasets();
    }
  }, [config.executionMode, config.connectionId]);
  
  // Handle connection change - auto-set tool based on connection provider
  const handleConnectionChange = (value: string) => {
    if (value === '__add_source__') {
      setSettingsOpen(true);
      return;
    }
    if (value === '__none__') {
      onUpdate({ connectionId: undefined });
      setAllDatasets([]);
      setHasFetchedDatasets(false);
      return;
    }
    if (value.startsWith('conn:')) {
      const connectionId = value.replace('conn:', '');
      const connection = connections.find(c => c.id === connectionId);
      
      // Auto-set the versioning tool based on connection provider
      const updates: Partial<VersioningConfig> = { connectionId };
      if (connection) {
        const mappedTool = providerToToolMap[connection.provider];
        if (mappedTool) {
          updates.tool = mappedTool;
        }
      }
      
      onUpdate(updates);
    }
  };
  
  // Handle dataset selection with action
  const handleDatasetAction = (dataset: ClearMLDatasetInfo, action: VersioningConfig['clearmlAction']) => {
    const updates: Partial<VersioningConfig> = { 
      selectedDatasetId: dataset.id,
      selectedDataset: dataset,
      clearmlAction: action,
    };
    
    // Auto-increment version when "New Version" is selected
    if (action === 'version') {
      updates.version = incrementVersion(dataset.version);
    }
    
    onUpdate(updates);
  };
  
  // Handle create new dataset
  const handleCreateNewDataset = () => {
    onUpdate({ 
      clearmlAction: 'create',
      selectedDatasetId: undefined,
      selectedDataset: undefined,
    });
  };

  return (
    <div className="space-y-4">
      {/* 1. Execution Mode - FIRST */}
      <div className="space-y-2">
        <Label>Execution Mode</Label>
        <Select 
          value={config.executionMode || 'local'} 
          onValueChange={(value) => {
            const updates: Partial<VersioningConfig> = { executionMode: value as 'local' | 'cloud' };
            // Reset connection when switching modes
            if (value === 'local') {
              updates.connectionId = undefined;
              setAllDatasets([]);
              setHasFetchedDatasets(false);
            }
            onUpdate(updates);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">💻 Local</SelectItem>
            <SelectItem value="cloud">☁️ Cloud</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {config.executionMode === 'cloud' 
            ? 'Use a configured cloud connection for versioning'
            : 'Run versioning operations locally'}
        </p>
      </div>
      
      {/* 2. Cloud Connection Section - Only shown in cloud mode */}
      {config.executionMode === 'cloud' && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Cloud Connection</Label>
            <Select 
              value={config.connectionId ? `conn:${config.connectionId}` : '__none__'} 
              onValueChange={handleConnectionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select connection">
                  {config.connectionId ? (() => {
                    const conn = connections.find(c => c.id === config.connectionId);
                    return conn ? `${providerInfo[conn.provider]?.icon || ''} ${conn.name}` : 'Select connection';
                  })() : 'Select connection'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">No connection selected</span>
                </SelectItem>
                
                {relevantConnections.length > 0 && (
                  <>
                    <SelectSeparator />
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Available Connections
                    </div>
                    {relevantConnections.map((conn) => (
                      <SelectItem key={conn.id} value={`conn:${conn.id}`}>
                        <span className="flex items-center gap-2">
                          <span>{providerInfo[conn.provider]?.icon}</span>
                          <span>{conn.name}</span>
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1">
                            {providerInfo[conn.provider]?.label}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
                
                <SelectSeparator />
                <SelectItem value="__add_source__">
                  <span className="flex items-center gap-2 text-primary">
                    <Plus className="h-4 w-4" />
                    <span>Add connection...</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            
            {config.connectionId && (
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-muted-foreground">
                  Credentials managed in Settings → Connections
                </p>
                <Button 
                  variant="link" 
                  size="sm" 
                  className="h-auto p-0 text-xs"
                  onClick={() => setSettingsOpen(true)}
                >
                  Manage
                </Button>
              </div>
            )}
            
            {!config.connectionId && relevantConnections.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                No connections configured. Add one to continue.
              </p>
            )}
          </div>
        </>
      )}
      
      {/* 3. Datasets Section - Auto-fetched when connection is established (Cloud mode with ClearML-like connection) */}
      {config.executionMode === 'cloud' && config.connectionId && config.tool === 'clearml-data' && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Datasets</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => fetchDatasets()}
                disabled={loadingDatasets}
              >
                <RefreshCw className={`h-3 w-3 ${loadingDatasets ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            
            {/* Error display */}
            {datasetsError && (
              <div className="text-xs text-destructive flex items-center gap-1 p-2 bg-destructive/10 rounded">
                <XCircle className="h-3 w-3 flex-shrink-0" />
                <span>{datasetsError}</span>
              </div>
            )}
            
            {/* Loading state */}
            {loadingDatasets && (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm">Loading datasets...</span>
              </div>
            )}
            
            {/* Dataset list with action icons */}
            {!loadingDatasets && hasFetchedDatasets && (
              <div className="space-y-2">
                {displayedDatasets.length === 0 && !datasetsError && (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No datasets found in this connection.
                  </div>
                )}
                
                {displayedDatasets.map((dataset) => {
                  // Get project name and extract only the last folder from the path
                  const fullProjectName = (dataset as any).projectName || dataset.project;
                  const shortProjectName = fullProjectName.split('/').pop() || fullProjectName;
                  
                  return (
                  <Card 
                    key={dataset.id} 
                    className={`p-3 transition-colors ${
                      config.selectedDatasetId === dataset.id 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate" title={`${fullProjectName} → ${dataset.name}`}>
                          {shortProjectName} → {dataset.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {dataset.version ? `v${dataset.version}` : 'No version'}
                          {dataset.fileCount !== undefined && ` • ${dataset.fileCount} files`}
                        </div>
                        {dataset.tags && dataset.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {dataset.tags.slice(0, 3).map((tag, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] px-1 py-0">
                                {tag}
                              </Badge>
                            ))}
                            {dataset.tags.length > 3 && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                +{dataset.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {/* Action icons */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDatasetAction(dataset, 'list')}
                          title="List / View Details"
                        >
                          <List className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDatasetAction(dataset, 'download')}
                          title="Download Dataset"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDatasetAction(dataset, 'version')}
                          title="Add New Version"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                  );
                })}
                
                {/* Load more button */}
                {hasMoreDatasets && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    onClick={handleLoadMoreDatasets}
                    disabled={loadingMoreDatasets}
                  >
                    <ChevronDown className="h-3 w-3" />
                    Load more ({allDatasets.length - displayedDatasetsCount} remaining)
                  </Button>
                )}
                
                {/* Create new dataset - at the end */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-9 text-xs gap-2 mt-2"
                  onClick={handleCreateNewDataset}
                >
                  <FolderPlus className="h-4 w-4" />
                  Create New Dataset
                </Button>
              </div>
            )}
          </div>
        </>
      )}
      
      {/* Selected dataset details and action-specific fields */}
      {config.executionMode === 'cloud' && config.connectionId && config.tool === 'clearml-data' && config.selectedDataset && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Selected Dataset</Label>
              <Badge variant="outline" className="text-xs">
                {config.clearmlAction === 'list' && 'View'}
                {config.clearmlAction === 'download' && 'Download'}
                {config.clearmlAction === 'version' && 'New Version'}
              </Badge>
            </div>
            
            <Card className="p-3 bg-muted/30">
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name:</span>
                  <span className="font-medium">{config.selectedDataset.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project:</span>
                  <span className="font-medium" title={(config.selectedDataset as any).projectName || config.selectedDataset.project}>
                    {(() => {
                      const fullPath = (config.selectedDataset as any).projectName || config.selectedDataset.project;
                      return fullPath.split('/').pop() || fullPath;
                    })()}
                  </span>
                </div>
                {config.selectedDataset.version && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Version:</span>
                    <span className="font-medium">v{config.selectedDataset.version}</span>
                  </div>
                )}
                {config.selectedDataset.fileCount !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Files:</span>
                    <span className="font-medium">{config.selectedDataset.fileCount}</span>
                  </div>
                )}
              </div>
            </Card>
            
            {/* Action-specific fields */}
            {config.clearmlAction === 'download' && (
              <div className="space-y-2">
                <Label htmlFor="outputPath">Download Path</Label>
                <Input
                  id="outputPath"
                  value={config.outputPath || ''}
                  onChange={(e) => onUpdate({ outputPath: e.target.value })}
                  placeholder="e.g., /path/to/download"
                />
                <p className="text-xs text-muted-foreground">
                  Local path where the dataset will be downloaded
                </p>
              </div>
            )}
            
            {config.clearmlAction === 'version' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="inputPath">Data Path</Label>
                  <PathInputWithSuggestions
                    value={config.inputPath || ''}
                    onChange={(value) => onUpdate({ inputPath: value })}
                    placeholder="e.g., /path/to/data or {{sourceNode.outputPath}}"
                    nodeId={nodeId}
                  />
                  <p className="text-xs text-muted-foreground">
                    Path to the data to add to the dataset
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="version">New Version Tag</Label>
                  <Input
                    id="version"
                    value={config.version}
                    onChange={(e) => onUpdate({ version: e.target.value })}
                    placeholder="e.g., 1.0.1"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional: specify a version tag for the new dataset version
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="datasetTags">Tags (comma-separated)</Label>
                  <Input
                    id="datasetTags"
                    value={config.datasetTags?.join(', ') || ''}
                    onChange={(e) => onUpdate({ 
                      datasetTags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) 
                    })}
                    placeholder="e.g., train, v1, processed"
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}
      
      {/* Create new dataset fields */}
      {config.executionMode === 'cloud' && config.connectionId && config.tool === 'clearml-data' && config.clearmlAction === 'create' && !config.selectedDataset && (
        <>
          <Separator />
          <div className="space-y-4">
            <Label className="text-sm font-semibold">Create New Dataset</Label>
            
            <div className="space-y-2">
              <Label htmlFor="newDatasetName">Dataset Name</Label>
              <Input
                id="newDatasetName"
                value={config.newDatasetName || ''}
                onChange={(e) => onUpdate({ newDatasetName: e.target.value })}
                placeholder="e.g., my-dataset"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newDatasetProject">Project</Label>
              <Input
                id="newDatasetProject"
                value={config.newDatasetProject || ''}
                onChange={(e) => onUpdate({ newDatasetProject: e.target.value })}
                placeholder="e.g., MyProject/Datasets"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Data Paths</Label>
              <MultiPathInputWithSuggestions
                values={config.inputPaths || (config.inputPath ? [config.inputPath] : [])}
                onChange={(values) => onUpdate({ 
                  inputPaths: values,
                  inputPath: values[0] || '' // Keep first path for backward compatibility
                })}
                placeholder="e.g., /path/to/data"
                nodeId={nodeId}
              />
              <p className="text-xs text-muted-foreground">
                Select one or more data paths to add to the dataset
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="datasetTags">Tags (comma-separated)</Label>
              <Input
                id="datasetTags"
                value={config.datasetTags?.join(', ') || ''}
                onChange={(e) => onUpdate({ 
                  datasetTags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) 
                })}
                placeholder="e.g., train, v1, processed"
              />
            </div>
            
            {/* Auto-version toggle */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autoVersionAfterCreate">Update this version after first run</Label>
                  <p className="text-xs text-muted-foreground">
                    After initial creation, subsequent runs will add new versions instead of recreating
                  </p>
                </div>
                <ToggleSwitch
                  id="autoVersionAfterCreate"
                  checked={config.autoVersionAfterCreate !== false}
                  onChange={(checked) => onUpdate({ autoVersionAfterCreate: checked })}
                />
              </div>
            </div>
          </div>
        </>
      )}
      
      {/* Local mode - Versioning Tool selection (only shown in local mode) */}
      {config.executionMode === 'local' && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Versioning Tool</Label>
            <Select value={config.tool} onValueChange={(value) => onUpdate({ tool: value as VersioningConfig['tool'] })}>
              <SelectTrigger>
                <SelectValue placeholder="Select tool" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dvc">DVC</SelectItem>
                <SelectItem value="git-lfs">Git LFS</SelectItem>
                <SelectItem value="clearml-data">ClearML Data</SelectItem>
                <SelectItem value="mlflow-artifacts">MLflow Artifacts</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Non-ClearML tools configuration */}
          {config.tool !== 'clearml-data' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="version">Version Tag</Label>
                <Input
                  id="version"
                  value={config.version}
                  onChange={(e) => onUpdate({ version: e.target.value })}
                  placeholder="e.g., v1.0.0"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="remoteUrl">Remote URL</Label>
                <Input
                  id="remoteUrl"
                  value={config.remoteUrl || ''}
                  onChange={(e) => onUpdate({ remoteUrl: e.target.value })}
                  placeholder="e.g., s3://bucket/dvc-cache"
                />
              </div>
              
              <Separator />
              <div className="space-y-4">
                <Label className="text-sm font-semibold">Credentials</Label>
                <div className="space-y-2">
                  <Label htmlFor="token">Access Token</Label>
                  <Input
                    id="token"
                    type="password"
                    value={config.credentials?.token || ''}
                    onChange={(e) => onUpdate({ 
                      credentials: { ...config.credentials, token: e.target.value }
                    })}
                  />
                </div>
              </div>
            </>
          )}
          
          {/* ClearML Data in local mode - need to configure credentials manually */}
          {config.tool === 'clearml-data' && (
            <>
              <Separator />
              <div className="space-y-4">
                <Label className="text-sm font-semibold">ClearML Credentials</Label>
                <p className="text-xs text-muted-foreground">
                  Configure ClearML credentials for local execution, or switch to Cloud mode to use a saved connection.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="clearmlApiHost">API Host</Label>
                  <Input
                    id="clearmlApiHost"
                    value={config.credentials?.clearmlApiHost || ''}
                    onChange={(e) => onUpdate({ 
                      credentials: { ...config.credentials, clearmlApiHost: e.target.value }
                    })}
                    placeholder="e.g., https://api.clear.ml"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clearmlAccessKey">Access Key</Label>
                  <Input
                    id="clearmlAccessKey"
                    type="password"
                    value={config.credentials?.clearmlAccessKey || ''}
                    onChange={(e) => onUpdate({ 
                      credentials: { ...config.credentials, clearmlAccessKey: e.target.value }
                    })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clearmlSecretKey">Secret Key</Label>
                  <Input
                    id="clearmlSecretKey"
                    type="password"
                    value={config.credentials?.clearmlSecretKey || ''}
                    onChange={(e) => onUpdate({ 
                      credentials: { ...config.credentials, clearmlSecretKey: e.target.value }
                    })}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
      
      {/* Settings Dialog */}
      <ControlledSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
        defaultTab="connections" 
      />
    </div>
  );
}
