import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

// Track running training jobs
const runningJobs = new Map<string, {
  process: ChildProcess;
  startTime: number;
  logs: string[];
}>();

/**
 * Expand tilde to user home directory (cross-platform)
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith('~')) {
    return filePath.replace(/^~/, os.homedir());
  }
  return filePath;
}

/**
 * Get the Python executable path for a given venv directory
 */
function getVenvPythonPath(venvPath: string): string {
  const isWindows = os.platform() === 'win32';
  if (isWindows) {
    return path.join(venvPath, 'Scripts', 'python.exe');
  }
  const python3Path = path.join(venvPath, 'bin', 'python3');
  if (fsSync.existsSync(python3Path)) {
    return python3Path;
  }
  return path.join(venvPath, 'bin', 'python');
}

/**
 * Check if a directory is a valid Python virtual environment
 */
function isValidVenv(venvPath: string): boolean {
  const expandedPath = expandTilde(venvPath);
  if (!fsSync.existsSync(expandedPath)) {
    return false;
  }
  
  const pythonPath = getVenvPythonPath(expandedPath);
  if (!fsSync.existsSync(pythonPath)) {
    const altPythonPath = path.join(expandedPath, 'bin', 'python');
    if (!fsSync.existsSync(altPythonPath)) {
      return false;
    }
  }
  
  const pyvenvCfg = path.join(expandedPath, 'pyvenv.cfg');
  const activateScript = os.platform() === 'win32'
    ? path.join(expandedPath, 'Scripts', 'activate.bat')
    : path.join(expandedPath, 'bin', 'activate');
  
  return fsSync.existsSync(pyvenvCfg) || fsSync.existsSync(activateScript);
}

/**
 * Auto-detect venv in a directory
 */
function autoDetectVenv(dirPath: string): string | null {
  const venvNames = ['.venv', 'venv', '.env', 'env'];
  
  for (const venvName of venvNames) {
    const potentialVenvPath = path.join(dirPath, venvName);
    if (isValidVenv(potentialVenvPath)) {
      return potentialVenvPath;
    }
  }
  
  return null;
}

/**
 * Setup virtual environment for training
 */
