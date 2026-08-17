"""
SD-WAN Vendor-Neutral Adapter (WP-3.6)

Abstracts multi-vendor SD-WAN providers (VeloCloud, Silver Peak / Aruba EdgeConnect)
behind a unified ``BaseSDWANAdapter`` interface.

Enables seamless multi-vendor SD-WAN operation and future-proofs provider cutovers.
"""

import logging
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import httpx

try:
    from backend.config.settings import get_settings
    from backend.shared.database.identity import IdentityResolver
    from backend.shared.models.collector_outcome import CollectorOutcome
    from backend.shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
    from backend.worker.collectors.velocloud import VeloCloudCollector
    from backend.worker.collectors.velocloud_inventory import VelocloudInventoryCollector
    from backend.worker.collectors.velocloud_metrics import VelocloudMetricsCollector
except ImportError:  # pragma: no cover - supports both entry-point styles
    from config.settings import get_settings
    from shared.database.identity import IdentityResolver
    from shared.models.collector_outcome import CollectorOutcome
    from shared.models.event import (
        DeviceInfo,
        EventCategory,
        EventSeverity,
        EventSource,
        EventType,
        UnifiedEvent,
    )
    from worker.collectors.velocloud import VeloCloudCollector
    from worker.collectors.velocloud_inventory import VelocloudInventoryCollector
    from worker.collectors.velocloud_metrics import VelocloudMetricsCollector

logger = logging.getLogger(__name__)


class BaseSDWANAdapter(ABC):
    """Abstract base class for vendor-neutral SD-WAN adapters."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns provider identifier string (e.g. 'velocloud', 'silverpeak')."""
        pass

    @property
    @abstractmethod
    def is_configured(self) -> bool:
        """Returns True if the underlying SD-WAN provider is configured."""
        pass

    @abstractmethod
    async def collect_all(self) -> List[CollectorOutcome]:
        """Execute full collection cycle (edges, events, metrics)."""
        pass


class VeloCloudAdapter(BaseSDWANAdapter):
    """Concrete SD-WAN adapter for VMware/Arista VeloCloud Orchestrator."""

    def __init__(self):
        self._velocloud = VeloCloudCollector()
        self._inventory = VelocloudInventoryCollector()
        self._metrics = VelocloudMetricsCollector()

    @property
    def provider_name(self) -> str:
        return "velocloud"

    @property
    def is_configured(self) -> bool:
        return self._velocloud.is_configured

    async def collect_all(self) -> List[CollectorOutcome]:
        if not self.is_configured:
            outcome = CollectorOutcome(
                collector_id="velocloud-sdwan",
                source_system="velocloud",
            )
            outcome.mark_skipped("VeloCloud SD-WAN not configured")
            return [outcome]

        outcomes = []
        outcomes.extend(await self._velocloud.collect_all())
        outcomes.append(await self._inventory.collect())
        try:
            updated_count = await self._metrics.collect()
            m_outcome = CollectorOutcome(
                collector_id="velocloud-metrics",
                source_system="velocloud",
                status="success",
                rows_written=updated_count if isinstance(updated_count, int) else 0,
            )
            outcomes.append(m_outcome)
        except Exception as exc:
            m_outcome = CollectorOutcome(
                collector_id="velocloud-metrics",
                source_system="velocloud",
            )
            m_outcome.mark_error(str(exc))
            outcomes.append(m_outcome)
        return outcomes


class SilverPeakAdapter(BaseSDWANAdapter):
    """Concrete SD-WAN adapter for Silver Peak (Aruba EdgeConnect Orchestrator)."""

    def __init__(self):
        settings = get_settings()
        self._host = settings.silverpeak_host.rstrip("/")
        self._api_key = settings.silverpeak_api_key
        self._enabled = settings.silverpeak_enabled
        self._resolver = IdentityResolver()

    @property
    def provider_name(self) -> str:
        return "silverpeak"

    @property
    def is_configured(self) -> bool:
        return bool(self._enabled and self._host and self._api_key)

    async def collect_all(self) -> List[CollectorOutcome]:
        outcome = CollectorOutcome(
            collector_id="silverpeak-sdwan",
            source_system="silverpeak",
        )
        if not self.is_configured:
            outcome.mark_skipped("Silver Peak SD-WAN not configured")
            return [outcome]

        try:
            headers = {
                "X-Auth-Token": self._api_key,
                "Content-Type": "application/json",
            }
            async with httpx.AsyncClient(
                headers=headers,
                timeout=httpx.Timeout(30.0),
                verify=False,
            ) as client:
                appliances = await self._fetch_appliances(client)
                events = await self._fetch_events(client)

            outcome.metadata["appliances_found"] = len(appliances)
            outcome.metadata["events_found"] = len(events)
            outcome.mark_success(rows_written=len(appliances) + len(events))
            logger.info("SilverPeak SD-WAN: processed %d appliances, %d events", len(appliances), len(events))
        except Exception as exc:
            outcome.mark_error(str(exc))
            logger.exception("SilverPeak SD-WAN collection failed")

        return [outcome]

    async def _fetch_appliances(self, client: httpx.AsyncClient) -> List[Dict]:
        try:
            resp = await client.get(f"{self._host}/rest/appliances")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
            return []
        except Exception as exc:
            logger.warning("SilverPeak: failed to fetch appliances: %s", exc)
            return []

    async def _fetch_events(self, client: httpx.AsyncClient) -> List[Dict]:
        try:
            resp = await client.get(f"{self._host}/rest/event")
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else []
            return []
        except Exception as exc:
            logger.warning("SilverPeak: failed to fetch events: %s", exc)
            return []


def get_sdwan_adapter() -> BaseSDWANAdapter:
    """Factory returning the active SD-WAN adapter based on settings.sdwan_provider."""
    settings = get_settings()
    provider = str(settings.sdwan_provider).lower().strip()
    if provider == "silverpeak":
        return SilverPeakAdapter()
    return VeloCloudAdapter()
