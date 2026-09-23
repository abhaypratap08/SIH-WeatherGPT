import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bell, CalendarDays, CloudRain, CloudSun, Mic, Send } from 'lucide-react';
import { ML_AGENT_ENDPOINT } from '../config/api';
import { useLocation } from '../location/LocationContext';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import { buildAgentLocationPayload } from './agentPayload';
import './AIChatWorkspace.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const PLACEHOLDER: Record<'en' | 'hi', string> = {
  en: 'Ask about weather, in English or हिंदी…',
  hi: 'मौसम के बारे में पूछें, टाइप करें या बोलें…',
};

// Location-aware suggestion cards: no city is hardcoded here — the /agent
// receives the canonical location coordinates alongside the prompt, so
// "my location" / "my area" resolve against the selected place (§19).
const SUGGESTIONS: { icon: typeof CloudSun; title: string; text: string }[] = [
  { icon: CloudSun, title: "Today's weather", text: "What's the current weather forecast for my location?" },
  { icon: CloudRain, title: 'Rain forecast', text: 'Will it rain in the next 24 hours?' },
  { icon: Bell, title: 'Weather warnings', text: 'What weather warnings affect my area?' },
  { icon: CalendarDays, title: '7-day outlook', text: 'What will the weather be like over the next 7 days?' },
];

/**
 * AIChatWorkspace — the primary (and only) AI chat in the main app.
 *
 * Migrated from frontend2/src/pages/ChatScreen.tsx, chat UX only:
 *   - empty state (greeting + suggestion cards)
 *   - assistant/user bubbles with Markdown (ReactMarkdown + remark-gfm)
 *   - auto-growing textarea (Enter sends, Shift+Enter newline, ~120px cap)
 *   - loading pulse while /agent processes
 *   - clear-chat and auto-scroll
 *   - voice input/output reusing the app's existing voice hooks
 *
 * It consumes the one canonical location via useLocation() — no GPS, no
 * second location store — and posts to ML_AGENT_ENDPOINT (/agent) with the
 * coordinates read at send time (see agentPayload.ts).
 */
export default function AIChatWorkspace({ lang = 'en' }: { lang?: 'en' | 'hi' }) {
  const { location } = useLocation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const { speak, stop: stopSpeech } = useVoiceOutput();

  const sendMessage = useCallback(async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? input).trim();
    if (!prompt || loading) return;

    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    if (!overridePrompt) setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setLoading(true);

    // Coordinates come from the canonical location at send time — read here,
    // never cached inside this component, so a location change between
    // messages flows into the next request automatically (§10).
    const body = { prompt, location: buildAgentLocationPayload(location) };

    try {
      const response = await fetch(ML_AGENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      const data = await response.json();
      const answer =
        typeof data?.message === 'string' && data.message.trim()
          ? data.message
          : 'No response from the weather agent.';
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
      if (voiceEnabled) speak(answer, undefined, locale);
    } catch {
      console.error('Agent error:', new Error('failed to reach /agent'));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Sorry, I couldn't connect to the WeatherGPT agent. Please check your connection and try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, location, voiceEnabled, speak, locale]);

  // Voice input (reused from the app's existing voice layer): transcripts
  // send straight through the same /agent path as typed messages.
  const { status: sttStatus, isSupported: sttSupported, startListening, stopListening } = useVoiceInput({
    lang: locale,
    onTranscript: (text) => {
      if (text) void sendMessage(text);
    },
    onError: (err) => console.error('Voice error:', err),
  });
  const listening = sttStatus === 'listening';

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      stopSpeech();
      setVoiceEnabled(false);
    } else {
      stopSpeech();
      startListening();
      setVoiceEnabled(true);
    }
  }, [listening, startListening, stopListening, stopSpeech]);

  // Auto-scroll to the newest message / loading state (frontend2 behavior).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const clearChat = () => setMessages([]);

  const canSend = input.trim().length > 0 && !loading;

  return (
    <div className="ai-chat">
      <main className="ai-chat-body" aria-label="AI chat">
        <div className="ai-chat-wrapper">
          {messages.length === 0 && (
            <div className="ai-chat-empty">
              <div className="ai-chat-empty-mark" aria-hidden="true">
                <CloudSun />
              </div>
              <h2 className="ai-chat-greeting">
                {location
                  ? `Ask anything about the weather in ${location.name}.`
                  : 'Ask anything about the weather anywhere. Choose a location from the header pill, the Weather map, or the Weather report.'}
              </h2>

              <div className="ai-chat-suggestion-grid">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.title}
                      type="button"
                      className="ai-chat-suggestion"
                      onClick={() => void sendMessage(s.text)}
                    >
                      <p>{s.text}</p>
                      <div className="ai-chat-suggestion-footer">
                        <span className="ai-chat-suggestion-title">{s.title}</span>
                        <span className="ai-chat-suggestion-icon" aria-hidden="true">
                          <Icon />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div className="ai-chat-messages">
              {messages.map((msg, index) => (
                <div key={index} className={`ai-chat-row ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                  {msg.role === 'assistant' && (
                    <div className="ai-chat-avatar" aria-hidden="true">
                      <CloudSun />
                    </div>
                  )}

                  <div className="ai-chat-bubble-wrap">
                    {msg.role === 'user' ? (
                      <div className="ai-chat-user-bubble">
                        <p>{msg.content}</p>
                      </div>
                    ) : (
                      <div className="ai-chat-assistant-bubble">
                        <div className="ai-chat-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="ai-chat-avatar ai-chat-user-avatar" aria-hidden="true">
                      U
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="ai-chat-row ai-chat-loading-row">
                  <div className="ai-chat-avatar" aria-hidden="true">
                    <CloudSun />
                  </div>
                  <div className="ai-chat-pulse-bar" role="status" aria-label="Assistant typing" />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      <div className="ai-chat-input-area">
        {messages.length > 0 && (
          <div className="ai-chat-input-toolbar">
            <button type="button" className="ai-chat-clear-btn" onClick={clearChat}>
              Clear chat
            </button>
          </div>
        )}

        <div className="ai-chat-input-pill">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={1}
            placeholder={PLACEHOLDER[lang]}
            aria-label="Message WeatherGPT"
            className="ai-chat-textarea"
          />
          <button
            type="button"
            className={`ai-chat-icon-btn ai-chat-mic-btn ${listening ? 'listening' : ''}`}
            onClick={toggleListening}
            disabled={!sttSupported}
            title={listening ? 'Stop listening' : 'Ask by voice'}
            aria-label={listening ? 'Stop listening' : 'Ask by voice'}
          >
            <Mic />
          </button>
          <button
            type="button"
            className="ai-chat-icon-btn ai-chat-send-btn"
            onClick={() => void sendMessage()}
            disabled={!canSend}
            aria-label="Send message"
          >
            <Send />
          </button>
        </div>

        <p className="ai-chat-disclaimer">
          WeatherGPT may display inaccurate information, including about weather conditions.
        </p>
      </div>
    </div>
  );
}