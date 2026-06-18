# Naxis Shared Libraries

Common code shared across all Naxis backend services.

## Structure

- **models/**: Pydantic data models (UnifiedEvent, Incident, Topology)
- **database/**: Database clients (Redis, ClickHouse, Neo4j)
- **config/**: Configuration management (Pydantic Settings)
- **utils/**: Utility functions (logging, retry logic)

## Installation

This package is installed as an editable dependency in all services:

```bash
pip install -e ../shared
```

## Usage

```python
from models.event import UnifiedEvent, EventSource, EventSeverity
from database.redis import RedisClient
from database.clickhouse import ClickHouseClient
from database.neo4j import Neo4jClient
from config.settings import Settings
from utils.logging import setup_logging
```

## Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black .

# Lint
ruff check .
```
