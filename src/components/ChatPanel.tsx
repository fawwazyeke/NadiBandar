import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage, District } from '../types';
import { scoreDistrict, gapSummary } from '../data/scoring';
import { LAYERS } from '../data/layers';

interface Props {
  districts: District[];
  selectedLayer: string;
  initialMessage?: string;
  onInitialMessageSent?: () => void;
}

const SUGGESTIONS = [
  'Which districts lack hospitals?',
  'Worst districts overall?',
  'Tell me about Kota Bharu',
  'Where to build more schools?',
];

export default function ChatPanel({ districts, selectedLayer, initialMessage, onInitialMessageSent }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'assistant',
    text: 'Hi! I\'m Nadi Bandar AI.\n\nI analyse facility gaps across all 160 Malaysian districts using real government data — DOSM Census 2020, HIES 2024 socioeconomics, and OpenStreetMap facility counts.\n\nAsk me which areas are underserved, click any district on the map for its breakdown, or try one of the suggestions below.',
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialMessage) { send(initialMessage); onInitialMessageSent?.(); }
  }, [initialMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const payload = {
        messages: [
          ...messages
            .filter(m => m.role !== 'info')
            .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
          { role: 'user', content: text.trim() },
        ],
        layer: selectedLayer,
      };

      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error(`API error ${resp.status}`);
      const data = await resp.json();
      const reply = data.content ?? 'Sorry, I could not get a response.';

      setMessages(prev => [
        ...prev,
        ...(data.usedSearch ? [{ role: 'info' as const, text: '🔍 Web search used' }] : []),
        { role: 'assistant', text: reply },
      ]);
    } catch {
      // Local fallback when backend is unreachable
      setMessages(prev => [...prev, { role: 'assistant', text: localFallback(text.trim()) }]);
    } finally {
      setLoading(false);
    }
  }

  function localFallback(q: string): string {
    const lower = q.toLowerCase();
    const layerKey = /hospital|clinic|health/.test(lower) ? 'hospitals'
      : /school|educat/.test(lower) ? 'schools'
      : /police|crime/.test(lower) ? 'police'
      : /market|pasar/.test(lower) ? 'markets'
      : /transport|bus|train/.test(lower) ? 'transport'
      : null;

    const mentioned = districts.find(d => lower.includes(d.name.toLowerCase()));
    if (mentioned) {
      const s = scoreDistrict(mentioned);
      return `${mentioned.name}, ${mentioned.state}\nPop: ${mentioned.population.toLocaleString()} | Score: ${s.composite}/100\n${gapSummary(mentioned)}`;
    }

    const scoreKey = layerKey as keyof ReturnType<typeof scoreDistrict> | null;
    const worst = [...districts]
      .filter(d => d.population > 10000)
      .map(d => { const s = scoreDistrict(d); const sc = scoreKey ? (s[scoreKey] as any)?.score ?? s.composite : s.composite; return { d, sc }; })
      .sort((a, b) => a.sc - b.sc)
      .slice(0, 5);
    const label = LAYERS.find(l => l.id === layerKey)?.label ?? 'Overall';
    const list = worst.map((x, i) => `${i + 1}. ${x.d.name} (${x.d.state}) — ${x.sc}/100`).join('\n');
    return `Districts most lacking in ${label}:\n\n${list}\n\nSelect a district on the map for a detailed breakdown.`;
  }

  const showSuggestions = messages.length < 4;

  return (
    <aside style={{
      width: 300, background: '#fff',
      borderLeft: '1px solid #e2e8f0',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '13px 14px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>Nadi Bandar AI</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <div style={{ width: 5, height: 5, background: '#10b981', borderRadius: '50%' }} />
          <span style={{ fontSize: 10.5, color: '#64748b' }}>GPT-4o mini · RAG + Web search</span>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
            <div style={{
              maxWidth: '88%', padding: '8px 12px',
              fontSize: msg.role === 'info' ? 11 : 12.5,
              lineHeight: 1.6, wordBreak: 'break-word',
              borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
              background: msg.role === 'user' ? '#0d9488' : msg.role === 'info' ? '#f1f5f9' : '#f8fafc',
              border: msg.role === 'user' ? 'none' : '1px solid #e2e8f0',
              color: msg.role === 'user' ? '#fff' : msg.role === 'info' ? '#64748b' : '#0f172a',
              fontStyle: msg.role === 'info' ? 'italic' : 'normal',
            }}>
              {msg.role === 'assistant' ? (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p style={{ margin: '0 0 6px' }}>{children}</p>,
                    strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
                    ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ol>,
                    li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                    h1: ({ children }) => <div style={{ fontWeight: 700, fontSize: 13.5, margin: '6px 0 3px' }}>{children}</div>,
                    h2: ({ children }) => <div style={{ fontWeight: 700, fontSize: 13, margin: '6px 0 3px' }}>{children}</div>,
                    h3: ({ children }) => <div style={{ fontWeight: 700, fontSize: 12.5, margin: '4px 0 2px' }}>{children}</div>,
                  }}
                >
                  {msg.text}
                </ReactMarkdown>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex' }}>
            <div style={{ padding: '9px 13px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px 14px 14px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
              {[0, 0.2, 0.4].map((delay, i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#94a3b8', animation: `blink 1.2s ease ${delay}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {showSuggestions && (
        <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Try asking</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} style={{
                fontSize: 11, padding: '4px 10px',
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                color: '#047857', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask about any area's facilities..."
            rows={2}
            style={{
              flex: 1, resize: 'none', border: '1.5px solid #e2e8f0',
              borderRadius: 9, padding: '7px 11px', fontSize: 12.5,
              outline: 'none', color: '#0f172a', background: '#f8fafc',
              lineHeight: 1.5, fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 36, height: 36, background: loading ? '#94a3b8' : '#0d9488',
              border: 'none', borderRadius: 9, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 4, textAlign: 'center' }}>Enter to send · Shift+Enter for new line</div>
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.15} }`}</style>
    </aside>
  );
}
