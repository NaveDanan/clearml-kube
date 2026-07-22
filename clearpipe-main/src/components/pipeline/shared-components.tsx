'use client';

import { useState, useEffect } from 'react';
import { X, Plus, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { usePipelineStore } from '@/stores/pipeline-store';
import { getConnectedSourceNode, getAvailableOutputVariables } from '@/components/nodes/shared/utils';

// Multi-Select Path Input Component with Output Variable Suggestions
interface MultiPathInputWithSuggestionsProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  nodeId?: string;
}

export function MultiPathInputWithSuggestions({ 
  values, 
  onChange, 
  placeholder, 
  nodeId 
}: MultiPathInputWithSuggestionsProps) {
  const { nodes, edges } = usePipelineStore();
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [manualPath, setManualPath] = useState('');
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
  
  const handleToggleVariable = (variable: string) => {
    if (values.includes(variable)) {
      onChange(values.filter(v => v !== variable));
    } else {
      onChange([...values, variable]);
    }
  };
  
  const handleAddManualPath = () => {
    if (manualPath.trim() && !values.includes(manualPath.trim())) {
      onChange([...values, manualPath.trim()]);
      setManualPath('');
    }
  };
  
  const handleRemovePath = (path: string) => {
    onChange(values.filter(v => v !== path));
  };
  
  const isSourceNodeVariable = (path: string) => path.includes('{{sourceNode.');
  
  return (
    <div className="space-y-3">
      {/* Selected paths */}
      {values.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Selected paths:</Label>
          <div className="flex flex-wrap gap-2">
            {values.map((path, index) => (
              <Badge 
                key={index} 
                variant={isSourceNodeVariable(path) ? "default" : "secondary"}
                className="text-xs gap-1 py-1 px-2"
              >
                <span className="truncate max-w-[180px]" title={path}>
                  {isSourceNodeVariable(path) 
                    ? path.replace('{{sourceNode.', '').replace('}}', '')
                    : path}
                </span>
                <button
                  onClick={() => handleRemovePath(path)}
                  className="ml-1 hover:opacity-75"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
      
      {/* Source node outputs selection */}
      {availableVars.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="w-full bg-muted/50 px-3 py-2 flex items-center justify-between hover:bg-muted/70 transition-colors"
          >
            <span className="text-sm font-medium">Source Node Outputs</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showSuggestions ? 'rotate-0' : '-rotate-90'}`}
            />
          </button>
          
          {showSuggestions && (
            <div className="p-2 space-y-1 border-t">
              {availableVars.map((varInfo, index) => {
                const isSelected = values.includes(varInfo.variable);
                return (
                  <button
                    key={index}
                    onClick={() => handleToggleVariable(varInfo.variable)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center gap-2 ${
                      isSelected 
                        ? 'bg-primary text-primary-foreground' 
                        : 'hover:bg-accent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleVariable(varInfo.variable)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="font-mono text-xs">{varInfo.variable.replace('{{sourceNode.', '').replace('}}', '')}</div>
                      <div className={`text-xs ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {varInfo.label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      
      {/* Manual path input */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Or add a custom path:</Label>
        <div className="flex gap-2">
          <Input
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder={placeholder || "e.g., /path/to/data"}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddManualPath();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddManualPath}
            disabled={!manualPath.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
