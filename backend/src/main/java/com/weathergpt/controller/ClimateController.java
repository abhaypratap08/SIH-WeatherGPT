package com.weathergpt.controller;

import com.weathergpt.climate.ClimateAnalysisService;
import com.weathergpt.climate.dto.ClimateTrendResponse;
import com.weathergpt.dto.ApiResponse;
import com.weathergpt.weather.model.GeoLocation;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public endpoints for historical weather analytics and long-term climate trends.
 *
 * TEMPORARY DEBUG: logging User-Agent + timestamp for each call so we can
 * identify what's triggering repeated climate fetches on the backend.
 */
@RestController
@RequestMapping("/api/weather/climate")
@RequiredArgsConstructor
@Slf4j
public class ClimateController {

    private final ClimateAnalysisService climateAnalysisService;

    @GetMapping
    public ResponseEntity<ApiResponse<ClimateTrendResponse>> getClimateTrends(
            HttpServletRequest request,
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) Integer startYear,
            @RequestParam(required = false) Integer endYear) {

        // TEMPORARY DEBUG LOG — remove once the polling source is identified
        String userAgent = request.getHeader("User-Agent") != null
                ? request.getHeader("User-Agent").substring(0, Math.min(120, request.getHeader("User-Agent").length()))
                : "(none)";
        String remoteAddr = request.getRemoteAddr();
        log.info("CLIMATE GET | ts={} | addr={} | UA=[{}] | location={} | lat={} | lon={} | startYear={} | endYear={}",
                Instant.now(), remoteAddr, userAgent, location, latitude, longitude, startYear, endYear);

        ClimateTrendResponse response;
        if (latitude != null && longitude != null) {
            // Coordinate path: no geocoding; the display label is presentation-only.
            response = climateAnalysisService.analyzeClimateTrendsForLocation(
                    GeoLocation.fromCoordinates(name, latitude, longitude), startYear, endYear);
        } else {
            if (location == null || location.isBlank()) {
                throw new IllegalArgumentException("Location is required for climate trend analysis");
            }
            response = climateAnalysisService.analyzeClimateTrends(location, startYear, endYear);
        }
        return ResponseEntity.ok(ApiResponse.success("Climate trends retrieved", response));
    }
}
