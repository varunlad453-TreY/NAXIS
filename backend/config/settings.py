"""
Naxis Platform Settings

Centralized, environment-driven configuration using Pydantic Settings.
"""

from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Platform-wide settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Service identity
    service_name: str = Field(default="naxis", description="Service name")
    log_level: str = Field(default="INFO", description="Logging level")
    environment: str = Field(default="development", description="Runtime environment")

    # Storage mode: memory | postgres
    # "memory" keeps the original MVP behavior and lets tests run without Docker.
    # "postgres" persists everything to PostgreSQL.
    storage_mode: str = Field(
        default="memory",
        description="Primary storage backend: memory or postgres",
    )

    # API
    api_host: str = Field(default="0.0.0.0", description="API bind host")
    api_port: int = Field(default=8000, description="API bind port")
    api_cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:8000",
        description="Comma-separated allowed CORS origins",
    )
    api_key: str = Field(default="", description="API key required in X-API-Key header")

    # PostgreSQL
    postgres_host: str = Field(default="localhost", description="PostgreSQL host")
    postgres_port: int = Field(default=5432, description="PostgreSQL port")
    postgres_user: str = Field(default="naxis", description="PostgreSQL user")
    postgres_password: str = Field(default="naxis_dev", description="PostgreSQL password")
    postgres_database: str = Field(default="naxis", description="PostgreSQL database")

    # Redis (used only for real-time notifications)
    redis_url: str = Field(default="redis://localhost:6379/0", description="Redis URL")
    redis_enabled: bool = Field(default=False, description="Enable Redis pub/sub")
    redis_max_connections: int = Field(default=10, description="Redis connection pool size")

    # Juniper Mist
    mist_api_key: str = Field(default="", description="Mist API token")
    mist_org_id: str = Field(default="", description="Mist organization UUID")
    mist_base_url: str = Field(default="https://api.mist.com", description="Mist API base URL")
    mist_enabled: bool = Field(default=False, description="Enable Mist collector")

    # VeloCloud (Arista SD-WAN)
    velocloud_url: str = Field(default="", description="VeloCloud Orchestrator URL")
    velocloud_api_key: str = Field(default="", description="VeloCloud API key / JWT token")
    velocloud_enabled: bool = Field(default=False, description="Enable VeloCloud collector")

    # Collectors
    collector_interval: int = Field(default=60, description="Worker collection interval in seconds")

    # SNMP polling
    snmp_enabled: bool = Field(default=False, description="Enable SNMP poller")
    snmp_community: str = Field(default="public", description="SNMPv2c community")
    snmp_port: int = Field(default=161, description="SNMP UDP port")
    snmp_timeout: int = Field(default=5, description="SNMP request timeout (s)")
    snmp_retries: int = Field(default=1, description="SNMP request retries")
    snmp_targets: str = Field(default="", description="Comma-separated SNMP target hosts")

    # SNMP trap receiver
    snmp_trap_enabled: bool = Field(default=False, description="Enable SNMP trap receiver")
    snmp_trap_host: str = Field(default="0.0.0.0", description="SNMP trap bind host")
    snmp_trap_port: int = Field(default=162, description="SNMP trap UDP port")

    # Syslog receiver
    syslog_enabled: bool = Field(default=False, description="Enable syslog receiver")
    syslog_host: str = Field(default="0.0.0.0", description="Syslog bind host")
    syslog_udp_port: int = Field(default=514, description="Syslog UDP port")
    syslog_tcp_port: int = Field(default=1514, description="Syslog TCP port")

    @property
    def snmp_targets_list(self) -> List[str]:
        return [t.strip() for t in self.snmp_targets.split(",") if t.strip()]

    # Correlation
    correlation_time_window: int = Field(default=300, description="Correlation time window in seconds")
    correlation_min_events: int = Field(default=2, description="Minimum events to form an incident")

    @property
    def postgres_url(self) -> str:
        """Async PostgreSQL URL for SQLAlchemy/asyncpg."""
        password = self.postgres_password or ""
        return (
            f"postgresql+asyncpg://{self.postgres_user}:"
            f"{password}@{self.postgres_host}:"
            f"{self.postgres_port}/{self.postgres_database}"
        )

    @property
    def api_cors_origins_list(self) -> List[str]:
        """Return CORS origins as a list."""
        return [part.strip() for part in self.api_cors_origins.split(",") if part.strip()]

    @property
    def is_postgres_enabled(self) -> bool:
        """True when PostgreSQL persistence is requested."""
        return self.storage_mode.lower() == "postgres"


# Lazy singleton
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Return the cached settings instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Clear the cached settings instance (useful in tests)."""
    global _settings
    _settings = None


settings = get_settings()
