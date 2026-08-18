"""Helpers for keeping secrets out of logs."""

from urllib.parse import urlsplit, urlunsplit


def redact_url_password(url: str) -> str:
    """Strip the password from a connection URL before logging it."""
    try:
        parsed = urlsplit(url)
        if not parsed.password:
            return url
        host = parsed.hostname or ""
        if parsed.port:
            host = f"{host}:{parsed.port}"
        userinfo = f"{parsed.username or ''}:***@"
        return urlunsplit(
            (parsed.scheme, f"{userinfo}{host}", parsed.path, parsed.query, parsed.fragment)
        )
    except ValueError:
        return "<unparseable>"
