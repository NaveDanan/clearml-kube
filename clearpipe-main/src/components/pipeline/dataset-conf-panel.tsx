'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, RefreshCw, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tree, Folder, File, type TreeViewElement } from '@/components/ui/file-tree';
import { useSettingsStore } from '@/stores/settings-store';
import { ControlledSettingsDialog } from '@/components/ui/settings-dialog';
import { dataFormatOptions } from '@/config/node-definitions';
import type { DataFormatOption } from '@/config/node-definitions';
import type { DatasetConfig, ClearMLDatasetInfo } from '@/types/pipeline';

// Provider display info for connections
export const providerInfo: Record<string, { label: string; icon: string }> = {
  aws: { label: 'AWS S3', icon: '🟠' },
  gcp: { label: 'Google Cloud Storage', icon: '🔵' },
  azure: { label: 'Azure Blob', icon: '🔷' },
  minio: { label: 'MinIO', icon: '🟣' },
  clearml: { label: 'ClearML', icon: '🟢' },
};

// Pagination constants for datasets
const DATASETS_PAGE_SIZE = 5;

// Collapsible Format Selector Component
interface CollapsibleFormatSelectorProps {
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

function CollapsibleFormatSelector({ value, onChange }: CollapsibleFormatSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    'Tabular': true,
    'Columnar': false,
    'Scientific': false,
    'Serialization': false,
    'Images': false,
    'Videos': false,
    'Audio': false,
    'Other': false,
  });

  // Normalize value to array for easier handling
  const selectedFormats = Array.isArray(value) ? value : (value ? [value] : []);

  // Group formats by category
  const formatsByCategory = dataFormatOptions.reduce((acc, option) => {
    const category = (option as any).category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(option);
    return acc;
  }, {} as Record<string, DataFormatOption[]>);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleFormatChange = (formatValue: string) => {
    if (selectedFormats.includes(formatValue)) {
      // Remove format if already selected
      const updated = selectedFormats.filter((f) => f !== formatValue);
      onChange(updated.length === 0 ? '' : updated.length === 1 ? updated[0] : updated);
    } else {
      // Add format
      onChange([...selectedFormats, formatValue]);
    }
  };

  const getDisplayText = () => {
    if (selectedFormats.length === 0) return 'Select formats';
    if (selectedFormats.length === 1) {
      const option = dataFormatOptions.find((opt) => opt.value === selectedFormats[0]);
      return option?.label || selectedFormats[0];
    }
    return `${selectedFormats.length} format${selectedFormats.length > 1 ? 's' : ''} selected`;
  };

  return (
    <div className="space-y-2">
      <div className="border rounded-lg overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full bg-muted/50 px-3 py-2.5 flex items-center justify-between hover:bg-muted/70 transition-colors"
        >
          <div className="flex-1 text-left">
            <div className="font-medium text-sm">{getDisplayText()}</div>
            {selectedFormats.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedFormats.map((format) => {
                  const option = dataFormatOptions.find((opt) => opt.value === format);
                  return (
                    <Badge key={format} variant="default" className="text-xs">
                      {option?.label || format}
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFormatChange(format);
                        }}
                        className="ml-1 hover:opacity-75 cursor-pointer"
                      >
                        ✕
                      </span>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 ml-2 transition-transform flex-shrink-0 ${
              isExpanded ? 'rotate-0' : '-rotate-90'
            }`}
          />
        </button>
        
        {isExpanded && (
          <ScrollArea className="h-64 border-t">
            <div className="p-2 space-y-1">
              {Object.entries(formatsByCategory).map(([category, formats]) => (
                <div key={category}>
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent rounded-md text-sm font-medium transition-colors"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedCategories[category] ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                    <span className="text-muted-foreground text-xs uppercase tracking-wider flex-1 text-left">
                      {category}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {formats.length}
                    </Badge>
                  </button>
                  
                  {expandedCategories[category] && (
                    <div className="pl-6 space-y-0.5">
                      {formats.map((format) => (
                        <button
                          key={format.value}
                          onClick={() => handleFormatChange(format.value)}
                          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-2 ${
                            selectedFormats.includes(format.value)
                              ? 'bg-primary text-primary-foreground font-medium'
                              : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFormats.includes(format.value)}
                            onChange={() => handleFormatChange(format.value)}
                            className="h-4 w-4 cursor-pointer"
                          />
                          {format.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

// Intelligent Path Input Component with Output Variable Suggestions
interface PathInputWithSuggestionsProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  nodeId?: string;
}

import { usePipelineStore } from '@/stores/pipeline-store';
import { getConnectedSourceNode, getAvailableOutputVariables } from '@/components/nodes/shared/utils';

export function PathInputWithSuggestions({ 
  value, 
  onChange, 
  placeholder, 
  nodeId 
}: PathInputWithSuggestionsProps) {
  const { nodes, edges } = usePipelineStore();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableVars, setAvailableVars] = useState<Array<{ variable: string; label: string }>>([]);
  
  // Get available output variables from connected nodes
  useEffect(() => {
    if (nodeId) {
      const connectedNode = getConnectedSourceNode(nodeId, nodes, edges);
      if (connectedNode) {
        const vars = getAvailableOutputVariables(connectedNode.data);
        setAvailableVars(vars);
      } else {
        setAvailableVars([]);
      }
    }
  }, [nodeId, nodes, edges]);
  
  const handleSelectVariable = (variable: string) => {
    onChange(variable);
    setShowSuggestions(false);
  };
  
  return (
    <div className="relative space-y-2">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        />
        
        {/* Show suggestions dropdown if there are available variables */}
        {showSuggestions && availableVars.length > 0 && (
          <div className="absolute z-10 w-full mt-1 border rounded-md bg-background shadow-lg">
            <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                Available from connected node:
              </div>
              {availableVars.map((varInfo, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectVariable(varInfo.variable)}
                  className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors flex items-center justify-between group"
                >
                  <div>
                    <div className="font-mono text-xs text-primary">{varInfo.variable}</div>
                    <div className="text-xs text-muted-foreground">{varInfo.label}</div>
                  </div>
                  <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    Click to insert
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {availableVars.length > 0 && (
        <p className="text-xs text-muted-foreground">
          💡 Tip: Click the field above to see available outputs from the connected node
        </p>
      )}
    </div>
  );
}

// Helper function to recursively render tree elements
function renderTreeElement(element: TreeViewElement, selectedPath?: string): React.ReactNode {
  if (element.children && element.children.length > 0) {
    // Folder with children
    return (
      <Folder 
        key={element.id} 
        element={element.name} 
        value={element.id}
        isSelectable={element.isSelectable}
        isSelect={element.id === selectedPath}
      >
        {element.children.map(child => renderTreeElement(child, selectedPath))}
      </Folder>
    );
  } else if (element.children) {
    // Empty folder
    return (
      <Folder 
        key={element.id} 
        element={element.name} 
        value={element.id}
        isSelectable={element.isSelectable}
        isSelect={element.id === selectedPath}
      />
    );
  } else {
    // File
    return (
      <File 
        key={element.id} 
        value={element.id}
        isSelectable={element.isSelectable}
        isSelect={element.id === selectedPath}
      >
        <span>{element.name}</span>
      </File>
    );
  }
}

// Dataset Configuration Panel
interface DatasetConfigPanelProps {
  config: DatasetConfig;
  onUpdate: (updates: Partial<DatasetConfig>) => void;
  nodeId?: string;
}

export function DatasetConfigPanel({ config, onUpdate, nodeId }: DatasetConfigPanelProps) {
  const { connections, fetchConnections } = useSettingsStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // ClearML dataset browsing state
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [allDatasets, setAllDatasets] = useState<ClearMLDatasetInfo[]>([]);
  const [displayedDatasetsCount, setDisplayedDatasetsCount] = useState(DATASETS_PAGE_SIZE);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [hasFetchedDatasets, setHasFetchedDatasets] = useState(false);
  const previousConnectionIdRef = useRef<string | undefined>(undefined);
  
  // Dataset files state (for file tree)
  const [datasetFiles, setDatasetFiles] = useState<{ path: string; type: 'file' | 'folder'; size?: number }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const previousDatasetIdRef = useRef<string | undefined>(undefined);
  
  // Fetch connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);
  
  // Fetch ClearML datasets when connection is established
  const fetchDatasets = async () => {
    if (!config.connectionId || config.source !== 'clearml') {
      return;
    }
    
    setLoadingDatasets(true);
    setDatasetsError(null);
    
    try {
      const response = await fetch('/api/versioning/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          connectionId: config.connectionId,
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
    }
  };
  
  // Auto-fetch datasets when ClearML connection is established
  useEffect(() => {
    if (
      config.source === 'clearml' && 
      config.connectionId && 
      config.connectionId !== previousConnectionIdRef.current
    ) {
      previousConnectionIdRef.current = config.connectionId;
      fetchDatasets();
    }
  }, [config.source, config.connectionId]);
  
  // Fetch files for the selected dataset
  const fetchDatasetFiles = async () => {
    if (!config.connectionId || !config.selectedDatasetId) {
      return;
    }
    
    setLoadingFiles(true);
    setFilesError(null);
    
    try {
      const response = await fetch('/api/versioning/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'get_files',
          connectionId: config.connectionId,
          datasetId: config.selectedDatasetId,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch dataset files');
      }
      
      const result = await response.json();
      setDatasetFiles(result.files || []);
    } catch (error) {
      setFilesError((error as Error).message);
      setDatasetFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };
  
  // Auto-fetch files when dataset is selected
  useEffect(() => {
    if (
      config.selectedDatasetId && 
      config.selectedDatasetId !== previousDatasetIdRef.current
    ) {
      previousDatasetIdRef.current = config.selectedDatasetId;
      fetchDatasetFiles();
    }
  }, [config.selectedDatasetId, config.connectionId]);
  
  // Convert flat file list to TreeViewElement hierarchy
  const buildFileTree = (): TreeViewElement[] => {
    if (datasetFiles.length === 0) return [];
    
    const root: TreeViewElement[] = [];
    const folderMap = new Map<string, TreeViewElement>();
    
    // First pass: create all folders
    datasetFiles
      .filter(f => f.type === 'folder')
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach(folder => {
        const element: TreeViewElement = {
          id: folder.path,
          name: folder.path.split('/').pop() || folder.path,
          isSelectable: true,
          children: [],
        };
        folderMap.set(folder.path, element);
        
        // Find parent folder
        const parts = folder.path.split('/');
        if (parts.length === 1) {
          root.push(element);
        } else {
          const parentPath = parts.slice(0, -1).join('/');
          const parent = folderMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(element);
          } else {
            root.push(element);
          }
        }
      });
    
    // Second pass: add files
    datasetFiles
      .filter(f => f.type === 'file')
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach(file => {
        const element: TreeViewElement = {
          id: file.path,
          name: file.path.split('/').pop() || file.path,
          isSelectable: true,
        };
        
        const parts = file.path.split('/');
        if (parts.length === 1) {
          root.push(element);
        } else {
          const parentPath = parts.slice(0, -1).join('/');
          const parent = folderMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(element);
          } else {
            root.push(element);
          }
        }
      });
    
    return root;
  };
  
  const fileTreeElements = buildFileTree();
  
  // Get datasets to display (with pagination)
  const displayedDatasets = allDatasets.slice(0, displayedDatasetsCount);
  const hasMoreDatasets = allDatasets.length > displayedDatasetsCount;
  
  // Handle dataset selection
  const handleDatasetSelect = (dataset: ClearMLDatasetInfo) => {
    // Get the full project name for the output format
    const projectName = (dataset as any).projectName || dataset.project;
    onUpdate({
      selectedDatasetId: dataset.id,
      selectedDataset: dataset,
      datasetId: dataset.id,
      datasetProject: projectName,
      clearmlAction: 'download', // Default to download action
    });
  };
  
  // Get configured connections (those marked as configured)
  const configuredConnections = connections.filter(conn => conn.isConfigured);
  
  // Handle connection selection (for cloud mode)
  const handleConnectionChange = (value: string) => {
    if (value === '__add_source__') {
      setSettingsOpen(true);
      return;
    }
    if (value === '__none__') {
      onUpdate({ connectionId: undefined, source: 'local' });
      setAllDatasets([]);
      setHasFetchedDatasets(false);
      return;
    }
    if (value.startsWith('conn:')) {
      const connectionId = value.replace('conn:', '');
      const connection = connections.find(c => c.id === connectionId);
      if (connection) {
        // Map connection provider to source type
        const sourceMap: Record<string, DatasetConfig['source']> = {
          aws: 's3',
          gcp: 'gcs',
          azure: 'azure-blob',
          minio: 'minio',
          clearml: 'clearml',
        };
        const source = sourceMap[connection.provider] || 'local';
        onUpdate({ 
          source, 
          connectionId,
          // Reset dataset selection when connection changes
          selectedDatasetId: undefined,
          selectedDataset: undefined,
          // Pre-fill some fields from the connection
          ...(connection.provider === 'aws' && { 
            region: (connection as any).region,
            bucket: (connection as any).bucket 
          }),
          ...(connection.provider === 'gcp' && { 
            bucket: (connection as any).bucket 
          }),
          ...(connection.provider === 'azure' && { 
            container: (connection as any).container 
          }),
          ...(connection.provider === 'minio' && { 
            endpoint: (connection as any).endpoint,
            bucket: (connection as any).bucket 
          }),
        });
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Execution Mode - FIRST */}
      <div className="space-y-2">
        <Label>Execution Mode</Label>
        <Select 
          value={config.executionMode || 'local'} 
          onValueChange={(value) => {
            const updates: Partial<DatasetConfig> = { executionMode: value as 'local' | 'cloud' };
            // Reset relevant fields when switching modes
            if (value === 'local') {
              updates.connectionId = undefined;
              updates.source = 'local';
              updates.selectedDatasetId = undefined;
              updates.selectedDataset = undefined;
              setAllDatasets([]);
              setHasFetchedDatasets(false);
            } else {
              // Switching to cloud
              updates.source = 'local'; // Will be updated when connection is selected
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
            ? 'Load dataset from a cloud connection'
            : 'Load dataset from local file system'}
        </p>
      </div>
      
      {/* LOCAL MODE: File Path Section */}
      {(config.executionMode === 'local' || !config.executionMode) && (
        <>
          <Separator />
          
          {/* Path Mode Selector */}
          <div className="space-y-2">
            <Label>Path Type</Label>
            <Select 
              value={config.pathMode || 'direct'} 
              onValueChange={(value) => onUpdate({ pathMode: value as 'direct' | 'folder-regex' })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select path type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct File Path</SelectItem>
                <SelectItem value="folder-regex">Folder + Regex Pattern</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {config.pathMode === 'folder-regex' 
                ? 'Specify a folder and regex pattern to match multiple files'
                : 'Specify a direct path to a single file'}
            </p>
          </div>

          {/* File Path Input */}
          <div className="space-y-2">
            <Label htmlFor="path">
              {config.pathMode === 'folder-regex' ? 'Folder Path' : 'File Path'}
            </Label>
            <PathInputWithSuggestions
              value={config.path}
              onChange={(value) => onUpdate({ path: value })}
              placeholder={
                config.pathMode === 'folder-regex'
                  ? 'e.g., /home/naved/Documents/pythonprojects/test-ml'
                  : 'e.g., /home/naved/Documents/pythonprojects/test-ml/synthetic_regression.csv or {{sourceNode.outputPath}}'
              }
              nodeId={nodeId}
            />
            {config.pathMode === 'direct' && (
              <p className="text-xs text-muted-foreground">
                Direct path to a specific file (e.g., /path/to/file.csv)
              </p>
            )}
            {config.pathMode === 'folder-regex' && (
              <p className="text-xs text-muted-foreground">
                Path to a folder containing data files. Files will be filtered by the format(s) selected below.
              </p>
            )}
          </div>
        </>
      )}
      
      {/* CLOUD MODE: Data Source / Connection Selection */}
      {config.executionMode === 'cloud' && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Data Source</Label>
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
                
                {configuredConnections.length > 0 && (
                  <>
                    <SelectSeparator />
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Configured Connections
                    </div>
                    {configuredConnections.map((conn) => (
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
                    <span>Add source...</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            
            {!config.connectionId && configuredConnections.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                No connections configured. Add one to continue.
              </p>
            )}
          </div>
          
          {/* Non-ClearML cloud sources - show path input */}
          {config.connectionId && config.source !== 'clearml' && (
            <div className="space-y-2">
              <Label htmlFor="path">Path</Label>
              <PathInputWithSuggestions
                value={config.path}
                onChange={(value) => onUpdate({ path: value })}
                placeholder="e.g., bucket/path/to/data"
                nodeId={nodeId}
              />
              <p className="text-xs text-muted-foreground">
                Path within the cloud storage
              </p>
            </div>
          )}
        </>
      )}
      
      {/* File Format Section - shown for all modes except ClearML with selected dataset */}
      {!(config.source === 'clearml' && config.selectedDataset) && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>File Format(s)</Label>
            <CollapsibleFormatSelector 
              value={config.format} 
              onChange={(value) => onUpdate({ format: value })}
            />
            <p className="text-xs text-muted-foreground">
              {config.pathMode === 'folder-regex' 
                ? 'Only files matching these formats will be included from the folder'
                : 'Validate that the file matches one of these formats'}
            </p>
          </div>
        </>
      )}
      
      {/* ClearML Dataset Selection - show when ClearML connection is established */}
      {config.source === 'clearml' && config.connectionId && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">ClearML Datasets</Label>
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
            
            {/* Dataset list */}
            {!loadingDatasets && hasFetchedDatasets && (
              <div className="space-y-2">
                {displayedDatasets.length === 0 && !datasetsError && (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No datasets found in this connection.
                  </div>
                )}
                
                {displayedDatasets.map((dataset) => {
                  const fullProjectName = (dataset as any).projectName || dataset.project;
                  const shortProjectName = fullProjectName.split('/').pop() || fullProjectName;
                  const isSelected = config.selectedDatasetId === dataset.id;
                  
                  return (
                    <Card 
                      key={dataset.id} 
                      className={`p-3 transition-colors cursor-pointer ${
                        isSelected 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleDatasetSelect(dataset)}
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
                        
                        {/* Selection indicator */}
                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                        )}
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
                    onClick={() => setDisplayedDatasetsCount(prev => prev + DATASETS_PAGE_SIZE)}
                  >
                    <ChevronDown className="h-3 w-3" />
                    Load more ({allDatasets.length - displayedDatasetsCount} remaining)
                  </Button>
                )}
              </div>
            )}
          </div>
          
          {/* Selected dataset details */}
          {config.selectedDataset && (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Selected Dataset</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => fetchDatasetFiles()}
                    disabled={loadingFiles}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingFiles ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                
                {/* Dataset info header */}
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{config.selectedDataset.name}</span>
                  {' • '}
                  <span title={(config.selectedDataset as any).projectName || config.selectedDataset.project}>
                    {(() => {
                      const fullPath = (config.selectedDataset as any).projectName || config.selectedDataset.project;
                      return fullPath.split('/').pop() || fullPath;
                    })()}
                  </span>
                  {config.selectedDataset.version && (
                    <span> • v{config.selectedDataset.version}</span>
                  )}
                </div>
                
                {/* File tree */}
                <Card className="overflow-hidden">
                  {/* Files error */}
                  {filesError && (
                    <div className="text-xs text-destructive flex items-center gap-1 p-2 bg-destructive/10">
                      <XCircle className="h-3 w-3 flex-shrink-0" />
                      <span>{filesError}</span>
                    </div>
                  )}
                  
                  {/* Loading files */}
                  {loadingFiles && (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                      <span className="text-sm">Loading files...</span>
                    </div>
                  )}
                  
                  {/* File tree display */}
                  {!loadingFiles && !filesError && fileTreeElements.length > 0 && (
                    <div className="h-[200px] overflow-hidden">
                      <Tree
                        className="p-2 text-sm"
                        initialSelectedId={config.selectedFilePath}
                        initialExpandedItems={[]}
                        elements={fileTreeElements}
                        onSelectChange={(id) => {
                          if (id) {
                            onUpdate({ selectedFilePath: id });
                          }
                        }}
                      >
                        {fileTreeElements.map((element) => 
                          renderTreeElement(element, config.selectedFilePath)
                        )}
                      </Tree>
                    </div>
                  )}
                  
                  {/* No files found */}
                  {!loadingFiles && !filesError && fileTreeElements.length === 0 && (
                    <div className="text-center py-4 text-sm text-muted-foreground">
                      No files found in this dataset.
                    </div>
                  )}
                </Card>
                
                {/* Selected file indicator */}
                {config.selectedFilePath && (
                  <div className="flex items-center gap-2 text-xs">
                    <CheckCircle2 className="h-3 w-3 text-primary" />
                    <span className="text-muted-foreground">Selected:</span>
                    <span className="font-mono truncate">{config.selectedFilePath}</span>
                  </div>
                )}
                
                {/* Output format preview */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Output Format:</Label>
                  <div className="p-2 bg-muted/50 rounded text-xs font-mono break-all">
                    os.path.join(Dataset.get(dataset_project="{(config.selectedDataset as any).projectName || config.selectedDataset.project}", dataset_name="{config.selectedDataset.name}").get_local_copy(){config.selectedFilePath ? `, "${config.selectedFilePath}"` : ''})
                  </div>
                </div>
                
                {/* Clear selection */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    onUpdate({ 
                      selectedDatasetId: undefined, 
                      selectedDataset: undefined,
                      selectedFilePath: undefined,
                      datasetId: undefined,
                      datasetProject: undefined,
                      clearmlAction: undefined,
                      outputPath: undefined,
                    });
                    setDatasetFiles([]);
                    previousDatasetIdRef.current = undefined;
                  }}
                >
                  Clear Selection
                </Button>
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
