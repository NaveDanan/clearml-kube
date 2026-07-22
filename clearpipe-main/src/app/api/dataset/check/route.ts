import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface CheckDatasetRequest {
  source: 'local' | 's3' | 'gcs' | 'azure-blob' | 'minio' | 'clearml' | 'url';
  path: string;
  pathMode?: 'direct' | 'folder-regex'; // 'direct' for single file, 'folder-regex' for folder + file pattern
  format: string | string[];
  // S3/MinIO specific
  bucket?: string;
  region?: string;
  endpoint?: string;
  // Azure specific
  container?: string;
  // ClearML specific
  datasetId?: string;
  datasetProject?: string;
  connectionId?: string; // Reference to saved connection
  // Credentials
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
    serviceAccountKey?: string;
    // ClearML
    clearmlApiHost?: string;
    clearmlWebHost?: string;
    clearmlFilesHost?: string;
    clearmlAccessKey?: string;
    clearmlSecretKey?: string;
  };
}

interface CheckDatasetResponse {
  success: boolean;
  fileCount: number;
  error?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
}

// Convert format selections to regex pattern
function formatToRegexPattern(format: string | string[]): RegExp {
  if (!format) return /.*/;
  
  const formats = Array.isArray(format) ? format : [format];
  
  const extensionMap: Record<string, string> = {
    csv: 'csv', tsv: 'tsv', xlsx: 'xlsx', xls: 'xls',
    parquet: 'parquet', json: 'json', jsonl: 'jsonl', arrow: 'arrow',
    avro: 'avro', orc: 'orc', hdf5: 'hdf5|h5', netcdf: 'nc|netcdf',
    sqlite: 'sqlite|db', xml: 'xml', yaml: 'yaml|yml', pickle: 'pkl|pickle',
    feather: 'feather', jpg: 'jpg|jpeg', png: 'png', gif: 'gif', bmp: 'bmp',
    tiff: 'tiff|tif', webp: 'webp', svg: 'svg', mp4: 'mp4', avi: 'avi',
    mkv: 'mkv', mov: 'mov', flv: 'flv', wmv: 'wmv', webm: 'webm', mp3: 'mp3',
    wav: 'wav', flac: 'flac', aac: 'aac', ogg: 'ogg', m4a: 'm4a', wma: 'wma',
  };
  
  const extensionsToMatch = formats
    .filter(f => f !== 'custom')
    .map(f => extensionMap[f] || f);
  
  if (extensionsToMatch.length === 0) return /.*/;
  
  return new RegExp(`\\.(${extensionsToMatch.join('|')})$`, 'i');
}

// Recursively get all files in a directory
function getAllFiles(dirPath: string, filePattern: RegExp, arrayOfFiles: string[] = []): string[] {
  try {
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      
      try {
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          getAllFiles(filePath, filePattern, arrayOfFiles);
        } else if (filePattern.test(file)) {
          arrayOfFiles.push(filePath);
        }
      } catch {
        // Skip files that can't be accessed
      }
    });

    return arrayOfFiles;
  } catch (error) {
    throw error;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<CheckDatasetResponse>> {
  try {
    const body: CheckDatasetRequest = await request.json();
    const { source, path: datasetPath, pathMode, format, credentials, bucket, region, endpoint, container, datasetId, datasetProject, connectionId } = body;

    // Get file pattern from format
    const filePattern = formatToRegexPattern(format);

    // Handle local file source
    if (source === 'local') {
      return handleLocalSource(datasetPath, filePattern, pathMode);
    }

    // Handle AWS S3 source
    if (source === 's3') {
      return handleS3Source(bucket, datasetPath, region, credentials, filePattern);
    }

    // Handle MinIO source (S3-compatible)
    if (source === 'minio') {
      return handleMinIOSource(bucket, datasetPath, endpoint, credentials, filePattern);
    }

    // Handle Google Cloud Storage source
    if (source === 'gcs') {
      return handleGCSSource(bucket, datasetPath, credentials, filePattern);
    }

    // Handle Azure Blob Storage source
    if (source === 'azure-blob') {
      return handleAzureBlobSource(container, datasetPath, credentials, filePattern);
    }

    // Handle ClearML Dataset source
    if (source === 'clearml') {
      return handleClearMLSource(datasetId, datasetProject, credentials, filePattern, connectionId);
    }

    // Handle URL source
    if (source === 'url') {
      return handleURLSource(datasetPath, filePattern);
    }

    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'Unknown data source',
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: (error as Error).message,
    });
  }
}

