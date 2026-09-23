package com.weathergpt.config;

import com.weathergpt.security.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    /**
     * Local development origins that stay allowed in every environment.
     * Covers well-known Vite (5173) and React dev servers (3000-3004) plus
     * static file servers (5500). Browser {@code Origin} headers never carry a
     * trailing slash, so these are stored normalized.
     */
    private static final List<String> LOCAL_DEVELOPMENT_ORIGINS = List.of(
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:3002",
            "http://localhost:3003",
            "http://localhost:3004",
            "http://localhost:5173",
            "http://127.0.0.1:5500",
            "http://localhost:5500"
    );

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final JwtAuthenticationEntryPoint authenticationEntryPoint;
    private final JwtAccessDeniedHandler accessDeniedHandler;

    @Value("${spring.h2.console.enabled:false}")
    private boolean h2ConsoleEnabled;

    /**
     * Additional (typically production) origins allowed to call the backend
     * cross-origin. Comes from {@code CORS_ALLOWED_ORIGINS} — a comma separated
     * list, trailing slashes allowed (they are stripped during matching) — and
     * falls back to {@code cors.allowed-origins} in application.properties.
     * Local development origins are always merged in separately.
     */
    @Value("${cors.allowed-origins:}")
    private String configuredCorsOrigins;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .exceptionHandling(exception -> exception
                .authenticationEntryPoint(authenticationEntryPoint)
                .accessDeniedHandler(accessDeniedHandler)
            )
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .authorizeHttpRequests(auth -> auth
                // Public endpoints (no auth required)
                // Weather data is public information; /api/weather/** is read-only
                // and requires no JWT. Authentication stays mandatory for
                // account-specific functionality.
                .requestMatchers(
                    "/api/auth/register",
                    "/api/auth/login",
                    "/api/auth/refresh",
                    "/api/auth/forgot-password",
                    "/api/auth/reset-password",
                    "/api/auth/verify-email",
                    "/api/weather/**",
                    "/api/chat/**",
                    "/api/alerts/**",
                    "/api/ingest/**",
                    "/swagger-ui/**",
                    "/swagger-ui.html",
                    "/v3/api-docs/**",
                    "/actuator/health"
                ).permitAll()
                // Admin-only endpoints
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                // All other endpoints require authentication
                .requestMatchers("/h2-console/**").permitAll()
                .anyRequest().authenticated()
            )
            // Security headers: HSTS, Content-Security-Policy, Referrer-Policy, Permissions-Policy
            .headers(headers -> headers
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000) // 1 year
                    .preload(true)
                )
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'; frame-src 'self' h2: http: https:")
                )
                .referrerPolicy(referrer -> referrer
                    .policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)
                )
                .permissionsPolicy(permissions -> permissions
                    .policy("geolocation=(), camera=(), microphone=()")
                )
            );

        // Conditionally allow H2 console (for development only)
        if (h2ConsoleEnabled) {
            http.headers(headers -> headers
                .frameOptions(frame -> frame.disable()) // Required for H2 console
            );
        }

        http.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        // Exact-match origins are always required: Spring Security/Spring MVC
        // compares the browser Origin against these byte-for-byte, and the
        // backend uses allowCredentials(true), so "Access-Control-Allow-Origin: *"
        // must never be used. Local dev origins are always present; production
        // origins come from CORS_ALLOWED_ORIGINS or the configured defaults.
        Set<String> allowedOrigins = new LinkedHashSet<>();
        LOCAL_DEVELOPMENT_ORIGINS.forEach(origin -> allowedOrigins.add(normalizeOrigin(origin)));
        configuredProductionOrigins().forEach(origin -> allowedOrigins.add(normalizeOrigin(origin)));
        configuration.setAllowedOrigins(new ArrayList<>(allowedOrigins));

        // Patterns for private LAN ranges and dynamic localhost ports used in
        // development. Wildcards are permitted here alongside credentials
        // (Spring treats them as patterns, never as "allow everything").
        configuration.setAllowedOriginPatterns(List.of(
                "http://192.168.0.*",
                "http://192.168.1.*",
                "http://10.*.*.*",
                "http://172.16.*.*",
                "http://localhost:*"
        ));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        configuration.setAllowedHeaders(List.of(
                "Authorization",
                "Content-Type",
                "X-Requested-With",
                "Accept",
                "Origin",
                "Cache-Control"
        ));
        configuration.setExposedHeaders(List.of("Authorization"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        // "/**" covers every endpoint, including /api/weather/** (GET + OPTIONS
        // preflight). The CorsFilter registered by .cors() above runs before
        // authorization, so preflights and rejected origins never reach a controller.
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    /**
     * Origins configured for production access: either the operator-supplied
     * {@code CORS_ALLOWED_ORIGINS} environment variable or the defaults in
     * application.properties. Blank/unset falls back to an empty list so that
     * only local development origins remain.
     */
    private List<String> configuredProductionOrigins() {
        if (configuredCorsOrigins == null || configuredCorsOrigins.isBlank()) {
            return List.of();
        }
        return Arrays.stream(configuredCorsOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
    }

    /**
     * Browser {@code Origin} headers are scheme + host + port only — they never
     * include a trailing slash. A configured origin such as
     * "https://sih-weather-gpt.vercel.app/" would therefore silently fail exact
     * matching, so all configured origins are normalized here.
     */
    private static String normalizeOrigin(String origin) {
        String normalized = origin.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
