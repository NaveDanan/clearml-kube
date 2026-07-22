'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Save,
  SaveAll,
  FolderOpen,
  FileDown,
  FileUp,
  Play,
  RotateCcw,
  Plus,
  Ellipsis,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
} from 'lucide-react';
import { usePipelineStore } from '@/stores/pipeline-store';
import { cn } from '@/lib/utils';
import type { PipelineNodeData, PipelineNode, PipelineEdge, DatasetNodeData, ExecuteNodeData, VersioningNodeData, ExecutionLogs } from '@/types/pipeline';
import { checkDatasetConnection, runExecute, executeVersioning } from '@/components/nodes';
import { UserDropdown } from '@/components/ui/user-dropdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CollaboratorAvatars } from '@/components/collaboration/collaborator-avatars';
import UniqueLoading from '@/components/ui/morph-loading';
import { useRouter } from 'next/navigation';
import { useUnsavedChanges } from '@/components/ui/unsaved-changes-dialog';

interface NodeExecutionResult {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  success: boolean;
  message?: string;
  outputPath?: string;
  outputPaths?: Record<string, string>; // Named outputs: { OUTPUT_PATH: "/path/to/file", TRAIN_OUT: "/path/train.csv" }
  fileCount?: number;
  error?: string;
}

interface PipelineToolbarProps {
  onSaveRef?: React.MutableRefObject<(() => void) | null>;
  onSaveAsRef?: React.MutableRefObject<(() => void) | null>;
}

// Helper function to get execution order based on graph topology
function getExecutionOrder(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
  // Build adjacency list and in-degree count
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();
  
  nodes.forEach(node => {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  });
  
  edges.forEach(edge => {
    const targets = adjacencyList.get(edge.source) || [];
    targets.push(edge.target);
    adjacencyList.set(edge.source, targets);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  });
  
  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  const result: PipelineNode[] = [];
  
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });
  
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodes.find(n => n.id === currentId);
    if (currentNode) {
      result.push(currentNode);
    }
    
    const neighbors = adjacencyList.get(currentId) || [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  return result;
}

// Helper function to get the source node for a given node
function getSourceNode(nodeId: string, edges: PipelineEdge[], nodes: PipelineNode[]): PipelineNode | null {
  const incomingEdge = edges.find(e => e.target === nodeId);
  if (!incomingEdge) return null;
  return nodes.find(n => n.id === incomingEdge.source) || null;
}

