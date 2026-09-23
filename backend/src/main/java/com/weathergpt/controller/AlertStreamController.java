package com.weathergpt.controller;

import com.weathergpt.dto.ApiResponse;
import com.weathergpt.dto.alert.AlertResponse;
import com.weathergpt.dto.alert.WeatherAlertDto;
import com.weathergpt.weather.alert.ImdEarlyWarningService;
import com.weathergpt.weather.model.GeoLocation;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Real-time alert streaming and IMD early warning endpoints.
 * Provides Server-Sent Events (SSE) for instant alert dissemination to mobile and web clients.
 */
@Slf4j
@RestController
@RequestMapping("/api/alerts")
@RequiredArgsConstructor
public class AlertStreamController {

    private final ImdEarlyWarningService earlyWarningService;
    private final List<SseEmitter> activeEmitters = new CopyOnWriteArrayList<>();

    @GetMapping("/early-warnings")
    public ResponseEntity<ApiResponse<AlertResponse>> getEarlyWarnings(
            @RequestParam(required = false) String location,
            @RequestParam(required = false) Double latitude,
            @RequestParam(required = false) Double longitude,
            @RequestParam(required = false) String name) {
        if (latitude != null && longitude != null) {
            // Coordinate path: no geocoding; the display label is presentation-only.
            AlertResponse geoResponse = earlyWarningService.getEarlyWarningsForLocation(
                    GeoLocation.fromCoordinates(name, latitude, longitude));
            return ResponseEntity.ok(ApiResponse.success("IMD early warnings retrieved", geoResponse));
        }
        if (location == null || location.isBlank()) {
            throw new IllegalArgumentException("Location is required for early warnings query");
        }
        AlertResponse response = earlyWarningService.getEarlyWarnings(location);
        return ResponseEntity.ok(ApiResponse.success("IMD early warnings retrieved", response));
    }

    /**
     * Server-Sent Events (SSE) endpoint for real-time alert dissemination.
     * Connected clients receive instant alerts when severe weather is detected.
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter subscribeToAlertStream() {
        SseEmitter emitter = new SseEmitter(180_000L); // 3 minutes timeout
        activeEmitters.add(emitter);

        emitter.onCompletion(() -> activeEmitters.remove(emitter));
        emitter.onTimeout(() -> activeEmitters.remove(emitter));
        emitter.onError(e -> activeEmitters.remove(emitter));

        try {
            // Initial connection acknowledgement event
            emitter.send(SseEmitter.event()
                    .name("CONNECTED")
                    .data("WeatherGPT Real-Time Early Warning Dissemination Stream Active"));
        } catch (IOException e) {
            activeEmitters.remove(emitter);
        }

        return emitter;
    }

    /**
     * Broadcasts an alert to all connected SSE clients.
     */
    public void broadcastAlert(WeatherAlertDto alert) {
        List<SseEmitter> deadEmitters = new CopyOnWriteArrayList<>();
        for (SseEmitter emitter : activeEmitters) {
            try {
                emitter.send(SseEmitter.event()
                        .name("WEATHER_ALERT")
                        .data(alert));
            } catch (Exception e) {
                deadEmitters.add(emitter);
            }
        }
        activeEmitters.removeAll(deadEmitters);
    }
}