// ============================================================================
// LOCAL FILE SYSTEM
// ============================================================================
function handleLocalSource(
  datasetPath: string,
  filePattern: RegExp,
  pathMode?: 'direct' | 'folder-regex'
): NextResponse<CheckDatasetResponse> {
  if (!datasetPath) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'Path not configured',
    });
  }

  // Expand tilde to user home directory (cross-platform: Linux, macOS, Windows)
  let resolvedPath = datasetPath;
  if (resolvedPath.startsWith('~')) {
    resolvedPath = resolvedPath.replace(/^~/, os.homedir());
  }

  // Check if path exists
  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `Path does not exist: ${datasetPath}`,
    });
  }

  const stat = fs.statSync(resolvedPath);

  // Handle direct file path mode
  if (pathMode === 'direct' || !stat.isDirectory()) {
    if (stat.isDirectory()) {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'Path is a directory. Use "Folder + File Format" mode for directories.',
      });
    }

    // It's a file - check if it matches the format
    const fileName = path.basename(resolvedPath);
    const matches = filePattern.test(fileName);

    if (!matches) {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: `File does not match the selected format(s): ${fileName}`,
      });
    }

    return NextResponse.json({
      success: true,
      fileCount: 1,
      files: [resolvedPath],
      metadata: {
        source: 'local',
        path: resolvedPath,
        pathMode: 'direct',
      },
    });
  }

  // Handle folder-regex mode (directory with file pattern matching)
  if (!stat.isDirectory()) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'Path is not a directory. Use "Direct File Path" mode for single files.',
    });
  }

  // Get all matching files
  const files = getAllFiles(resolvedPath, filePattern);

  return NextResponse.json({
    success: true,
    fileCount: files.length,
    files: files.slice(0, 100),
    metadata: {
      source: 'local',
      path: resolvedPath,
      pathMode: 'folder-regex',
    },
  });
}

// ============================================================================
// AWS S3
// ============================================================================
async function handleS3Source(
  bucket: string | undefined,
  prefix: string,
  region: string | undefined,
  credentials: CheckDatasetRequest['credentials'],
  filePattern: RegExp
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!bucket) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'S3 bucket not configured',
    });
  }

  if (!credentials?.accessKey || !credentials?.secretKey) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'AWS credentials not configured (Access Key and Secret Key required)',
    });
  }

  try {
    // Dynamic import for AWS SDK - check if package is installed
    let S3Client: any, ListObjectsV2Command: any;
    try {
      const awsS3 = await import('@aws-sdk/client-s3');
      S3Client = awsS3.S3Client;
      ListObjectsV2Command = awsS3.ListObjectsV2Command;
    } catch {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'AWS SDK not installed. Run: pnpm add @aws-sdk/client-s3',
      });
    }

    const s3Client = new S3Client({
      region: region || 'us-east-1',
      credentials: {
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.secretKey,
      },
    });

    const matchingFiles: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || '',
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && filePattern.test(obj.Key)) {
            matchingFiles.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return NextResponse.json({
      success: true,
      fileCount: matchingFiles.length,
      files: matchingFiles.slice(0, 100),
      metadata: {
        source: 's3',
        bucket,
        region: region || 'us-east-1',
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `S3 connection failed: ${(error as Error).message}`,
    });
  }
}

