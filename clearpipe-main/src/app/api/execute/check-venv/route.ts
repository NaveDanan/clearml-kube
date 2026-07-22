import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface CheckVenvRequest {
  scriptPath: string;
  customVenvPath?: string;
}

interface CheckVenvResponse {
  success: boolean;
  detected: boolean;
  venvPath?: string;
  pythonPath?: string;
  error?: string;
}

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
  return path.join(venvPath, 'bin', 'python3');
}

/**
 * Check if a directory is a valid Python virtual environment
 */
function isValidVenv(venvPath: string): boolean {
  const pythonPath = getVenvPythonPath(venvPath);
  
  // Check if the Python executable exists
  if (!fs.existsSync(pythonPath)) {
    // Try python instead of python3 on Linux/macOS
    const altPythonPath = path.join(venvPath, 'bin', 'python');
    if (os.platform() !== 'win32' && fs.existsSync(altPythonPath)) {
      return true;
    }
    return false;
  }
  
  // Check for pyvenv.cfg or activate script as additional validation
  const pyvenvCfg = path.join(venvPath, 'pyvenv.cfg');
  const activateScript = os.platform() === 'win32'
    ? path.join(venvPath, 'Scripts', 'activate.bat')
    : path.join(venvPath, 'bin', 'activate');
  
  return fs.existsSync(pyvenvCfg) || fs.existsSync(activateScript);
}

export async function POST(request: NextRequest): Promise<NextResponse<CheckVenvResponse>> {
  try {
    const body: CheckVenvRequest = await request.json();
    const { scriptPath, customVenvPath } = body;

    // If custom venv path is provided, check that directly
    if (customVenvPath) {
      const expandedPath = expandTilde(customVenvPath);
      
      if (!fs.existsSync(expandedPath)) {
        return NextResponse.json({
          success: true,
          detected: false,
          error: `Virtual environment path does not exist: ${customVenvPath}`,
        });
      }
      
      if (!isValidVenv(expandedPath)) {
        return NextResponse.json({
          success: true,
          detected: false,
          error: `Path is not a valid Python virtual environment: ${customVenvPath}`,
        });
      }
      
      const pythonPath = getVenvPythonPath(expandedPath);
      // Check for alternative python path if python3 doesn't exist
      const actualPythonPath = fs.existsSync(pythonPath) 
        ? pythonPath 
        : path.join(expandedPath, 'bin', 'python');
      
      return NextResponse.json({
        success: true,
        detected: true,
        venvPath: expandedPath,
        pythonPath: actualPythonPath,
      });
    }

    // Auto-detect: look for .venv in the same directory as the script
    if (!scriptPath) {
      return NextResponse.json({
        success: true,
        detected: false,
        error: 'No script path provided for auto-detection',
      });
    }

    const expandedScriptPath = expandTilde(scriptPath);
    
    // Check if script path exists
    if (!fs.existsSync(expandedScriptPath)) {
      return NextResponse.json({
        success: true,
        detected: false,
        error: `Script path does not exist: ${scriptPath}`,
      });
    }

    // Get the directory containing the script
    const scriptDir = path.dirname(expandedScriptPath);
    
    // Common venv folder names to check
    const venvNames = ['.venv', 'venv', '.env', 'env'];
    
    for (const venvName of venvNames) {
      const potentialVenvPath = path.join(scriptDir, venvName);
      
      if (fs.existsSync(potentialVenvPath) && isValidVenv(potentialVenvPath)) {
        const pythonPath = getVenvPythonPath(potentialVenvPath);
        const actualPythonPath = fs.existsSync(pythonPath)
          ? pythonPath
          : path.join(potentialVenvPath, 'bin', 'python');
        
        return NextResponse.json({
          success: true,
          detected: true,
          venvPath: potentialVenvPath,
          pythonPath: actualPythonPath,
        });
      }
    }

    // No venv found
    return NextResponse.json({
      success: true,
      detected: false,
      error: 'No virtual environment detected in script directory',
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      detected: false,
      error: (error as Error).message,
    });
  }
}
