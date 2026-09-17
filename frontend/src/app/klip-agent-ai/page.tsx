'use client'

import { useState } from 'react'
import Layout from '@/components/Layout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Upload, Sparkles } from 'lucide-react'
import api from '@/lib/api'
import AgentReportView from './AgentReportView'

type AgentReportTable = {
  title: string
  columns: Array<{ key: string; label: string; align?: 'left' | 'right' }>
  rows: Array<Record<string, string | number | null>>
  totals?: Record<string, string | number | null>
  chart?: { type: 'bar' | 'pie'; labelKey: string; valueKey: string; valueLabel: string }
}

type AgentResponse = {
  answer: string
  report: string
  insights: string
  comparison: string
  clarification?: string
  reportTable?: AgentReportTable | null
}

type ChatItem =
  | { role: 'user'; text: string; fileName?: string }
  | {
      role: 'assistant'
      data: AgentResponse
      memoryId?: string | null
      feedbackSent?: boolean
      source?: { mode?: string; label?: string; detail?: string | null } | null
    }

export default function KlipAgentAiPage() {
  const [question, setQuestion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatItem[]>([])

  const ask = async () => {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setError(null)

    const currentFile = file
    setChat((prev) => [...prev, { role: 'user', text: q, fileName: currentFile?.name }])

    try {
      const form = new FormData()
      form.append('question', q)
      const lastUserQuestion = [...chat].reverse().find((x) => x.role === 'user') as { role: 'user'; text: string } | undefined
      const lastAssistant = [...chat].reverse().find((x) => x.role === 'assistant') as
        | { role: 'assistant'; source?: { label?: string } | null }
        | undefined
      form.append(
        'context',
        JSON.stringify({
          lastUserQuestion: lastUserQuestion?.text || null,
          lastSourceLabel: lastAssistant?.source?.label || null,
        })
      )
      if (currentFile) form.append('file', currentFile)

      const res = await api.post('/agent-ai/ask', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      const data = res.data?.data as AgentResponse
      const memoryId = (res.data?.meta?.memoryId as string | null | undefined) ?? null
      const source = (res.data?.meta?.source as { mode?: string; label?: string; detail?: string | null } | undefined) ?? null
      setChat((prev) => [...prev, { role: 'assistant', data, memoryId, feedbackSent: false, source }])
      setQuestion('')
      setFile(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to get AI response'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-5xl h-[calc(100vh-140px)] flex flex-col">
        <div className="mb-3 flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">Beta</Badge>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {chat.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-gray-600">
                Ask directly about logistics/commercial data.  
                Press <span className="font-medium">Enter</span> to send, <span className="font-medium">Shift+Enter</span> for a new line.
              </CardContent>
            </Card>
          ) : (
            chat.map((item, idx) => (
              <Card
                key={idx}
                className={item.role === 'user' ? 'ml-12 bg-blue-50 border-blue-100' : 'mr-12'}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">
                      {item.role === 'user' ? 'You' : 'KLIP Agent AI'}
                    </CardTitle>
                    {item.role === 'assistant' && item.memoryId ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={item.feedbackSent}
                          onClick={async () => {
                            try {
                              await api.post('/agent-ai/feedback', { memoryId: item.memoryId, rating: 5 })
                              setChat((prev) =>
                                prev.map((x, i) => (i === idx && x.role === 'assistant' ? { ...x, feedbackSent: true } : x))
                              )
                            } catch {
                              // keep silent to avoid noisy UX
                            }
                          }}
                        >
                          Helpful
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={item.feedbackSent}
                          onClick={async () => {
                            try {
                              await api.post('/agent-ai/feedback', { memoryId: item.memoryId, rating: 1 })
                              setChat((prev) =>
                                prev.map((x, i) => (i === idx && x.role === 'assistant' ? { ...x, feedbackSent: true } : x))
                              )
                            } catch {
                              // keep silent to avoid noisy UX
                            }
                          }}
                        >
                          Not Helpful
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {item.role === 'user' ? (
                    <>
                      <div className="whitespace-pre-wrap">{item.text}</div>
                      {item.fileName ? <div className="text-xs text-gray-500">File: {item.fileName}</div> : null}
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="font-semibold text-gray-800 mb-1">Direct Answer</div>
                        <div className="whitespace-pre-wrap">{item.data.answer || '-'}</div>
                      </div>
                      {item.data.reportTable ? (
                        <div>
                          <div className="font-semibold text-gray-800 mb-1">Report</div>
                          <AgentReportView table={item.data.reportTable} />
                        </div>
                      ) : item.data.report ? (
                        <div>
                          <div className="font-semibold text-gray-800 mb-1">Report</div>
                          <div className="whitespace-pre-wrap">{item.data.report}</div>
                        </div>
                      ) : null}
                      {item.data.insights ? (
                        <div>
                          <div className="font-semibold text-gray-800 mb-1">Insights</div>
                          <div className="whitespace-pre-wrap">{item.data.insights}</div>
                        </div>
                      ) : null}
                      {item.data.comparison ? (
                        <div>
                          <div className="font-semibold text-gray-800 mb-1">Comparison</div>
                          <div className="whitespace-pre-wrap">{item.data.comparison}</div>
                        </div>
                      ) : null}
                      {item.data.clarification ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 whitespace-pre-wrap">
                          {item.data.clarification}
                        </div>
                      ) : null}
                      <div className="border-t pt-2">
                        <div className="font-semibold text-gray-800 mb-1">Data Source</div>
                        <div className="text-xs text-gray-600">
                          <div>
                            <span className="font-medium">Mode:</span> {item.source?.mode || 'unknown'}
                          </div>
                          <div>
                            <span className="font-medium">Path:</span> {item.source?.label || 'unknown'}
                          </div>
                          {item.source?.detail ? (
                            <div className="mt-1 whitespace-pre-wrap text-gray-500">
                              {item.source.detail}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card className="mt-3">
          <CardContent className="pt-4 space-y-3">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask()
                }
              }}
              placeholder="Ask anything about logistics/commercial data..."
              className="min-h-[88px] w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <div className="flex-1">
                <Input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  accept=".csv,.txt,.json,.xlsx,.xls,image/*"
                />
              </div>
              <Button onClick={ask} disabled={loading || !question.trim()} className="md:w-auto w-full rounded-xl px-5">
                <Sparkles className="h-4 w-4 mr-2" />
                {loading ? 'Thinking...' : 'Ask Agent AI'}
              </Button>
            </div>
            {file ? (
              <div className="text-xs text-gray-600 flex items-center gap-2">
                <Upload className="h-3.5 w-3.5" />
                Attached: {file.name}
              </div>
            ) : null}
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
          </CardContent>
        </Card>
      </div>
    </Layout>
  )
}

