#!/usr/bin/env python3
"""
Quick test to verify ClearML SDK is installed and wrapper works.
Usage: uv run python scripts/test_clearml_wrapper.py
"""

import sys
import json
import subprocess

def test_clearml_import():
    """Test if ClearML can be imported."""
    try:
        from clearml import Dataset, Task
        print("✅ ClearML SDK imported successfully")
        return True
    except ImportError as e:
        print(f"❌ ClearML SDK not installed: {e}")
        print("\n   Install with: uv pip install clearml")
        return False

def test_wrapper_syntax():
    """Test if the wrapper script has valid Python syntax."""
    try:
        import ast
        with open("scripts/clearml_wrapper.py", "r") as f:
            source = f.read()
        ast.parse(source)
        print("✅ clearml_wrapper.py has valid Python syntax")
        return True
    except SyntaxError as e:
        print(f"❌ Syntax error in clearml_wrapper.py: {e}")
        return False
    except FileNotFoundError:
        print("❌ clearml_wrapper.py not found")
        return False

def test_wrapper_help():
    """Test if the wrapper can show help."""
    try:
        result = subprocess.run(
            [sys.executable, "scripts/clearml_wrapper.py", "--help"],
            capture_output=True,
            text=True
        )
        if "ClearML Dataset Wrapper" in result.stdout:
            print("✅ clearml_wrapper.py --help works correctly")
            return True
        else:
            print(f"⚠️ Unexpected help output: {result.stdout[:200]}")
            return False
    except Exception as e:
        print(f"❌ Failed to run wrapper: {e}")
        return False

def main():
    print("=" * 60)
    print("ClearML Wrapper Test Suite")
    print("=" * 60)
    print()
    
    results = []
    
    # Test 1: ClearML import
    results.append(("ClearML SDK Import", test_clearml_import()))
    print()
    
    # Test 2: Wrapper syntax
    results.append(("Wrapper Syntax", test_wrapper_syntax()))
    print()
    
    # Test 3: Wrapper help (only if ClearML is available)
    if results[0][1]:  # ClearML was imported successfully
        results.append(("Wrapper Help", test_wrapper_help()))
        print()
    
    # Summary
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    print(f"\nPassed: {passed}/{total}")
    
    if passed == total:
        print("\n✅ All tests passed! ClearML wrapper is ready to use.")
        return 0
    else:
        print("\n⚠️ Some tests failed. Please install missing dependencies.")
        print("   Run: uv pip install clearml")
        print("   Or:  uv sync")
        return 1

if __name__ == "__main__":
    sys.exit(main())
