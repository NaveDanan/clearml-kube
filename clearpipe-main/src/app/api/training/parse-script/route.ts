import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DetectedParam {
  name: string;
  type: 'int' | 'float' | 'str' | 'bool' | 'list' | 'unknown';
  default?: string | number | boolean | null;
  help?: string;
  choices?: (string | number)[];
  required?: boolean;
  source: 'argparse' | 'hyperparameter' | 'env' | 'config';
  // Range values for hyperparameters (like YOLOv7 meta format)
  min?: number;
  max?: number;
}

interface ParseScriptRequest {
  scriptContent?: string; // Direct script content
  scriptPath?: string; // Local file path
  framework?: string; // ML framework hint
}

interface ParseScriptResponse {
  success: boolean;
  params?: DetectedParam[];
  framework?: string;
  error?: string;
}

// Python script that parses another Python script to extract argparse arguments and hyperparameters
const PARSER_SCRIPT = `
import sys
import ast
import json
import re

def extract_argparse_args(tree):
    """Extract arguments from argparse.ArgumentParser.add_argument calls."""
    args = []
    
    for node in ast.walk(tree):
        # Look for method calls
        if isinstance(node, ast.Call):
            # Check if it's a method call (has attr)
            if isinstance(node.func, ast.Attribute):
                if node.func.attr == 'add_argument':
                    arg_info = parse_add_argument(node)
                    if arg_info:
                        args.append(arg_info)
    
    return args

def parse_add_argument(node):
    """Parse an add_argument call to extract parameter info."""
    try:
        # Get the argument name (first positional arg)
        if not node.args:
            return None
        
        arg_name = None
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                name = arg.value
                # Prefer --long-option over -s short option
                if name.startswith('--'):
                    arg_name = name.lstrip('-').replace('-', '_')
                    break
                elif name.startswith('-') and arg_name is None:
                    arg_name = name.lstrip('-').replace('-', '_')
        
        if not arg_name:
            return None
        
        param = {
            'name': arg_name,
            'type': 'str',
            'source': 'argparse',
            'required': False
        }
        
        # Parse keyword arguments
        for kw in node.keywords:
            if kw.arg == 'type':
                if isinstance(kw.value, ast.Name):
                    type_map = {'int': 'int', 'float': 'float', 'str': 'str', 'bool': 'bool'}
                    param['type'] = type_map.get(kw.value.id, 'unknown')
            elif kw.arg == 'default':
                param['default'] = get_constant_value(kw.value)
            elif kw.arg == 'help':
                if isinstance(kw.value, ast.Constant):
                    param['help'] = kw.value.value
            elif kw.arg == 'required':
                if isinstance(kw.value, ast.Constant):
                    param['required'] = kw.value.value
            elif kw.arg == 'action':
                if isinstance(kw.value, ast.Constant):
                    if kw.value.value in ('store_true', 'store_false'):
                        param['type'] = 'bool'
                        param['default'] = kw.value.value == 'store_false'
            elif kw.arg == 'choices':
                if isinstance(kw.value, (ast.List, ast.Tuple)):
                    param['choices'] = [get_constant_value(el) for el in kw.value.elts]
            elif kw.arg == 'nargs':
                if isinstance(kw.value, ast.Constant):
                    if kw.value.value in ('+', '*') or isinstance(kw.value.value, int):
                        param['type'] = 'list'
        
        return param
    except Exception as e:
        return None

def get_constant_value(node):
    """Extract constant value from AST node."""
    if isinstance(node, ast.Constant):
        return node.value
    elif isinstance(node, ast.Num):  # Python 3.7 compatibility
        return node.n
    elif isinstance(node, ast.Str):  # Python 3.7 compatibility
        return node.s
    elif isinstance(node, ast.NameConstant):  # Python 3.7 compatibility
        return node.value
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        val = get_constant_value(node.operand)
        if val is not None:
            return -val
    elif isinstance(node, ast.List):
        # Handle list defaults like [640, 640]
        return [get_constant_value(el) for el in node.elts]
    elif isinstance(node, ast.Tuple):
        # Handle tuple defaults
        return tuple(get_constant_value(el) for el in node.elts)
    return None

def extract_inline_comments(source_code):
    """Extract inline comments from source code lines for parameter descriptions."""
    comments = {}
    lines = source_code.split('\\n')
    for i, line in enumerate(lines):
        if '#' in line:
            # Find the comment part
            code_part, comment_part = line.split('#', 1)
            comment = comment_part.strip()
            if comment:
                # Store by line number (1-indexed to match AST)
                comments[i + 1] = comment
    return comments

def extract_tuple_range_value(node):
    """Extract range values from a tuple like (scale, min, max)."""
    if not isinstance(node, ast.Tuple) or len(node.elts) < 2:
        return None
    
    values = []
    for el in node.elts:
        val = get_constant_value(el)
        if val is not None:
            values.append(val)
        else:
            # Handle scientific notation like 1e-5
            if isinstance(el, ast.BinOp):
                # Try to evaluate simple expressions
                try:
                    val = eval(compile(ast.Expression(el), '<string>', 'eval'))
                    values.append(val)
                except:
                    values.append(None)
            else:
                values.append(None)
    
    return values if len(values) >= 2 else None

def extract_meta_hyperparameters(tree, source_code, inline_comments):
    """
    Extract hyperparameters from 'meta' style dicts like YOLOv7's format:
    meta = {'lr0': (1, 1e-5, 1e-1),  # initial learning rate
            'momentum': (0.3, 0.6, 0.98),  # SGD momentum
            ...}
    """
    hyperparams = []
    
    # Common dict names that might contain hyperparameter metadata
    meta_dict_names = {'meta', 'hyp', 'hyperparameters', 'hp', 'hparams', 'config', 'params', 'settings', 'options'}
    
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            # Check if this is an assignment to a meta-style dict
            for target in node.targets:
                if isinstance(target, ast.Name):
                    var_name_lower = target.id.lower()
                    # Check for meta dict names
                    is_meta_dict = var_name_lower in meta_dict_names
                    
                    if isinstance(node.value, ast.Dict) and is_meta_dict:
                        for key, value in zip(node.value.keys, node.value.values):
                            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                                param_name = key.value
                                
                                # Check if value is a tuple (range format)
                                if isinstance(value, ast.Tuple):
                                    range_values = extract_tuple_range_value(value)
                                    if range_values and len(range_values) >= 3:
                                        # Format: (mutation_scale, min_value, max_value)
                                        scale, min_val, max_val = range_values[0], range_values[1], range_values[2]
                                        
                                        # Determine type based on values
                                        if all(isinstance(v, int) for v in [min_val, max_val] if v is not None):
                                            param_type = 'int'
                                        else:
                                            param_type = 'float'
                                        
                                        # Use min_value as default (more conservative starting point)
                                        default_val = min_val if min_val is not None else max_val
                                        
                                        # Try to get help text from inline comment
                                        help_text = None
                                        if hasattr(key, 'lineno'):
                                            help_text = inline_comments.get(key.lineno, None)
                                        
                                        hyperparams.append({
                                            'name': param_name,
                                            'type': param_type,
                                            'default': default_val,
                                            'min': min_val,
                                            'max': max_val,
                                            'help': help_text,
                                            'source': 'hyperparameter'
                                        })
                                    elif range_values and len(range_values) == 2:
                                        # Format: (min_value, max_value)
                                        min_val, max_val = range_values[0], range_values[1]
                                        
                                        if all(isinstance(v, int) for v in [min_val, max_val] if v is not None):
                                            param_type = 'int'
                                        else:
                                            param_type = 'float'
                                        
                                        # Use min_value as default
                                        default_val = min_val if min_val is not None else max_val
                                        
                                        help_text = None
                                        if hasattr(key, 'lineno'):
                                            help_text = inline_comments.get(key.lineno, None)
                                        
                                        hyperparams.append({
                                            'name': param_name,
                                            'type': param_type,
                                            'default': default_val,
                                            'min': min_val,
                                            'max': max_val,
                                            'help': help_text,
                                            'source': 'hyperparameter'
                                        })
                                else:
                                    # Regular value (not a tuple)
                                    const_val = get_constant_value(value)
                                    if const_val is not None:
                                        if isinstance(const_val, bool):
                                            param_type = 'bool'
                                        elif isinstance(const_val, int):
                                            param_type = 'int'
                                        elif isinstance(const_val, float):
                                            param_type = 'float'
                                        else:
                                            param_type = 'str'
                                        
                                        help_text = None
                                        if hasattr(key, 'lineno'):
                                            help_text = inline_comments.get(key.lineno, None)
                                        
                                        hyperparams.append({
                                            'name': param_name,
                                            'type': param_type,
                                            'default': const_val,
                                            'help': help_text,
                                            'source': 'config'
                                        })
    
    return hyperparams

def extract_hyperparameters(tree, source_code):
    """Extract common hyperparameter patterns from the code."""
    hyperparams = []
    
    # First, extract inline comments for help text
    inline_comments = extract_inline_comments(source_code)
    
    # Common hyperparameter variable names and their typical types
    hp_patterns = {
        'epochs': 'int',
        'num_epochs': 'int',
        'n_epochs': 'int',
        'batch_size': 'int',
        'learning_rate': 'float',
        'lr': 'float',
        'lr0': 'float',
        'lrf': 'float',
        'weight_decay': 'float',
        'momentum': 'float',
        'dropout': 'float',
        'dropout_rate': 'float',
        'hidden_size': 'int',
        'hidden_dim': 'int',
        'num_layers': 'int',
        'n_layers': 'int',
        'num_workers': 'int',
        'n_workers': 'int',
        'workers': 'int',
        'patience': 'int',
        'seed': 'int',
        'random_seed': 'int',
        'max_length': 'int',
        'max_seq_length': 'int',
        'warmup_steps': 'int',
        'warmup_epochs': 'float',
        'warmup_momentum': 'float',
        'warmup_bias_lr': 'float',
        'warmup_ratio': 'float',
        'gradient_accumulation_steps': 'int',
        'max_grad_norm': 'float',
        'num_train_epochs': 'int',
        'per_device_train_batch_size': 'int',
        'per_device_eval_batch_size': 'int',
        'save_steps': 'int',
        'eval_steps': 'int',
        'logging_steps': 'int',
        # YOLO / Object Detection specific
        'box': 'float',
        'cls': 'float',
        'cls_pw': 'float',
        'obj': 'float',
        'obj_pw': 'float',
        'iou_t': 'float',
        'anchor_t': 'float',
        'anchors': 'float',
        'fl_gamma': 'float',
        'hsv_h': 'float',
        'hsv_s': 'float',
        'hsv_v': 'float',
        'degrees': 'float',
        'translate': 'float',
        'scale': 'float',
        'shear': 'float',
        'perspective': 'float',
        'flipud': 'float',
        'fliplr': 'float',
        'mosaic': 'float',
        'mixup': 'float',
        'copy_paste': 'float',
        'paste_in': 'float',
    }
    
    # Look for assignments at module level or in main blocks
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    var_name = target.id.lower()
                    if var_name in hp_patterns:
                        value = get_constant_value(node.value)
                        help_text = None
                        if hasattr(node, 'lineno'):
                            help_text = inline_comments.get(node.lineno, None)
                        hyperparams.append({
                            'name': target.id,
                            'type': hp_patterns[var_name],
                            'default': value,
                            'help': help_text,
                            'source': 'hyperparameter'
                        })
    
    # Look for dict-based configs like config = {'epochs': 10, ...}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if isinstance(node.value, ast.Dict):
                for key, value in zip(node.value.keys, node.value.values):
                    if isinstance(key, ast.Constant) and isinstance(key.value, str):
                        key_lower = key.value.lower()
                        if key_lower in hp_patterns:
                            help_text = None
                            if hasattr(key, 'lineno'):
                                help_text = inline_comments.get(key.lineno, None)
                            hyperparams.append({
                                'name': key.value,
                                'type': hp_patterns[key_lower],
                                'default': get_constant_value(value),
                                'help': help_text,
                                'source': 'config'
                            })
    
    # Extract meta-style hyperparameters (with ranges like YOLOv7)
    meta_hyperparams = extract_meta_hyperparameters(tree, source_code, inline_comments)
    hyperparams.extend(meta_hyperparams)
    
    return hyperparams

def detect_framework(source_code):
    """Detect the ML framework used in the script."""
    framework_patterns = {
        'pytorch': [r'import torch', r'from torch', r'torch\\.nn', r'torch\\.optim'],
        'tensorflow': [r'import tensorflow', r'from tensorflow', r'tf\\.keras', r'keras\\.'],
        'sklearn': [r'from sklearn', r'import sklearn', r'scikit-learn'],
        'xgboost': [r'import xgboost', r'from xgboost', r'xgb\\.'],
        'lightgbm': [r'import lightgbm', r'from lightgbm', r'lgb\\.'],
    }
    
    for framework, patterns in framework_patterns.items():
        for pattern in patterns:
            if re.search(pattern, source_code):
                return framework
    
    return 'custom'

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No script path provided'}))
        sys.exit(1)
    
    script_path = sys.argv[1]
    
    try:
        with open(script_path, 'r', encoding='utf-8') as f:
            source_code = f.read()
        
        tree = ast.parse(source_code)
        
        # Extract argparse arguments
        argparse_args = extract_argparse_args(tree)
        
        # Extract hyperparameters
        hyperparams = extract_hyperparameters(tree, source_code)
        
        # Detect framework
        framework = detect_framework(source_code)
        
        # Combine and deduplicate (argparse takes priority)
        seen_names = set()
        all_params = []
        
        for param in argparse_args:
            name_lower = param['name'].lower()
            if name_lower not in seen_names:
                seen_names.add(name_lower)
                all_params.append(param)
        
        for param in hyperparams:
            name_lower = param['name'].lower()
            if name_lower not in seen_names:
                seen_names.add(name_lower)
                all_params.append(param)
        
        result = {
            'success': True,
            'params': all_params,
            'framework': framework
        }
        
        print(json.dumps(result))
        
    except SyntaxError as e:
        print(json.dumps({'success': False, 'error': f'Syntax error in script: {str(e)}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
`;

