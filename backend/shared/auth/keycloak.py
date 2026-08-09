"""
Keycloak OIDC JWT Verifier (WP-4)

Handles dynamic JWKS key retrieval, JWT signature verification, and extraction of
user profile & role claims from Keycloak Bearer tokens.
"""

import logging
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

import httpx
import jwt

try:
    from backend.config.settings import get_settings
except ImportError:
    from config.settings import get_settings

logger = logging.getLogger(__name__)


class UserPrincipal(BaseModel):
    """Authenticated user context extracted from validated Keycloak JWT or API Key."""
    user_id: str = Field(..., description="Unique subject identifier (sub)")
    username: str = Field(..., description="Human-readable username / preferred_username")
    email: Optional[str] = Field(None, description="User email address")
    roles: List[str] = Field(default_factory=list, description="Assigned roles (viewer, operator, admin)")
    is_machine: bool = Field(default=False, description="True if authenticated via API Key")

    def has_role(self, required_role: str) -> bool:
        """Check if user possesses required role or admin privilege."""
        if "admin" in self.roles:
            return True
        return required_role.lower().strip() in [r.lower().strip() for r in self.roles]


class KeycloakJWTVerifier:
    """Retrieves JWKS certs from Keycloak and validates incoming JWT Bearer tokens."""

    def __init__(self):
        settings = get_settings()
        self._server_url = settings.keycloak_server_url.rstrip("/")
        self._realm = settings.keycloak_realm
        self._client_id = settings.keycloak_client_id
        self._enabled = settings.keycloak_enabled
        self._jwks_cache: Optional[Dict[str, Any]] = None
        self._jwks_cached_at: float = 0.0
        self._cache_ttl_seconds: float = 3600.0  # Cache JWKS keys for 1 hour

    @property
    def jwks_url(self) -> str:
        return f"{self._server_url}/realms/{self._realm}/protocol/openid-connect/certs"

    async def get_jwks(self) -> Dict[str, Any]:
        """Fetch and cache JWKS public keys from Keycloak."""
        now = time.monotonic()
        if self._jwks_cache and (now - self._jwks_cached_at) < self._cache_ttl_seconds:
            return self._jwks_cache

        logger.info("Fetching Keycloak JWKS public keys from %s", self.jwks_url)
        try:
            async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                resp = await client.get(self.jwks_url)
                if resp.status_code == 200:
                    self._jwks_cache = resp.json()
                    self._jwks_cached_at = now
                    return self._jwks_cache
                else:
                    logger.error("Failed to fetch JWKS from Keycloak (HTTP %d)", resp.status_code)
        except Exception as exc:
            logger.exception("Error connecting to Keycloak JWKS endpoint: %s", exc)

        return self._jwks_cache or {"keys": []}

    async def verify_token(self, token: str) -> Optional[UserPrincipal]:
        """
        Verifies a Bearer JWT token against Keycloak's public keys.

        Returns UserPrincipal if valid, or None if verification fails.
        """
        if not token:
            return None

        # Unverified decode to get key ID (kid) and algorithm
        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
        except jwt.PyJWTError as exc:
            logger.warning("Invalid JWT header format: %s", exc)
            return None

        jwks = await self.get_jwks()
        keys = jwks.get("keys", [])

        # Find matching public key
        target_key = None
        for key_dict in keys:
            if key_dict.get("kid") == kid:
                target_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_dict)
                break

        if not target_key and not self._enabled:
            # For development/testing when Keycloak is off or unverified token is provided
            try:
                payload = jwt.decode(token, options={"verify_signature": False})
                return self._extract_principal(payload)
            except Exception:
                return None

        if not target_key:
            logger.warning("JWKS key with kid '%s' not found in Keycloak certificates", kid)
            return None

        try:
            payload = jwt.decode(
                token,
                key=target_key,
                algorithms=["RS256"],
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_aud": False,  # Keycloak audience format varies by client setup
                },
            )
            return self._extract_principal(payload)
        except jwt.ExpiredSignatureError:
            logger.warning("Keycloak Bearer token expired")
        except jwt.PyJWTError as exc:
            logger.warning("Keycloak JWT verification failed: %s", exc)

        return None

    def _extract_principal(self, payload: Dict[str, Any]) -> UserPrincipal:
        """Extract user_id, username, email, and roles from decoded JWT payload."""
        user_id = payload.get("sub", "unknown")
        username = payload.get("preferred_username") or payload.get("username") or payload.get("email") or user_id
        email = payload.get("email")

        # Extract roles from realm_access and resource_access
        roles: List[str] = []
        realm_access = payload.get("realm_access", {})
        if isinstance(realm_access, dict):
            roles.extend(realm_access.get("roles", []))

        resource_access = payload.get("resource_access", {})
        if isinstance(resource_access, dict) and self._client_id in resource_access:
            client_access = resource_access[self._client_id]
            if isinstance(client_access, dict):
                roles.extend(client_access.get("roles", []))

        # Default fallback role for authenticated OIDC users
        if not roles:
            roles = ["viewer"]

        return UserPrincipal(
            user_id=user_id,
            username=username,
            email=email,
            roles=list(set(roles)),
            is_machine=False,
        )
