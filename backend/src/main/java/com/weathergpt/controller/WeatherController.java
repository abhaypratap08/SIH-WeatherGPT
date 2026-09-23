package com.weathergpt.controller;

import com.weathergpt.dto.ApiResponse;
import com.weathergpt.dto.weather.CurrentWeatherResponse;
import com.weathergpt.dto.weather.ForecastResponse;
import com.weathergpt.service.WeatherService;
import com.weathergpt.weather.model.GeoLocation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public, read-only weather endpoints.
 * Weather data is public information, so no authentication is required
 * (see SecurityConfig). Authentication remains required for account features.
 *
 * <p>Every endpoint accepts either a human-readable {@code location} string
 * (geocoded as before — backwards compatible) or {@code latitude}/{@code
 * longitude} plus an optional display {@code name}. When coordinates are
 * provided they are authoritative and the backend skips geocoding, so a
 * reverse-geocoded display label that is not a geocodable place (e.g.
 * "16th Park View(GYC)", "Selected point") can still fetch weather.
 */
@RestController
@RequestMapping("/api/weather")
@RequiredArgsConstructor
public class WeatherController {

    public static final int DEFAULT_FORECAST_DAYS = 7;
    public static final int MAX_FORECAST_DAYS = 16;

    private final WeatherService weatherService;

    @GetMapping("/current")
    public ResponseEntity<ApiResponse<CurrentWeatherResponse>> getCurrentWeather(
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name) {
        CurrentWeatherResponse response;
        if (latitude != null && longitude != null) {
            response = weatherService.getCurrentWeather(
                    GeoLocation.fromCoordinates(name, latitude, longitude));
        } else {
            validateLocation(location);
            response = weatherService.getCurrentWeather(location);
        }
        return ResponseEntity.ok(ApiResponse.success("Current weather retrieved", response));
    }

    @GetMapping("/forecast")
    public ResponseEntity<ApiResponse<ForecastResponse>> getForecast(
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name,
            @RequestParam(defaultValue = "7") int days) {
        int forecastDays = Math.max(1, Math.min(days, MAX_FORECAST_DAYS));
        ForecastResponse response;
        if (latitude != null && longitude != null) {
            // Coordinate path: authoritative coords, no geocoding.
            response = weatherService.getForecast(
                    GeoLocation.fromCoordinates(name, latitude, longitude), forecastDays);
        } else {
            validateLocation(location);
            // String path: geocoding preserved for normal city-name requests.
            response = weatherService.getForecast(location, forecastDays);
        }
        return ResponseEntity.ok(ApiResponse.success("Weather forecast retrieved", response));
    }

    private void validateLocation(String location) {
        if (location == null || location.isBlank()) {
            throw new IllegalArgumentException("Location is required");
        }
    }
}
