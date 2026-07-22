'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { ExperimentConfig as ExperimentConfigType } from '@/types/pipeline';

// Experiment Configuration Panel
interface ExperimentConfigPanelProps {
  config: ExperimentConfigType;
  onUpdate: (updates: Partial<ExperimentConfigType>) => void;
}

export function ExperimentConfigPanel({ config, onUpdate }: ExperimentConfigPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Experiment Tracker</Label>
        <Select value={config.tracker} onValueChange={(value) => onUpdate({ tracker: value as ExperimentConfigType['tracker'] })}>
          <SelectTrigger>
            <SelectValue placeholder="Select tracker" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="clearml">ClearML</SelectItem>
            <SelectItem value="mlflow">MLflow</SelectItem>
            <SelectItem value="wandb">Weights & Biases</SelectItem>
            <SelectItem value="comet">Comet ML</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="projectName">Project Name</Label>
        <Input
          id="projectName"
          value={config.projectName}
          onChange={(e) => onUpdate({ projectName: e.target.value })}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="experimentName">Experiment Name</Label>
        <Input
          id="experimentName"
          value={config.experimentName}
          onChange={(e) => onUpdate({ experimentName: e.target.value })}
        />
      </div>
      
      {config.tracker !== 'none' && (
        <>
          <Separator />
          <Label className="text-sm font-semibold">Tracker Credentials</Label>
          
          {config.tracker === 'clearml' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="clearmlApiHost">API Host</Label>
                <Input
                  id="clearmlApiHost"
                  value={config.credentials.clearmlApiHost || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, clearmlApiHost: e.target.value }
                  })}
                  placeholder="https://api.clear.ml"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearmlWebHost">Web Host</Label>
                <Input
                  id="clearmlWebHost"
                  value={config.credentials.clearmlWebHost || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, clearmlWebHost: e.target.value }
                  })}
                  placeholder="https://app.clear.ml"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearmlFilesHost">Files Host</Label>
                <Input
                  id="clearmlFilesHost"
                  value={config.credentials.clearmlFilesHost || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, clearmlFilesHost: e.target.value }
                  })}
                  placeholder="https://files.clear.ml"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clearmlAccessKey">Access Key</Label>
                <Input
                  id="clearmlAccessKey"
                  type="password"
                  value={config.credentials.clearmlAccessKey || ''}
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
                  value={config.credentials.clearmlSecretKey || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, clearmlSecretKey: e.target.value }
                  })}
                />
              </div>
            </>
          )}
          
          {config.tracker === 'mlflow' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mlflowTrackingUri">Tracking URI</Label>
                <Input
                  id="mlflowTrackingUri"
                  value={config.credentials.mlflowTrackingUri || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, mlflowTrackingUri: e.target.value }
                  })}
                  placeholder="http://localhost:5000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mlflowUsername">Username</Label>
                <Input
                  id="mlflowUsername"
                  value={config.credentials.mlflowUsername || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, mlflowUsername: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mlflowPassword">Password</Label>
                <Input
                  id="mlflowPassword"
                  type="password"
                  value={config.credentials.mlflowPassword || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, mlflowPassword: e.target.value }
                  })}
                />
              </div>
            </>
          )}
          
          {config.tracker === 'wandb' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="wandbApiKey">API Key</Label>
                <Input
                  id="wandbApiKey"
                  type="password"
                  value={config.credentials.wandbApiKey || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, wandbApiKey: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wandbEntity">Entity / Team</Label>
                <Input
                  id="wandbEntity"
                  value={config.credentials.wandbEntity || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, wandbEntity: e.target.value }
                  })}
                />
              </div>
            </>
          )}
          
          {config.tracker === 'comet' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="cometApiKey">API Key</Label>
                <Input
                  id="cometApiKey"
                  type="password"
                  value={config.credentials.cometApiKey || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, cometApiKey: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cometWorkspace">Workspace</Label>
                <Input
                  id="cometWorkspace"
                  value={config.credentials.cometWorkspace || ''}
                  onChange={(e) => onUpdate({ 
                    credentials: { ...config.credentials, cometWorkspace: e.target.value }
                  })}
                />
              </div>
            </>
          )}
        </>
      )}
      
      <Separator />
      <Label className="text-sm font-semibold">Logging Options</Label>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="logMetrics">Log Metrics</Label>
          <input
            type="checkbox"
            id="logMetrics"
            checked={config.logMetrics}
            onChange={(e) => onUpdate({ logMetrics: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="logArtifacts">Log Artifacts</Label>
          <input
            type="checkbox"
            id="logArtifacts"
            checked={config.logArtifacts}
            onChange={(e) => onUpdate({ logArtifacts: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="logHyperparameters">Log Hyperparameters</Label>
          <input
            type="checkbox"
            id="logHyperparameters"
            checked={config.logHyperparameters}
            onChange={(e) => onUpdate({ logHyperparameters: e.target.checked })}
            className="h-4 w-4"
          />
        </div>
      </div>
    </div>
  );
}
