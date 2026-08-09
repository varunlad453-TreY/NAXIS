"""
Authentication and Authorization Module (WP-4)

Provides Keycloak OIDC JWT token verification, role-based access control (RBAC),
and FastAPI security dependencies.
"""

from shared.auth.keycloak import KeycloakJWTVerifier, UserPrincipal
from shared.auth.dependencies import get_current_user, require_role

__all__ = [
    "KeycloakJWTVerifier",
    "UserPrincipal",
    "get_current_user",
    "require_role",
]
