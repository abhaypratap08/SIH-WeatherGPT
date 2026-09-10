import { ChevronLeft, Mic, MoreVertical, Send, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useVoiceOutput } from '../hooks/useVoiceOutput';
import './ChatDrawer.css';

interface ChatMessage {
  id: string;
  role: 'bot' | 'user';
  content: string;
  timestamp: Date;
  voiceText?: string;
  structuredData?: any;
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLang?: string;
  onLanguageChange?: (lang: string) => void;
}

export default function ChatDrawer({
  isOpen,
  onClose,
  selectedLang = 'en',

}: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'bot',
      content:
        "Hello! I'm WeatherGPT, your AI weather assistant. Ask me about the weather in any location.",
      timestamp: new Date(),
    },
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeakingId, setIsSpeakingId] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { speak, stop: stopSpeech } = useVoiceOutput();

  const LANGUAGE_LOCALES: Record<string, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    ta: 'ta-IN',
    te: 'te-IN',
    bn: 'bn-IN',
    mr: 'mr-IN',
    gu: 'gu-IN',
  };

  const { status: voiceStatus, startListening, stopListening } = useVoiceInput({
    lang: LANGUAGE_LOCALES[selectedLang] || 'en-IN',
    onTranscript: (text) => {
      if (!text) return;
      setInput(text);
      handleSendMessage(text);
    },
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);

      try {
        const res = await fetch('/api/chat/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text.trim(),
            language: selectedLang,
            sector: 'general',
            sessionId: 'desktop-drawer-session',
          }),
        });

        if (!res.ok) throw new Error(`Status ${res.status}`);
        const d = await res.json();

        if (d.success && d.data) {
          const botResponse: ChatMessage = {
            id: `bot-${Date.now()}`,
            role: 'bot',
            content: d.data.answer || 'Query processed.',
            voiceText: d.data.voiceAnswer || d.data.answer,
            structuredData: d.data,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, botResponse]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `bot-${Date.now()}`, role: 'bot', content: d.message || 'Could not process query.', timestamp: new Date() },
          ]);
        }
      } catch (error) {
        console.error('Error sending message:', error);
        setMessages((prev) => [
          ...prev,
          { id: `bot-${Date.now()}`, role: 'bot', content: '⚠️ Unable to reach backend. Is the Java server running on :8080?', timestamp: new Date() },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [selectedLang]
  );

  const handleSpeakMessage = useCallback(
    (messageId: string, text: string) => {
      if (isSpeakingId === messageId) {
        stopSpeech();
        setIsSpeakingId(null);
      } else {
        setIsSpeakingId(messageId);
        speak(text);
      }
    },
    [isSpeakingId, speak, stopSpeech, selectedLang]
  );

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen) return null;

  return (
    <div className={`chat-drawer-container ${isClosing ? 'is-closing' : ''}`}>
      {/* Header */}
      <div className="chat-drawer-header">
        <div className="cdr-header-left">
          <button
            className="cdr-back-btn"
            onClick={handleClose}
            aria-label="Close chat drawer"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="cdr-header-title-group">
            <h2 className="cdr-header-title">WeatherGPT</h2>
            <p className="cdr-header-status">
              <span className="cdr-status-indicator" />
              Online
            </p>
          </div>
        </div>

        <div className="cdr-header-right">
          <button
            className="cdr-menu-btn"
            onClick={() => console.log('Menu clicked')}
            aria-label="More options"
          >
            <MoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Message Stream */}
      <div className="chat-drawer-stream" ref={streamRef}>
        {messages.map((msg) => (
          <div key={msg.id} className={`cdr-msg-wrap ${msg.role}`}>
            {msg.role === 'bot' && (
              <div className="cdr-msg-bubble bot">
                <p className="cdr-msg-text">{msg.content}</p>

                {msg.structuredData && (
                  <div className="cdr-msg-data-section">
                    <div className="cdr-data-card">
                      <div className="cdr-card-header">
                        <h3 className="cdr-card-title">
                          {msg.structuredData.location}
                        </h3>
                        <p className="cdr-card-meta">
                          {msg.structuredData.date}
                        </p>
                      </div>

                      <div className="cdr-data-row">
                        <span className="cdr-data-label">
                          {msg.structuredData.condition}
                        </span>
                      </div>

                      <div className="cdr-data-row">
                        <span className="cdr-data-label">Humidity</span>
                        <span className="cdr-data-value">
                          {msg.structuredData.metrics.humidity}
                        </span>
                      </div>
                      <div className="cdr-data-row">
                        <span className="cdr-data-label">Wind</span>
                        <span className="cdr-data-value">
                          {msg.structuredData.metrics.wind}
                        </span>
                      </div>
                      <div className="cdr-data-row">
                        <span className="cdr-data-label">Precipitation</span>
                        <span className="cdr-data-value">
                          {msg.structuredData.metrics.precipitation}
                        </span>
                      </div>

                      {msg.structuredData.description && (
                        <p className="cdr-data-desc">
                          {msg.structuredData.description}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="cdr-msg-footer">
                  <span className="cdr-msg-timestamp">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    className={`cdr-speak-btn ${
                      isSpeakingId === msg.id ? 'is-speaking' : ''
                    }`}
                    onClick={() =>
                      handleSpeakMessage(
                        msg.id,
                        msg.voiceText || msg.content
                      )
                    }
                    disabled={isLoading}
                    aria-label={`${
                      isSpeakingId === msg.id ? 'Stop' : 'Listen to'
                    } message`}
                  >
                    {isSpeakingId === msg.id ? (
                      <>
                        <VolumeX size={12} />
                        Stop
                      </>
                    ) : (
                      <>
                        <span>🔊</span>
                        Listen
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {msg.role === 'user' && (
              <div className="cdr-msg-bubble user">
                <p className="cdr-msg-text">{msg.content}</p>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="cdr-msg-wrap bot">
            <div className="cdr-typing-bubble">
              <div className="cdr-typing-dot" />
              <div className="cdr-typing-dot" />
              <div className="cdr-typing-dot" />
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <div className="chat-drawer-input-bar">
        <div className="chat-drawer-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="chat-drawer-input"
            placeholder="Ask about the weather..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage(input);
              }
            }}
            disabled={isLoading}
            aria-label="Chat input"
          />

          <button
            className="cdr-input-btn"
            onClick={() => {
              if (voiceStatus === 'listening') {
                stopListening();
              } else {
                startListening();
              }
            }}
            title={voiceStatus === 'listening' ? 'Stop listening' : 'Start listening'}
            aria-label={voiceStatus === 'listening' ? 'Stop listening' : 'Start listening'}
          >
            <Mic size={18} />
          </button>
        </div>

        <button
          className="cdr-send-btn"
          onClick={() => handleSendMessage(input)}
          disabled={!input.trim() || isLoading}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