// ============================================================================
// MinIO (S3-Compatible)
// ============================================================================
async function handleMinIOSource(
  bucket: string | undefined,
  prefix: string,
  endpoint: string | undefined,
  credentials: CheckDatasetRequest['credentials'],
  filePattern: RegExp
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!bucket) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'MinIO bucket not configured',
    });
  }

  if (!endpoint) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'MinIO endpoint not configured',
    });
  }

  if (!credentials?.accessKey || !credentials?.secretKey) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'MinIO credentials not configured (Access Key and Secret Key required)',
    });
  }

  try {
    // Dynamic import for AWS SDK - check if package is installed
    let S3Client: any, ListObjectsV2Command: any;
    try {
      const awsS3 = await import('@aws-sdk/client-s3');
      S3Client = awsS3.S3Client;
      ListObjectsV2Command = awsS3.ListObjectsV2Command;
    } catch {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'AWS SDK not installed. Run: pnpm add @aws-sdk/client-s3',
      });
    }

    const s3Client = new S3Client({
      endpoint: endpoint,
      region: 'us-east-1', // MinIO doesn't use regions but requires one
      credentials: {
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });

    const matchingFiles: string[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || '',
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && filePattern.test(obj.Key)) {
            matchingFiles.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return NextResponse.json({
      success: true,
      fileCount: matchingFiles.length,
      files: matchingFiles.slice(0, 100),
      metadata: {
        source: 'minio',
        bucket,
        endpoint,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `MinIO connection failed: ${(error as Error).message}`,
    });
  }
}

// ============================================================================
// Google Cloud Storage
// ============================================================================
async function handleGCSSource(
  bucket: string | undefined,
  prefix: string,
  credentials: CheckDatasetRequest['credentials'],
  filePattern: RegExp
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!bucket) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'GCS bucket not configured',
    });
  }

  if (!credentials?.projectId || !credentials?.serviceAccountKey) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'GCS credentials not configured (Project ID and Service Account Key required)',
    });
  }

  try {
    // Dynamic import for GCS SDK - check if package is installed
    let Storage: any;
    try {
      const gcs = await import('@google-cloud/storage');
      Storage = gcs.Storage;
    } catch {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'Google Cloud Storage SDK not installed. Run: pnpm add @google-cloud/storage',
      });
    }

    // Parse the service account key
    let keyFile;
    try {
      keyFile = JSON.parse(credentials.serviceAccountKey);
    } catch {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'Invalid GCS service account key format (must be valid JSON)',
      });
    }

    const storage = new Storage({
      projectId: credentials.projectId,
      credentials: keyFile,
    });

    const [files] = await storage.bucket(bucket).getFiles({
      prefix: prefix || '',
    });

    const matchingFiles = files
      .filter((file: any) => filePattern.test(file.name))
      .map((file: any) => file.name);

    return NextResponse.json({
      success: true,
      fileCount: matchingFiles.length,
      files: matchingFiles.slice(0, 100),
      metadata: {
        source: 'gcs',
        bucket,
        projectId: credentials.projectId,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `GCS connection failed: ${(error as Error).message}`,
    });
  }
}

// ============================================================================
// Azure Blob Storage
// ============================================================================
async function handleAzureBlobSource(
  container: string | undefined,
  prefix: string,
  credentials: CheckDatasetRequest['credentials'],
  filePattern: RegExp
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!container) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'Azure container not configured',
    });
  }

  // Check for valid credentials (connection string OR account name + key/SAS)
  const hasConnectionString = !!credentials?.connectionString;
  const hasAccountCredentials = credentials?.accountName && (credentials?.accountKey || credentials?.sasToken);

  if (!hasConnectionString && !hasAccountCredentials) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'Azure credentials not configured (Connection String or Account Name + Key/SAS Token required)',
    });
  }

  try {
    // Dynamic import for Azure SDK - check if package is installed
    let BlobServiceClient: any, StorageSharedKeyCredential: any;
    try {
      const azureBlob = await import('@azure/storage-blob');
      BlobServiceClient = azureBlob.BlobServiceClient;
      StorageSharedKeyCredential = azureBlob.StorageSharedKeyCredential;
    } catch {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'Azure Storage SDK not installed. Run: pnpm add @azure/storage-blob',
      });
    }

    let blobServiceClient: InstanceType<typeof BlobServiceClient>;

    if (hasConnectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(credentials!.connectionString!);
    } else if (credentials?.accountKey) {
      const sharedKeyCredential = new StorageSharedKeyCredential(
        credentials.accountName!,
        credentials.accountKey
      );
      blobServiceClient = new BlobServiceClient(
        `https://${credentials.accountName}.blob.core.windows.net`,
        sharedKeyCredential
      );
    } else {
      // Using SAS token
      blobServiceClient = new BlobServiceClient(
        `https://${credentials!.accountName}.blob.core.windows.net?${credentials!.sasToken}`
      );
    }

    const containerClient = blobServiceClient.getContainerClient(container);
    const matchingFiles: string[] = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix: prefix || '' })) {
      if (filePattern.test(blob.name)) {
        matchingFiles.push(blob.name);
      }
    }

    return NextResponse.json({
      success: true,
      fileCount: matchingFiles.length,
      files: matchingFiles.slice(0, 100),
      metadata: {
        source: 'azure-blob',
        container,
        accountName: credentials?.accountName,
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `Azure Blob connection failed: ${(error as Error).message}`,
    });
  }
}

