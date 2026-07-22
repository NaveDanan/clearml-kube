#!/usr/bin/env python3
"""
ClearML Dataset Wrapper for ClearPipe
Provides a simple CLI interface to ClearML SDK operations.
Usage:
    python clearml_wrapper.py <action> [options]
    
Actions:
    create    - Create a new dataset and upload files
    version   - Create a new version of an existing dataset
    download  - Download a dataset to local path
    list      - List all datasets
    info      - Get info about a specific dataset
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional, List, Dict, Any

# Check if clearml is installed
try:
    from clearml import Dataset, Task
    CLEARML_AVAILABLE = True
except ImportError:
    CLEARML_AVAILABLE = False


def setup_credentials(api_host: str, web_host: str, files_host: str, 
                      access_key: str, secret_key: str) -> None:
    """Set up ClearML credentials via environment variables."""
    os.environ['CLEARML_API_HOST'] = api_host
    os.environ['CLEARML_WEB_HOST'] = web_host  
    os.environ['CLEARML_FILES_HOST'] = files_host
    os.environ['CLEARML_API_ACCESS_KEY'] = access_key
    os.environ['CLEARML_API_SECRET_KEY'] = secret_key
    
    # Also set the config to avoid interactive prompts
    os.environ['CLEARML_CONFIG_FILE'] = ''  # Don't read from config file


def create_dataset(
    name: str,
    project: Optional[str] = None,
    input_paths: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    description: Optional[str] = None,
    output_uri: Optional[str] = None
) -> Dict[str, Any]:
    """Create a new ClearML dataset and upload files."""
    try:
        # Create the dataset
        dataset = Dataset.create(
            dataset_name=name,
            dataset_project=project or "datasets",
            dataset_tags=tags or [],
            description=description or f"Created by ClearPipe",
            output_uri=output_uri  # None uses default ClearML file server
        )
        
        files_added = []
        total_size = 0
        
        # Add files from input paths
        if input_paths:
            for input_path in input_paths:
                path = Path(input_path)
                if not path.exists():
                    return {
                        "success": False,
                        "error": f"Path does not exist: {input_path}"
                    }
                
                if path.is_file():
                    # Add single file
                    dataset.add_files(path=str(path))
                    size = path.stat().st_size
                    files_added.append({
                        "path": str(path),
                        "name": path.name,
                        "size": size
                    })
                    total_size += size
                elif path.is_dir():
                    # Add directory recursively
                    dataset.add_files(path=str(path))
                    for file_path in path.rglob("*"):
                        if file_path.is_file():
                            size = file_path.stat().st_size
                            files_added.append({
                                "path": str(file_path),
                                "name": str(file_path.relative_to(path)),
                                "size": size
                            })
                            total_size += size
        
        # Upload and finalize the dataset
        dataset.upload()
        dataset.finalize()
        
        return {
            "success": True,
            "datasetId": dataset.id,
            "datasetName": name,
            "datasetProject": project or "datasets",
            "filesAdded": len(files_added),
            "totalSize": total_size,
            "files": files_added[:20],  # Limit to first 20 for response size
            "webUrl": f"{os.environ.get('CLEARML_WEB_HOST', 'https://app.clear.ml')}/datasets/{dataset.id}"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def create_version(
    parent_id: Optional[str] = None,
    parent_name: Optional[str] = None,
    parent_project: Optional[str] = None,
    input_paths: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    description: Optional[str] = None
) -> Dict[str, Any]:
    """Create a new version of an existing dataset."""
    try:
        # Get parent dataset
        if parent_id:
            parent_dataset = Dataset.get(dataset_id=parent_id)
        elif parent_name:
            parent_dataset = Dataset.get(
                dataset_name=parent_name,
                dataset_project=parent_project
            )
        else:
            return {
                "success": False,
                "error": "Either parent_id or parent_name is required"
            }
        
        if not parent_dataset:
            return {
                "success": False,
                "error": "Parent dataset not found"
            }
        
        # Create child dataset (new version)
        new_dataset = Dataset.create(
            dataset_name=parent_dataset.name,
            dataset_project=parent_dataset.project,
            parent_datasets=[parent_dataset.id],
            dataset_tags=tags or [],
            description=description or f"New version created by ClearPipe"
        )
        
        files_added = []
        total_size = 0
        
        # Add files from input paths
        if input_paths:
            for input_path in input_paths:
                path = Path(input_path)
                if not path.exists():
                    return {
                        "success": False,
                        "error": f"Path does not exist: {input_path}"
                    }
                
                if path.is_file():
                    new_dataset.add_files(path=str(path))
                    size = path.stat().st_size
                    files_added.append({
                        "path": str(path),
                        "name": path.name,
                        "size": size
                    })
                    total_size += size
                elif path.is_dir():
                    new_dataset.add_files(path=str(path))
                    for file_path in path.rglob("*"):
                        if file_path.is_file():
                            size = file_path.stat().st_size
                            files_added.append({
                                "path": str(file_path),
                                "name": str(file_path.relative_to(path)),
                                "size": size
                            })
                            total_size += size
        
        # Upload and finalize
        new_dataset.upload()
        new_dataset.finalize()
        
        return {
            "success": True,
            "datasetId": new_dataset.id,
            "parentId": parent_dataset.id,
            "datasetName": new_dataset.name,
            "datasetProject": new_dataset.project,
            "filesAdded": len(files_added),
            "totalSize": total_size,
            "files": files_added[:20],
            "webUrl": f"{os.environ.get('CLEARML_WEB_HOST', 'https://app.clear.ml')}/datasets/{new_dataset.id}"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def download_dataset(
    dataset_id: Optional[str] = None,
    dataset_name: Optional[str] = None,
    dataset_project: Optional[str] = None,
    output_path: Optional[str] = None
) -> Dict[str, Any]:
    """Download a dataset to local path."""
    try:
        # Get the dataset
        if dataset_id:
            dataset = Dataset.get(dataset_id=dataset_id)
        elif dataset_name:
            dataset = Dataset.get(
                dataset_name=dataset_name,
                dataset_project=dataset_project
            )
        else:
            return {
                "success": False,
                "error": "Either dataset_id or dataset_name is required"
            }
        
        if not dataset:
            return {
                "success": False,
                "error": "Dataset not found"
            }
        
        # Download to specified path or default
        target_path = output_path or str(Path.cwd() / "data" / "downloaded" / dataset.name)
        local_path = dataset.get_local_copy(target_folder=target_path)
        
        # Count downloaded files
        files_downloaded = []
        path = Path(local_path)
        if path.exists():
            for file_path in path.rglob("*"):
                if file_path.is_file():
                    files_downloaded.append({
                        "path": str(file_path),
                        "name": str(file_path.relative_to(path)),
                        "size": file_path.stat().st_size
                    })
        
        return {
            "success": True,
            "datasetId": dataset.id,
            "datasetName": dataset.name,
            "localPath": local_path,
            "filesDownloaded": len(files_downloaded),
            "files": files_downloaded[:20]
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def list_datasets(
    project: Optional[str] = None,
    tags: Optional[List[str]] = None,
    only_completed: bool = True
) -> Dict[str, Any]:
    """List all datasets."""
    try:
        datasets = Dataset.list_datasets(
            dataset_project=project,
            tags=tags,
            only_completed=only_completed
        )
        
        dataset_list = []
        for ds_info in datasets:
            dataset_list.append({
                "id": ds_info.get("id"),
                "name": ds_info.get("name"),
                "project": ds_info.get("project"),
                "tags": ds_info.get("tags", []),
                "created": ds_info.get("created"),
                "version": ds_info.get("version"),
            })
        
        return {
            "success": True,
            "count": len(dataset_list),
            "datasets": dataset_list
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def get_dataset_info(
    dataset_id: Optional[str] = None,
    dataset_name: Optional[str] = None,
    dataset_project: Optional[str] = None
) -> Dict[str, Any]:
    """Get detailed info about a dataset."""
    try:
        if dataset_id:
            dataset = Dataset.get(dataset_id=dataset_id)
        elif dataset_name:
            dataset = Dataset.get(
                dataset_name=dataset_name,
                dataset_project=dataset_project
            )
        else:
            return {
                "success": False,
                "error": "Either dataset_id or dataset_name is required"
            }
        
        if not dataset:
            return {
                "success": False,
                "error": "Dataset not found"
            }
        
        # Get file list
        file_entries = dataset.list_files()
        files = []
        for entry in file_entries[:50]:  # Limit to 50 files
            files.append({
                "path": entry,
                "size": dataset.get_file_size(entry) if hasattr(dataset, 'get_file_size') else None
            })
        
        return {
            "success": True,
            "datasetId": dataset.id,
            "datasetName": dataset.name,
            "project": dataset.project,
            "tags": dataset.tags,
            "fileCount": len(file_entries),
            "files": files,
            "isFinalized": dataset.is_final(),
            "webUrl": f"{os.environ.get('CLEARML_WEB_HOST', 'https://app.clear.ml')}/datasets/{dataset.id}"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def main():
    if not CLEARML_AVAILABLE:
        result = {
            "success": False,
            "error": "ClearML SDK not installed. Install with: pip install clearml",
            "installCommand": "pip install clearml"
        }
        print(json.dumps(result))
        sys.exit(1)
    
    parser = argparse.ArgumentParser(description="ClearML Dataset Wrapper for ClearPipe")
    parser.add_argument("action", choices=["create", "version", "download", "list", "info"],
                        help="Action to perform")
    
    # Credentials (required for all actions)
    parser.add_argument("--api-host", default="https://api.clear.ml",
                        help="ClearML API host")
    parser.add_argument("--web-host", default="https://app.clear.ml",
                        help="ClearML Web host")
    parser.add_argument("--files-host", default="https://files.clear.ml",
                        help="ClearML Files host")
    parser.add_argument("--access-key", required=True,
                        help="ClearML access key")
    parser.add_argument("--secret-key", required=True,
                        help="ClearML secret key")
    
    # Dataset identification
    parser.add_argument("--dataset-id", help="Dataset ID")
    parser.add_argument("--dataset-name", help="Dataset name")
    parser.add_argument("--dataset-project", help="Dataset project")
    
    # Create/version options
    parser.add_argument("--input-path", action="append", dest="input_paths",
                        help="Input path(s) to add (can be specified multiple times)")
    parser.add_argument("--tags", action="append",
                        help="Tags to apply (can be specified multiple times)")
    parser.add_argument("--description", help="Dataset description")
    parser.add_argument("--output-uri", help="Output URI for upload")
    
    # Download options
    parser.add_argument("--output-path", help="Output path for download")
    
    # List options
    parser.add_argument("--only-completed", action="store_true", default=True,
                        help="Only list completed datasets")
    
    args = parser.parse_args()
    
    # Setup credentials
    setup_credentials(
        api_host=args.api_host,
        web_host=args.web_host,
        files_host=args.files_host,
        access_key=args.access_key,
        secret_key=args.secret_key
    )
    
    # Execute action
    if args.action == "create":
        if not args.dataset_name:
            result = {"success": False, "error": "Dataset name is required for create action"}
        elif not args.input_paths:
            result = {"success": False, "error": "At least one input path is required for create action"}
        else:
            result = create_dataset(
                name=args.dataset_name,
                project=args.dataset_project,
                input_paths=args.input_paths,
                tags=args.tags,
                description=args.description,
                output_uri=args.output_uri
            )
    
    elif args.action == "version":
        if not args.dataset_id and not args.dataset_name:
            result = {"success": False, "error": "Dataset ID or name is required for version action"}
        elif not args.input_paths:
            result = {"success": False, "error": "At least one input path is required for version action"}
        else:
            result = create_version(
                parent_id=args.dataset_id,
                parent_name=args.dataset_name,
                parent_project=args.dataset_project,
                input_paths=args.input_paths,
                tags=args.tags,
                description=args.description
            )
    
    elif args.action == "download":
        result = download_dataset(
            dataset_id=args.dataset_id,
            dataset_name=args.dataset_name,
            dataset_project=args.dataset_project,
            output_path=args.output_path
        )
    
    elif args.action == "list":
        result = list_datasets(
            project=args.dataset_project,
            tags=args.tags,
            only_completed=args.only_completed
        )
    
    elif args.action == "info":
        result = get_dataset_info(
            dataset_id=args.dataset_id,
            dataset_name=args.dataset_name,
            dataset_project=args.dataset_project
        )
    
    else:
        result = {"success": False, "error": f"Unknown action: {args.action}"}
    
    # Output JSON result with a clear separator to help parsing
    # Use a marker that won't appear in ClearML output
    print("---CLEARML_JSON_START---", flush=True)
    print(json.dumps(result, indent=2, default=str), flush=True)
    print("---CLEARML_JSON_END---", flush=True)
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
