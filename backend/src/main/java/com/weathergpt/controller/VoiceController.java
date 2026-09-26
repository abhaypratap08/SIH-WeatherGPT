package com.weathergpt.controller;

import com.weathergpt.dto.ApiResponse;
import com.weathergpt.dto.chat.ChatQueryRequest;
import com.weathergpt.dto.chat.ChatResponse;
import com.weathergpt.service.WeatherQueryService;
import com.weathergpt.voice.TextToSpeechService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Optional;

/**
 * Voice-enabled interaction endpoints.
 *
 * Two complementary paths are exposed:
 * <ul>
 *   <li>{@link #queryVoice(ChatQueryRequest)} — accepts text <em>or</em> an audio
 *       recording. When audio is present and text is blank, server-side STT is
 *       attempted. This mirrors the existing {@code /api/chat/query} contract but
 *       now also accepts {@code multipart/form-data} with an {@code audio} file.</li>
 *   <li>{@link #speak(String, String)} — synthesizes spoken audio for a given text
 *       (usually the {@code voiceAnswer} from a chat response). When server-side TTS
 *       is unavailable, clients can fall back to browser {@code speechSynthesis}.</li>
 * </ul>
 *
 * Weather data is public information, so these endpoints remain publicly readable.
 */
@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class VoiceController {

    private final WeatherQueryService weatherQueryService;
    private final TextToSpeechService textToSpeechService;

    /**
     * Process a weather query that may be text or voice.
     *
     * Accepts either:
     * <ul>
     *   <li>JSON body with {@code message} (existing behavior), or</li>
     *   <li>{@code multipart/form-data} with an optional {@code audio} file and an
     *       optional {@code message} field. When {@code message} is blank but
     *       {@code audio} is present, server-side STT is attempted.</li>
     * </ul>
     */
    @PostMapping(consumes = {
            MediaType.APPLICATION_JSON_VALUE,
            MediaType.MULTIPART_FORM_DATA_VALUE
    })
    public ResponseEntity<ApiResponse<ChatResponse>> queryVoice(
            @RequestParam(required = false) String message,
            @RequestParam(required = false) MultipartFile audio,
            @Valid @RequestBody(required = false) ChatQueryRequest body) {

        ChatQueryRequest request = normalizeRequest(message, audio, body);
        ChatResponse response = weatherQueryService.processQuery(request);
        return ResponseEntity.ok(ApiResponse.success("Query processed", response));
    }

    /**
     * Synthesize spoken audio for the given text.
     *
     * @param text         text to speak (typically {@code voiceAnswer} from a chat
     *                    response, or any short weather advisory)
     * @param audioFormat requested audio format (e.g. {@code audio/wav} or
     *                    {@code audio/mpeg}); pass {@code null} for the
     *                    implementation's default
     * @return audio payload with the appropriate {@code Content-Type}, or a helpful
     *         error when server-side TTS is not configured
     */
    @GetMapping("/speak")
    public ResponseEntity<byte[]> speak(
            @RequestParam String text,
            @RequestParam(required = false) String audioFormat) {

        Optional<TextToSpeechService.TtsResult> result =
                textToSpeechService.synthesize(text, audioFormat);

        if (result.isEmpty()) {
            String json = "{\"success\":false,\"message\":\"Server-side TTS is not configured.\"";
            return ResponseEntity
                    .status(503)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(json.getBytes());
        }

        TextToSpeechService.TtsResult tts = result.get();
        String filenameExt = tts.mimeType().endsWith("wav") ? "wav"
                : tts.mimeType().endsWith("mp3") ? "mp3" : "audio";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"weathergpt-voice.%s\"".formatted(filenameExt))
                .contentType(MediaType.parseMediaType(tts.mimeType()))
                .body(tts.audio());
    }

    private ChatQueryRequest normalizeRequest(
            String message,
            MultipartFile audio,
            ChatQueryRequest body) {

        // Explicit multipart fields win over the JSON body, which wins over defaults.
        String effectiveMessage = message;
        if ((effectiveMessage == null || effectiveMessage.isBlank())
                && body != null && body.getMessage() != null) {
            effectiveMessage = body.getMessage();
        }

        byte[] effectiveAudio = null;
        String effectiveContentType = null;
        if (audio != null && !audio.isEmpty()) {
            try {
                effectiveAudio = audio.getBytes();
            } catch (java.io.IOException e) {
                // Nothing to transcribe — fall back to text or the audio-less path.
                effectiveAudio = null;
            }
            effectiveContentType = audio.getContentType();
        } else if (body != null && body.getAudio() != null) {
            effectiveAudio = body.getAudio();
            effectiveContentType = body.getAudioContentType();
        }

        return ChatQueryRequest.builder()
                .message(effectiveMessage)
                .audio(effectiveAudio)
                .audioContentType(effectiveContentType)
                // Keep conversational context flowing through both paths:
                // language, sector, session memory and the selected location.
                // (Previously these were silently dropped on the unified path.)
                .language(body != null ? body.getLanguage() : null)
                .sector(body != null ? body.getSector() : null)
                .sessionId(body != null ? body.getSessionId() : null)
                .location(body != null ? body.getLocation() : null)
                .build();
    }
}
