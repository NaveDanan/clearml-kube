'use client';

import { useCallback, useState, useEffect } from 'react';
import { RefreshCw, Wand2, Settings, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { usePipelineStore } from '@/stores/pipeline-store';
import { useSettingsStore } from '@/stores/settings-store';
import { ControlledSettingsDialog } from '@/components/ui/settings-dialog';
import type { TrainingConfig, DetectedParam } from '@/types/pipeline';

// Detected Parameters Section Component with collapsible Bool Flags
interface DetectedParametersSectionProps {
  detectedParams: DetectedParam[] | undefined;
  parameterValues: Record<string, string | number | boolean> | undefined;
  onParamChange: (paramName: string, value: string | number | boolean) => void;
  renderParamInput: (param: DetectedParam) => React.ReactNode;
}

function DetectedParametersSection({ 
  detectedParams, 
  parameterValues, 
  onParamChange, 
  renderParamInput 
}: DetectedParametersSectionProps) {
  const [boolFlagsExpanded, setBoolFlagsExpanded] = useState(false);
  
  // Separate boolean flags from other parameters
  const boolParams = detectedParams?.filter(p => p.type === 'bool') || [];
  const nonBoolArgparseParams = detectedParams?.filter(p => p.source === 'argparse' && p.type !== 'bool') || [];
  const nonBoolHyperParams = detectedParams?.filter(p => (p.source === 'hyperparameter' || p.source === 'config') && p.type !== 'bool') || [];
  
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">
        Script Parameters 
        {detectedParams && detectedParams.length > 0 && (
          <Badge variant="secondary" className="ml-2 text-xs">
            {detectedParams.length} detected
          </Badge>
        )}
      </Label>
      
      {detectedParams && detectedParams.length > 0 ? (
        <div className="space-y-3">
          {/* Bool Flags - Collapsible Section */}
          {boolParams.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setBoolFlagsExpanded(!boolFlagsExpanded)}
                className="w-full bg-muted/50 px-3 py-2.5 flex items-center justify-between hover:bg-muted/70 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Bool Flags</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {boolParams.length}
                  </Badge>
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    boolFlagsExpanded ? 'rotate-0' : '-rotate-90'
                  }`}
                />
              </button>
              
              {boolFlagsExpanded && (
                <div className="p-3 space-y-2 border-t bg-background">
                  {boolParams.map((param) => (
                    <div key={param.name} className="flex items-center justify-between gap-2 py-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono bg-muted px-1 rounded">
                            --{param.name.replace(/_/g, '-')}
                          </code>
                          {param.required && (
                            <Badge variant="destructive" className="text-[10px] h-4">required</Badge>
                          )}
                        </div>
                        {param.help && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={param.help}>
                            {param.help}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {renderParamInput(param)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Argparse arguments (non-bool) */}
          {nonBoolArgparseParams.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Command Line Arguments</Label>
              <div className="space-y-2">
                {nonBoolArgparseParams.map((param) => (
                  <div key={param.name} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono bg-muted px-1 rounded">--{param.name.replace(/_/g, '-')}</code>
                        <span className="text-[10px] text-muted-foreground">({param.type})</span>
                        {param.required && <Badge variant="destructive" className="text-[10px] h-4">required</Badge>}
                      </div>
                      {param.help && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate" title={param.help}>
                          {param.help}
                        </p>
                      )}
                    </div>
                    <div className="w-32 flex-shrink-0">
                      {renderParamInput(param)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Hyperparameters (non-bool) */}
          {nonBoolHyperParams.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Detected Hyperparameters</Label>
              <div className="space-y-2">
                {nonBoolHyperParams.map((param) => (
                  <div key={param.name} className="border rounded-lg p-2 bg-muted/20">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono bg-muted px-1 rounded">{param.name}</code>
                          <span className="text-[10px] text-muted-foreground">({param.type})</span>
                          {param.min !== undefined && param.max !== undefined && (
                            <Badge variant="outline" className="text-[10px] h-4">
                              {param.min} – {param.max}
                            </Badge>
                          )}
                        </div>
                        {param.help && (
                          <p className="text-[10px] text-muted-foreground mt-1" title={param.help}>
                            {param.help}
                          </p>
                        )}
                      </div>
                      <div className="w-28 flex-shrink-0">
                        {renderParamInput(param)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground p-3 border rounded-lg bg-muted/30 text-center">
          <p>No parameters detected.</p>
          <p className="text-xs mt-1">Click &quot;Detect Parameters from Script&quot; to auto-detect training parameters.</p>
        </div>
      )}
    </div>
  );
}

// Training Configuration Panel
interface TrainingConfigPanelProps {
  config: TrainingConfig;
  onUpdate: (updates: Partial<TrainingConfig>) => void;
  nodeId?: string;
}

export function TrainingConfigPanel({ config, onUpdate, nodeId }: TrainingConfigPanelProps) {
  const { nodes, edges } = usePipelineStore();
  const { connections, fetchConnections } = useSettingsStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isParsingScript, setIsParsingScript] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  
  // Fetch connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);
  
  // Get configured connections
  const configuredConnections = connections.filter(conn => conn.isConfigured);
  const cloudConnections = configuredConnections.filter(conn => 
    ['gcp', 'aws', 'azure'].includes(conn.provider)
  );
  const gitConnections = configuredConnections.filter(conn =>
    ['github', 'gitlab', 'dagshub', 'azure-devops', 'bitbucket'].includes(conn.provider)
  );

  // Fetch branches when repo URL changes
  const fetchBranches = useCallback(async () => {
    if (!config.gitConfig?.repoUrl) return;
    
    setIsFetchingBranches(true);
    try {
      const params = new URLSearchParams({ repoUrl: config.gitConfig.repoUrl });
      const response = await fetch(`/api/training/clone-repo?${params.toString()}`);
      const result = await response.json();
      
      if (result.success && result.branches) {
        setBranches(result.branches);
      }
    } catch (error) {
      console.error('Failed to fetch branches:', error);
    } finally {
      setIsFetchingBranches(false);
    }
  }, [config.gitConfig?.repoUrl]);

  // Parse script to detect parameters
  const parseScript = useCallback(async () => {
    setIsParsingScript(true);
    setParseError(null);
    
    try {
      const scriptPath = config.scriptSource === 'local' 
        ? config.localScriptPath 
        : undefined; // For git, we'd need to clone first
      
      if (!scriptPath) {
        setParseError('No script path configured');
        setIsParsingScript(false);
        return;
      }
      
      const response = await fetch('/api/training/parse-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        // Auto-fill parameter values with detected defaults
        const autoFilledValues: Record<string, string | number | boolean> = {
          ...config.parameterValues, // Keep any existing user values
        };
        
        // Populate with detected parameter defaults (only if not already set by user)
        if (result.params && Array.isArray(result.params)) {
          for (const param of result.params) {
            if (param.name && param.default !== undefined && param.default !== null) {
              // Only set if user hasn't already configured this parameter
              if (autoFilledValues[param.name] === undefined) {
                // Handle list/array defaults - convert to comma-separated string
                if (Array.isArray(param.default)) {
                  autoFilledValues[param.name] = param.default.join(', ');
                } else {
                  autoFilledValues[param.name] = param.default;
                }
              }
            }
          }
        }
        
        onUpdate({ 
          detectedParams: result.params,
          framework: result.framework || config.framework,
          parameterValues: autoFilledValues,
        });
      } else {
        setParseError(result.error || 'Failed to parse script');
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'Failed to parse script');
    } finally {
      setIsParsingScript(false);
    }
  }, [config.scriptSource, config.localScriptPath, config.framework, config.parameterValues, onUpdate]);

  // Handle parameter value change
  const handleParamChange = useCallback((paramName: string, value: string | number | boolean) => {
    onUpdate({
      parameterValues: {
        ...config.parameterValues,
        [paramName]: value,
      },
    });
  }, [config.parameterValues, onUpdate]);

  // Render parameter input based on type
  const renderParamInput = (param: { name: string; type: string; default?: any; help?: string; choices?: any[]; min?: number; max?: number }) => {
    // Convert array defaults to comma-separated string for display
    let defaultVal = param.default;
    if (Array.isArray(defaultVal)) {
      defaultVal = defaultVal.join(', ');
    }
    
    const value = config.parameterValues?.[param.name] ?? defaultVal ?? '';
    
    if (param.choices && param.choices.length > 0) {
      return (
        <Select 
          value={String(value)} 
          onValueChange={(v) => handleParamChange(param.name, param.type === 'int' ? parseInt(v) : v)}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {param.choices.map((choice) => (
              <SelectItem key={String(choice)} value={String(choice)}>
                {String(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    
    if (param.type === 'bool') {
      return (
        <ToggleSwitch
          id={`param-${param.name}`}
          checked={value === true || value === 'true'}
          onChange={(checked: boolean) => handleParamChange(param.name, checked)}
        />
      );
    }
    
    // For numeric inputs with min/max range
    const hasRange = param.min !== undefined || param.max !== undefined;
    
    // Ensure value is not boolean for the Input component
    const inputValue = typeof value === 'boolean' ? '' : value;
    
    // Check if this is a list-type parameter (detected from array default or help text mentioning 'nargs')
    const isListParam = Array.isArray(param.default);
    
    return (
      <div className="space-y-1">
        <Input
          className="h-8"
          type={(!isListParam && (param.type === 'int' || param.type === 'float')) ? 'number' : 'text'}
          step={param.type === 'float' ? '0.0001' : undefined}
          min={!isListParam ? param.min : undefined}
          max={!isListParam ? param.max : undefined}
          value={inputValue}
          onChange={(e) => {
            // For list params, keep as string (comma-separated)
            if (isListParam) {
              handleParamChange(param.name, e.target.value);
            } else {
              const newValue = param.type === 'int' 
                ? parseInt(e.target.value) || 0
                : param.type === 'float'
                ? parseFloat(e.target.value) || 0
                : e.target.value;
              handleParamChange(param.name, newValue);
            }
          }}
          placeholder={param.help || `Enter ${param.name}`}
        />
        {isListParam && (
          <p className="text-[10px] text-muted-foreground">
            List values (comma-separated)
          </p>
        )}
        {hasRange && !isListParam && (
          <p className="text-[10px] text-muted-foreground">
            Range: {param.min !== undefined ? param.min : '—'} to {param.max !== undefined ? param.max : '—'}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Execution Mode Section - Moved to top */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Execution</Label>
        
        <div className="space-y-2">
          <Label>Execution Mode</Label>
          <Select 
            value={config.executionMode || 'local'} 
            onValueChange={(value) => onUpdate({ executionMode: value as 'local' | 'cloud' })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local Machine</SelectItem>
              <SelectItem value="cloud">Cloud Provider</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {config.executionMode === 'cloud' && (
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>Cloud Provider</Label>
              <Select 
                value={config.cloudProvider || 'gcp'} 
                onValueChange={(value) => onUpdate({ cloudProvider: value as 'gcp' | 'aws' | 'azure' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gcp">Google Cloud Platform</SelectItem>
                  <SelectItem value="aws">Amazon Web Services</SelectItem>
                  <SelectItem value="azure">Microsoft Azure</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {cloudConnections.length > 0 && (
              <div className="space-y-2">
                <Label>Cloud Connection</Label>
                <div className="flex gap-2">
                  <Select 
                    value={config.connectionId || ''} 
                    onValueChange={(value) => onUpdate({ connectionId: value || undefined })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {cloudConnections
                        .filter(conn => conn.provider === config.cloudProvider)
                        .map((conn) => (
                          <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)}>
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>Instance Type</Label>
              <Input
                value={config.instanceType || ''}
                onChange={(e) => onUpdate({ instanceType: e.target.value })}
                placeholder={config.cloudProvider === 'gcp' ? 'n1-standard-8' : config.cloudProvider === 'aws' ? 'm5.xlarge' : 'Standard_D4s_v3'}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>GPU Type</Label>
                <Input
                  value={config.instanceConfig?.gpu || ''}
                  onChange={(e) => onUpdate({ 
                    instanceConfig: { ...config.instanceConfig, gpu: e.target.value }
                  })}
                  placeholder="T4, V100, A100"
                />
              </div>
              <div className="space-y-2">
                <Label>GPU Count</Label>
                <Input
                  type="number"
                  value={config.instanceConfig?.gpuCount || ''}
                  onChange={(e) => onUpdate({ 
                    instanceConfig: { ...config.instanceConfig, gpuCount: parseInt(e.target.value) || undefined }
                  })}
                  placeholder="1"
                />
              </div>
            </div>
            
            {/* Autoscaler Section */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label>Autoscaler</Label>
                <ToggleSwitch
                  id="autoscaler-enabled"
                  checked={config.autoscaler?.enabled || false}
                  onChange={(checked) => onUpdate({ 
                    autoscaler: { 
                      ...config.autoscaler, 
                      enabled: checked,
                      minNodes: config.autoscaler?.minNodes || 1,
                      maxNodes: config.autoscaler?.maxNodes || 3,
                    }
                  })}
                />
              </div>
              
              {config.autoscaler?.enabled && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Min Nodes</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={config.autoscaler?.minNodes || 1}
                      onChange={(e) => onUpdate({ 
                        autoscaler: { ...config.autoscaler!, minNodes: parseInt(e.target.value) || 1 }
                      })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max Nodes</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={config.autoscaler?.maxNodes || 3}
                      onChange={(e) => onUpdate({ 
                        autoscaler: { ...config.autoscaler!, maxNodes: parseInt(e.target.value) || 3 }
                      })}
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Use Spot Instances</Label>
                      <ToggleSwitch
                        id="spot-instances"
                        checked={config.autoscaler?.spotInstances || false}
                        onChange={(checked) => onUpdate({ 
                          autoscaler: { ...config.autoscaler!, spotInstances: checked }
                        })}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Up to 90% cost savings with spot/preemptible instances</p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded text-xs text-amber-600 dark:text-amber-400">
              <strong>Note:</strong> Cloud execution is in development. Training will run on your local machine for now.
            </div>
          </div>
        )}
      </div>
      
      <Separator />
      
      {/* ML Framework */}
      <div className="space-y-2">
        <Label>ML Framework</Label>
        <Select value={config.framework} onValueChange={(value) => onUpdate({ framework: value as TrainingConfig['framework'] })}>
          <SelectTrigger>
            <SelectValue placeholder="Select framework" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pytorch">PyTorch</SelectItem>
            <SelectItem value="tensorflow">TensorFlow</SelectItem>
            <SelectItem value="sklearn">Scikit-Learn</SelectItem>
            <SelectItem value="xgboost">XGBoost</SelectItem>
            <SelectItem value="lightgbm">LightGBM</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <Separator />
      
      {/* Training Script Section */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Training Script</Label>
        
        <div className="space-y-2">
          <Label>Script Source</Label>
          <Select 
            value={config.scriptSource || 'local'} 
            onValueChange={(value) => onUpdate({ scriptSource: value as 'local' | 'git' })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local File</SelectItem>
              <SelectItem value="git">Git Repository</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {config.scriptSource === 'local' && (
          <div className="space-y-2">
            <Label htmlFor="localScriptPath">Script Path</Label>
            <Input
              id="localScriptPath"
              value={config.localScriptPath || ''}
              onChange={(e) => onUpdate({ localScriptPath: e.target.value })}
              placeholder="/path/to/train.py"
            />
          </div>
        )}
        
        {config.scriptSource === 'git' && (
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>Git Provider</Label>
              <Select 
                value={config.gitConfig?.provider || 'github'} 
                onValueChange={(value) => onUpdate({ 
                  gitConfig: { ...config.gitConfig, provider: value as any, repoUrl: config.gitConfig?.repoUrl || '', entryScript: config.gitConfig?.entryScript || 'train.py' }
                })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub</SelectItem>
                  <SelectItem value="gitlab">GitLab</SelectItem>
                  <SelectItem value="dagshub">DagsHub</SelectItem>
                  <SelectItem value="azure-devops">Azure DevOps</SelectItem>
                  <SelectItem value="bitbucket">Bitbucket</SelectItem>
                  <SelectItem value="custom">Custom URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="repoUrl">Repository URL</Label>
              <Input
                id="repoUrl"
                value={config.gitConfig?.repoUrl || ''}
                onChange={(e) => onUpdate({ 
                  gitConfig: { ...config.gitConfig, repoUrl: e.target.value, provider: config.gitConfig?.provider || 'github', entryScript: config.gitConfig?.entryScript || 'train.py' }
                })}
                placeholder="https://github.com/user/repo.git"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>Branch</Label>
                <div className="flex gap-1">
                  <Select 
                    value={config.gitConfig?.branch || 'main'} 
                    onValueChange={(value) => onUpdate({ 
                      gitConfig: { ...config.gitConfig, branch: value, repoUrl: config.gitConfig?.repoUrl || '', provider: config.gitConfig?.provider || 'github', entryScript: config.gitConfig?.entryScript || 'train.py' }
                    })}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.length > 0 ? (
                        branches.map((branch) => (
                          <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="main">main</SelectItem>
                          <SelectItem value="master">master</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="h-9 w-9"
                    onClick={fetchBranches}
                    disabled={isFetchingBranches || !config.gitConfig?.repoUrl}
                  >
                    <RefreshCw className={`h-4 w-4 ${isFetchingBranches ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="commitId">Commit ID (optional)</Label>
                <Input
                  id="commitId"
                  value={config.gitConfig?.commitId || ''}
                  onChange={(e) => onUpdate({ 
                    gitConfig: { ...config.gitConfig, commitId: e.target.value, repoUrl: config.gitConfig?.repoUrl || '', provider: config.gitConfig?.provider || 'github', entryScript: config.gitConfig?.entryScript || 'train.py' }
                  })}
                  placeholder="abc123..."
                  className="font-mono text-xs"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="entryScript">Entry Script (relative to repo root)</Label>
              <Input
                id="entryScript"
                value={config.gitConfig?.entryScript || ''}
                onChange={(e) => onUpdate({ 
                  gitConfig: { ...config.gitConfig, entryScript: e.target.value, repoUrl: config.gitConfig?.repoUrl || '', provider: config.gitConfig?.provider || 'github' }
                })}
                placeholder="train.py or src/train.py"
              />
            </div>
            
            {gitConnections.length > 0 && (
              <div className="space-y-2">
                <Label>Git Connection (for private repos)</Label>
                <Select 
                  value={config.gitConfig?.connectionId || ''} 
                  onValueChange={(value) => onUpdate({ 
                    gitConfig: { ...config.gitConfig, connectionId: value || undefined, repoUrl: config.gitConfig?.repoUrl || '', provider: config.gitConfig?.provider || 'github', entryScript: config.gitConfig?.entryScript || 'train.py' }
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Public repo (no auth)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Public repo (no auth)</SelectItem>
                    <SelectSeparator />
                    {gitConnections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>{conn.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
        
        {/* Detect Parameters Button */}
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full"
          onClick={parseScript}
          disabled={isParsingScript || (!config.localScriptPath && config.scriptSource === 'local')}
        >
          {isParsingScript ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Detecting Parameters...
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-2" />
              Detect Parameters from Script
            </>
          )}
        </Button>
        
        {parseError && (
          <div className="p-2 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
            {parseError}
          </div>
        )}
      </div>
      
      <Separator />
      
      {/* Detected Parameters Section */}
      <DetectedParametersSection 
        detectedParams={config.detectedParams}
        parameterValues={config.parameterValues}
        onParamChange={handleParamChange}
        renderParamInput={renderParamInput}
      />
      
      <Separator />
      
      {/* Manual Training Parameters (fallback) */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Manual Parameters</Label>
        <p className="text-xs text-muted-foreground">Override or add parameters manually</p>
        
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Epochs</Label>
            <Input
              type="number"
              className="h-8"
              value={config.epochs || ''}
              onChange={(e) => onUpdate({ epochs: parseInt(e.target.value) || undefined })}
              placeholder="10"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Batch Size</Label>
            <Input
              type="number"
              className="h-8"
              value={config.batchSize || ''}
              onChange={(e) => onUpdate({ batchSize: parseInt(e.target.value) || undefined })}
              placeholder="32"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Learning Rate</Label>
            <Input
              type="number"
              step="0.0001"
              className="h-8"
              value={config.learningRate || ''}
              onChange={(e) => onUpdate({ learningRate: parseFloat(e.target.value) || undefined })}
              placeholder="0.001"
            />
          </div>
        </div>
      </div>
      
      <Separator />
      
      {/* Environment Configuration */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Environment</Label>
        
        <div className="space-y-2">
          <Label>Virtual Environment</Label>
          <Select 
            value={config.venvConfig?.mode || 'auto'} 
            onValueChange={(value) => onUpdate({ 
              venvConfig: { ...config.venvConfig, mode: value as any }
            })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              <SelectItem value="requirements">requirements.txt</SelectItem>
              <SelectItem value="conda">Conda (environment.yml)</SelectItem>
              <SelectItem value="poetry">Poetry (pyproject.toml)</SelectItem>
              <SelectItem value="none">System Python</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {config.venvConfig?.mode === 'requirements' && (
          <div className="space-y-2">
            <Label className="text-xs">Requirements file path (relative to script dir)</Label>
            <Input
              value={config.venvConfig?.requirementsPath || ''}
              onChange={(e) => onUpdate({ 
                venvConfig: { ...config.venvConfig, requirementsPath: e.target.value, mode: config.venvConfig?.mode || 'requirements' }
              })}
              placeholder="requirements.txt"
            />
          </div>
        )}
      </div>
      
      {/* Settings Dialog */}
      <ControlledSettingsDialog 
        open={settingsOpen} 
        onOpenChange={setSettingsOpen} 
        defaultTab="connections" 
      />
    </div>
  );
}
