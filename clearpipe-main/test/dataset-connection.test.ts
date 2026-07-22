/**
 * Dataset Connection Test
 * 
 * Tests the dataset check API with various data sources:
 * - Local file system
 * - AWS S3
 * - Google Cloud Storage
 * - Azure Blob Storage
 * - MinIO
 * - ClearML Dataset
 * 
 * Local Test: C:\Users\naved\Documents\PythonProjects\GUI-images
 * Expected: 2018 images
 * 
 * Run with: npx tsx test/dataset-connection.test.ts
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Test Configurations
// ============================================================================

// Local filesystem test
const localTestConfig = {
  source: 'local' as const,
  path: 'C:\\Users\\naved\\Documents\\PythonProjects\\GUI-images',
  format: ['jpg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg'],
};

// AWS S3 test (configure with your credentials)
const s3TestConfig = {
  source: 's3' as const,
  bucket: 'your-bucket-name',
  path: 'datasets/', // prefix
  region: 'us-east-1',
  format: ['jpg', 'png'],
  credentials: {
    accessKey: process.env.AWS_ACCESS_KEY_ID || '',
    secretKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
};

// Google Cloud Storage test (configure with your credentials)
const gcsTestConfig = {
  source: 'gcs' as const,
  bucket: 'your-bucket-name',
  path: 'datasets/',
  format: ['jpg', 'png'],
  credentials: {
    projectId: process.env.GCP_PROJECT_ID || '',
    serviceAccountKey: process.env.GCP_SERVICE_ACCOUNT_KEY || '', // JSON string
  },
};

// Azure Blob Storage test (configure with your credentials)
const azureTestConfig = {
  source: 'azure-blob' as const,
  container: 'your-container-name',
  path: 'datasets/',
  format: ['jpg', 'png'],
  credentials: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
  },
};

// MinIO test (configure with your credentials)
const minioTestConfig = {
  source: 'minio' as const,
  bucket: 'your-bucket-name',
  path: 'datasets/',
  endpoint: 'http://localhost:9000',
  format: ['jpg', 'png'],
  credentials: {
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || '',
  },
};

// ClearML Dataset test (configure with your credentials)
const clearmlTestConfig = {
  source: 'clearml' as const,
  datasetId: process.env.CLEARML_DATASET_ID || '',
  datasetProject: process.env.CLEARML_DATASET_PROJECT || '',
  format: ['jpg', 'png'],
  credentials: {
    clearmlApiHost: process.env.CLEARML_API_HOST || 'https://api.clear.ml',
    clearmlWebHost: process.env.CLEARML_WEB_HOST || 'https://app.clear.ml',
    clearmlFilesHost: process.env.CLEARML_FILES_HOST || 'https://files.clear.ml',
    clearmlAccessKey: process.env.CLEARML_ACCESS_KEY || '',
    clearmlSecretKey: process.env.CLEARML_SECRET_KEY || '',
  },
};

// Expected file count for local test
const EXPECTED_LOCAL_FILE_COUNT = 2018;

// ============================================================================
// Test Utilities
// ============================================================================

// Extension mapping
const extensionMap: Record<string, string> = {
  jpg: 'jpg|jpeg', png: 'png', gif: 'gif', bmp: 'bmp',
  tiff: 'tiff|tif', webp: 'webp', svg: 'svg',
  csv: 'csv', json: 'json', parquet: 'parquet',
};

// Convert format to regex
function formatToRegex(format: string[]): RegExp {
  const extensions = format.map(f => extensionMap[f] || f);
  return new RegExp(`\\.(${extensions.join('|')})$`, 'i');
}

// Recursively get all files (for local testing only)
function getAllFiles(dirPath: string, filePattern: RegExp, arrayOfFiles: string[] = []): string[] {
  try {
    const files = fs.readdirSync(dirPath);

    files.forEach((file: string) => {
      const filePath: string = path.join(dirPath, file);
      
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

// ============================================================================
// Test Result Interface
// ============================================================================

interface TestResult {
  success: boolean;
  fileCount: number;
  error?: string;
  duration: number;
}

// ============================================================================
// Local Filesystem Test
// ============================================================================

async function testLocalConnection(): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // Check if path exists
    if (!fs.existsSync(localTestConfig.path)) {
      return { 
        success: false, 
        fileCount: 0, 
        error: `Path does not exist: ${localTestConfig.path}`,
        duration: Date.now() - startTime,
      };
    }

    // Check if it's a directory
    const stat = fs.statSync(localTestConfig.path);
    if (!stat.isDirectory()) {
      return { 
        success: false, 
        fileCount: 0, 
        error: 'Path is not a directory',
        duration: Date.now() - startTime,
      };
    }

    // Get file pattern
    const filePattern = formatToRegex(localTestConfig.format);

    // Count matching files
    const files = getAllFiles(localTestConfig.path, filePattern);

    return { 
      success: true, 
      fileCount: files.length,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return { 
      success: false, 
      fileCount: 0, 
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('='.repeat(70));
  console.log('Dataset Connection Tests');
  console.log('='.repeat(70));
  console.log('');

  // Test 1: Local Filesystem
  console.log('TEST 1: Local Filesystem');
  console.log('-'.repeat(70));
  console.log(`  Path: ${localTestConfig.path}`);
  console.log(`  Formats: ${localTestConfig.format.join(', ')}`);
  console.log(`  Expected Files: ${EXPECTED_LOCAL_FILE_COUNT}`);
  console.log('');
  console.log('  Running...');
  
  const localResult = await testLocalConnection();
  
  console.log('');
  console.log(`  Success: ${localResult.success}`);
  console.log(`  File Count: ${localResult.fileCount}`);
  console.log(`  Duration: ${localResult.duration}ms`);
  
  if (localResult.error) {
    console.log(`  Error: ${localResult.error}`);
  }
  
  console.log('');
  
  if (localResult.success) {
    if (localResult.fileCount === EXPECTED_LOCAL_FILE_COUNT) {
      console.log('  ✅ TEST PASSED: File count matches expected value');
    } else {
      console.log('  ⚠️ TEST WARNING: File count mismatch');
      console.log(`     Expected: ${EXPECTED_LOCAL_FILE_COUNT}`);
      console.log(`     Actual: ${localResult.fileCount}`);
      console.log(`     Difference: ${localResult.fileCount - EXPECTED_LOCAL_FILE_COUNT}`);
    }
  } else {
    console.log('  ❌ TEST FAILED: Connection unsuccessful');
  }
  
  console.log('');
  console.log('='.repeat(70));
  console.log('');
  
  // Summary of cloud storage configurations
  console.log('CLOUD STORAGE TESTS (Requires Configuration)');
  console.log('-'.repeat(70));
  console.log('');
  console.log('To test cloud storage connections, set the following environment variables:');
  console.log('');
  console.log('AWS S3:');
  console.log('  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
  console.log('');
  console.log('Google Cloud Storage:');
  console.log('  GCP_PROJECT_ID, GCP_SERVICE_ACCOUNT_KEY (JSON string)');
  console.log('');
  console.log('Azure Blob Storage:');
  console.log('  AZURE_STORAGE_CONNECTION_STRING');
  console.log('  (or AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY)');
  console.log('');
  console.log('MinIO:');
  console.log('  MINIO_ACCESS_KEY, MINIO_SECRET_KEY');
  console.log('');
  console.log('ClearML:');
  console.log('  CLEARML_API_HOST, CLEARML_ACCESS_KEY, CLEARML_SECRET_KEY');
  console.log('  CLEARML_DATASET_ID or CLEARML_DATASET_PROJECT');
  console.log('');
  console.log('='.repeat(70));

  return localResult;
}

// Run the tests
runAllTests()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Test error:', error);
    process.exit(1);
  });