export async function POST(request: NextRequest): Promise<NextResponse<ParseScriptResponse>> {
  try {
    const body: ParseScriptRequest = await request.json();
    const { scriptContent, scriptPath, framework } = body;

    let targetPath: string;
    let tempFile: string | null = null;

    if (scriptContent) {
      // Write content to a temp file
      tempFile = path.join(os.tmpdir(), `parse_script_${Date.now()}.py`);
      fs.writeFileSync(tempFile, scriptContent, 'utf-8');
      targetPath = tempFile;
    } else if (scriptPath) {
      // Use the provided path
      if (!fs.existsSync(scriptPath)) {
        return NextResponse.json({
          success: false,
          error: `Script file not found: ${scriptPath}`,
        });
      }
      targetPath = scriptPath;
    } else {
      return NextResponse.json({
        success: false,
        error: 'Either scriptContent or scriptPath must be provided',
      });
    }

    // Write the parser script to a temp file
    const parserPath = path.join(os.tmpdir(), `param_parser_${Date.now()}.py`);
    fs.writeFileSync(parserPath, PARSER_SCRIPT, 'utf-8');

    try {
      // Run the parser script
      const result = await new Promise<ParseScriptResponse>((resolve) => {
        const proc = spawn('python', [parserPath, targetPath], {
          cwd: path.dirname(targetPath),
          env: { ...process.env },
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
          if (code !== 0) {
            resolve({
              success: false,
              error: stderr || `Parser exited with code ${code}`,
            });
            return;
          }

          try {
            const parsed = JSON.parse(stdout);
            resolve({
              success: parsed.success ?? true,
              params: parsed.params || [],
              framework: parsed.framework || framework || 'custom',
              error: parsed.error,
            });
          } catch (e) {
            resolve({
              success: false,
              error: `Failed to parse output: ${stdout}`,
            });
          }
        });

        proc.on('error', (err) => {
          resolve({
            success: false,
            error: `Failed to run parser: ${err.message}`,
          });
        });
      });

      return NextResponse.json(result);
    } finally {
      // Clean up temp files
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if (fs.existsSync(parserPath)) {
        fs.unlinkSync(parserPath);
      }
    }
  } catch (error) {
    console.error('[Training API] Parse script error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
