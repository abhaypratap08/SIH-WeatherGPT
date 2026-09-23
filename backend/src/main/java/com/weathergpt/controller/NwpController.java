package com.weathergpt.controller;

import com.weathergpt.dto.ApiResponse;
import com.weathergpt.nwp.NwpModelService;
import com.weathergpt.nwp.dto.NwpComparisonResponse;
import com.weathergpt.weather.model.GeoLocation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public endpoints for Numerical Weather Prediction (NWP) multi-model comparison
 * (GFS, ECMWF, WRF, ICON).
 */
@RestController
@RequestMapping("/api/weather/nwp")
@RequiredArgsConstructor
public class NwpController {

    private final NwpModelService nwpModelService;

    @GetMapping
    public ResponseEntity<ApiResponse<NwpComparisonResponse>> getModelComparison(
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name) {
        if (latitude != null && longitude != null) {
            // Coordinate path: no geocoding; the display label is presentation-only.
            NwpComparisonResponse geoResponse = nwpModelService.compareModelsForLocation(
                    GeoLocation.fromCoordinates(name, latitude, longitude));
            return ResponseEntity.ok(ApiResponse.success("NWP multi-model comparison retrieved", geoResponse));
        }
        if (location == null || location.isBlank()) {
            throw new IllegalArgumentException("Location is required for NWP model comparison");
        }
        NwpComparisonResponse response = nwpModelService.compareModels(location);
        return ResponseEntity.ok(ApiResponse.success("NWP multi-model comparison retrieved", response));
    }
}
