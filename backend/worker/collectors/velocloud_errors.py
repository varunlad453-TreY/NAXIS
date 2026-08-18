"""
VeloCloud Orchestrator error-envelope detection.

The VCO portal REST API answers an invalid or expired API token with
**HTTP 200** and a JSON-RPC style error body:

    {"error": {"code": -32000, "message": "tokenError [Invalid API Token]"}}

`raise_for_status()` therefore passes, the caller sees an empty result set and
reports `success` with `rows_written=0`. The ledger looks clean while nothing
is being ingested. Every VCO response must be run through
`raise_on_vco_error()` so an auth failure surfaces as a collector error and
reaches the health-alerting path.
"""

from typing import Any


class VeloCloudApiError(RuntimeError):
    """A VCO response carried an error envelope instead of a result."""


def raise_on_vco_error(data: Any, context: str = "VCO request") -> Any:
    """Return ``data`` unchanged, or raise VeloCloudApiError if it is an
    error envelope. Accepts any JSON value so callers can wrap blindly."""
    if not isinstance(data, dict):
        return data

    error = data.get("error")
    if isinstance(error, dict):
        code = error.get("code")
        message = error.get("message") or error
        raise VeloCloudApiError(f"{context}: [{code}] {message}")
    if error:
        raise VeloCloudApiError(f"{context}: {error}")

    # Some endpoints inline the envelope rather than nesting it under "error".
    if "code" in data and "message" in data and "id" not in data:
        raise VeloCloudApiError(f"{context}: [{data['code']}] {data['message']}")

    return data
