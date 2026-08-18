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

    # API
    api_key: str = Field(default="", description="API key for authentication (empty = no auth)")
    api_host: str = Field(default="0.0.0.0", description="API bind host")
    api_port: int = Field(default=8000, description="API bind port")
    api_cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:8000",
        description="Comma-separated allowed CORS origins",
    )

    # PostgreSQL
    postgres_host: str = Field(default="localhost", description="PostgreSQL host")
    postgres_port: int = Field(default=5432, description="PostgreSQL port")
    postgres_user: str = Field(default="naxis", description="PostgreSQL user")
    postgres_password: str = Field(default="naxis_dev", description="PostgreSQL password")
    postgres_database: str = Field(default="naxis", description="PostgreSQL database")
    postgres_ssl: bool = Field(default=False, description="Enforce SSL (require) for PostgreSQL pool")

    # Keycloak OIDC Auth (WP-4)
    keycloak_server_url: str = Field(default="http://localhost:8080", description="Keycloak base server URL")
    keycloak_realm: str = Field(default="naxis", description="Keycloak realm name")
    keycloak_client_id: str = Field(default="naxis-platform", description="Keycloak OIDC client ID")
    keycloak_client_secret: str = Field(default="", description="Keycloak OIDC client secret")
    keycloak_enabled: bool = Field(default=False, description="Enable Keycloak OIDC authentication")

    # Redis (used only for real-time notifications)
    redis_url: str = Field(default="redis://localhost:6379/0", description="Redis URL")
    redis_enabled: bool = Field(default=False, description="Enable Redis pub/sub")
    redis_max_connections: int = Field(default=10, description="Redis connection pool size")

    # Juniper Mist
    mist_api_key: str = Field(default="", description="Mist API token")
    mist_org_id: str = Field(default="", description="Mist organization UUID")
    mist_base_url: str = Field(default="https://api.mist.com", description="Mist API base URL")
    mist_enabled: bool = Field(default=False, description="Enable Mist collector")

    # Cisco DNA Center
    dnac_host: str = Field(default="", description="DNAC base host")
    dnac_username: str = Field(default="", description="DNAC username")
    dnac_password: str = Field(default="", description="DNAC password")
    dnac_enabled: bool = Field(default=False, description="Enable DNAC integration")
    dnac_verify_ssl: bool = Field(default=True, description="Verify SSL for DNAC requests")

    # VeloCloud & SD-WAN Adapter (WP-3.6)
    velocloud_url: str = Field(default="", description="VeloCloud orchestrator URL")
    velocloud_api_key: str = Field(default="", description="VeloCloud API key")
    velocloud_enterprise_id: str = Field(default="", description="VeloCloud enterprise ID (skip auto-discover)")
    velocloud_enabled: bool = Field(default=False, description="Enable VeloCloud integration")
    velocloud_verify_ssl: bool = Field(default=True, description="Verify SSL for VeloCloud requests")
    sdwan_provider: str = Field(default="velocloud", description="Active SD-WAN provider ('velocloud' | 'silverpeak')")
    silverpeak_host: str = Field(default="", description="Silver Peak Orchestrator URL")
    silverpeak_api_key: str = Field(default="", description="Silver Peak API Key")
    silverpeak_enabled: bool = Field(default=False, description="Enable Silver Peak SD-WAN integration")

    # HPE Aruba Central (WP-3.5)
    aruba_central_base_url: str = Field(
        default="https://apigw-uswest.central.arubanetworks.com", description="Aruba Central API Base URL"
    )
    aruba_central_client_id: str = Field(default="", description="Aruba Central Client ID")
    aruba_central_client_secret: str = Field(default="", description="Aruba Central Client Secret")
    aruba_central_customer_id: str = Field(default="", description="Aruba Central Customer ID")
    aruba_central_enabled: bool = Field(default=False, description="Enable Aruba Central integration")

    # Aruba ClearPass (WP-3.5)
    clearpass_host: str = Field(default="", description="ClearPass Server FQDN or IP")
    clearpass_client_id: str = Field(default="", description="ClearPass Client ID")
    clearpass_client_secret: str = Field(default="", description="ClearPass Client Secret")
    clearpass_enabled: bool = Field(default=False, description="Enable Aruba ClearPass integration")

    # Cloudflare Zero Trust / Magic Transit (WP-3.5)
    cloudflare_api_token: str = Field(default="", description="Cloudflare API Token")
    cloudflare_account_id: str = Field(default="", description="Cloudflare Account ID")
    cloudflare_enabled: bool = Field(default=False, description="Enable Cloudflare Path Segment Telemetry")

    # Netskope SASE & NPA (WP-3.5)
    netskope_tenant_url: str = Field(default="", description="Netskope Tenant URL (e.g. tenant.goskope.com)")
    netskope_api_token: str = Field(default="", description="Netskope REST API v2 Token")
    netskope_enabled: bool = Field(default=False, description="Enable Netskope SASE Path Segment Telemetry")

    # Arista WLC
    arista_wlc_host: str = Field(default="", description="Arista WLC host")
    arista_wlc_username: str = Field(default="", description="Arista WLC username")
    arista_wlc_password: str = Field(default="", description="Arista WLC password")
    arista_wlc_enabled: bool = Field(default=False, description="Enable Arista WLC integration")
    arista_wlc_verify_ssl: bool = Field(default=True, description="Verify SSL for Arista WLC requests")

    # SNMP
    snmp_enabled: bool = Field(default=False, description="Enable SNMP polling of switch/AP topology")
    snmp_community: str = Field(default="public", description="SNMP v2c read-only community string")
    snmp_port: int = Field(default=161, description="SNMP agent UDP port")
    snmp_timeout: int = Field(default=10, description="SNMP poll timeout in seconds")
    snmp_retries: int = Field(default=2, description="SNMP poll retry count")
    snmp_targets: str = Field(default="", description="Comma-separated switch IPs to poll via SNMP")

    @property
    def snmp_targets_list(self) -> List[str]:
        """Parse comma-separated SNMP target IPs from env var."""
        return [ip.strip() for ip in self.snmp_targets.split(",") if ip.strip()]

    # SNMP trap receiver
    snmp_trap_enabled: bool = Field(default=False, description="Enable SNMP trap receiver")
    snmp_trap_host: str = Field(default="0.0.0.0", description="SNMP trap listener bind address")
    snmp_trap_port: int = Field(default=162, description="SNMP trap listener UDP port")

    # Syslog receiver
    syslog_enabled: bool = Field(default=False, description="Enable syslog receiver")
    syslog_host: str = Field(default="0.0.0.0", description="Syslog listener bind address")
    syslog_udp_port: int = Field(default=514, description="Syslog UDP listener port")
    syslog_tcp_port: int = Field(default=1514, description="Syslog TCP listener port (non-privileged)")

    # Collectors
    collector_interval: int = Field(default=60, description="Worker collection interval in seconds")

    # Retention (WP-2.4)
    event_retention_days: int = Field(
        default=2, description="Events older than this many days (48h) are pruned (WP-2.4)"
    )
    incident_retention_days: int = Field(
        default=180, description="Resolved incidents older than this many days are pruned"
    )
    raw_event_debug_days: int = Field(
        default=0, description="Keep raw_event blobs for this many days, then strip them (0 = immediate strip)"
    )

    # Correlation
    incident_stale_hours: int = Field(
        default=48,
        description="Auto-resolve open incidents with no new evidence for this many hours (0 = never)",
    )
    correlation_time_window: int = Field(default=300, description="Correlation time window in seconds")
    correlation_min_events: int = Field(default=2, description="Minimum events to form an incident")
    correlation_topology_cascade: bool = Field(
        default=True, description="Enable Stage 2 infrastructure-aware topology cascade"
    )

    # Notifications — collector health alerts
    notification_enabled: bool = Field(default=False, description="Enable push notification alerts")
    notification_slack_webhook: str = Field(default="", description="Slack webhook URL for collector alerts")
    notification_smtp_host: str = Field(default="", description="SMTP host for email alerts")
    notification_smtp_port: int = Field(default=587, description="SMTP port")
    notification_smtp_user: str = Field(default="", description="SMTP username")
    notification_smtp_password: str = Field(default="", description="SMTP password")
    notification_smtp_from: str = Field(default="naxis@localhost", description="SMTP from address")
    notification_email_to: str = Field(default="", description="Comma-separated recipient emails for alerts")
    notification_dedup_minutes: int = Field(default=15, description="Minutes before re-sending the same alert")
    notification_min_failures: int = Field(default=3, description="Minimum failures before alerting")
    notification_min_skips: int = Field(default=10, description="Minimum skips before alerting")

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
