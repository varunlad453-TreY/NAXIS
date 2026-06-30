"""
Device Service

Business logic layer for network device inventory.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.config.settings import get_settings
from backend.db.base import init_db
from backend.db.models import Device as DeviceORM
from backend.db.models import Site as SiteORM
from backend.shared.models.event import UnifiedEvent

logger = logging.getLogger(__name__)


def _orm_to_device_dict(orm: DeviceORM) -> Dict[str, Any]:
    """Convert SQLAlchemy Device row to API-friendly dict."""
    return {
        "device_id": orm.device_id,
        "platform": orm.platform,
        "hostname": orm.hostname,
        "ip_address": orm.ip_address,
        "device_type": orm.device_type,
        "site_id": orm.site_id,
        "site_name": orm.site.name if orm.site else None,
        "reachability": orm.reachability,
        "management_state": orm.management_state,
        "last_seen": orm.last_seen,
    }


class DeviceService:
    """Service layer for device operations."""

    def __init__(self):
        self._settings = get_settings()
        self._use_postgres = self._settings.is_postgres_enabled
        self._memory: Dict[str, Dict[str, Any]] = {}
        logger.info(
            "DeviceService initialized (storage=%s)",
            "postgres" if self._use_postgres else "memory",
        )

    async def _ensure_tables(self) -> None:
        """Create tables if using PostgreSQL (idempotent)."""
        if self._use_postgres:
            await init_db()

    async def upsert_from_event(self, event: UnifiedEvent) -> None:
        """Extract device info from an event and store it."""
        if not event.device or not event.device.device_id:
            return

        device_id = event.device.device_id
        site_id = event.device.site_id
        site_name = event.device.site_name

        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import select

            await self._ensure_tables()
            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                # Upsert site
                if site_id:
                    site_result = await session.execute(
                        select(SiteORM).where(SiteORM.site_id == site_id)
                    )
                    site = site_result.scalar_one_or_none()
                    if not site:
                        site = SiteORM(site_id=site_id, name=site_name)
                        session.add(site)
                    elif site_name:
                        site.name = site_name

                # Upsert device
                result = await session.execute(
                    select(DeviceORM).where(DeviceORM.device_id == device_id)
                )
                device = result.scalar_one_or_none()
                if device:
                    device.platform = event.source.value
                    device.hostname = event.device.device_name or device.hostname
                    device.ip_address = event.device.device_ip or device.ip_address
                    device.device_type = event.device.device_type or device.device_type
                    device.site_id = site_id or device.site_id
                    device.last_seen = event.timestamp
                else:
                    device = DeviceORM(
                        device_id=device_id,
                        site_id=site_id,
                        platform=event.source.value,
                        hostname=event.device.device_name or "",
                        ip_address=event.device.device_ip or "",
                        device_type=event.device.device_type or "",
                        last_seen=event.timestamp,
                    )
                    session.add(device)
                await session.commit()
        else:
            self._memory[device_id] = {
                "device_id": device_id,
                "platform": event.source.value,
                "hostname": event.device.device_name or "",
                "ip_address": event.device.device_ip or "",
                "device_type": event.device.device_type or "",
                "site_id": site_id or "",
                "site_name": site_name or "",
                "reachability": "unknown",
                "management_state": "unknown",
                "last_seen": event.timestamp,
            }

    async def upsert_from_events(self, events: List[UnifiedEvent]) -> int:
        """Bulk upsert devices extracted from events."""
        count = 0
        for event in events:
            if event.device and event.device.device_id:
                await self.upsert_from_event(event)
                count += 1
        logger.info("Upserted %d devices from events", count)
        return count

    async def list_devices(
        self,
        platform: Optional[str] = None,
        site_id: Optional[str] = None,
        reachability: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List devices with optional filters."""
        if self._use_postgres:
            from backend.db.base import AsyncSession, get_engine
            from sqlalchemy import func, select

            async with AsyncSession(get_engine(), expire_on_commit=False) as session:
                query = select(DeviceORM).order_by(DeviceORM.last_seen.desc().nullslast())
                count_query = select(func.count(DeviceORM.device_id))

                if platform:
                    query = query.where(DeviceORM.platform == platform)
                    count_query = count_query.where(DeviceORM.platform == platform)
                if site_id:
                    query = query.where(DeviceORM.site_id == site_id)
                    count_query = count_query.where(DeviceORM.site_id == site_id)
                if reachability:
                    query = query.where(DeviceORM.reachability == reachability)
                    count_query = count_query.where(DeviceORM.reachability == reachability)

                total_result = await session.execute(count_query)
                total = total_result.scalar() or 0

                result = await session.execute(query.offset(offset).limit(limit))
                rows = [_orm_to_device_dict(orm) for orm in result.scalars().all()]
                return rows, total

        devices = list(self._memory.values())
        if platform:
            devices = [d for d in devices if d.get("platform") == platform]
        if site_id:
            devices = [d for d in devices if d.get("site_id") == site_id]
        if reachability:
            devices = [d for d in devices if d.get("reachability") == reachability]
        devices.sort(key=lambda d: d.get("last_seen") or "", reverse=True)
        total = len(devices)
        return devices[offset : offset + limit], total


# Global singleton instance
device_service = DeviceService()
