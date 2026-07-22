'use client';

import { useState, useEffect } from 'react';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Eye, 
  EyeOff, 
  Key, 
  Cloud, 
  Check,
  AlertCircle,
  Server,
  Loader2,
  Keyboard
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CinematicThemeSwitcher from '@/components/ui/cinematic-theme-switcher';
import { KeyboardShortcutsDialog } from '@/components/ui/keyboard-shortcuts-dialog';
import {
  useSettingsStore,
  CloudProviderType,
  Secret,
  CloudConnection,
  AWSConnection,
  GCPConnection,
  AzureConnection,
  MinIOConnection,
  ClearMLConnection,
} from '@/stores/settings-store';

// Provider display info
const providerInfo: Record<CloudProviderType, { label: string; icon: string; color: string }> = {
  aws: { label: 'Amazon Web Services', icon: '🟠', color: 'bg-orange-500' },
  gcp: { label: 'Google Cloud Platform', icon: '🔵', color: 'bg-blue-500' },
  azure: { label: 'Microsoft Azure', icon: '🔷', color: 'bg-sky-500' },
  minio: { label: 'MinIO', icon: '🟣', color: 'bg-purple-500' },
  clearml: { label: 'ClearML', icon: '🟢', color: 'bg-green-500' },
};

// Secret creation form
function SecretForm({ onClose }: { onClose: () => void }) {
  const { addSecret } = useSettingsStore();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [provider, setProvider] = useState<CloudProviderType>('aws');
  const [showValue, setShowValue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name && value) {
      setIsSubmitting(true);
      try {
        await addSecret({ name, value, provider });
        onClose();
      } catch (error) {
        console.error('Failed to add secret:', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="secret-name">Secret Name</Label>
        <Input
          id="secret-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., AWS Access Key"
          required
          disabled={isSubmitting}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="secret-provider">Provider</Label>
        <Select value={provider} onValueChange={(v) => setProvider(v as CloudProviderType)} disabled={isSubmitting}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(providerInfo).map(([key, info]) => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="secret-value">Secret Value</Label>
        <div className="relative">
          <Input
            id="secret-value"
            type={showValue ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter your secret value"
            className="pr-10"
            required
            disabled={isSubmitting}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3"
            onClick={() => setShowValue(!showValue)}
            disabled={isSubmitting}
          >
            {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          This value will be stored securely and won&apos;t be visible after saving.
        </p>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            'Add Secret'
          )}
        </Button>
      </div>
    </form>
  );
}

// Connection creation/edit form
function ConnectionForm({ 
  provider,
  existingConnection,
  onClose 
}: { 
  provider: CloudProviderType;
  existingConnection?: CloudConnection;
  onClose: () => void;
}) {
  const { addConnection, updateConnection, getSecretsByProvider } = useSettingsStore();
  const secrets = getSecretsByProvider(provider);
  
  // Form state based on provider
  const [name, setName] = useState(existingConnection?.name || '');
  
  // AWS
  const [awsRegion, setAwsRegion] = useState((existingConnection as AWSConnection)?.region || 'us-east-1');
  const [awsBucket, setAwsBucket] = useState((existingConnection as AWSConnection)?.bucket || '');
  const [awsAccessKeySecretId, setAwsAccessKeySecretId] = useState((existingConnection as AWSConnection)?.accessKeySecretId || '');
  const [awsSecretKeySecretId, setAwsSecretKeySecretId] = useState((existingConnection as AWSConnection)?.secretKeySecretId || '');
  
  // GCP
  const [gcpProjectId, setGcpProjectId] = useState((existingConnection as GCPConnection)?.projectId || '');
  const [gcpBucket, setGcpBucket] = useState((existingConnection as GCPConnection)?.bucket || '');
  const [gcpServiceAccountKeySecretId, setGcpServiceAccountKeySecretId] = useState((existingConnection as GCPConnection)?.serviceAccountKeySecretId || '');
  
  // Azure
  const [azureSubscriptionId, setAzureSubscriptionId] = useState((existingConnection as AzureConnection)?.subscriptionId || '');
  const [azureTenantId, setAzureTenantId] = useState((existingConnection as AzureConnection)?.tenantId || '');
  const [azureClientId, setAzureClientId] = useState((existingConnection as AzureConnection)?.clientId || '');
  const [azureAccountName, setAzureAccountName] = useState((existingConnection as AzureConnection)?.accountName || '');
  const [azureContainer, setAzureContainer] = useState((existingConnection as AzureConnection)?.container || '');
  const [azureClientSecretSecretId, setAzureClientSecretSecretId] = useState((existingConnection as AzureConnection)?.clientSecretSecretId || '');
  const [azureConnectionStringSecretId, setAzureConnectionStringSecretId] = useState((existingConnection as AzureConnection)?.connectionStringSecretId || '');
  
  // MinIO
  const [minioEndpoint, setMinioEndpoint] = useState((existingConnection as MinIOConnection)?.endpoint || '');
  const [minioBucket, setMinioBucket] = useState((existingConnection as MinIOConnection)?.bucket || '');
  const [minioAccessKeySecretId, setMinioAccessKeySecretId] = useState((existingConnection as MinIOConnection)?.accessKeySecretId || '');
  const [minioSecretKeySecretId, setMinioSecretKeySecretId] = useState((existingConnection as MinIOConnection)?.secretKeySecretId || '');
  
  // ClearML
  const [clearmlApiHost, setClearmlApiHost] = useState((existingConnection as ClearMLConnection)?.apiHost || 'https://api.clear.ml');
  const [clearmlWebHost, setClearmlWebHost] = useState((existingConnection as ClearMLConnection)?.webHost || 'https://app.clear.ml');
  const [clearmlFilesHost, setClearmlFilesHost] = useState((existingConnection as ClearMLConnection)?.filesHost || 'https://files.clear.ml');
  const [clearmlAccessKeySecretId, setClearmlAccessKeySecretId] = useState((existingConnection as ClearMLConnection)?.accessKeySecretId || '');
  const [clearmlSecretKeySecretId, setClearmlSecretKeySecretId] = useState((existingConnection as ClearMLConnection)?.secretKeySecretId || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      switch (provider) {
        case 'aws': {
          const awsConnection: Omit<AWSConnection, 'id'> = {
            name,
            provider: 'aws',
            region: awsRegion,
            bucket: awsBucket || undefined,
            accessKeySecretId: awsAccessKeySecretId || undefined,
            secretKeySecretId: awsSecretKeySecretId || undefined,
            isConfigured: !!(awsAccessKeySecretId && awsSecretKeySecretId),
          };
          if (existingConnection) {
            await updateConnection(existingConnection.id, awsConnection);
          } else {
            await addConnection(awsConnection as Omit<CloudConnection, 'id'>);
          }
          break;
        }
        case 'gcp': {
          const gcpConnection: Omit<GCPConnection, 'id'> = {
            name,
            provider: 'gcp',
            projectId: gcpProjectId,
            bucket: gcpBucket || undefined,
            serviceAccountKeySecretId: gcpServiceAccountKeySecretId || undefined,
            isConfigured: !!(gcpProjectId && gcpServiceAccountKeySecretId),
          };
          if (existingConnection) {
            await updateConnection(existingConnection.id, gcpConnection);
          } else {
            await addConnection(gcpConnection as Omit<CloudConnection, 'id'>);
          }
          break;
        }
        case 'azure': {
          const azureConnection: Omit<AzureConnection, 'id'> = {
            name,
            provider: 'azure',
            subscriptionId: azureSubscriptionId || undefined,
            tenantId: azureTenantId || undefined,
            clientId: azureClientId || undefined,
            accountName: azureAccountName || undefined,
            container: azureContainer || undefined,
            clientSecretSecretId: azureClientSecretSecretId || undefined,
            connectionStringSecretId: azureConnectionStringSecretId || undefined,
            isConfigured: !!(azureConnectionStringSecretId || (azureAccountName && azureClientSecretSecretId)),
          };
          if (existingConnection) {
            await updateConnection(existingConnection.id, azureConnection);
          } else {
            await addConnection(azureConnection as Omit<CloudConnection, 'id'>);
          }
          break;
        }
        case 'minio': {
          const minioConnection: Omit<MinIOConnection, 'id'> = {
            name,
            provider: 'minio',
            endpoint: minioEndpoint,
            bucket: minioBucket || undefined,
            accessKeySecretId: minioAccessKeySecretId || undefined,
            secretKeySecretId: minioSecretKeySecretId || undefined,
            isConfigured: !!(minioEndpoint && minioAccessKeySecretId && minioSecretKeySecretId),
          };
          if (existingConnection) {
            await updateConnection(existingConnection.id, minioConnection);
          } else {
            await addConnection(minioConnection as Omit<CloudConnection, 'id'>);
          }
          break;
        }
        case 'clearml': {
          const clearmlConnection: Omit<ClearMLConnection, 'id'> = {
            name,
            provider: 'clearml',
            apiHost: clearmlApiHost,
            webHost: clearmlWebHost,
            filesHost: clearmlFilesHost,
            accessKeySecretId: clearmlAccessKeySecretId || undefined,
            secretKeySecretId: clearmlSecretKeySecretId || undefined,
            isConfigured: !!(clearmlAccessKeySecretId && clearmlSecretKeySecretId),
          };
          if (existingConnection) {
            await updateConnection(existingConnection.id, clearmlConnection);
          } else {
            await addConnection(clearmlConnection as Omit<CloudConnection, 'id'>);
          }
          break;
        }
      }
      
      onClose();
    } catch (error) {
      console.error('Failed to save connection:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const SecretSelect = ({ 
    value, 
    onChange, 
    label 
  }: { 
    value: string; 
    onChange: (v: string) => void; 
    label: string; 
  }) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select 
        value={value || "__none__"} 
        onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a secret" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None</SelectItem>
          {secrets.map((secret) => (
            <SelectItem key={secret.id} value={secret.id}>
              <span className="flex items-center gap-2">
                <Key className="h-3 w-3" />
                {secret.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {secrets.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No secrets available. Add secrets in the Secrets tab first.
        </p>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="connection-name">Connection Name</Label>
        <Input
          id="connection-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`e.g., Production ${providerInfo[provider].label}`}
          required
        />
      </div>

      <Separator />

      {provider === 'aws' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="aws-region">Region</Label>
            <Input
              id="aws-region"
              value={awsRegion}
              onChange={(e) => setAwsRegion(e.target.value)}
              placeholder="e.g., us-east-1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aws-bucket">Default Bucket (optional)</Label>
            <Input
              id="aws-bucket"
              value={awsBucket}
              onChange={(e) => setAwsBucket(e.target.value)}
              placeholder="e.g., my-data-bucket"
            />
          </div>
          <SecretSelect
            label="Access Key ID"
            value={awsAccessKeySecretId}
            onChange={setAwsAccessKeySecretId}
          />
          <SecretSelect
            label="Secret Access Key"
            value={awsSecretKeySecretId}
            onChange={setAwsSecretKeySecretId}
          />
        </>
      )}

      {provider === 'gcp' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="gcp-project">Project ID</Label>
            <Input
              id="gcp-project"
              value={gcpProjectId}
              onChange={(e) => setGcpProjectId(e.target.value)}
              placeholder="e.g., my-gcp-project"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gcp-bucket">Default Bucket (optional)</Label>
            <Input
              id="gcp-bucket"
              value={gcpBucket}
              onChange={(e) => setGcpBucket(e.target.value)}
              placeholder="e.g., my-gcs-bucket"
            />
          </div>
          <SecretSelect
            label="Service Account Key (JSON)"
            value={gcpServiceAccountKeySecretId}
            onChange={setGcpServiceAccountKeySecretId}
          />
        </>
      )}

      {provider === 'azure' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="azure-subscription">Subscription ID</Label>
              <Input
                id="azure-subscription"
                value={azureSubscriptionId}
                onChange={(e) => setAzureSubscriptionId(e.target.value)}
                placeholder="Subscription ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-tenant">Tenant ID</Label>
              <Input
                id="azure-tenant"
                value={azureTenantId}
                onChange={(e) => setAzureTenantId(e.target.value)}
                placeholder="Tenant ID"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="azure-client">Client ID</Label>
              <Input
                id="azure-client"
                value={azureClientId}
                onChange={(e) => setAzureClientId(e.target.value)}
                placeholder="Client ID"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-account">Account Name</Label>
              <Input
                id="azure-account"
                value={azureAccountName}
                onChange={(e) => setAzureAccountName(e.target.value)}
                placeholder="Storage account"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="azure-container">Default Container (optional)</Label>
            <Input
              id="azure-container"
              value={azureContainer}
              onChange={(e) => setAzureContainer(e.target.value)}
              placeholder="e.g., my-container"
            />
          </div>
          <SecretSelect
            label="Client Secret"
            value={azureClientSecretSecretId}
            onChange={setAzureClientSecretSecretId}
          />
          <SecretSelect
            label="Connection String (alternative)"
            value={azureConnectionStringSecretId}
            onChange={setAzureConnectionStringSecretId}
          />
        </>
      )}

      {provider === 'minio' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="minio-endpoint">Endpoint</Label>
            <Input
              id="minio-endpoint"
              value={minioEndpoint}
              onChange={(e) => setMinioEndpoint(e.target.value)}
              placeholder="e.g., http://localhost:9000"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="minio-bucket">Default Bucket (optional)</Label>
            <Input
              id="minio-bucket"
              value={minioBucket}
              onChange={(e) => setMinioBucket(e.target.value)}
              placeholder="e.g., my-bucket"
            />
          </div>
          <SecretSelect
            label="Access Key"
            value={minioAccessKeySecretId}
            onChange={setMinioAccessKeySecretId}
          />
          <SecretSelect
            label="Secret Key"
            value={minioSecretKeySecretId}
            onChange={setMinioSecretKeySecretId}
          />
        </>
      )}

      {provider === 'clearml' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="clearml-api">API Host</Label>
            <Input
              id="clearml-api"
              value={clearmlApiHost}
              onChange={(e) => setClearmlApiHost(e.target.value)}
              placeholder="https://api.clear.ml"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clearml-web">Web Host</Label>
            <Input
              id="clearml-web"
              value={clearmlWebHost}
              onChange={(e) => setClearmlWebHost(e.target.value)}
              placeholder="https://app.clear.ml"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="clearml-files">Files Host</Label>
            <Input
              id="clearml-files"
              value={clearmlFilesHost}
              onChange={(e) => setClearmlFilesHost(e.target.value)}
              placeholder="https://files.clear.ml"
            />
          </div>
          <SecretSelect
            label="Access Key"
            value={clearmlAccessKeySecretId}
            onChange={setClearmlAccessKeySecretId}
          />
          <SecretSelect
            label="Secret Key"
            value={clearmlSecretKeySecretId}
            onChange={setClearmlSecretKeySecretId}
          />
        </>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            `${existingConnection ? 'Update' : 'Add'} Connection`
          )}
        </Button>
      </div>
    </form>
  );
}

// Secrets list component
function SecretsSection() {
  const { secrets, removeSecret, fetchSecrets, isLoading } = useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await removeSecret(id);
    } catch (error) {
      console.error('Failed to delete secret:', error);
    } finally {
      setDeletingId(null);
    }
  };

  if (isAdding) {
    return <SecretForm onClose={() => setIsAdding(false)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label className="text-base font-semibold">Secrets</Label>
          <p className="text-sm text-muted-foreground">
            Store sensitive credentials securely. Values are hidden after saving.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Secret
        </Button>
      </div>
      
      <ScrollArea className="h-[300px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
            <Key className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No secrets added yet</p>
            <p className="text-xs">Add secrets to use in your cloud connections</p>
          </div>
        ) : (
          <div className="space-y-2">
            {secrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${providerInfo[secret.provider].color}`} />
                  <div>
                    <p className="font-medium text-sm">{secret.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {providerInfo[secret.provider].label} • Added {new Date(secret.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    ••••••••
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(secret.id)}
                    disabled={deletingId === secret.id}
                  >
                    {deletingId === secret.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// Connections list component
function ConnectionsSection() {
  const { connections, removeConnection, fetchConnections, isLoading } = useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<CloudProviderType>('aws');
  const [editingConnection, setEditingConnection] = useState<CloudConnection | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await removeConnection(id);
    } catch (error) {
      console.error('Failed to delete connection:', error);
    } finally {
      setDeletingId(null);
    }
  };

  if (isAdding || editingConnection) {
    return (
      <ConnectionForm
        provider={editingConnection?.provider || selectedProvider}
        existingConnection={editingConnection || undefined}
        onClose={() => {
          setIsAdding(false);
          setEditingConnection(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label className="text-base font-semibold">Connections</Label>
          <p className="text-sm text-muted-foreground">
            Configure cloud provider connections using your stored secrets.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Select value={selectedProvider} onValueChange={(v) => setSelectedProvider(v as CloudProviderType)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(providerInfo).map(([key, info]) => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Connection
        </Button>
      </div>
      
      <ScrollArea className="h-[250px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
            <Cloud className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No connections configured</p>
            <p className="text-xs">Add connections to use cloud providers in your pipelines</p>
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => setEditingConnection(connection)}
              >
                <div className="flex items-center gap-3">
                  <div className="text-xl">{providerInfo[connection.provider].icon}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{connection.name}</p>
                      {connection.isConfigured ? (
                        <Badge variant="default" className="h-5 text-[10px] bg-green-500">
                          <Check className="h-3 w-3 mr-1" />
                          Configured
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="h-5 text-[10px]">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Incomplete
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {providerInfo[connection.provider].label}
                      {connection.provider === 'aws' && (connection as AWSConnection).region && 
                        ` • ${(connection as AWSConnection).region}`}
                      {connection.provider === 'gcp' && (connection as GCPConnection).projectId && 
                        ` • ${(connection as GCPConnection).projectId}`}
                      {connection.provider === 'minio' && (connection as MinIOConnection).endpoint && 
                        ` • ${(connection as MinIOConnection).endpoint}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => handleDelete(connection.id, e)}
                  disabled={deletingId === connection.id}
                >
                  {deletingId === connection.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// Settings dialog content component (used internally)
function SettingsDialogContent({ defaultTab = 'appearance' }: { defaultTab?: string }) {
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  
  return (
    <>
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Configure your application preferences, connections, and secrets.
        </DialogDescription>
      </DialogHeader>
      
      <Tabs defaultValue={defaultTab} className="mt-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="appearance" className="flex items-center gap-1">
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Appearance</span>
          </TabsTrigger>
          <TabsTrigger value="connections" className="flex items-center gap-1">
            <Cloud className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Connections</span>
          </TabsTrigger>
          <TabsTrigger value="secrets" className="flex items-center gap-1">
            <Key className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Secrets</span>
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="appearance" className="mt-4 space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-base font-semibold">Appearance</Label>
              <p className="text-sm text-muted-foreground">
                Choose between light and dark mode for the interface.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Theme</Label>
                <p className="text-xs text-muted-foreground">
                  Toggle between light and dark mode
                </p>
              </div>
              <CinematicThemeSwitcher size="sm" />
            </div>
          </div>
          
          <Separator />
          
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-base font-semibold">Keyboard Shortcuts</Label>
              <p className="text-sm text-muted-foreground">
                Learn keyboard shortcuts to speed up your workflow.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Shortcuts Cheatsheet</Label>
                <p className="text-xs text-muted-foreground">
                  View all available keyboard shortcuts
                </p>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShortcutsDialogOpen(true)}
                className="flex items-center gap-2"
              >
                <Keyboard className="h-4 w-4" />
                View Shortcuts
              </Button>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="connections" className="mt-4">
          <ConnectionsSection />
        </TabsContent>
        
        <TabsContent value="secrets" className="mt-4">
          <SecretsSection />
        </TabsContent>
      </Tabs>
      
      <KeyboardShortcutsDialog 
        open={shortcutsDialogOpen} 
        onOpenChange={setShortcutsDialogOpen} 
      />
    </>
  );
}

// Default SettingsDialog with trigger button
export function SettingsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh]">
        <SettingsDialogContent />
      </DialogContent>
    </Dialog>
  );
}

// Controlled SettingsDialog that can be opened programmatically
interface ControlledSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'appearance' | 'connections' | 'secrets';
}

export function ControlledSettingsDialog({ 
  open, 
  onOpenChange, 
  defaultTab = 'appearance' 
}: ControlledSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh]">
        <SettingsDialogContent defaultTab={defaultTab} />
      </DialogContent>
    </Dialog>
  );
}
