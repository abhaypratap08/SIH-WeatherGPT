"""
Comprehensive tests for the geocoding module.

Tests cover:
1. Successful geocoding
2. Location not found
3. DNS/connection failures with retry
4. Timeout failures with retry
5. HTTP errors
6. Input validation
"""

import pytest
from unittest.mock import patch, MagicMock
import requests

from route_weather.geocoding import get_coordinates
from route_weather.exceptions import GeocodingServiceError, LocationNotFoundError


class TestGetCoordinatesSuccess:
    """Test successful geocoding scenarios."""
    
    @patch('route_weather.geocoding.requests.get')
    def test_successful_geocoding_delhi(self, mock_get):
        """Test geocoding a valid location (Delhi)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {
                    "latitude": 28.6139,
                    "longitude": 77.2090,
                    "name": "Delhi",
                    "country": "India"
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = get_coordinates("Delhi")
        
        assert result == (28.6139, 77.2090)
        mock_get.assert_called_once()
        mock_response.raise_for_status.assert_called_once()
    
    @patch('route_weather.geocoding.requests.get')
    def test_successful_geocoding_jaipur(self, mock_get):
        """Test geocoding another valid location (Jaipur)."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {
                    "latitude": 26.9124,
                    "longitude": 75.7873,
                    "name": "Jaipur",
                    "country": "India"
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = get_coordinates("Jaipur")
        
        assert result == (26.9124, 75.7873)
    
    @patch('route_weather.geocoding.requests.get')
    def test_successful_geocoding_with_whitespace(self, mock_get):
        """Test geocoding with leading/trailing whitespace."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": [
                {
                    "latitude": 28.6139,
                    "longitude": 77.2090,
                    "name": "Delhi"
                }
            ]
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        result = get_coordinates("  Delhi  ")
        
        assert result == (28.6139, 77.2090)


class TestGetCoordinatesLocationNotFound:
    """Test location not found scenarios."""
    
    @patch('route_weather.geocoding.requests.get')
    def test_location_not_found_empty_results(self, mock_get):
        """Test when API returns empty results array."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "results": []
        }
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        with pytest.raises(LocationNotFoundError) as exc_info:
            get_coordinates("asdfghjkl")
        
        assert "asdfghjkl" in str(exc_info.value)
        assert "could not be found" in str(exc_info.value)
    
    @patch('route_weather.geocoding.requests.get')
    def test_location_not_found_missing_results_key(self, mock_get):
        """Test when API response is missing 'results' key."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        
        with pytest.raises(LocationNotFoundError):
            get_coordinates("nonexistent_city_xyz")


class TestGetCoordinatesConnectionErrors:
    """Test DNS/connection failure scenarios with retry."""
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    def test_connection_error_retry_then_success(self, mock_get, mock_sleep):
        """Test that connection errors are retried and eventually succeed."""
        # First call fails, second succeeds
        mock_response_success = MagicMock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {
            "results": [{"latitude": 28.6139, "longitude": 77.2090}]
        }
        mock_response_success.raise_for_status = MagicMock()
        
        mock_get.side_effect = [
            requests.exceptions.ConnectionError("DNS resolution failed"),
            mock_response_success
        ]
        
        result = get_coordinates("Delhi")
        
        assert result == (28.6139, 77.2090)
        assert mock_get.call_count == 2
        mock_sleep.assert_called_once()
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    def test_connection_error_all_retries_exhausted(self, mock_get, mock_sleep):
        """Test that GeocodingServiceError is raised after all retries fail."""
        mock_get.side_effect = requests.exceptions.ConnectionError("DNS resolution failed")
        
        with pytest.raises(GeocodingServiceError) as exc_info:
            get_coordinates("Delhi")
        
        assert "temporarily unavailable" in str(exc_info.value)
        assert mock_get.call_count == 3  # MAX_RETRIES = 3 by default
        assert mock_sleep.call_count == 2  # Sleep between attempts 1-2 and 2-3
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    def test_timeout_error_retry_then_success(self, mock_get, mock_sleep):
        """Test that timeout errors are retried and eventually succeed."""
        mock_response_success = MagicMock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {
            "results": [{"latitude": 28.6139, "longitude": 77.2090}]
        }
        mock_response_success.raise_for_status = MagicMock()
        
        mock_get.side_effect = [
            requests.exceptions.Timeout("Request timed out"),
            mock_response_success
        ]
        
        result = get_coordinates("Delhi")
        
        assert result == (28.6139, 77.2090)
        assert mock_get.call_count == 2
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    def test_timeout_error_all_retries_exhausted(self, mock_get, mock_sleep):
        """Test that GeocodingServiceError is raised after timeout retries fail."""
        mock_get.side_effect = requests.exceptions.Timeout("Request timed out")
        
        with pytest.raises(GeocodingServiceError):
            get_coordinates("Delhi")
        
        assert mock_get.call_count == 3


class TestGetCoordinatesHttpErrors:
    """Test HTTP error scenarios."""
    
    @patch('route_weather.geocoding.requests.get')
    def test_http_500_error(self, mock_get):
        """Test handling of HTTP 500 Internal Server Error."""
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = requests.exceptions.HTTPError(
            response=mock_response
        )
        mock_get.return_value = mock_response
        
        with pytest.raises(GeocodingServiceError):
            get_coordinates("Delhi")
    
    @patch('route_weather.geocoding.requests.get')
    def test_http_503_error(self, mock_get):
        """Test handling of HTTP 503 Service Unavailable."""
        mock_response = MagicMock()
        mock_response.status_code = 503
        mock_response.raise_for_status.side_effect = requests.exceptions.HTTPError(
            response=mock_response
        )
        mock_get.return_value = mock_response
        
        with pytest.raises(GeocodingServiceError):
            get_coordinates("Delhi")
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    def test_http_500_retry_then_success(self, mock_get, mock_sleep):
        """Test that HTTP 500 errors are retried and eventually succeed."""
        mock_response_success = MagicMock()
        mock_response_success.status_code = 200
        mock_response_success.json.return_value = {
            "results": [{"latitude": 28.6139, "longitude": 77.2090}]
        }
        mock_response_success.raise_for_status = MagicMock()
        
        mock_response_500 = MagicMock()
        mock_response_500.status_code = 500
        mock_response_500.raise_for_status.side_effect = requests.exceptions.HTTPError(
            response=mock_response_500
        )
        
        mock_get.side_effect = [mock_response_500, mock_response_success]
        
        result = get_coordinates("Delhi")
        
        assert result == (28.6139, 77.2090)
        assert mock_get.call_count == 2


class TestGetCoordinatesInputValidation:
    """Test input validation."""
    
    def test_empty_string_input(self):
        """Test that empty string raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            get_coordinates("")
        assert "non-empty string" in str(exc_info.value)
    
    def test_whitespace_only_input(self):
        """Test that whitespace-only string raises ValueError."""
        with pytest.raises(ValueError) as exc_info:
            get_coordinates("   ")
        assert "non-empty string" in str(exc_info.value)
    
    def test_none_input(self):
        """Test that None raises ValueError."""
        with pytest.raises(ValueError):
            get_coordinates(None)
    
    def test_numeric_input(self):
        """Test that numeric input raises ValueError."""
        with pytest.raises(ValueError):
            get_coordinates(12345)


class TestGetCoordinatesRetryConfiguration:
    """Test that retry configuration works correctly."""
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    @patch('route_weather.geocoding.MAX_RETRIES', 2)
    def test_custom_retry_count(self, mock_get, mock_sleep):
        """Test that custom MAX_RETRIES is respected."""
        mock_get.side_effect = requests.exceptions.ConnectionError("DNS failed")
        
        with pytest.raises(GeocodingServiceError):
            get_coordinates("Delhi")
        
        assert mock_get.call_count == 2  # Only 2 attempts, not 3
        assert mock_sleep.call_count == 1  # Sleep only once between 2 attempts
    
    @patch('route_weather.geocoding.time.sleep')
    @patch('route_weather.geocoding.requests.get')
    @patch('route_weather.geocoding.MAX_RETRIES', 1)
    def test_single_retry(self, mock_get, mock_sleep):
        """Test with MAX_RETRIES=1 (no retries, just one attempt)."""
        mock_get.side_effect = requests.exceptions.ConnectionError("DNS failed")
        
        with pytest.raises(GeocodingServiceError):
            get_coordinates("Delhi")
        
        assert mock_get.call_count == 1
        assert mock_sleep.call_count == 0
