'use client'

import { useState, useRef, useEffect } from 'react'
import { Bot, Send, User, Loader2, Trash2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages.slice(-10) }),
      })
      const data = await res.json()
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.reply || data.error || '응답을 받지 못했습니다.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'AI 서비스에 연결할 수 없습니다. LLM 설정을 확인해주세요.',
        timestamp: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* 헤더 */}
      <div className="flex items-center justify-between pb-4 border-b border-[var(--c-border)]">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot size={28} className="text-cyan-400" />
            AI 채팅
          </h1>
          <p className="text-[var(--c-muted)] mt-1">인프라 관련 질문 · 트러블슈팅 · 구성 분석</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--c-border)] hover:bg-[var(--c-hover)] text-sm text-[var(--c-muted)]">
            <Trash2 size={14} /> 대화 초기화
          </button>
        )}
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--c-muted)]">
            <Bot size={48} className="mb-4 opacity-30" />
            <p className="text-lg">무엇이든 물어보세요</p>
            <p className="text-sm mt-1">서버 상태, 장애 분석, 구성 확인 등</p>
            <div className="flex gap-2 mt-6">
              {['서버 상태 요약', '최근 알림 분석', '디스크 용량 현황'].map(q => (
                <button key={q} onClick={() => setInput(q)}
                        className="px-3 py-1.5 rounded-full border border-[var(--c-border)] text-sm hover:bg-[var(--c-hover)] hover:border-cyan-400/50">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-cyan-400/10 flex items-center justify-center shrink-0">
                <Bot size={16} className="text-cyan-400" />
              </div>
            )}
            <div className={`max-w-[70%] px-4 py-3 rounded-lg text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-cyan-400/10 border border-cyan-400/20'
                : 'bg-[var(--c-card)] border border-[var(--c-border)]'
            }`}>
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-purple-400/10 flex items-center justify-center shrink-0">
                <User size={16} className="text-purple-400" />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-400/10 flex items-center justify-center shrink-0">
              <Bot size={16} className="text-cyan-400" />
            </div>
            <div className="px-4 py-3 rounded-lg bg-[var(--c-card)] border border-[var(--c-border)]">
              <Loader2 size={16} className="animate-spin text-cyan-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 */}
      <div className="pt-4 border-t border-[var(--c-border)]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="질문을 입력하세요..."
            className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--c-border)] bg-[var(--c-card)] text-sm focus:outline-none focus:border-cyan-400/50"
            disabled={loading}
          />
          <button onClick={send} disabled={loading || !input.trim()}
                  className="px-4 py-2.5 rounded-lg bg-cyan-500 text-black font-medium text-sm hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
            <Send size={16} /> 전송
          </button>
        </div>
      </div>
    </div>
  )
}
