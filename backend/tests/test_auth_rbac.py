"""
Unit Tests for Keycloak OIDC Authentication & Server-Side RBAC (WP-4)
"""

import pytest
import jwt
from fastapi import HTTPException
from unittest.mock import AsyncMock, patch

from shared.auth.keycloak import KeycloakJWTVerifier, UserPrincipal
from shared.auth.dependencies import require_role


class TestUserPrincipal:
    """Test UserPrincipal role verification and admin fallback logic."""

    def test_has_role_direct(self):
        user = UserPrincipal(
            user_id="usr-1",
            username="alice",
            roles=["operator", "viewer"],
        )
        assert user.has_role("operator") is True
        assert user.has_role("viewer") is True
        assert user.has_role("admin") is False

    def test_admin_has_all_roles(self):
        user = UserPrincipal(
            user_id="usr-2",
            username="admin_bob",
            roles=["admin"],
        )
        assert user.has_role("operator") is True
        assert user.has_role("viewer") is True
        assert user.has_role("any_role") is True

    def test_case_insensitive_roles(self):
        user = UserPrincipal(
            user_id="usr-3",
            username="charlie",
            roles=["OPERATOR"],
        )
        assert user.has_role("operator") is True


class TestKeycloakJWTVerifier:
    """Test JWT token verification and claims extraction."""

    @pytest.mark.asyncio
    async def test_extract_principal_claims(self):
        verifier = KeycloakJWTVerifier()
        payload = {
            "sub": "keycloak-uuid-123",
            "preferred_username": "john.doe",
            "email": "john.doe@enterprise.com",
            "realm_access": {"roles": ["operator", "offline_access"]},
            "resource_access": {
                "naxis-platform": {"roles": ["admin"]}
            },
        }

        principal = verifier._extract_principal(payload)
        assert principal.user_id == "keycloak-uuid-123"
        assert principal.username == "john.doe"
        assert principal.email == "john.doe@enterprise.com"
        assert "operator" in principal.roles
        assert "admin" in principal.roles

    @pytest.mark.asyncio
    async def test_verify_unverified_token_when_disabled(self):
        verifier = KeycloakJWTVerifier()
        verifier._enabled = False

        dummy_token = jwt.encode(
            {"sub": "test-sub", "preferred_username": "dev_user", "realm_access": {"roles": ["viewer"]}},
            "secret",
            algorithm="HS256",
        )

        principal = await verifier.verify_token(dummy_token)
        assert principal is not None
        assert principal.username == "dev_user"
        assert "viewer" in principal.roles


class TestRBACDependencies:
    """Test require_role FastAPI dependency checking."""

    @pytest.mark.asyncio
    async def test_require_role_allowed(self):
        checker = require_role(["operator"])
        user = UserPrincipal(
            user_id="u1",
            username="op_user",
            roles=["operator"],
        )
        result = await checker(user=user)
        assert result == user

    @pytest.mark.asyncio
    async def test_require_role_forbidden(self):
        checker = require_role(["admin"])
        user = UserPrincipal(
            user_id="u2",
            username="view_user",
            roles=["viewer"],
        )
        with pytest.raises(HTTPException) as exc_info:
            await checker(user=user)
        assert exc_info.value.status_code == 403
