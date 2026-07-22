import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { connectionsRepository, secretsRepository } from '@/lib/db/supabase-repositories';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface ClearMLCredentials {
  apiHost: string;
  webHost: string;
  filesHost: string;
  accessKey: string;
  secretKey: string;
}

// Resolve a secret by ID
async function resolveSecret(secretId: string | undefined): Promise<string> {
  if (!secretId) return '';
  const secret = await secretsRepository.getById(secretId);
  return secret?.value || '';
}

// Get credentials from connection or direct credentials
async function getCredentials(
  connectionId?: string,
  directCredentials?: {
    clearmlApiHost?: string;
    clearmlWebHost?: string;
    clearmlFilesHost?: string;
    clearmlAccessKey?: string;
    clearmlSecretKey?: string;
  }
): Promise<ClearMLCredentials | null> {
  if (connectionId) {
    try {
      const connection = await connectionsRepository.getById(connectionId);
      
      if (!connection) {
        console.error('Connection not found:', connectionId);
        return null;
      }
      
      // Config is already a JSON object from Supabase (JSONB)
      const config = connection.config as Record<string, string>;
      
      // Resolve secrets directly
      const accessKey = await resolveSecret(config.accessKeySecretId);
      const secretKey = await resolveSecret(config.secretKeySecretId);
      
      return {
        apiHost: config.apiHost || 'https://api.clear.ml',
        webHost: config.webHost || 'https://app.clear.ml',
        filesHost: config.filesHost || 'https://files.clear.ml',
        accessKey,
        secretKey,
      };
    } catch (error) {
      console.error('Error fetching connection credentials:', error);
      return null;
    }
  }
  
  if (directCredentials) {
    return {
      apiHost: directCredentials.clearmlApiHost || 'https://api.clear.ml',
      webHost: directCredentials.clearmlWebHost || 'https://app.clear.ml',
      filesHost: directCredentials.clearmlFilesHost || 'https://files.clear.ml',
      accessKey: directCredentials.clearmlAccessKey || '',
      secretKey: directCredentials.clearmlSecretKey || '',
    };
  }
  
  return null;
}

// Execute a command with environment variables (kept for DVC)
function executeCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
  useShell: boolean = true
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: cwd || process.cwd(),
      shell: useShell,
      windowsHide: true,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code || 0,
      });
    });
    
    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: -1,
      });
    });
  });
}

// ============================================================================
// ClearML Python SDK Wrapper
// Uses the official ClearML SDK for reliable dataset operations
// ============================================================================

interface ClearMLPythonResult {
  success: boolean;
  datasetId?: string;
  datasetName?: string;
  datasetProject?: string;
  filesAdded?: number;
  totalSize?: number;
  files?: { path: string; name: string; size: number }[];
  webUrl?: string;
  error?: string;
  installCommand?: string;
  // For download
  localPath?: string;
  filesDownloaded?: number;
  // For list
  count?: number;
  datasets?: { id: string; name: string; project: string; tags: string[] }[];
}

// Get the Python executable path using uv (handles venv detection)
function getPythonExecutable(): { python: string; useUv: boolean } {
  const isWindows = os.platform() === 'win32';
  // Use process.cwd() instead of __dirname since Next.js bundles differently
  const projectRoot = process.cwd();
  
  // Check if .venv exists (uv-managed environment)
  const uvVenvPath = path.join(projectRoot, '.venv');
  const uvPythonPath = isWindows
    ? path.join(uvVenvPath, 'Scripts', 'python.exe')
    : path.join(uvVenvPath, 'bin', 'python');
  
  if (fs.existsSync(uvPythonPath)) {
    // Use uv run for proper environment activation
    return { python: 'uv', useUv: true };
  }
  
  // Check for traditional venv
  const venvPaths = [
    path.join(projectRoot, '.venv'),
    path.join(projectRoot, 'venv'),
  ];
  
  for (const venvPath of venvPaths) {
    const pythonPath = isWindows
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');
    
    if (fs.existsSync(pythonPath)) {
      return { python: pythonPath, useUv: false };
    }
  }
  
  // Fallback: try uv run (it will create venv if needed)
  return { python: 'uv', useUv: true };
}

