package com.weathergpt.controller;

import com.weathergpt.dto.ApiResponse;
import com.weathergpt.dto.alert.AlertResponse;
import com.weathergpt.service.AlertService;
import com.weathergpt.weather.model.GeoLocation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Extreme weather alert endpoints.
 *
 * Alerts are public information (no authentication required). The response
 * always includes a providerStatus field so consumers know whether official
 * government alert integration is active or pending.
 *
 * IMPORTANT: The response always includes informationClass on each alert.
 * Consumers must surface this to users so official warnings and automated
 * advisories are never confused.
 */
@RestController
@RequestMapping("/api/alerts")
@RequiredArgsConstructor
public class AlertController {

    private final AlertService alertService;

    /**
     * Get active extreme weather alerts and advisories for a location.
     *
     * <pre>
     * GET /api/alerts?location=Delhi
     * GET /api/alerts?location=Mumbai
     * GET /api/alerts?latitude=28.65&longitude=77.23&name=16th%20Park%20View(GYC)
     * </pre>
     *
     * @param location    human-readable location string (geocoded when
     *                    coordinates are absent — backwards compatible)
     * @param latitude    authoritative coordinate when provided alongside longitude
     * @param longitude   authoritative coordinate when provided alongside latitude
     * @param name        display-only label used with coordinates (never geocoded)
     * @return normalized alert response with providerStatus and officialProviderActive flags
     */
    @GetMapping
    public ResponseEntity<ApiResponse<AlertResponse>> getAlerts(
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name) {
        if (latitude != null && longitude != null) {
            AlertResponse geoResponse = alertService.getAlertsForLocation(
                    GeoLocation.fromCoordinates(name, latitude, longitude));
            return ResponseEntity.ok(ApiResponse.success("Alerts retrieved", geoResponse));
        }
        validateLocation(location);
        AlertResponse alertResponse = alertService.getAlerts(location);
        return ResponseEntity.ok(ApiResponse.success("Alerts retrieved", alertResponse));
    }

    private void validateLocation(String location) {
        if (location == null || location.isBlank()) {
            throw new IllegalArgumentException("Location is required");
        }
    }
}