async function setupVenv(
  workDir: string,
  venvConfig: TrainingVenvConfig,
  pythonVersion?: string
): Promise<{ pythonPath: string; venvPath?: string; error?: string }> {
  const venvDir = path.join(workDir, '.venv');
  
  if (venvConfig.mode === 'none') {
    return { pythonPath: 'python3' };
  }
  
  if (venvConfig.mode === 'auto') {
    const detected = autoDetectVenv(workDir);
    if (detected) {
      return { pythonPath: getVenvPythonPath(detected), venvPath: detected };
    }
    // Fall through to create new venv
  }
  
  // Check if requirements.txt or environment.yml exists
  const requirementsPath = venvConfig.requirementsPath 
    ? path.join(workDir, venvConfig.requirementsPath)
    : path.join(workDir, 'requirements.txt');
  
  const condaEnvPath = venvConfig.condaEnvPath
    ? path.join(workDir, venvConfig.condaEnvPath)
    : path.join(workDir, 'environment.yml');
  
  const pyprojectPath = path.join(workDir, 'pyproject.toml');
  
  // Determine which method to use
  if (venvConfig.mode === 'conda' && fsSync.existsSync(condaEnvPath)) {
    // Use conda (if available)
    // Note: Full conda support would require additional implementation
    return { pythonPath: 'python3', error: 'Conda environments not yet fully supported' };
  }
  
  if (venvConfig.mode === 'poetry' && fsSync.existsSync(pyprojectPath)) {
    // Use poetry (if available)
    return { pythonPath: 'python3', error: 'Poetry environments not yet fully supported' };
  }
  
  // Default to pip + venv
  try {
    // Create venv if it doesn't exist
    if (!fsSync.existsSync(venvDir)) {
      const pythonCmd = pythonVersion ? `python${pythonVersion}` : 'python3';
      await execCommand(`${pythonCmd} -m venv "${venvDir}"`, workDir);
    }
    
    const pythonPath = getVenvPythonPath(venvDir);
    
    // Install requirements if they exist
    if (fsSync.existsSync(requirementsPath)) {
      const pipPath = os.platform() === 'win32'
        ? path.join(venvDir, 'Scripts', 'pip.exe')
        : path.join(venvDir, 'bin', 'pip');
      
      await execCommand(`"${pipPath}" install -r "${requirementsPath}"`, workDir);
    }
    
    // Install additional packages if specified
    if (venvConfig.additionalPackages && venvConfig.additionalPackages.length > 0) {
      const pipPath = os.platform() === 'win32'
        ? path.join(venvDir, 'Scripts', 'pip.exe')
        : path.join(venvDir, 'bin', 'pip');
      
      await execCommand(
        `"${pipPath}" install ${venvConfig.additionalPackages.join(' ')}`,
        workDir
      );
    }
    
    return { pythonPath, venvPath: venvDir };
  } catch (error) {
    return { 
      pythonPath: 'python3', 
      error: `Failed to setup venv: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

/**
 * Execute a command and return output
 */
function execCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env },
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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Command exited with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

interface TrainingVenvConfig {
  mode: 'auto' | 'requirements' | 'conda' | 'poetry' | 'none';
  requirementsPath?: string;
  condaEnvPath?: string;
  pythonVersion?: string;
  additionalPackages?: string[];
}

interface DataSourceVariableMapping {
  variableName: string;
  sourceOutput: string;
}

interface TrainingRunRequest {
  jobId: string;
  
  // Script configuration
  scriptSource: 'local' | 'git';
  localScriptPath?: string;
  clonedRepoPath?: string; // Path where git repo was cloned
  entryScript?: string; // Entry script within cloned repo
  
  // Parameter configuration
  parameterValues: Record<string, string | number | boolean>;
  
  // Environment configuration
  venvConfig?: TrainingVenvConfig;
  
  // Data source configuration
  dataSourceMappings?: DataSourceVariableMapping[];
  inputPath?: string;
  sourceNodeOutputs?: Record<string, string>;
  
  // Output configuration
  outputPath?: string;
  modelOutputPath?: string;
  checkpointPath?: string;
  
  // Execution mode
  executionMode: 'local' | 'cloud';
  
  // Cloud configuration (for future implementation)
  cloudProvider?: string;
  instanceType?: string;
  connectionId?: string;
}

interface TrainingRunResponse {
  success: boolean;
  jobId: string;
  status: 'started' | 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
  error?: string;
  logs?: string[];
  metrics?: Record<string, number>;
  outputPaths?: {
    model?: string;
    checkpoints?: string;
    logs?: string;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<TrainingRunResponse>> {
  try {
    const body: TrainingRunRequest = await request.json();
    const {
      jobId,
      scriptSource,
      localScriptPath,
      clonedRepoPath,
      entryScript,
      parameterValues,
      venvConfig,
      dataSourceMappings,
      inputPath,
      sourceNodeOutputs,
      outputPath,
      modelOutputPath,
      checkpointPath,
      executionMode,
    } = body;

    if (!jobId) {
      return NextResponse.json({
        success: false,
        jobId: '',
        status: 'failed',
        error: 'Job ID is required',
      });
    }

    // Determine script path and working directory
    let scriptPath: string;
    let workDir: string;

    if (scriptSource === 'local') {
      if (!localScriptPath) {
        return NextResponse.json({
          success: false,
          jobId,
          status: 'failed',
          error: 'Local script path is required',
        });
      }
      scriptPath = expandTilde(localScriptPath);
      workDir = path.dirname(scriptPath);
    } else if (scriptSource === 'git') {
      if (!clonedRepoPath || !entryScript) {
        return NextResponse.json({
          success: false,
          jobId,
          status: 'failed',
          error: 'Cloned repo path and entry script are required for git source',
        });
      }
      scriptPath = path.join(clonedRepoPath, entryScript);
      workDir = clonedRepoPath;
    } else {
      return NextResponse.json({
        success: false,
        jobId,
        status: 'failed',
        error: 'Invalid script source',
      });
    }

    // Verify script exists
    if (!fsSync.existsSync(scriptPath)) {
      return NextResponse.json({
        success: false,
        jobId,
        status: 'failed',
        error: `Training script not found: ${scriptPath}`,
      });
    }

    // Setup virtual environment
    let pythonPath = 'python3';
    if (venvConfig && executionMode === 'local') {
      const venvResult = await setupVenv(workDir, venvConfig);
      if (venvResult.error) {
        console.warn(`[Training] Venv setup warning: ${venvResult.error}`);
      }
      pythonPath = venvResult.pythonPath;
    }

    // Build command line arguments from parameter values
    const args: string[] = [scriptPath];
    
    for (const [key, value] of Object.entries(parameterValues)) {
      if (value === true) {
        // Boolean flag (true)
        args.push(`--${key.replace(/_/g, '-')}`);
      } else if (value === false) {
        // Boolean flag (false) - skip
        continue;
      } else if (value !== undefined && value !== null && value !== '') {
        // Regular argument
        args.push(`--${key.replace(/_/g, '-')}`, String(value));
      }
    }

    // Add data source mappings as environment variables or arguments
    const envVars: Record<string, string | undefined> = { ...process.env };
    
    if (dataSourceMappings && dataSourceMappings.length > 0) {
      for (const mapping of dataSourceMappings) {
        let resolvedValue = inputPath || '';
        
        if (mapping.sourceOutput && mapping.sourceOutput !== 'inputPath') {
          const match = mapping.sourceOutput.match(/\{\{sourceNode\.(\w+)\}\}/);
          if (match && sourceNodeOutputs && sourceNodeOutputs[match[1]]) {
            resolvedValue = sourceNodeOutputs[match[1]];
          }
        }
        
        envVars[mapping.variableName] = resolvedValue;
      }
    }

    // Add output paths as environment variables
    if (outputPath) {
      envVars['OUTPUT_PATH'] = outputPath;
    }
    if (modelOutputPath) {
      envVars['MODEL_OUTPUT_PATH'] = modelOutputPath;
    }
    if (checkpointPath) {
      envVars['CHECKPOINT_PATH'] = checkpointPath;
    }

    // For cloud execution, we would spin up the cloud instance here
    // For now, only local execution is implemented
    if (executionMode === 'cloud') {
      return NextResponse.json({
        success: false,
        jobId,
        status: 'failed',
        error: 'Cloud execution is not yet implemented. Please use local execution mode.',
      });
    }

    // Start the training process
    console.log(`[Training] Starting job ${jobId}`);
    console.log(`[Training] Python: ${pythonPath}`);
    console.log(`[Training] Script: ${scriptPath}`);
    console.log(`[Training] Args: ${args.slice(1).join(' ')}`);

    const trainingProcess = spawn(pythonPath, args, {
      cwd: workDir,
      env: envVars as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const logs: string[] = [];
    const metrics: Record<string, number> = {};

    // Parse training metrics from output (common patterns)
    const metricsPatterns = [
      /(?:loss|train_loss|training_loss)[:\s=]+([0-9.]+)/i,
      /(?:accuracy|acc|train_acc)[:\s=]+([0-9.]+)/i,
      /(?:val_loss|validation_loss)[:\s=]+([0-9.]+)/i,
      /(?:val_accuracy|val_acc)[:\s=]+([0-9.]+)/i,
      /(?:epoch)[:\s=]+(\d+)/i,
      /(?:lr|learning_rate)[:\s=]+([0-9.e-]+)/i,
    ];

    trainingProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      logs.push(`[stdout] ${text}`);
      
      // Try to extract metrics
      for (const pattern of metricsPatterns) {
        const match = text.match(pattern);
        if (match) {
          const key = pattern.source.match(/\(([^)]+)\)/)?.[1].split('|')[0] || 'unknown';
          metrics[key] = parseFloat(match[1]);
        }
      }
    });

    trainingProcess.stderr?.on('data', (data: Buffer) => {
      logs.push(`[stderr] ${data.toString()}`);
    });

    // Store the running job
    runningJobs.set(jobId, {
      process: trainingProcess,
      startTime: Date.now(),
      logs,
    });

    // Return immediately with 'started' status
    // Client should poll /api/training/status for updates
    return NextResponse.json({
      success: true,
      jobId,
      status: 'started',
      message: 'Training job started',
      logs: logs.slice(-50), // Last 50 log lines
    });
  } catch (error) {
    console.error('[Training API] Error:', error);
    return NextResponse.json({
      success: false,
      jobId: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// GET endpoint to check job status
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({
        success: false,
        error: 'Job ID is required',
      });
    }

    const job = runningJobs.get(jobId);
    
    if (!job) {
      return NextResponse.json({
        success: false,
        jobId,
        status: 'not_found',
        error: 'Job not found or already completed',
      });
    }

    // Check if process is still running
    const isRunning = job.process.exitCode === null;
    const exitCode = job.process.exitCode;

    return NextResponse.json({
      success: true,
      jobId,
      status: isRunning ? 'running' : (exitCode === 0 ? 'completed' : 'failed'),
      logs: job.logs.slice(-100), // Last 100 log lines
      duration: Date.now() - job.startTime,
      exitCode,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// DELETE endpoint to cancel a job
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json({
        success: false,
        error: 'Job ID is required',
      });
    }

    const job = runningJobs.get(jobId);
    
    if (!job) {
      return NextResponse.json({
        success: false,
        error: 'Job not found',
      });
    }

    // Kill the process
    job.process.kill('SIGTERM');
    
    // Give it a moment, then force kill if still running
    setTimeout(() => {
      if (job.process.exitCode === null) {
        job.process.kill('SIGKILL');
      }
      runningJobs.delete(jobId);
    }, 5000);

    return NextResponse.json({
      success: true,
      jobId,
      status: 'cancelled',
      message: 'Training job cancelled',
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
