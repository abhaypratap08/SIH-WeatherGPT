class GeocodingServiceError(Exception):
    """Raised when the geocoding service is unavailable due to network/DNS/timeout issues."""
    pass


class LocationNotFoundError(Exception):
    """Raised when a location cannot be found in the geocoding database."""
    pass
