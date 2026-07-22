import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

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
 * Handles cross-platform differences (Linux/macOS vs Windows)
 */
function getVenvPythonPath(venvPath: string): string {
  const isWindows = os.platform() === 'win32';
  if (isWindows) {
    return path.join(venvPath, 'Scripts', 'python.exe');
  }
  // Try python3 first, fall back to python
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
    // Try alternative python path
    const altPythonPath = path.join(expandedPath, 'bin', 'python');
    if (!fsSync.existsSync(altPythonPath)) {
      return false;
    }
  }
  
  // Check for pyvenv.cfg or activate script as additional validation
  const pyvenvCfg = path.join(expandedPath, 'pyvenv.cfg');
  const activateScript = os.platform() === 'win32'
    ? path.join(expandedPath, 'Scripts', 'activate.bat')
    : path.join(expandedPath, 'bin', 'activate');
  
  return fsSync.existsSync(pyvenvCfg) || fsSync.existsSync(activateScript);
}

/**
 * Auto-detect venv in script directory
 */
function autoDetectVenv(scriptPath: string): string | null {
  const expandedScriptPath = expandTilde(scriptPath);
  const scriptDir = path.dirname(expandedScriptPath);
  
  // Common venv folder names to check
  const venvNames = ['.venv', 'venv', '.env', 'env'];
  
  for (const venvName of venvNames) {
    const potentialVenvPath = path.join(scriptDir, venvName);
    if (isValidVenv(potentialVenvPath)) {
      return potentialVenvPath;
    }
  }
  
  return null;
}

/**
 * Determine the Python command to use based on venv configuration
 */
function getPythonCommand(step: ExecuteStep): { pythonPath: string; venvUsed: boolean; venvPath?: string } {
  // If venv mode is 'none', use system Python
  if (step.venvMode === 'none') {
    return { pythonPath: 'python3', venvUsed: false };
  }
  
  // If venv mode is 'custom' and a path is provided, use that
  if (step.venvMode === 'custom' && step.venvPath) {
    const expandedPath = expandTilde(step.venvPath);
    if (isValidVenv(expandedPath)) {
      const pythonPath = getVenvPythonPath(expandedPath);
      return { pythonPath, venvUsed: true, venvPath: expandedPath };
    }
    // Custom venv path invalid, fall back to system Python
    return { pythonPath: 'python3', venvUsed: false };
  }
  
  // Auto-detect mode (default)
  if (step.scriptPath) {
    const detectedVenvPath = autoDetectVenv(step.scriptPath);
    if (detectedVenvPath) {
      const pythonPath = getVenvPythonPath(detectedVenvPath);
      return { pythonPath, venvUsed: true, venvPath: detectedVenvPath };
    }
  }
  
  // If already have a venvPath from previous detection, use it
  if (step.venvPath) {
    const expandedPath = expandTilde(step.venvPath);
    if (isValidVenv(expandedPath)) {
      const pythonPath = getVenvPythonPath(expandedPath);
      return { pythonPath, venvUsed: true, venvPath: expandedPath };
    }
  }
  
  // Fall back to system Python
  return { pythonPath: 'python3', venvUsed: false };
}

// Data source variable mapping - maps a script variable to an output from the previous node
interface DataSourceVariableMapping {
  variableName: string; // Variable name in the script (e.g., 'DATA_SOURCE')
  sourceOutput: string; // Which output from the previous node to use (e.g., '{{sourceNode.outputPath}}' or 'inputPath' for default)
}

interface ExecuteStep {
  id: string;
  name: string;
  type: string;
  params: Record<string, unknown>;
  enabled: boolean;
  scriptSource?: 'local' | 'inline';
  scriptPath?: string;
  inlineScript?: string;
  useDataSourceVariable?: boolean; // Whether to use data source variable replacement
  dataSourceVariable?: string; // Legacy: single variable name (deprecated)
  dataSourceMappings?: DataSourceVariableMapping[]; // New: multiple variable mappings
  useOutputVariables?: boolean; // Whether to use output variable replacement
  outputVariables?: string[]; // Support multiple output variables
  // Virtual environment configuration
  venvPath?: string;
  venvMode?: 'auto' | 'custom' | 'none';
}

interface RunExecuteRequest {
  step: ExecuteStep;
  inputPath: string; // Path from the dataset node
  sourceNodeOutputs?: Record<string, string>; // Outputs from the source node for variable mapping
}

