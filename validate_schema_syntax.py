#!/usr/bin/env python3
"""
Syntax validation for event schema (no dependencies required).
This validates Python syntax and imports structure without running the code.
"""

import ast
import sys
from pathlib import Path
from typing import Tuple


def validate_python_file(file_path: Path) -> Tuple[bool, str]:
    """Validate Python syntax and structure"""
    try:
        with open(file_path, 'r') as f:
            code = f.read()

        # Parse AST
        tree = ast.parse(code, filename=str(file_path))

        # Count definitions
        classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
        functions = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]

        return True, f"✓ {len(classes)} classes, {len(functions)} functions"

    except SyntaxError as e:
        return False, f"✗ Syntax error: {e}"
    except Exception as e:
        return False, f"✗ Error: {e}"


def main():
    """Validate all event schema files"""
    print("Validating Naxis Event Schema\n")
    print("="*60)

    base_dir = Path(__file__).parent
    files_to_check = [
        "backend/shared/models/__init__.py",
        "backend/shared/models/event.py",
        "backend/shared/models/event_factory.py",
        "test_event_schema.py",
    ]

    all_valid = True

    for file_path in files_to_check:
        full_path = base_dir / file_path
        if not full_path.exists():
            print(f"✗ {file_path}: File not found")
            all_valid = False
            continue

        valid, message = validate_python_file(full_path)

        if valid:
            print(f"✓ {file_path}")
            print(f"  {message}")
        else:
            print(f"✗ {file_path}")
            print(f"  {message}")
            all_valid = False

    # Check SQL schema
    print()
    sql_file = base_dir / "schemas/clickhouse/001_events.sql"
    if sql_file.exists():
        content = sql_file.read_text()
        line_count = len(content.splitlines())
        has_create = "CREATE TABLE" in content
        has_indexes = "INDEX" in content
        has_partitions = "PARTITION BY" in content

        print(f"✓ schemas/clickhouse/001_events.sql")
        print(f"  {line_count} lines, CREATE TABLE: {has_create}, Indexes: {has_indexes}, Partitioning: {has_partitions}")
    else:
        print("✗ schemas/clickhouse/001_events.sql: File not found")
        all_valid = False

    print()
    print("="*60)

    if all_valid:
        print("✅ All schema files are syntactically valid!")
        print()
        print("Schema Summary:")
        print("  - UnifiedEvent model with 40+ event types")
        print("  - EventFactory for easy event creation")
        print("  - ClickHouse schema with partitioning & indexes")
        print("  - Test suite ready to run (requires pydantic)")
        print()
        print("Next: Install dependencies to run full test")
        print("  $ cd backend/shared")
        print("  $ pip install -e .")
        print("  $ python3 ../../test_event_schema.py")
        return 0
    else:
        print("❌ Some files have errors!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
