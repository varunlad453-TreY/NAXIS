"""
FastAPI Security & RBAC Dependencies (WP-4)

Provides dependency functions for routes to authenticate requests via Keycloak JWT or
X-API-Key, and enforce server-side role permissions (viewer, operator, admin).
"""

import logging
from typing import Callable, List, Optional
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

try:
    from backend.config.settings import get_settings
    from backend.shared.auth.keycloak import KeycloakJWTVerifier, UserPrincipal
except ImportError:
    from config.settings import get_settings
    from shared.auth.keycloak import KeycloakJWTVerifier, UserPrincipal

logger = logging.getLogger(__name__)

security_bearer = HTTPBearer(auto_error=False)
jwt_verifier = KeycloakJWTVerifier()


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> UserPrincipal:
    """
    FastAPI dependency that extracts and validates the authenticated user principal.

    Order of evaluation:
    1. Authorization: Bearer <JWT> header (Keycloak OIDC)
    2. X-API-Key header (Machine-to-Machine clients)
    3. Unauthenticated default (if keycloak_enabled=False and no api_key required)
    """
    settings = get_settings()

    # 1. Check Bearer Token (Keycloak OIDC)
    if credentials and credentials.credentials:
        principal = await jwt_verifier.verify_token(credentials.credentials)
        if principal:
            return principal

    # 2. Check X-API-Key (Machine-to-Machine)
    if x_api_key and settings.api_key and x_api_key == settings.api_key:
        return UserPrincipal(
            user_id="machine-client",
            username="api-key-client",
            email=None,
            roles=["admin"],  # Machine API key grants admin access
            is_machine=True,
        )

    # 3. Development / Permissive Mode
    if not settings.keycloak_enabled and not settings.api_key:
        return UserPrincipal(
            user_id="dev-user",
            username="local-dev",
            email="dev@naxis.local",
            roles=["admin"],
            is_machine=False,
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_role(allowed_roles: List[str]) -> Callable:
    """
    FastAPI dependency factory enforcing server-side RBAC role permissions.

    Usage:
        @router.post("/mitigate", dependencies=[Depends(require_role(["operator", "admin"]))])
    """
    async def role_checker(user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
        # Admins have implicit access to all endpoints
        if "admin" in user.roles:
            return user

        for role in allowed_roles:
            if user.has_role(role):
                return user

        logger.warning(
            "RBAC Authorization Failed: user '%s' (roles=%s) attempted action requiring roles %s",
            user.username,
            user.roles,
            allowed_roles,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Operation requires one of the following roles: {', '.join(allowed_roles)}",
        )

    return role_checker