interface ExecuteResult {
  success: boolean;
  outputPaths?: string[]; // Multiple output paths
  outputPath?: string; // Primary output path (first one) for backward compatibility
  stdout?: string;
  stderr?: string;
  error?: string;
  stepId: string;
  stepName: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<ExecuteResult>> {
  try {
    const body: RunExecuteRequest = await request.json();
    const { step, inputPath, sourceNodeOutputs } = body;

    if (!step) {
      return NextResponse.json({
        success: false,
        error: 'No step provided',
        stepId: '',
        stepName: '',
      });
    }

    // Check if input path is required (only when useDataSourceVariable is true or undefined)
    const requiresInputPath = step.useDataSourceVariable !== false;
    
    if (!inputPath && requiresInputPath) {
      return NextResponse.json({
        success: false,
        error: 'No input path provided',
        stepId: step.id,
        stepName: step.name,
      });
    }

    if (!step.enabled) {
      return NextResponse.json({
        success: true,
        outputPath: inputPath,
        outputPaths: [inputPath],
        stepId: step.id,
        stepName: step.name,
      });
    }

    // Handle data source mappings (new format) or legacy single variable
    const useDataSource = step.useDataSourceVariable !== false;
    const dataSourceMappings: DataSourceVariableMapping[] = useDataSource 
      ? (step.dataSourceMappings && step.dataSourceMappings.length > 0
          ? step.dataSourceMappings
          : [{ variableName: step.dataSourceVariable || 'DATA_SOURCE', sourceOutput: 'inputPath' }])
      : [];
    
    const useOutputVars = step.useOutputVariables !== false;
    const outputVariables = step.outputVariables && step.outputVariables.length > 0 
      ? step.outputVariables 
      : ['OUTPUT_PATH'];

    let scriptContent: string;
    let scriptPath: string;

    if (step.scriptSource === 'inline' && step.inlineScript) {
      // For inline scripts, create a temporary file
      const tempDir = os.tmpdir();
      scriptPath = path.join(tempDir, `preprocess_${step.id}_${Date.now()}.py`);
      scriptContent = step.inlineScript;
    } else if (step.scriptSource === 'local' || !step.scriptSource) {
      // For local file scripts
      if (!step.scriptPath) {
        return NextResponse.json({
          success: false,
          error: 'No script path provided for local file source',
          stepId: step.id,
          stepName: step.name,
        });
      }

      scriptPath = step.scriptPath;

      // Check if the script file exists
      try {
        await fs.access(scriptPath);
        scriptContent = await fs.readFile(scriptPath, 'utf-8');
      } catch {
        return NextResponse.json({
          success: false,
          error: `Script file not found: ${scriptPath}`,
          stepId: step.id,
          stepName: step.name,
        });
      }
    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid script source configuration',
        stepId: step.id,
        stepName: step.name,
      });
    }

    // Create a wrapper script that:
    // 1. Optionally sets up the data source variables (with mappings to source node outputs)
    // 2. Runs the original script
    // 3. Optionally captures multiple output paths
    const tempDir = os.tmpdir();
    const wrapperScriptPath = path.join(tempDir, `wrapper_${step.id}_${Date.now()}.py`);
    
    // Escape paths for Python string (use empty string if no input path)
    const escapedInputPath = inputPath ? inputPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
    