export function PipelineToolbar({ onSaveRef, onSaveAsRef }: PipelineToolbarProps = {}) {
  const {
    nodes,
    edges,
    currentPipeline,
    savedPipelines,
    isDirty,
    isLoading,
    savePipeline,
    saveAsNewPipeline,
    loadPipeline,
    createNewPipeline,
    deletePipeline,
    exportPipeline,
    importPipeline,
    fetchPipelines,
    reset,
    updateNodeStatus,
    updateNodeExecutionLogs,
    updateNodeData,
  } = usePipelineStore();

  const router = useRouter();
  
  // Get the unsaved changes checker
  const { checkUnsavedChanges } = useUnsavedChanges();

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [saveAsDialogOpen, setSaveAsDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch saved pipelines on mount
  React.useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);
  const [isRunning, setIsRunning] = useState(false);
  const [runResults, setRunResults] = useState<NodeExecutionResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [pipelineName, setPipelineName] = useState(currentPipeline?.name || '');
  const [pipelineDescription, setPipelineDescription] = useState(
    currentPipeline?.description || ''
  );
  const [isPublic, setIsPublic] = useState(false);
  
  // Store for passing data between nodes during execution
  const [nodeOutputs, setNodeOutputs] = useState<Map<string, { path: string; fileCount?: number }>>(new Map());

  // Fetch pipeline share status on mount or when pipeline changes
  React.useEffect(() => {
    const fetchShareStatus = async () => {
      if (!currentPipeline?.id) {
        setIsPublic(false);
        return;
      }
      
      try {
        const res = await fetch(`/api/pipelines/${currentPipeline.id}/share`);
        if (res.ok) {
          const data = await res.json();
          setIsPublic(data.isPublic || false);
        }
      } catch (error) {
        console.error('Failed to fetch share status:', error);
      }
    };

    fetchShareStatus();
  }, [currentPipeline?.id]);

  const handleSave = async () => {
    if (currentPipeline?.id) {
      // Pipeline exists, save directly
      await savePipeline(currentPipeline.name, currentPipeline.description || '');
    } else {
      // New pipeline, open Save As dialog
      setPipelineName('');
      setPipelineDescription('');
      setSaveAsDialogOpen(true);
    }
  };

  // Open the Save As dialog (for keyboard shortcut)
  const openSaveAsDialog = () => {
    setPipelineName(currentPipeline?.name ? `${currentPipeline.name} Copy` : '');
    setPipelineDescription(currentPipeline?.description || '');
    setSaveAsDialogOpen(true);
  };

  // Expose save functions to parent via refs (for keyboard shortcuts)
  React.useEffect(() => {
    if (onSaveRef) {
      onSaveRef.current = handleSave;
    }
    if (onSaveAsRef) {
      onSaveAsRef.current = openSaveAsDialog;
    }
    return () => {
      if (onSaveRef) {
        onSaveRef.current = null;
      }
      if (onSaveAsRef) {
        onSaveAsRef.current = null;
      }
    };
  }, [onSaveRef, onSaveAsRef, currentPipeline?.id, currentPipeline?.name, currentPipeline?.description]);

  const handleRename = () => {
    if (pipelineName.trim()) {
      savePipeline(pipelineName.trim(), pipelineDescription.trim());
      setRenameDialogOpen(false);
    }
  };

  const handleSaveAs = async () => {
    if (pipelineName.trim()) {
      try {
        await saveAsNewPipeline(pipelineName.trim(), pipelineDescription.trim());
        setSaveAsDialogOpen(false);
      } catch (error) {
        console.error('Error saving pipeline as:', error);
        alert('Failed to save pipeline. Please try again.');
      }
    }
  };

  const handleExport = async () => {
    try {
      const json = exportPipeline();
      const blob = new Blob([json], { type: 'application/json' });

      // Check if the browser supports the File System Access API
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `${currentPipeline?.name || 'pipeline'}.json`,
            types: [
              {
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] },
              },
            ],
          });

          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          // User cancelled the save dialog or File System Access API not supported
          if ((error as Error).name !== 'AbortError') {
            console.error('Error saving file:', error);
            // Fall back to standard download
            fallbackDownload(blob);
          }
        }
      } else {
        // Fallback for browsers that don't support File System Access API
        fallbackDownload(blob);
      }
    } catch (error) {
      console.error('Error exporting pipeline:', error);
      alert('Failed to export pipeline. Please try again.');
    }
  };

  const fallbackDownload = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentPipeline?.name || 'pipeline'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Wrapper for new pipeline that checks for unsaved changes
  const handleNewPipeline = () => {
    checkUnsavedChanges({ type: 'new' }, () => {
      createNewPipeline();
    });
  };

  // Wrapper for loading a pipeline that checks for unsaved changes
  const handleLoadPipeline = (pipelineId: string) => {
    checkUnsavedChanges({ type: 'open', payload: pipelineId }, () => {
      loadPipeline(pipelineId);
      setLoadDialogOpen(false);
    });
  };

  // Internal import function (called after unsaved check)
  const doImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        const success = importPipeline(text);
        if (!success) {
          alert('Failed to import pipeline. Please check the file format.');
        }
      }
    };
    input.click();
  };

  // Wrapper for import that checks for unsaved changes
  const handleImport = () => {
    checkUnsavedChanges({ type: 'import' }, doImport);
  };

  const handleDeletePipeline = async (pipelineId: string, isCurrentPipeline: boolean = false) => {
    setIsDeleting(true);
    try {
      await deletePipeline(pipelineId);
      // Close the load dialog if it's open
      setLoadDialogOpen(false);
      // If we deleted the current pipeline, redirect to home
      if (isCurrentPipeline) {
        // Wait a moment for the animation to be visible
        setTimeout(() => {
          router.push('/');
        }, 1000);
      }
    } catch (error) {
      console.error('Error deleting pipeline:', error);
      setIsDeleting(false);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    const results: NodeExecutionResult[] = [];
    const outputs = new Map<string, { path: string; fileCount?: number }>();

    if (nodes.length === 0) {
      alert('No nodes in the pipeline. Please add at least one node.');
      setIsRunning(false);
      return;
    }

    // Get the execution order based on graph topology
    const executionOrder = getExecutionOrder(nodes, edges);

    // Execute nodes in order
    for (const node of executionOrder) {
      const nodeData = node.data as PipelineNodeData;
      const nodeType = nodeData.type;

      try {
        updateNodeStatus(node.id, 'running', 'Executing...');

        let result: NodeExecutionResult;

        switch (nodeType) {
          case 'dataset': {
            const datasetData = nodeData as DatasetNodeData;
            let resolvedPath = datasetData.config.path;
            
            // Resolve variable references like {{sourceNode.OUTPUT_PATH}}
            if (resolvedPath && resolvedPath.includes('{{sourceNode.')) {
              const sourceNode = getSourceNode(node.id, edges, nodes);
              if (sourceNode) {
                const sourceOutput = outputs.get(sourceNode.id);
                if (sourceOutput) {
                  // Extract the variable name from the template
                  const varMatch = resolvedPath.match(/\{\{sourceNode\.(\w+)\}\}/);
                  if (varMatch) {
                    const varName = varMatch[1];
                    
                    // Check if the variable is in the source output's named outputs
                    const namedOutputs = (sourceOutput as any).namedOutputs;
                    if (namedOutputs && namedOutputs[varName]) {
                      resolvedPath = namedOutputs[varName];
                    } else if (varName.toLowerCase() === 'outputpath' || varName === 'path') {
                      // Fall back to the generic path
                      resolvedPath = sourceOutput.path;
                    } else {
                      // Variable not found in named outputs
                      result = {
                        nodeId: node.id,
                        nodeLabel: nodeData.label,
                        nodeType: nodeType,
                        success: false,
                        error: `Variable "${varName}" not found in source node output. Available: ${namedOutputs ? Object.keys(namedOutputs).join(', ') : 'outputPath'}`,
                        message: `Could not resolve {{sourceNode.${varName}}}`,
                      };
                      updateNodeStatus(node.id, 'error', `Variable ${varName} not found`);
                      break;
                    }
                  }
                } else {
                  result = {
                    nodeId: node.id,
                    nodeLabel: nodeData.label,
                    nodeType: nodeType,
                    success: false,
                    error: 'Source node has no output. Ensure the source node executed successfully.',
                    message: 'No source output available',
                  };
                  updateNodeStatus(node.id, 'error', 'No source output');
                  break;
                }
              } else {
                result = {
                  nodeId: node.id,
                  nodeLabel: nodeData.label,
                  nodeType: nodeType,
                  success: false,
                  error: 'No source node connected. Connect a node that produces output.',
                  message: 'No source node connected',
                };
                updateNodeStatus(node.id, 'error', 'No source connected');
                break;
              }
            }
            
            const checkResult = await checkDatasetConnection({
              ...datasetData.config,
              path: resolvedPath,
            });
            
            result = {
              nodeId: node.id,
              nodeLabel: nodeData.label,
              nodeType: nodeType,
              success: checkResult.success,
              fileCount: checkResult.fileCount,
              error: checkResult.error,
              message: checkResult.success 
                ? `Found ${checkResult.fileCount} files` 
                : checkResult.error,
              outputPath: resolvedPath,
            };

            if (checkResult.success) {
              outputs.set(node.id, { 
                path: resolvedPath, 
                fileCount: checkResult.fileCount 
              });
              updateNodeStatus(node.id, 'completed', `Found ${checkResult.fileCount} files`);
            } else {
              updateNodeStatus(node.id, 'error', checkResult.error || 'Connection failed');
            }
            break;
          }

          case 'execute': {
            const executeData = nodeData as ExecuteNodeData;
            
            // Get input path from the source node
            const sourceNode = getSourceNode(node.id, edges, nodes);
            let inputPath = '';
            
            if (sourceNode) {
              const sourceOutput = outputs.get(sourceNode.id);
              if (sourceOutput) {
                inputPath = sourceOutput.path;
              }
            }

            // Check if any enabled step requires data source variable
            const enabledSteps = executeData.config.steps?.filter(s => s.enabled) || [];
            const requiresInputPath = enabledSteps.some(step => step.useDataSourceVariable !== false);

            if (!inputPath && requiresInputPath) {
              result = {
                nodeId: node.id,
                nodeLabel: nodeData.label,
                nodeType: nodeType,
                success: false,
                error: 'No input data path available. Please connect a Dataset node.',
                message: 'No input data path available',
              };
              updateNodeStatus(node.id, 'error', 'No input data path');
              break;
            }

            const executeResult = await runExecute(executeData.config, inputPath);
            
            // Build named outputs from step results and config
            const namedOutputs: Record<string, string> = {};
            
            if (executeResult.success && executeResult.stepResults && executeResult.stepResults.length > 0) {
              executeResult.stepResults.forEach((stepResult, stepIndex) => {
                const step = enabledSteps[stepIndex];
                if (step && step.outputVariables && stepResult.outputPaths) {
                  step.outputVariables.forEach((varName, varIndex) => {
                    if (stepResult.outputPaths && stepResult.outputPaths[varIndex]) {
                      namedOutputs[varName] = stepResult.outputPaths[varIndex];
                    }
                  });
                }
              });
            }
            
            // Store the primary output path
            if (executeResult.outputPath) {
              namedOutputs['outputPath'] = executeResult.outputPath;
            }
            
            result = {
              nodeId: node.id,
              nodeLabel: nodeData.label,
              nodeType: nodeType,
              success: executeResult.success,
              message: executeResult.message,
              outputPath: executeResult.outputPath,
              outputPaths: Object.keys(namedOutputs).length > 0 ? namedOutputs : undefined,
              error: executeResult.success ? undefined : executeResult.message,
            };

            if (executeResult.success) {
              
              outputs.set(node.id, { 
                path: executeResult.outputPath || inputPath,
                namedOutputs,
              } as any);
              updateNodeStatus(node.id, 'completed', executeResult.message);
              
              // Store execution logs from step results
              if (executeResult.stepResults && executeResult.stepResults.length > 0) {
                const executionLogs: ExecutionLogs = {
                  startTime: new Date(Date.now() - 5000).toISOString(), // Approximate start time
                  endTime: new Date().toISOString(),
                  exitCode: 0,
                  logs: executeResult.stepResults.flatMap(step => {
                    const logs: Array<{ timestamp: string; type: 'stdout' | 'stderr' | 'system'; message: string }> = [];
                    
                    if (step.stdout) {
                      step.stdout.split('\n').filter(line => line.trim()).forEach(line => {
                        logs.push({
                          timestamp: new Date().toISOString(),
                          type: 'stdout',
                          message: line,
                        });
                      });
                    }
                    
                    if (step.stderr) {
                      step.stderr.split('\n').filter(line => line.trim()).forEach(line => {
                        logs.push({
                          timestamp: new Date().toISOString(),
                          type: 'stderr',
                          message: line,
                        });
                      });
                    }
                    
                    return logs;
                  }),
                };
                updateNodeExecutionLogs(node.id, executionLogs);
              }
            } else {
              updateNodeStatus(node.id, 'error', executeResult.message);
              
              // Store error logs
              if (executeResult.stepResults && executeResult.stepResults.length > 0) {
                const executionLogs: ExecutionLogs = {
                  startTime: new Date(Date.now() - 5000).toISOString(),
                  endTime: new Date().toISOString(),
                  exitCode: 1,
                  logs: executeResult.stepResults.flatMap(step => {
                    const logs: Array<{ timestamp: string; type: 'stdout' | 'stderr' | 'system'; message: string }> = [];
                    
                    if (step.error) {
                      logs.push({
                        timestamp: new Date().toISOString(),
                        type: 'stderr',
                        message: `Error: ${step.error}`,
                      });
                    }
                    
                    if (step.stdout) {
                      step.stdout.split('\n').filter(line => line.trim()).forEach(line => {
                        logs.push({
                          timestamp: new Date().toISOString(),
                          type: 'stdout',
                          message: line,
                        });
                      });
                    }
                    
                    if (step.stderr) {
                      step.stderr.split('\n').filter(line => line.trim()).forEach(line => {
                        logs.push({
                          timestamp: new Date().toISOString(),
                          type: 'stderr',
                          message: line,
                        });
                      });
                    }
                    
                    return logs;
                  }),
                };
                updateNodeExecutionLogs(node.id, executionLogs);
              }
            }
            break;
          }

          case 'versioning': {
            const versioningData = nodeData as VersioningNodeData;
            
            // Get source node outputs for variable resolution
            const sourceNode = getSourceNode(node.id, edges, nodes);
            let sourceNodeOutputs: Record<string, string> | undefined;
            
            if (sourceNode) {
              const sourceOutput = outputs.get(sourceNode.id);
              if (sourceOutput && typeof sourceOutput === 'object' && 'namedOutputs' in sourceOutput) {
                sourceNodeOutputs = (sourceOutput as any).namedOutputs;
              }
            }
            
            // Execute versioning with resolved paths and source node outputs
            const versioningResult = await executeVersioning(
              versioningData.config,
              undefined,
              nodes,
              edges,
              node.id,
              sourceNodeOutputs
            );
            
            result = {
              nodeId: node.id,
              nodeLabel: nodeData.label,
              nodeType: nodeType,
              success: versioningResult.success,
              message: versioningResult.message,
              outputPath: versioningResult.outputPath,
              error: versioningResult.success ? undefined : versioningResult.message,
            };

            if (versioningResult.success) {
              // Build named outputs for downstream nodes
              const namedOutputs: Record<string, string> = {};
              
              if (versioningResult.outputPath) {
                namedOutputs['outputPath'] = versioningResult.outputPath;
              }
              if (versioningResult.inputPath) {
                namedOutputs['inputPath'] = versioningResult.inputPath;
              }
              if (versioningResult.inputPaths) {
                namedOutputs['inputPaths'] = versioningResult.inputPaths.join(',');
                versioningResult.inputPaths.forEach((p, i) => {
                  namedOutputs[`inputPaths[${i}]`] = p;
                });
              }
              if (versioningResult.datasetId) {
                namedOutputs['datasetId'] = versioningResult.datasetId;
              }
              if (versioningResult.datasetName) {
                namedOutputs['datasetName'] = versioningResult.datasetName;
              }
              
              outputs.set(node.id, { 
                path: versioningResult.outputPath || versioningResult.inputPath || '',
                namedOutputs,
              } as any);
              updateNodeStatus(node.id, 'completed', versioningResult.message);
              
              // Handle auto-version after create
              if (versioningResult.shouldSwitchToVersion && versioningResult.createdDataset) {
                // Update the node config to switch from 'create' to 'version' mode
                updateNodeData(node.id, {
                  config: {
                    ...versioningData.config,
                    clearmlAction: 'version',
                    selectedDatasetId: versioningResult.createdDataset.id,
                    selectedDataset: {
                      id: versioningResult.createdDataset.id,
                      name: versioningResult.createdDataset.name,
                      project: versioningResult.createdDataset.project,
                    },
                    autoVersionAfterCreate: false, // Reset the toggle
                  },
                });
              }
            } else {
              updateNodeStatus(node.id, 'error', versioningResult.message);
            }
            break;
          }

          default: {
            // For other node types, just pass through the input
            const sourceNode = getSourceNode(node.id, edges, nodes);
            if (sourceNode) {
              const sourceOutput = outputs.get(sourceNode.id);
              if (sourceOutput) {
                outputs.set(node.id, sourceOutput);
              }
            }
            
            result = {
              nodeId: node.id,
              nodeLabel: nodeData.label,
              nodeType: nodeType,
              success: true,
              message: 'Node type not yet implemented for execution',
            };
            updateNodeStatus(node.id, 'completed', 'Skipped (not implemented)');
            break;
          }
        }

        results.push(result);

        // Stop execution if a node fails
        if (!result.success) {
          break;
        }
      } catch (error) {
        const errorMsg = (error as Error).message;
        results.push({
          nodeId: node.id,
          nodeLabel: nodeData.label,
          nodeType: nodeType,
          success: false,
          error: errorMsg,
          message: errorMsg,
        });
        updateNodeStatus(node.id, 'error', errorMsg);
        break;
      }
    }

    setNodeOutputs(outputs);
    setRunResults(results);
    setShowResults(true);
    setIsRunning(false);
  };

  return (
    <div className="flex items-center gap-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border rounded-lg p-2 shadow-lg">
      {/* Pipeline Name */}
      <div className="flex items-center gap-2 px-2">
        <span className="text-sm font-medium">
          {currentPipeline?.name || 'Untitled Pipeline'}
        </span>
        {currentPipeline?.id ? (
          <div className="relative">
            {isDirty && (
              <span className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-background z-10" />
            )}
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs",
                isPublic 
                  ? "bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30" 
                  : "bg-slate-500/20 text-slate-700 dark:text-slate-400 border-slate-500/30"
              )}
            >
              {isPublic ? 'Shared' : 'Private'}
            </Badge>
          </div>
        ) : isDirty && (
          <Badge variant="secondary" className="text-xs">
            Unsaved
          </Badge>
        )}
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Pipeline Menu Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Ellipsis className="w-4 h-4" />
            Pipeline
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={handleNewPipeline}>
            <Plus className="w-4 h-4 mr-2" />
            New Pipeline
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save
          </DropdownMenuItem>

          <Dialog open={saveAsDialogOpen} onOpenChange={(open) => {
            setSaveAsDialogOpen(open);
            if (open) {
              setPipelineName(currentPipeline?.name ? `${currentPipeline.name} Copy` : '');
              setPipelineDescription(currentPipeline?.description || '');
            }
          }}>
            <DialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} data-save-as-trigger>
                <SaveAll className="w-4 h-4 mr-2" />
                Save As...
              </DropdownMenuItem>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save Pipeline As</DialogTitle>
                <DialogDescription>
                  Create a new copy of this pipeline with a different name.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    placeholder="My ML Pipeline"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Input
                    value={pipelineDescription}
                    onChange={(e) => setPipelineDescription(e.target.value)}
                    placeholder="A brief description..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSaveAsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveAs} disabled={!pipelineName.trim()}>
                  Save As
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={renameDialogOpen} onOpenChange={(open) => {
            setRenameDialogOpen(open);
            if (open && currentPipeline) {
              setPipelineName(currentPipeline.name || '');
              setPipelineDescription(currentPipeline.description || '');
            }
          }}>
            <DialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={!currentPipeline?.id}>
                <Pencil className="w-4 h-4 mr-2" />
                Rename...
              </DropdownMenuItem>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename Pipeline</DialogTitle>
                <DialogDescription>
                  Update your pipeline name or description.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    placeholder="My ML Pipeline"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Input
                    value={pipelineDescription}
                    onChange={(e) => setPipelineDescription(e.target.value)}
                    placeholder="A brief description..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRename} disabled={!pipelineName.trim()}>
                  Rename
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={loadDialogOpen} onOpenChange={(open) => {
            setLoadDialogOpen(open && !isDeleting);
            if (open) {
              fetchPipelines();
            }
          }}>
            <DialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </DropdownMenuItem>
            </DialogTrigger>
            <DialogContent>
              {isDeleting && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center z-50">
                  <div className="flex flex-col items-center gap-4">
                    <UniqueLoading variant="morph" size="lg" />
                    <p className="text-sm font-medium text-white">Deleting pipeline...</p>
                  </div>
                </div>
              )}
              <DialogHeader>
                <DialogTitle>Open Pipeline</DialogTitle>
                <DialogDescription>
                  Select a saved pipeline to open.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 max-h-[300px] overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading pipelines...</span>
                  </div>
                ) : savedPipelines.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No saved pipelines yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {savedPipelines.map((pipeline) => (
                      <div
                        key={pipeline.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          setLoadDialogOpen(false);
                          handleLoadPipeline(pipeline.id);
                        }}
                      >
                        <div>
                          <p className="font-medium">{pipeline.name}</p>
                          {pipeline.description && (
                            <p className="text-xs text-muted-foreground">
                              {pipeline.description}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {pipeline.nodes.length} nodes •{' '}
                            {new Date(pipeline.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePipeline(pipeline.id, false);
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleExport}>
            <FileDown className="w-4 h-4 mr-2" />
            Export
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImport}>
            <FileUp className="w-4 h-4 mr-2" />
            Import
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => handleDeletePipeline(currentPipeline?.id || '', true)} className="text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Pipeline
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="h-6 w-px bg-border" />

      {/* Results Dialog */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pipeline Execution Results</DialogTitle>
            <DialogDescription>
              Execution results for all nodes in the pipeline
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3 py-4 pr-4">
              {runResults.map((result, index) => (
                <div key={result.nodeId} className="flex items-start gap-3 p-3 border rounded-lg">
                  <div className="pt-0.5">
                    {result.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{index + 1}.</span>
                      <p className="font-medium text-sm">{result.nodeLabel}</p>
                      <Badge variant="outline" className="text-xs">
                        {result.nodeType}
                      </Badge>
                    </div>
                    {result.success ? (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-sm text-green-600 font-medium">
                          ✓ {result.message || 'Completed successfully'}
                        </p>
                        {result.fileCount !== undefined && (
                          <p className="text-xs text-muted-foreground">
                            Files: {result.fileCount}
                          </p>
                        )}
                        {result.outputPaths && Object.keys(result.outputPaths).length > 0 ? (
                          <div className="mt-1 space-y-0.5">
                            <p className="text-xs text-muted-foreground font-medium">Outputs:</p>
                            {Object.entries(result.outputPaths)
                              .filter(([key]) => key !== 'outputPath') // Skip the generic outputPath if we have named ones
                              .map(([varName, path]) => (
                                <p key={varName} className="text-xs text-muted-foreground truncate pl-2" title={path}>
                                  <span className="font-mono text-primary">{varName}</span>: {path}
                                </p>
                              ))}
                          </div>
                        ) : result.outputPath && (
                          <p className="text-xs text-muted-foreground truncate" title={result.outputPath}>
                            Output: {result.outputPath}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-red-600 mt-1">
                        ✗ {result.error || result.message || 'Execution failed'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setShowResults(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Controls */}
      <Button 
        variant="default" 
        size="sm" 
        onClick={handleRun}
        disabled={isRunning}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-1" />
            Run Pipeline
          </>
        )}
      </Button>

      <div className="h-6 w-px bg-border" />

      {/* Online Collaborators */}
      <CollaboratorAvatars />

      {/* User Profile */}
      <UserDropdown />
    </div>
  );
}
