package com.weathergpt.weather.model;

import lombok.*;

import java.util.Locale;

/**
 * Internal normalized location used across the weather pipeline.
 * Geocoding providers produce it; weather providers consume it.
 * Not exposed directly to API clients (see {@code dto.weather.LocationInfo}).
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GeoLocation {

    private String name;
    private Double latitude;
    private Double longitude;
    private String admin1;
    private String country;
    private String timezone;

    /**
     * Reject coordinates outside the valid WGS84 ranges. Used by every
     * coordinate-aware controller parameter so bad input never reaches a
     * provider (mapped to HTTP 400 via the IllegalArgumentException handler).
     */
    public static void validate(double latitude, double longitude) {
        if (Double.isNaN(latitude) || latitude < -90.0 || latitude > 90.0
                || Double.isNaN(longitude) || longitude < -180.0 || longitude > 180.0) {
            throw new IllegalArgumentException(
                    "Invalid coordinates: latitude must be in [-90, 90] and longitude in [-180, 180]");
        }
    }

    /**
     * Build a location straight from caller-supplied coordinates, bypassing
     * geocoding entirely. {@code displayName} is a presentation label only
     * (e.g. a reverse-geocoded POI like "16th Park View(GYC)"); it is never
     * resolvable and must not be sent to a geocoder.
     */
    public static GeoLocation fromCoordinates(String displayName, double latitude, double longitude) {
        validate(latitude, longitude);
        String name = (displayName != null && !displayName.isBlank())
                ? displayName.trim()
                : String.format(Locale.ROOT, "%.4f, %.4f", latitude, longitude);
        return GeoLocation.builder()
                .name(name)
                .latitude(latitude)
                .longitude(longitude)
                .build();
    }
}