    // Helper function to resolve a source output reference to its actual value
    const resolveSourceOutput = (sourceOutput: string): string => {
      if (sourceOutput === 'inputPath' || !sourceOutput) {
        return escapedInputPath;
      }
      // Handle {{sourceNode.X}} pattern
      const match = sourceOutput.match(/\{\{sourceNode\.(\w+(?:\[\d+\])?)\}\}/);
      if (match && sourceNodeOutputs) {
        const key = match[1];
        // Handle array access like outputPaths[0]
        const arrayMatch = key.match(/(\w+)\[(\d+)\]/);
        if (arrayMatch) {
          const [, arrayName, indexStr] = arrayMatch;
          const index = parseInt(indexStr, 10);
          const array = sourceNodeOutputs[arrayName];
          if (Array.isArray(array) && array[index]) {
            return (array[index] as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          }
        }
        // Simple property access
        if (sourceNodeOutputs[key]) {
          return (sourceNodeOutputs[key] as string).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        }
      }
      // Default to input path
      return escapedInputPath;
    };
    
    // Build data source variable setup for each mapping
    const dataSourceSetup = dataSourceMappings.length > 0
      ? dataSourceMappings.map(mapping => {
          const resolvedValue = resolveSourceOutput(mapping.sourceOutput);
          return resolvedValue 
            ? `'${mapping.variableName}': r'${resolvedValue}'`
            : `'${mapping.variableName}': None`;
        }).join(',\n    ')
      : '';
    
    // Conditionally initialize output variables
    const outputVarInit = useOutputVars
      ? outputVariables.map(v => `'${v}': None`).join(',\n    ')
      : '';
    
    // Conditionally create the output printing logic
    const outputPrintLogic = useOutputVars
      ? outputVariables.map(v => `
if _exec_globals.get('${v}') is not None:
    print(f"__OUTPUT__${v}__:{_exec_globals['${v}']}")
${escapedInputPath ? `else:\n    print(f"__OUTPUT__${v}__:${escapedInputPath}")` : ''}
`).join('\n')
      : '# Output variable printing disabled';
    
    // Create wrapper script that properly injects variables
    // We use string replacement instead of regex to avoid escape sequence issues
    const wrapperScript = `
import sys
import os

# Original script content
_original_script = '''${scriptContent.replace(/'/g, "\\'")}'''

# Variables to inject (these will override any definitions in the script)
_inject_vars = {
    ${dataSourceSetup}${dataSourceSetup && outputVarInit ? ',\n    ' : ''}${outputVarInit}
}

# Replace variable assignments in the script for each variable we want to inject
# Using line-by-line replacement to avoid regex escape issues with Windows paths
_lines = _original_script.split('\\n')
_modified_lines = []

for _line in _lines:
    _replaced = False
    for var_name, var_value in _inject_vars.items():
        if var_value is not None and not _replaced:
            # Check if this line starts with the variable assignment
            _stripped = _line.lstrip()
            if _stripped.startswith(var_name) and '=' in _stripped:
                # Get the part before the variable name (indentation)
                _indent = _line[:len(_line) - len(_stripped)]
                # Check it's actually an assignment (VAR = or VAR=)
                _after_var = _stripped[len(var_name):].lstrip()
                if _after_var.startswith('='):
                    # Replace the entire line with the new assignment
                    _modified_lines.append(f'{_indent}{var_name} = r"{var_value}"')
                    _replaced = True
                    break
    if not _replaced:
        _modified_lines.append(_line)

_modified_script = '\\n'.join(_modified_lines)

# Create globals dict for exec
_exec_globals = {'__name__': '__main__', '__file__': r'${step.scriptPath?.replace(/\\/g, '\\\\') || 'inline_script.py'}'}
_exec_globals.update(_inject_vars)

# Execute the modified script
exec(_modified_script, _exec_globals)

# Print all output paths at the end
${outputPrintLogic}
`;

    await fs.writeFile(wrapperScriptPath, wrapperScript, 'utf-8');

    try {
      // Determine the Python command based on venv configuration
      const { pythonPath, venvUsed, venvPath } = getPythonCommand(step);
      
      // Log which Python is being used (for debugging)
      console.log(`[Execute] Using Python: ${pythonPath} (venv: ${venvUsed ? venvPath : 'none'})`);
      
      // Execute the Python script with the appropriate Python interpreter
      const { stdout, stderr } = await execAsync(`"${pythonPath}" "${wrapperScriptPath}"`, {
        timeout: 300000, // 5 minute timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        cwd: path.dirname(step.scriptPath || wrapperScriptPath),
      });

      // Parse all output paths from stdout (only if output variables are enabled)
      const outputPaths: string[] = [];
      if (useOutputVars) {
        for (const varName of outputVariables) {
          const regex = new RegExp(`__OUTPUT__${varName}__:(.+)`);
          const match = stdout.match(regex);
          if (match) {
            outputPaths.push(match[1].trim());
          } else if (inputPath) {
            outputPaths.push(inputPath); // Fallback to input path
          }
        }
      }

      // Clean stdout by removing all output markers
      let cleanStdout = stdout;
      if (useOutputVars) {
        for (const varName of outputVariables) {
          cleanStdout = cleanStdout.replace(new RegExp(`__OUTPUT__${varName}__:.+\\n?`, 'g'), '');
        }
      }

      // Clean up wrapper script
      try {
        await fs.unlink(wrapperScriptPath);
      } catch {
        // Ignore cleanup errors
      }

      return NextResponse.json({
        success: true,
        outputPath: outputPaths[0] || inputPath || undefined, // Primary output for backward compatibility
        outputPaths: outputPaths.length > 0 ? outputPaths : (inputPath ? [inputPath] : []),
        stdout: cleanStdout.trim(),
        stderr: stderr.trim(),
        stepId: step.id,
        stepName: step.name,
      });
    } catch (execError: any) {
      // Clean up wrapper script on error
      try {
        await fs.unlink(wrapperScriptPath);
      } catch {
        // Ignore cleanup errors
      }

      return NextResponse.json({
        success: false,
        error: execError.message || 'Script execution failed',
        stderr: execError.stderr || '',
        stdout: execError.stdout || '',
        stepId: step.id,
        stepName: step.name,
      });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
      stepId: '',
      stepName: '',
    });
  }
}
