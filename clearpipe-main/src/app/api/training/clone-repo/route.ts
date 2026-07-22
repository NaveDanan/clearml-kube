import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface CloneRepoRequest {
  repoUrl: string;
  branch?: string;
  commitId?: string;
  targetDir?: string; // Optional custom target directory
  authToken?: string; // PAT or OAuth token for private repos
  sshKey?: string; // SSH private key for SSH auth
  shallow?: boolean; // Whether to do shallow clone (default: true)
}

interface CloneRepoResponse {
  success: boolean;
  localPath?: string;
  branch?: string;
  commitId?: string;
  error?: string;
  files?: string[]; // List of files in the repo root
}

/**
 * Inject auth token into HTTPS URL for private repos
 */
function injectAuthToken(repoUrl: string, authToken: string): string {
  try {
    const url = new URL(repoUrl);
    // Format: https://token@github.com/user/repo.git
    url.username = authToken;
    url.password = 'x-oauth-basic'; // GitHub convention, works for most providers
    return url.toString();
  } catch {
    // If URL parsing fails, try simple injection
    if (repoUrl.startsWith('https://')) {
      return repoUrl.replace('https://', `https://${authToken}@`);
    }
    return repoUrl;
  }
}

/**
 * Execute a git command and return the output
 */
async function execGit(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout: '',
        stderr: err.message,
      });
    });
  });
}

/**
 * List files in a directory (non-recursive, top-level only)
 */
function listFiles(dirPath: string): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('.git'))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch {
    return [];
  }
}

/**
 * Find Python files in the repository
 */
function findPythonFiles(dirPath: string, maxDepth: number = 3): string[] {
  const pythonFiles: string[] = [];
  
  function walk(currentPath: string, depth: number) {
    if (depth > maxDepth) return;
    
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip hidden directories and common non-source directories
        if (entry.name.startsWith('.') || 
            entry.name === 'node_modules' || 
            entry.name === '__pycache__' ||
            entry.name === 'venv' ||
            entry.name === '.venv' ||
            entry.name === 'env') {
          continue;
        }
        
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
        
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.name.endsWith('.py')) {
          pythonFiles.push(relativePath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }
  
  walk(dirPath, 0);
  return pythonFiles.sort();
}

export async function POST(request: NextRequest): Promise<NextResponse<CloneRepoResponse>> {
  try {
    const body: CloneRepoRequest = await request.json();
    const { repoUrl, branch, commitId, targetDir, authToken, sshKey, shallow = true } = body;

    if (!repoUrl) {
      return NextResponse.json({
        success: false,
        error: 'Repository URL is required',
      });
    }

    // Generate a unique directory for the clone
    const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    const uniqueId = Date.now().toString(36);
    const cloneDir = targetDir || path.join(os.tmpdir(), 'clearpipe-training', `${repoName}-${uniqueId}`);

    // Ensure parent directory exists
    const parentDir = path.dirname(cloneDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Prepare the URL with auth if needed
    let cloneUrl = repoUrl;
    const gitEnv: Record<string, string> = {};

    if (authToken && repoUrl.startsWith('https://')) {
      cloneUrl = injectAuthToken(repoUrl, authToken);
    }

    if (sshKey) {
      // Write SSH key to temp file and configure Git to use it
      const sshKeyPath = path.join(os.tmpdir(), `clearpipe_ssh_${uniqueId}`);
      fs.writeFileSync(sshKeyPath, sshKey, { mode: 0o600 });
      gitEnv.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no`;
    }

    // Build clone command
    const cloneArgs = ['clone'];
    
    if (shallow && !commitId) {
      cloneArgs.push('--depth', '1');
    }
    
    if (branch && !commitId) {
      cloneArgs.push('--branch', branch);
    }
    
    cloneArgs.push(cloneUrl, cloneDir);

    // Execute clone
    console.log(`[Clone] Cloning ${repoUrl} to ${cloneDir}`);
    const cloneResult = await execGit(cloneArgs, os.tmpdir(), gitEnv);

    if (!cloneResult.success) {
      // Sanitize error message to remove auth tokens
      const sanitizedError = cloneResult.stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
      return NextResponse.json({
        success: false,
        error: `Failed to clone repository: ${sanitizedError}`,
      });
    }

    // If a specific commit was requested, checkout that commit
    let finalCommitId = commitId;
    let finalBranch = branch;

    if (commitId) {
      // If we did a shallow clone with branch, we need to fetch the specific commit
      if (shallow) {
        // Fetch the specific commit
        const fetchResult = await execGit(['fetch', 'origin', commitId, '--depth=1'], cloneDir, gitEnv);
        if (!fetchResult.success) {
          // Try fetching without depth limit
          await execGit(['fetch', '--unshallow'], cloneDir, gitEnv);
        }
      }
      
      // Checkout the specific commit
      const checkoutResult = await execGit(['checkout', commitId], cloneDir, gitEnv);
      if (!checkoutResult.success) {
        return NextResponse.json({
          success: false,
          error: `Failed to checkout commit ${commitId}: ${checkoutResult.stderr}`,
        });
      }
    }

    // Get the actual commit ID
    const revParseResult = await execGit(['rev-parse', 'HEAD'], cloneDir, gitEnv);
    if (revParseResult.success) {
      finalCommitId = revParseResult.stdout;
    }

    // Get the current branch name
    if (!finalBranch) {
      const branchResult = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cloneDir, gitEnv);
      if (branchResult.success && branchResult.stdout !== 'HEAD') {
        finalBranch = branchResult.stdout;
      }
    }

    // List files in the repository
    const files = listFiles(cloneDir);
    const pythonFiles = findPythonFiles(cloneDir);

    console.log(`[Clone] Successfully cloned to ${cloneDir}`);
    console.log(`[Clone] Found ${pythonFiles.length} Python files`);

    return NextResponse.json({
      success: true,
      localPath: cloneDir,
      branch: finalBranch,
      commitId: finalCommitId,
      files: [...files, '---', 'Python files:', ...pythonFiles],
    });
  } catch (error) {
    console.error('[Clone API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// GET endpoint to list branches for a repository
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const repoUrl = searchParams.get('repoUrl');
    const authToken = searchParams.get('authToken');

    if (!repoUrl) {
      return NextResponse.json({
        success: false,
        error: 'Repository URL is required',
      });
    }

    // Prepare URL with auth
    let lsRemoteUrl = repoUrl;
    if (authToken && repoUrl.startsWith('https://')) {
      lsRemoteUrl = injectAuthToken(repoUrl, authToken);
    }

    // Use git ls-remote to list branches without cloning
    const result = await execGit(['ls-remote', '--heads', lsRemoteUrl], os.tmpdir());

    if (!result.success) {
      const sanitizedError = result.stderr.replace(/https:\/\/[^@]+@/g, 'https://***@');
      return NextResponse.json({
        success: false,
        error: `Failed to list branches: ${sanitizedError}`,
      });
    }

    // Parse the output to get branch names
    const branches = result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/refs\/heads\/(.+)$/);
        return match ? match[1] : null;
      })
      .filter(Boolean) as string[];

    return NextResponse.json({
      success: true,
      branches,
    });
  } catch (error) {
    console.error('[Clone API] List branches error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