// Check if Python and ClearML SDK are available (using uv)
async function checkPythonAndClearML(): Promise<{ 
  available: boolean; 
  python?: string; 
  useUv?: boolean;
  error?: string 
}> {
  const { python, useUv } = getPythonExecutable();
  const isWindows = process.platform === 'win32';
  
  try {
    let result;
    
    if (useUv) {
      if (isWindows) {
        // On Windows, use cmd.exe to avoid PowerShell argument parsing issues
        result = await executeCommand(
          'cmd.exe',
          ['/c', 'uv run python -c "import clearml; print(\'ok\')"'],
          {}
        );
      } else {
        result = await executeCommand(
          'uv',
          ['run', 'python', '-c', 'import clearml; print("ok")'],
          {}
        );
      }
    } else {
      result = await executeCommand(
        python,
        ['-c', 'import clearml; print("ok")'],
        {}
      );
    }
    
    // Debug logging
    console.log('[ClearML Check] Result:', {
      success: result.success,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim().substring(0, 200),
      exitCode: result.exitCode,
      stdoutIncludesOk: result.stdout.includes('ok')
    });
    
    // Check both stdout and the combined output for 'ok'
    const combinedOutput = result.stdout + result.stderr;
    if (result.exitCode === 0 && combinedOutput.includes('ok')) {
      return { available: true, python, useUv };
    }
    
    // ClearML not installed, provide install instructions
    return {
      available: false,
      python,
      useUv,
      error: `ClearML SDK check failed. Exit code: ${result.exitCode}, stdout: "${result.stdout.trim()}", stderr: "${result.stderr.trim().substring(0, 100)}"`
    };
  } catch (err) {
    return {
      available: false,
      error: `Python/uv error: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// Execute ClearML operations via Python SDK wrapper
async function executeClearMLPython(
  credentials: ClearMLCredentials,
  action: string,
  options: {
    datasetId?: string;
    datasetName?: string;
    datasetProject?: string;
    inputPaths?: string[];
    outputPath?: string;
    tags?: string[];
    description?: string;
  }
): Promise<ClearMLPythonResult> {
  const pythonCheck = await checkPythonAndClearML();
  
  if (!pythonCheck.available) {
    return {
      success: false,
      error: pythonCheck.error,
      installCommand: 'uv pip install clearml'
    };
  }
  
  // Build command arguments
  const scriptPath = path.join(process.cwd(), 'scripts', 'clearml_wrapper.py');
  
  if (!fs.existsSync(scriptPath)) {
    return {
      success: false,
      error: `ClearML wrapper script not found at: ${scriptPath}. Current working directory: ${process.cwd()}`
    };
  }
  
  const args: string[] = [
    scriptPath,
    action,
    '--api-host', credentials.apiHost,
    '--web-host', credentials.webHost,
    '--files-host', credentials.filesHost,
    '--access-key', credentials.accessKey,
    '--secret-key', credentials.secretKey,
  ];
  
  // Add optional arguments based on action
  if (options.datasetId) {
    args.push('--dataset-id', options.datasetId);
  }
  if (options.datasetName) {
    args.push('--dataset-name', options.datasetName);
  }
  if (options.datasetProject) {
    args.push('--dataset-project', options.datasetProject);
  }
  if (options.inputPaths) {
    for (const inputPath of options.inputPaths) {
      args.push('--input-path', inputPath);
    }
  }
  if (options.outputPath) {
    args.push('--output-path', options.outputPath);
  }
  if (options.tags) {
    for (const tag of options.tags) {
      args.push('--tags', tag);
    }
  }
  if (options.description) {
    args.push('--description', options.description);
  }
  
  // Execute the Python script using uv or direct python
  let result;
  const isWindows = process.platform === 'win32';
  
  if (pythonCheck.useUv) {
    if (isWindows) {
      // On Windows, use cmd.exe to avoid PowerShell argument parsing issues
      const cmdArgs = ['uv', 'run', 'python', ...args].map(arg => 
        arg.includes(' ') ? `"${arg}"` : arg
      ).join(' ');
      result = await executeCommand('cmd.exe', ['/c', cmdArgs], {});
    } else {
      result = await executeCommand('uv', ['run', 'python', ...args], {});
    }
  } else {
    result = await executeCommand(pythonCheck.python!, args, {});
  }
  
  // Extract JSON from stdout using markers
  const fullOutput = result.stdout;
  let jsonOutput = '';
  
  // Look for our JSON markers
  const startMarker = '---CLEARML_JSON_START---';
  const endMarker = '---CLEARML_JSON_END---';
  const startIdx = fullOutput.indexOf(startMarker);
  const endIdx = fullOutput.indexOf(endMarker);
  
  if (startIdx !== -1 && endIdx !== -1) {
    jsonOutput = fullOutput.substring(startIdx + startMarker.length, endIdx).trim();
  } else {
    // Fallback: try to find JSON by matching braces
    const jsonMatch = fullOutput.match(/\{[\s\S]*"success"[\s\S]*\}/);
    if (jsonMatch) {
      jsonOutput = jsonMatch[0];
    } else {
      jsonOutput = fullOutput;
    }
  }
  
  // Debug log
  console.log('[ClearML Python] Raw output length:', fullOutput.length);
  console.log('[ClearML Python] Extracted JSON length:', jsonOutput.length);
  console.log('[ClearML Python] Extracted JSON preview:', jsonOutput.substring(0, 300));
  
  if (!result.success) {
    // Try to parse error from stderr or stdout
    let errorMessage = result.stderr || result.stdout || 'Unknown error';
    
    // Check if it's a JSON error response
    try {
      const jsonResult = JSON.parse(result.stdout);
      if (jsonResult.error) {
        errorMessage = jsonResult.error;
      }
    } catch {
      // Not JSON, use raw error
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
  
  // Parse JSON output from Python script
  try {
    const jsonResult = JSON.parse(jsonOutput);
    
    if (!jsonResult.success && !result.success) {
      jsonResult.error = jsonResult.error || result.stderr || 'Unknown error';
    }
    
    return jsonResult;
  } catch {
    if (!result.success) {
      return {
        success: false,
        error: result.stderr || result.stdout || 'Command execution failed'
      };
    }
    
    return {
      success: false,
      error: `Failed to parse Python output: ${result.stdout.substring(0, 500)}`
    };
  }
}

// ============================================================================
// ClearML Dataset Operations (Python SDK Only)
// ============================================================================

async function executeClearMLData(
  credentials: ClearMLCredentials,
  action: string,
  options: {
    datasetId?: string;
    datasetName?: string;
    datasetProject?: string;
    inputPath?: string;
    inputPaths?: string[];
    outputPath?: string;
    version?: string;
    tags?: string[];
  }
): Promise<{
  success: boolean;
  message: string;
  datasetId?: string;
  datasetName?: string;
  datasetProject?: string;
  version?: string;
  outputPath?: string;
  stdout?: string;
  stderr?: string;
}> {
  // Collect all input paths
  const allInputPaths: string[] = [];
  if (options.inputPaths && options.inputPaths.length > 0) {
    allInputPaths.push(...options.inputPaths);
  } else if (options.inputPath) {
    allInputPaths.push(options.inputPath);
  }

  console.log('[ClearML] Executing via Python SDK...');
  
  const pythonResult = await executeClearMLPython(credentials, action, {
    datasetId: options.datasetId,
    datasetName: options.datasetName,
    datasetProject: options.datasetProject,
    inputPaths: allInputPaths.length > 0 ? allInputPaths : undefined,
    outputPath: options.outputPath,
    tags: options.tags,
  });
  
  if (pythonResult.success) {
    // Format success message
    let message = '';
    
    if (action === 'create' || action === 'version') {
      const fileList = (pythonResult.files || [])
        .map(f => `  - ${f.name} (${(f.size / 1024).toFixed(2)} KB)`)
        .join('\n');
      
      message = `Dataset "${pythonResult.datasetName}" ${action === 'create' ? 'created' : 'version created'} successfully.\n`;
      message += `ID: ${pythonResult.datasetId}\n\n`;
      if (pythonResult.filesAdded && pythonResult.filesAdded > 0) {
        message += `Files (${pythonResult.filesAdded}):\n${fileList || '  (none)'}\n\n`;
      }
      message += `View dataset at: ${pythonResult.webUrl}`;
    } else if (action === 'download') {
      message = `Dataset downloaded to: ${pythonResult.localPath}\n`;
      message += `Files downloaded: ${pythonResult.filesDownloaded}`;
    } else if (action === 'list') {
      const datasetList = (pythonResult.datasets || [])
        .map(d => `  - ${d.name} (ID: ${d.id}, Project: ${d.project || 'N/A'})`)
        .join('\n');
      message = `Found ${pythonResult.count} datasets:\n${datasetList || '  (none)'}`;
    } else if (action === 'info') {
      message = JSON.stringify(pythonResult, null, 2);
    } else {
      message = JSON.stringify(pythonResult, null, 2);
    }
    
    return {
      success: true,
      message,
      datasetId: pythonResult.datasetId,
      datasetName: pythonResult.datasetName,
      datasetProject: pythonResult.datasetProject,
      outputPath: pythonResult.localPath,
    };
  } else {
    // Return the error from Python SDK
    let errorMessage = pythonResult.error || 'Unknown error occurred';
    
    if (pythonResult.installCommand) {
      errorMessage += `\n\nTo fix this, run: ${pythonResult.installCommand}`;
    }
    
    return {
      success: false,
      message: errorMessage,
    };
  }
}

// Execute DVC operations
async function executeDVC(
  options: {
    action: string;
    inputPath?: string;
    remoteUrl?: string;
    version?: string;
  }
): Promise<{
  success: boolean;
  message: string;
  version?: string;
  commitHash?: string;
  stdout?: string;
  stderr?: string;
}> {
  switch (options.action || 'push') {
    case 'push': {
      if (!options.inputPath) {
        return { success: false, message: 'Input path is required for DVC push' };
      }
      
      // Add file to DVC
      const addResult = await executeCommand('dvc', ['add', options.inputPath], {});
      
      if (!addResult.success) {
        return {
          success: false,
          message: `Failed to add to DVC: ${addResult.stderr}`,
          stdout: addResult.stdout,
          stderr: addResult.stderr,
        };
      }
      
      // Push to remote
      const pushResult = await executeCommand('dvc', ['push'], {});
      
      // Get git commit hash
      const gitResult = await executeCommand('git', ['rev-parse', 'HEAD'], {});
      const commitHash = gitResult.success ? gitResult.stdout.trim() : undefined;
      
      return {
        success: pushResult.success,
        message: pushResult.success 
          ? 'Data pushed to DVC remote' 
          : `Failed to push: ${pushResult.stderr}`,
        version: options.version,
        commitHash,
        stdout: `${addResult.stdout}\n${pushResult.stdout}`,
        stderr: `${addResult.stderr}\n${pushResult.stderr}`,
      };
    }
    
    case 'pull': {
      const pullResult = await executeCommand('dvc', ['pull'], {});
      
      return {
        success: pullResult.success,
        message: pullResult.success 
          ? 'Data pulled from DVC remote' 
          : `Failed to pull: ${pullResult.stderr}`,
        stdout: pullResult.stdout,
        stderr: pullResult.stderr,
      };
    }
    
    default:
      return { success: false, message: `Unknown DVC action: ${options.action}` };
  }
}

// POST /api/versioning/run - Execute versioning operations
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      tool, 
      action, 
      connectionId, 
      credentials: directCredentials,
      datasetId,
      datasetName,
      datasetProject,
      inputPath,
      inputPaths,
      outputPath,
      version,
      tags,
      remoteUrl,
    } = body;
    
    switch (tool) {
      case 'clearml-data': {
        const credentials = await getCredentials(connectionId, directCredentials);
        
        if (!credentials) {
          return NextResponse.json(
            { error: 'ClearML credentials not configured' },
            { status: 400 }
          );
        }
        
        const result = await executeClearMLData(credentials, action, {
          datasetId,
          datasetName,
          datasetProject,
          inputPath,
          inputPaths,
          outputPath,
          version,
          tags,
        });
        
        if (!result.success) {
          return NextResponse.json({ error: result.message }, { status: 400 });
        }
        
        return NextResponse.json(result);
      }
      
      case 'dvc': {
        const result = await executeDVC({
          action: action || 'push',
          inputPath,
          remoteUrl,
          version,
        });
        
        if (!result.success) {
          return NextResponse.json({ error: result.message }, { status: 400 });
        }
        
        return NextResponse.json(result);
      }
      
      case 'git-lfs':
      case 'mlflow-artifacts':
      case 'custom': {
        // TODO: Implement these tools
        return NextResponse.json({
          success: true,
          message: `${tool} versioning simulated`,
          version: version || '1.0.0',
          timestamp: new Date().toISOString(),
        });
      }
      
      default:
        return NextResponse.json(
          { error: `Unknown versioning tool: ${tool}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error in versioning/run API:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
