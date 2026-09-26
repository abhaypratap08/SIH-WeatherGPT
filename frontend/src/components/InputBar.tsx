import { Mic, Send } from 'lucide-react';
import { forwardRef } from 'react';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text?: string) => void;
  onMicClick: () => void;
  listening: boolean;
  micSupported: boolean;
  disabled?: boolean;
  placeholder?: string;
  helperText?: string;
}

/**
 * Voice-first input bar: mic and typing have equal visual weight. The mic
 * button pulses with two staggered expanding rings while listening.
 */
const InputBar = forwardRef<HTMLInputElement, InputBarProps>(function InputBar(
  {
    value,
    onChange,
    onSend,
    onMicClick,
    listening,
    micSupported,
    disabled = false,
    placeholder = 'Ask about weather, in English or हिंदी…',
    helperText = 'Warnings interrupt this conversation automatically. They are never paraphrased.',
  },
  ref,
) {
  return (
    <div className="inputbar inputbar-slot">
      <div className="inputbar-inner">
        <button
          type="button"
          className={`icon-btn mic-btn ${listening ? 'listening' : ''}`}
          onClick={onMicClick}
          disabled={!micSupported}
          title={listening ? 'Stop listening' : 'Ask by voice'}
          aria-label={listening ? 'Stop listening' : 'Ask by voice'}
        >
          <Mic />
        </button>
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={listening ? 'Listening…' : placeholder}
          aria-label="Message"
        />
        <button
          type="button"
          className="icon-btn send-btn"
          onClick={() => onSend()}
          disabled={!value.trim() || disabled}
          title="Send"
          aria-label="Send"
        >
          <Send />
        </button>
      </div>
      <p className="helper-row">{helperText}</p>
    </div>
  );
});

export default InputBar;