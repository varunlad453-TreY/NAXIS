"""
Unit Tests for Database Migration Runner (WP-4)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import scripts.migrate as migrate_module


class TestMigrationRunner:
    """Test SQL schema discovery and idempotent execution."""

    @pytest.mark.asyncio
    @patch("scripts.migrate.asyncpg.connect", new_callable=AsyncMock)
    async def test_run_migrations_idempotent(self, mock_connect):
        mock_conn = AsyncMock()
        mock_tx = MagicMock()
        mock_tx.__aenter__ = AsyncMock(return_value=None)
        mock_tx.__aexit__ = AsyncMock(return_value=None)
        mock_conn.transaction = MagicMock(return_value=mock_tx)
        mock_connect.return_value = mock_conn

        # Mock schema_migrations existing entries
        mock_conn.fetch.return_value = [
            {"filename": "001_init.sql"},
            {"filename": "002_inventory.sql"},
        ]

        with patch.object(migrate_module, "SCHEMAS_DIR") as mock_dir:
            file1 = MagicMock(spec=Path)
            file1.name = "001_init.sql"
            file1.is_file.return_value = True

            file2 = MagicMock(spec=Path)
            file2.name = "013_audit_log.sql"
            file2.is_file.return_value = True
            file2.read_text.return_value = "CREATE TABLE IF NOT EXISTS audit_log (...);"

            mock_dir.glob.return_value = [file1, file2]
            mock_dir.exists.return_value = True

            await migrate_module.run_migrations()

            # Should connect to DB
            mock_connect.assert_called_once()
            # Should read only 013_audit_log.sql because 001_init.sql was already applied
            file2.read_text.assert_called_once()
            mock_conn.close.assert_called_once()