// ============================================================================
// ClearML Dataset
// ============================================================================
async function handleClearMLSource(
  datasetId: string | undefined,
  datasetProject: string | undefined,
  credentials: CheckDatasetRequest['credentials'],
  filePattern: RegExp,
  connectionId?: string
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!datasetId && !datasetProject) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'ClearML Dataset ID or Project not configured',
    });
  }

  // If we have a connectionId, use that to get credentials via the versioning datasets API
  if (connectionId) {
    try {
      // Use the versioning datasets API to list and check dataset info
      const infoResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/versioning/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          connectionId,
        }),
      });
      
      if (!infoResponse.ok) {
        const error = await infoResponse.json();
        return NextResponse.json({
          success: false,
          fileCount: 0,
          error: error.error || 'Failed to fetch ClearML datasets',
        });
      }
      
      const result = await infoResponse.json();
      const datasets = result.datasets || [];
      
      // Find the specific dataset if datasetId is provided
      if (datasetId) {
        const dataset = datasets.find((d: any) => d.id === datasetId);
        if (dataset) {
          return NextResponse.json({
            success: true,
            fileCount: dataset.fileCount || 0,
            metadata: {
              source: 'clearml',
              datasetId: dataset.id,
              datasetName: dataset.name,
              datasetProject: dataset.project,
              version: dataset.version,
            },
          });
        }
      }
      
      // Return info about all datasets in project
      if (datasetProject) {
        const projectDatasets = datasets.filter((d: any) => 
          d.project === datasetProject || (d as any).projectName === datasetProject
        );
        const totalFiles = projectDatasets.reduce((sum: number, d: any) => sum + (d.fileCount || 0), 0);
        
        return NextResponse.json({
          success: true,
          fileCount: totalFiles,
          metadata: {
            source: 'clearml',
            datasetProject,
            datasetCount: projectDatasets.length,
          },
        });
      }
      
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: 'ClearML dataset not found',
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: `ClearML connection failed: ${(error as Error).message}`,
      });
    }
  }

  // Fallback to direct credentials (old method)
  if (!credentials?.clearmlApiHost || !credentials?.clearmlAccessKey || !credentials?.clearmlSecretKey) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'ClearML credentials not configured (API Host, Access Key, and Secret Key required)',
    });
  }

  try {
    // ClearML API endpoint for dataset info
    const apiUrl = `${credentials.clearmlApiHost}/datasets.get_by_id`;
    
    // Prepare the request
    const requestBody = datasetId 
      ? { id: datasetId }
      : { project: datasetProject };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${credentials.clearmlAccessKey}:${credentials.clearmlSecretKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Try alternative auth method
      const altResponse = await fetch(`${credentials.clearmlApiHost}/datasets.get_all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clearml-Access-Key': credentials.clearmlAccessKey,
          'X-Clearml-Secret-Key': credentials.clearmlSecretKey,
        },
        body: JSON.stringify({
          id: datasetId ? [datasetId] : undefined,
          project: datasetProject ? [datasetProject] : undefined,
          only_fields: ['id', 'name', 'runtime.ds_file_count'],
        }),
      });

      if (!altResponse.ok) {
        return NextResponse.json({
          success: false,
          fileCount: 0,
          error: `ClearML API request failed: ${response.status} ${response.statusText}`,
        });
      }

      const altData = await altResponse.json();
      
      if (altData.data?.datasets?.length > 0) {
        const dataset = altData.data.datasets[0];
        const fileCount = dataset.runtime?.ds_file_count || 0;

        return NextResponse.json({
          success: true,
          fileCount,
          metadata: {
            source: 'clearml',
            datasetId: dataset.id,
            datasetName: dataset.name,
          },
        });
      }
    }

    const data = await response.json();

    if (data.data?.dataset) {
      const dataset = data.data.dataset;
      const fileCount = dataset.runtime?.ds_file_count || 0;

      return NextResponse.json({
        success: true,
        fileCount,
        metadata: {
          source: 'clearml',
          datasetId: dataset.id,
          datasetName: dataset.name,
          datasetProject: dataset.project,
        },
      });
    }

    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'ClearML dataset not found',
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `ClearML connection failed: ${(error as Error).message}`,
    });
  }
}

// ============================================================================
// URL Source
// ============================================================================
async function handleURLSource(
  url: string,
  filePattern: RegExp
): Promise<NextResponse<CheckDatasetResponse>> {
  if (!url) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: 'URL not configured',
    });
  }

  try {
    // Try to fetch the URL to check if it's accessible
    const response = await fetch(url, { method: 'HEAD' });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        fileCount: 0,
        error: `URL not accessible: ${response.status} ${response.statusText}`,
      });
    }

    // Check if URL matches the file pattern
    const urlPath = new URL(url).pathname;
    const isMatchingFile = filePattern.test(urlPath);

    return NextResponse.json({
      success: true,
      fileCount: isMatchingFile ? 1 : 0,
      files: isMatchingFile ? [url] : [],
      metadata: {
        source: 'url',
        url,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
      },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      fileCount: 0,
      error: `URL check failed: ${(error as Error).message}`,
    });
  }
}
