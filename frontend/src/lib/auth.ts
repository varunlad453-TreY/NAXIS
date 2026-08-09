/**
 * Keycloak OIDC Client & Auth Session Management (WP-4)
 *
 * Manages Bearer tokens, token refresh, and user authentication state for the frontend.
 */

export interface AuthUser {
  userId: string;
  username: string;
  email?: string;
  roles: string[];
  token?: string;
}

const TOKEN_KEY = "naxis_auth_token";
const REFRESH_TOKEN_KEY = "naxis_refresh_token";

/**
 * Retrieve the active Bearer token from localStorage or session.
 */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Store active authentication tokens.
 */
export function setAuthTokens(token: string, refreshToken?: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

/**
 * Clear authentication session on logout.
 */
export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Parse unverified JWT payload on frontend to display user profile and role badges.
 */
export function getCurrentUserFromToken(): AuthUser | null {
  const token = getAuthToken();
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));

    const roles: string[] = [];
    if (payload.realm_access?.roles) {
      roles.push(...payload.realm_access.roles);
    }

    return {
      userId: payload.sub ?? "unknown",
      username: payload.preferred_username ?? payload.email ?? "User",
      email: payload.email,
      roles: Array.from(new Set(roles)),
      token,
    };
  } catch {
    return null;
  }
}
