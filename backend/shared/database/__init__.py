from .client import db
from .incidents import (
    insert_incident,
    upsert_incident,
    get_incident,
    list_incidents,
    count_incidents,
)
from .events import (
    insert_event,
    insert_events,
    get_event,
    list_events_for_incident,
    get_recent_events,
    link_events_to_incident,
)

__all__ = [
    "db",
    # incidents
    "insert_incident",
    "upsert_incident",
    "get_incident",
    "list_incidents",
    "count_incidents",
    # events
    "insert_event",
    "insert_events",
    "get_event",
    "list_events_for_incident",
    "get_recent_events",
    "link_events_to_incident",
]
