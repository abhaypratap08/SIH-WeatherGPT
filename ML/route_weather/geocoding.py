import os
import logging
import time

import requests
from requests.exceptions import ConnectionError, Timeout, RequestException

from route_weather.exceptions import GeocodingServiceError, LocationNotFoundError

# Configure logging
logger = logging.getLogger(__name__)

# Configuration - can be overridden via environment variables
GEOCODING_URL = os.environ.get(
    "GEOCODING_URL",
    "https://geocoding-api.open-meteo.com/v1/search"
)

# Retry configuration
MAX_RETRIES = int(os.environ.get("GEOCODING_MAX_RETRIES", "3"))
RETRY_BACKOFF = float(os.environ.get("GEOCODING_RETRY_BACKOFF", "0.5"))
REQUEST_TIMEOUT = int(os.environ.get("GEOCODING_TIMEOUT", "10"))


def get_coordinates(place: str) -> tuple[float, float]:
    """
    Geocode a place name to latitude/longitude coordinates using Open-Meteo API.
    
    Args:
        place: The location name to geocode (e.g., "Delhi", "New York")
        
    Returns:
        Tuple of (latitude, longitude)
        
    Raises:
        LocationNotFoundError: If the location cannot be found in the geocoding database.
        GeocodingServiceError: If the geocoding service is unavailable due to network/DNS/timeout issues.
        ValueError: If the place name is invalid (empty or None).
    """
    
    # Validate input
    if not place or not isinstance(place, str) or not place.strip():
        raise ValueError("Location name must be a non-empty string")
    
    place = place.strip()
    logger.info(f"Geocoding location: {place}")
    
    params = {
        "name": place,
        "count": 1,
        "language": "en",
        "format": "json"
    }
    
    last_exception = None
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.debug(f"Geocoding attempt {attempt}/{MAX_RETRIES}")
            
            response = requests.get(
                GEOCODING_URL,
                params=params,
                timeout=REQUEST_TIMEOUT
            )
            
            # Raise for HTTP errors (4xx, 5xx)
            response.raise_for_status()
            
            data = response.json()
            
            # Check if results are present
            if "results" not in data or not data["results"]:
                raise LocationNotFoundError(
                    f"Location '{place}' could not be found. "
                    "Please check the spelling or try a different location name."
                )
            
            result = data["results"][0]
            latitude = result["latitude"]
            longitude = result["longitude"]
            
            logger.info(f"Successfully geocoded '{place}' to ({latitude}, {longitude})")
            return (latitude, longitude)
            
        except LocationNotFoundError:
            # Don't retry for location not found - this is a definitive client error
            raise
            
        except ConnectionError as e:
            last_exception = e
            logger.warning(
                f"Geocoding attempt {attempt}/{MAX_RETRIES} failed due to connection error. "
                f"Retrying..."
            )
            
        except Timeout as e:
            last_exception = e
            logger.warning(
                f"Geocoding attempt {attempt}/{MAX_RETRIES} failed due to timeout. "
                f"Retrying..."
            )
            
        except RequestException as e:
            last_exception = e
            # Check if this is a 4xx client error (not retryable)
            if hasattr(e, 'response') and e.response is not None:
                if 400 <= e.response.status_code < 500:
                    raise GeocodingServiceError(
                        f"Geocoding service returned client error: {e.response.status_code}"
                    ) from e
            logger.warning(
                f"Geocoding attempt {attempt}/{MAX_RETRIES} failed due to request error. "
                f"Retrying..."
            )
            
        except Exception as e:
            # Catch-all for unexpected errors, but don't retry indefinitely
            last_exception = e
            logger.error(
                f"Geocoding attempt {attempt}/{MAX_RETRIES} failed with unexpected error: {type(e).__name__}"
            )
            # Don't retry unexpected errors
            break
        
        # Exponential backoff
        if attempt < MAX_RETRIES:
            sleep_time = RETRY_BACKOFF * (2 ** (attempt - 1))
            logger.debug(f"Waiting {sleep_time:.1f}s before retry")
            time.sleep(sleep_time)
    
    # All retries exhausted
    if last_exception:
        raise GeocodingServiceError(
            f"The geocoding service is temporarily unavailable after {MAX_RETRIES} attempts. "
            "Please try again later."
        ) from last_exception
    else:
        raise GeocodingServiceError(
            f"The geocoding service is temporarily unavailable after {MAX_RETRIES} attempts. "
            "Please try again later."
        )
