'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, ArrowLeft, RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { getConnectedSourceNode, getAvailableOutputVariables } from '@/components/nodes/shared/utils';
import { PathInputWithSuggestions, providerInfo } from './dataset-conf-panel';
import type { ExecuteConfig, ExecuteStep, DataSourceVariableMapping } from '@/types/pipeline';

// Execute Configuration Panel
interface ExecuteConfigPanelProps {
  config: ExecuteConfig;
  onUpdate: (updates: Partial<ExecuteConfig>) => void;
  nodeId?: string;
}

export function ExecuteConfigPanel({ config, onUpdate, nodeId }: ExecuteConfigPanelProps) {
  const { nodes, edges } = usePipelineStore();
  const { connections, fetchConnections } = useSettingsStore();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [hoveredStepId, setHoveredStepId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [venvStatus, setVenvStatus] = useState<{
    checking: boolean;
    detected: boolean;
    venvPath?: string;
    pythonPath?: string;
    error?: string;
  }>({ checking: false, detected: false });
  const [availableSourceOutputs, setAvailableSourceOutputs] = useState<Array<{ variable: string; label: string }>>([]);
  
  // Get available output variables from connected source node
  useEffect(() => {
    if (nodeId) {
      const connectedNode = getConnectedSourceNode(nodeId, nodes, edges);
      if (connectedNode) {
        const vars = getAvailableOutputVariables(connectedNode.data);
        setAvailableSourceOutputs(vars);
      } else {
        setAvailableSourceOutputs([]);
      }
    }
  }, [nodeId, nodes, edges]);
  
  // Fetch connections on mount
  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);
  
  // Get configured connections (those marked as configured)
  const configuredConnections = connections.filter(conn => conn.isConfigured);
  
  const editingStep = editingStepId ? config.steps.find(s => s.id === editingStepId) : null;
  
  const handleDeleteStep = (stepId: string) => {
    onUpdate({ steps: config.steps.filter(s => s.id !== stepId) });
    if (editingStepId === stepId) {
      setEditingStepId(null);
    }
  };
  
  const handleUpdateStep = useCallback((stepId: string, updates: Partial<ExecuteStep>) => {
    onUpdate({
      steps: config.steps.map(s => 
        s.id === stepId ? { ...s, ...updates } : s
      )
    });
  }, [config.steps, onUpdate]);
  
  // Check venv when script path changes or when editing a step with local source
  const checkVenv = useCallback(async (scriptPath: string, customVenvPath?: string, autoUpdateStepId?: string) => {
    if (!scriptPath && !customVenvPath) {
      setVenvStatus({ checking: false, detected: false, error: 'No script path provided' });
      return;
    }
    
    setVenvStatus({ checking: true, detected: false });
    
    try {
      const response = await fetch('/api/execute/check-venv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath, customVenvPath }),
      });
      
      const data = await response.json();
      
      setVenvStatus({
        checking: false,
        detected: data.detected,
        venvPath: data.venvPath,
        pythonPath: data.pythonPath,
        error: data.error,
      });
      
      // If auto-detected and we have a step to update, update only venv fields
      if (data.detected && autoUpdateStepId && !customVenvPath) {
        handleUpdateStep(autoUpdateStepId, { 
          venvPath: data.venvPath,
          venvMode: 'auto'
        });
      }
    } catch (error) {
      setVenvStatus({
        checking: false,
        detected: false,
        error: (error as Error).message,
      });
    }
  }, [handleUpdateStep]);
  
  // Auto-check venv when editing step changes or script path is set
  // Use a ref to track previous script path to avoid unnecessary re-checks
  const prevScriptPathRef = useRef<string | undefined>(undefined);
  
  useEffect(() => {
    if (editingStep && (editingStep.scriptSource === 'local' || !editingStep.scriptSource)) {
      const currentScriptPath = editingStep.scriptPath;
      
      // Only auto-check if script path actually changed
      if (currentScriptPath !== prevScriptPathRef.current) {
        prevScriptPathRef.current = currentScriptPath;
        
        if (editingStep.venvMode === 'custom' && editingStep.venvPath) {
          checkVenv(currentScriptPath || '', editingStep.venvPath);
        } else if (currentScriptPath) {
          // Pass the step ID for auto-update, but only update venv fields
          checkVenv(currentScriptPath, undefined, editingStep.id);
        } else {
          setVenvStatus({ checking: false, detected: false });
        }
      }
    } else {
      prevScriptPathRef.current = undefined;
    }
  }, [editingStep?.id, editingStep?.scriptPath, editingStep?.venvPath, editingStep?.venvMode, editingStep?.scriptSource, checkVenv]);
  
  const handleAddStep = () => {
    const newStep: ExecuteStep = {
      id: `step-${Date.now()}`,
      name: 'New Step',
      type: 'custom' as const,
      params: {},
      enabled: true,
      scriptSource: 'local',
      scriptPath: '',
      dataSourceMappings: [{ variableName: 'DATA_SOURCE', sourceOutput: 'inputPath' }],
      outputVariables: ['OUTPUT_PATH'],
    };
    onUpdate({ steps: [...config.steps, newStep] });
  };
  
  // Helper functions for managing data source mappings
  const getDataSourceMappings = (step: ExecuteStep): DataSourceVariableMapping[] => {
    // Support both old dataSourceVariable and new dataSourceMappings
    if (step.dataSourceMappings && step.dataSourceMappings.length > 0) {
      return step.dataSourceMappings;
    }
    // Migrate from old single variable to new mappings format
    if (step.dataSourceVariable) {
      return [{ variableName: step.dataSourceVariable, sourceOutput: 'inputPath' }];
    }
    return [{ variableName: 'DATA_SOURCE', sourceOutput: 'inputPath' }];
  };
  
  const handleAddDataSourceMapping = (stepId: string) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentMappings = getDataSourceMappings(step);
    const newVarName = `DATA_SOURCE_${currentMappings.length + 1}`;
    handleUpdateStep(stepId, { 
      dataSourceMappings: [...currentMappings, { variableName: newVarName, sourceOutput: 'inputPath' }],
      dataSourceVariable: undefined // Clear legacy field
    });
  };
  
  const handleRemoveDataSourceMapping = (stepId: string, index: number) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentMappings = getDataSourceMappings(step);
    if (currentMappings.length <= 1) return; // Keep at least one
    handleUpdateStep(stepId, { 
      dataSourceMappings: currentMappings.filter((_, i) => i !== index),
      dataSourceVariable: undefined // Clear legacy field
    });
  };
  
  const handleUpdateDataSourceMapping = (stepId: string, index: number, updates: Partial<DataSourceVariableMapping>) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentMappings = [...getDataSourceMappings(step)];
    currentMappings[index] = { ...currentMappings[index], ...updates };
    handleUpdateStep(stepId, { 
      dataSourceMappings: currentMappings,
      dataSourceVariable: undefined // Clear legacy field
    });
  };
  
  // Helper functions for managing output variables
  const getOutputVariables = (step: ExecuteStep): string[] => {
    return step.outputVariables && step.outputVariables.length > 0 
      ? step.outputVariables 
      : ['OUTPUT_PATH'];
  };
  
  const handleAddOutputVariable = (stepId: string) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentVars = getOutputVariables(step);
    const newVarName = `OUTPUT_PATH_${currentVars.length + 1}`;
    handleUpdateStep(stepId, { outputVariables: [...currentVars, newVarName] });
  };
  
  const handleRemoveOutputVariable = (stepId: string, index: number) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentVars = getOutputVariables(step);
    if (currentVars.length <= 1) return; // Keep at least one
    handleUpdateStep(stepId, { 
      outputVariables: currentVars.filter((_, i) => i !== index) 
    });
  };
  
  const handleUpdateOutputVariable = (stepId: string, index: number, value: string) => {
    const step = config.steps.find(s => s.id === stepId);
    if (!step) return;
    const currentVars = [...getOutputVariables(step)];
    currentVars[index] = value;
    handleUpdateStep(stepId, { outputVariables: currentVars });
  };
  
  // If editing a step, show the edit panel
  if (editingStep) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditingStepId(null)}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="font-medium">Edit Step</span>
        </div>
        
        <Separator />
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stepName">Step Name</Label>
            <Input
              id="stepName"
              value={editingStep.name}
              onChange={(e) => handleUpdateStep(editingStep.id, { name: e.target.value })}
              placeholder="e.g., Data Cleaning"
            />
          </div>
          
          <div className="space-y-2">
            <Label>Execution Mode</Label>
            <Select 
              value={editingStep.executionMode || 'local'} 
              onValueChange={(value) => handleUpdateStep(editingStep.id, { executionMode: value as 'local' | 'cloud' })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="cloud">Cloud</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Cloud Connection Section */}
          {editingStep.executionMode === 'cloud' && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Cloud Connection</Label>
                <Select 
                  value={editingStep.connectionId ? `conn:${editingStep.connectionId}` : '__none__'} 
                  onValueChange={(value) => {
                    if (value === '__add_source__') {
                      setSettingsOpen(true);
                      return;
                    }
                    if (value === '__none__') {
                      handleUpdateStep(editingStep.id, { connectionId: undefined });
                      return;
                    }
                    if (value.startsWith('conn:')) {
                      const connectionId = value.replace('conn:', '');
                      handleUpdateStep(editingStep.id, { connectionId });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select connection">
                      {editingStep.connectionId ? (() => {
                        const conn = connections.find(c => c.id === editingStep.connectionId);
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
                
                {/* Show connection info when using a saved connection */}
                {editingStep.connectionId && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Credentials are managed in Settings → Connections
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
                  </div>
                )}
                
                {!editingStep.connectionId && configuredConnections.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    No connections configured. Add a connection to use cloud execution.
                  </p>
                )}
              </div>
            </>
          )}
          
          <Separator />
          
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Script Configuration</Label>
          </div>
          
          <div className="space-y-2">
            <Label>Script Source</Label>
            <Select 
              value={editingStep.scriptSource || 'local'} 
              onValueChange={(value) => handleUpdateStep(editingStep.id, { scriptSource: value as 'local' | 'inline' })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local File</SelectItem>
                <SelectItem value="inline">Inline Script</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {editingStep.scriptSource === 'local' || !editingStep.scriptSource ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="scriptPath">Script Path</Label>
                <PathInputWithSuggestions
                  value={editingStep.scriptPath || ''}
                  onChange={(value) => handleUpdateStep(editingStep.id, { scriptPath: value })}
                  placeholder="e.g., /path/to/preprocess.py or {{sourceNode.outputPath}}"
                  nodeId={nodeId}
                />
                <p className="text-xs text-muted-foreground">
                  Path to the Python script (.py file) that will be executed
                </p>
              </div>
              
              {/* Environment (Virtual Environment) Configuration */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Environment</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => {
                      if (editingStep.venvMode === 'custom' && editingStep.venvPath) {
                        checkVenv(editingStep.scriptPath || '', editingStep.venvPath);
                      } else {
                        checkVenv(editingStep.scriptPath || '');
                      }
                    }}
                    disabled={venvStatus.checking}
                  >
                    <RefreshCw className={`h-3 w-3 ${venvStatus.checking ? 'animate-spin' : ''}`} />
                    Detect
                  </Button>
                </div>
                
                <Select 
                  value={editingStep.venvMode || 'auto'} 
                  onValueChange={(value) => {
                    handleUpdateStep(editingStep.id, { 
                      venvMode: value as 'auto' | 'custom' | 'none',
                      venvPath: value === 'none' ? undefined : editingStep.venvPath
                    });
                    if (value === 'auto' && editingStep.scriptPath) {
                      checkVenv(editingStep.scriptPath);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select environment mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect (.venv)</SelectItem>
                    <SelectItem value="custom">Custom path</SelectItem>
                    <SelectItem value="none">System Python</SelectItem>
                  </SelectContent>
                </Select>
                
                {editingStep.venvMode === 'custom' && (
                  <Input
                    value={editingStep.venvPath || ''}
                    onChange={(e) => handleUpdateStep(editingStep.id, { venvPath: e.target.value })}
                    onBlur={(e) => {
                      if (e.target.value) {
                        checkVenv(editingStep.scriptPath || '', e.target.value);
                      }
                    }}
                    placeholder="e.g., /path/to/.venv or ~/myproject/venv"
                  />
                )}
                
                {/* Venv Status Badge */}
                {(editingStep.venvMode !== 'none') && (
                  <div className="flex items-center gap-2 mt-2">
                    {venvStatus.checking ? (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Checking...
                      </Badge>
                    ) : venvStatus.detected ? (
                      <Badge variant="default" className="text-xs gap-1 bg-green-600 hover:bg-green-700">
                        <CheckCircle2 className="h-3 w-3" />
                        venv detected
                      </Badge>
                    ) : editingStep.scriptPath ? (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <XCircle className="h-3 w-3" />
                        venv not detected
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Enter script path first
                      </Badge>
                    )}
                  </div>
                )}
                
                {venvStatus.detected && venvStatus.venvPath && (
                  <p className="text-xs text-muted-foreground truncate" title={venvStatus.venvPath}>
                    Using: {venvStatus.venvPath}
                  </p>
                )}
                
                {!venvStatus.detected && venvStatus.error && editingStep.scriptPath && editingStep.venvMode !== 'none' && (
                  <p className="text-xs text-destructive">
                    {venvStatus.error}
                  </p>
                )}
                
                {editingStep.venvMode === 'none' && (
                  <p className="text-xs text-muted-foreground">
                    Will use system Python (python3). Make sure required packages are installed globally.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="inlineScript">Inline Script</Label>
              <Textarea
                id="inlineScript"
                value={editingStep.inlineScript || ''}
                onChange={(e) => handleUpdateStep(editingStep.id, { inlineScript: e.target.value })}
                placeholder="# Python code..."
                className="font-mono text-sm"
                rows={8}
              />
            </div>
          )}
          
          <Separator />
          
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Variable Configuration</Label>
            <p className="text-xs text-muted-foreground">
              Configure the variable names in your script that will be replaced with actual paths
            </p>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="useDataSourceVariable">Data Source Variables</Label>
              <ToggleSwitch
                id="useDataSourceVariable"
                checked={editingStep.useDataSourceVariable !== false}
                onChange={(checked) => handleUpdateStep(editingStep.id, { useDataSourceVariable: checked })}
              />
            </div>
            {editingStep.useDataSourceVariable !== false && (
              <>
                <div className="flex items-center justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddDataSourceMapping(editingStep.id)}
                    className="h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Variable
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Map variables in your script to outputs from the connected node
                </p>
                <div className="space-y-3">
                  {getDataSourceMappings(editingStep).map((mapping, index) => (
                    <div key={index} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-muted-foreground">Variable {index + 1}</Label>
                        {getDataSourceMappings(editingStep).length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:text-destructive"
                            onClick={() => handleRemoveDataSourceMapping(editingStep.id, index)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Variable Name</Label>
                        <Input
                          value={mapping.variableName}
                          onChange={(e) => handleUpdateDataSourceMapping(editingStep.id, index, { variableName: e.target.value })}
                          placeholder="DATA_SOURCE"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Replace With</Label>
                        <Select
                          value={mapping.sourceOutput}
                          onValueChange={(value) => handleUpdateDataSourceMapping(editingStep.id, index, { sourceOutput: value })}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select source output" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inputPath">
                              <span className="flex items-center gap-2">
                                <span className="text-primary">Input Path</span>
                                <span className="text-xs text-muted-foreground">(default)</span>
                              </span>
                            </SelectItem>
                            {availableSourceOutputs.length > 0 && (
                              <>
                                <SelectSeparator />
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                  From Connected Node
                                </div>
                                {availableSourceOutputs.map((output, idx) => (
                                  <SelectItem key={idx} value={output.variable}>
                                    <span className="flex flex-col">
                                      <span className="font-mono text-xs">{output.variable}</span>
                                      <span className="text-xs text-muted-foreground">{output.label}</span>
                                    </span>
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {mapping.sourceOutput === 'inputPath' 
                            ? 'Uses the input path passed to this step'
                            : `Uses ${mapping.sourceOutput} from the connected node`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {editingStep.useDataSourceVariable === false && (
              <p className="text-xs text-muted-foreground">
                Data source variable replacement is disabled
              </p>
            )}
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="useOutputVariables">Output Variables</Label>
              <ToggleSwitch
                id="useOutputVariables"
                checked={editingStep.useOutputVariables !== false}
                onChange={(checked) => handleUpdateStep(editingStep.id, { useOutputVariables: checked })}
              />
            </div>
            {editingStep.useOutputVariables !== false && (
              <>
                <div className="flex items-center justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddOutputVariable(editingStep.id)}
                    className="h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Output
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Variable names that will contain output paths from your script
                </p>
                <div className="space-y-2">
                  {getOutputVariables(editingStep).map((varName, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={varName}
                        onChange={(e) => handleUpdateOutputVariable(editingStep.id, index, e.target.value)}
                        placeholder={`OUTPUT_PATH_${index + 1}`}
                        className="flex-1"
                      />
                      {getOutputVariables(editingStep).length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveOutputVariable(editingStep.id, index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
            {editingStep.useOutputVariables === false && (
              <p className="text-xs text-muted-foreground">
                Output variable replacement is disabled
              </p>
            )}
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Enabled</Label>
            <input
              type="checkbox"
              id="enabled"
              checked={editingStep.enabled}
              onChange={(e) => handleUpdateStep(editingStep.id, { enabled: e.target.checked })}
              className="h-4 w-4"
            />
          </div>
        </div>
        
        {/* Settings Dialog for adding connections */}
        <ControlledSettingsDialog 
          open={settingsOpen} 
          onOpenChange={setSettingsOpen} 
          defaultTab="connections" 
        />
      </div>
    );
  }
  
  // Default view: list of steps
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Execute Steps</Label>
        <div className="space-y-2">
          {config.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps configured</p>
          ) : (
            config.steps.map((step, index) => (
              <Card 
                key={step.id} 
                className="p-3 relative group"
                onMouseEnter={() => setHoveredStepId(step.id)}
                onMouseLeave={() => setHoveredStepId(null)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{index + 1}. {step.name}</span>
                    {step.scriptPath && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {step.scriptPath}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant={step.executionMode === 'cloud' ? 'secondary' : 'outline'}>
                      {step.executionMode === 'cloud' ? '☁️ Cloud' : '💻 Local'}
                    </Badge>
                    {hoveredStepId === step.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setEditingStepId(step.id)}
                          title="Edit step"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteStep(step.id)}
                          title="Delete step"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleAddStep}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Step
        </Button>
      </div>
      
      <Separator />
      
      <div className="space-y-2">
        <Label htmlFor="customCode">Custom Execute Code</Label>
        <Textarea
          id="customCode"
          value={config.customCode || ''}
          onChange={(e) => onUpdate({ customCode: e.target.value })}
          placeholder="# Python code..."
          className="font-mono text-sm"
          rows={6}
        />
      </div>
    </div>
  );
}
