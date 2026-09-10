"""
Tests for the FastAPI /route-weather endpoint.

Tests cover:
1. Successful route weather analysis
2. Invalid location (400 Bad Request)
3. Geocoding service unavailable (503 Service Unavailable)
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import requests

from main import app
from route_weather.exceptions import GeocodingServiceError, LocationNotFoundError


client = TestClient(app)


class TestRouteWeatherEndpointSuccess:
    """Test successful route weather scenarios."""
    
    @patch('main.get_weather_for_route')
    @patch('main.analyze_route')
    @patch('main.get_route')
    @patch('main.get_coordinates')
    def test_successful_route_weather(self, mock_geocode, mock_route, mock_analyze, mock_weather):
        """Test successful route weather analysis."""
        # Mock geocoding
        mock_geocode.return_value = (28.6139, 77.2090)
        
        # Mock route API
        mock_route.return_value = {
            "distance_km": 230.5,
            "duration_minutes": 240.0,
            "coordinates": [(77.2090, 28.6139), (77.8000, 27.5000), (78.0103, 27.1767)]
        }
        
        # Mock weather API
        mock_weather.return_value = [
            {
                "latitude": 28.6139,
                "longitude": 77.2090,
                "distance_from_start": 0.0,
                "arrival_time": "2024-01-15T08:00:00",
                "weather_time": "2024-01-15T08:00:00",
                "temperature": 22.5,
                "humidity": 65.0,
                "rain_probability": 10.0,
                "precipitation": 0.0,
                "wind_speed": 5.0,
                "weather_code": 0
            }
        ]
        
        # Mock analyze_route
        mock_analyze.return_value = [
            {
                "latitude": 28.6139,
                "longitude": 77.2090,
                "distance_from_start": 0.0,
                "risk": "LOW",
                "temperature": 22.5
            }
        ]
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "WeatherGPT route analysis complete"
        assert "route_info" in data
        assert "risk_summary" in data
        assert "weather_data" in data


class TestRouteWeatherEndpointErrors:
    """Test error handling scenarios."""
    
    @patch('main.get_coordinates')
    def test_invalid_origin_location(self, mock_geocode):
        """Test 400 Bad Request for invalid origin."""
        mock_geocode.side_effect = LocationNotFoundError(
            "Location 'invalid_city_xyz' could not be found"
        )
        
        response = client.post("/route-weather", json={
            "origin": "invalid_city_xyz",
            "destination": "Delhi",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "could not be found" in data["detail"]
        assert "invalid_city_xyz" in data["detail"]
    
    @patch('main.get_coordinates')
    def test_invalid_destination_location(self, mock_geocode):
        """Test 400 Bad Request for invalid destination."""
        mock_geocode.side_effect = LocationNotFoundError(
            "Location 'another_invalid' could not be found"
        )
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "another_invalid",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "could not be found" in data["detail"]
    
    @patch('main.get_coordinates')
    def test_geocoding_service_unavailable_origin(self, mock_geocode):
        """Test 503 Service Unavailable when geocoding service fails for origin."""
        mock_geocode.side_effect = GeocodingServiceError(
            "The geocoding service is temporarily unavailable after 3 attempts"
        )
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 503
        data = response.json()
        assert "temporarily unavailable" in data["detail"]
    
    @patch('main.get_coordinates')
    def test_geocoding_service_unavailable_destination(self, mock_geocode):
        """Test 503 Service Unavailable when geocoding service fails for destination."""
        mock_geocode.side_effect = GeocodingServiceError(
            "The geocoding service is temporarily unavailable after 3 attempts"
        )
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 503
        data = response.json()
        assert "temporarily unavailable" in data["detail"]
    
    @patch('main.get_coordinates')
    def test_geocoding_service_unavailable_both_locations(self, mock_geocode):
        """Test 503 when both origin and destination geocoding fail."""
        mock_geocode.side_effect = GeocodingServiceError(
            "The geocoding service is temporarily unavailable"
        )
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 503


class TestRouteWeatherEndpointValidation:
    """Test request validation."""
    
    def test_missing_origin(self):
        """Test request with missing origin field."""
        response = client.post("/route-weather", json={
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 422  # Unprocessable Entity
    
    def test_missing_destination(self):
        """Test request with missing destination field."""
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 422
    
    def test_missing_departure_time(self):
        """Test request with missing departure_time field."""
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra"
        })
        
        assert response.status_code == 422
    
    def test_empty_body(self):
        """Test request with empty JSON body."""
        response = client.post("/route-weather", json={})
        
        assert response.status_code == 422


class TestRouteWeatherEndpointEdgeCases:
    """Test edge cases and error propagation."""
    
    @patch('main.get_coordinates')
    def test_origin_failures_before_destination_checked(self, mock_geocode):
        """Test that origin failure is caught before destination is geocoded."""
        call_count = 0
        
        def mock_geocode_func(place):
            nonlocal call_count
            call_count += 1
            if place == "Delhi":
                raise GeocodingServiceError("Service unavailable")
            return (27.1767, 78.0103)  # Agra coordinates
        
        mock_geocode.side_effect = mock_geocode_func
        
        response = client.post("/route-weather", json={
            "origin": "Delhi",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 503
        assert call_count == 1  # Only origin was geocoded, destination was not
    
    @patch('main.get_coordinates')
    def test_location_not_found_before_service_error(self, mock_geocode):
        """Test that LocationNotFoundError is raised before GeocodingServiceError."""
        mock_geocode.side_effect = LocationNotFoundError("Location not found")
        
        response = client.post("/route-weather", json={
            "origin": "invalid_place",
            "destination": "Agra",
            "departure_time": "08:00"
        })
        
        assert response.status_code == 400
        data = response.json()
        assert "Location not found" in data["detail"]
