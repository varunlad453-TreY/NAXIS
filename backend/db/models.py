"""
SQLAlchemy ORM models for PostgreSQL.

These models map directly to the PostgreSQL schema used by the Naxis platform.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    JSON,
    ARRAY,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.base import Base


class Site(Base):
    """Physical or logical site/location."""

    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    devices: Mapped[List["Device"]] = relationship("Device", back_populates="site")


class Device(Base):
    """Network device discovered from events or collectors."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    site_id: Mapped[Optional[str]] = mapped_column(
        String(100), ForeignKey("sites.site_id"), nullable=True, index=True
    )
    platform: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True)
    hostname: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    device_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    reachability: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    management_state: Mapped[str] = mapped_column(String(50), nullable=False, default="unknown")
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    site: Mapped[Optional["Site"]] = relationship("Site", back_populates="devices")


class Event(Base):
    """Normalized network event from any vendor source."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=datetime.utcnow
    )
    source: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_event_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    device_id: Mapped[Optional[str]] = mapped_column(
        String(100), ForeignKey("devices.device_id"), nullable=True, index=True
    )
    site_id: Mapped[Optional[str]] = mapped_column(
        String(100), ForeignKey("sites.site_id"), nullable=True, index=True
    )
    client_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    client_mac: Mapped[Optional[str]] = mapped_column(String(17), nullable=True)
    client_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    interface_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tags: Mapped[List[str]] = mapped_column(ARRAY(String(50)), nullable=False, default=list)
    incident_id: Mapped[Optional[str]] = mapped_column(
        String(100), ForeignKey("incidents.incident_id"), nullable=True, index=True
    )
    correlation_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    event_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    raw_event: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


class Incident(Base):
    """Correlated incident produced by the correlation engine."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    affected_sites: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, default=list
    )
    affected_devices: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, default=list
    )
    affected_clients: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, default=list
    )
    related_event_ids: Mapped[List[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, default=list
    )
    probable_cause: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
