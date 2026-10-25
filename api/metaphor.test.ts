import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { answerSchema, handle } from './metaphor.ts'

const post = (body: unknown) => new Request('http://x/api/metaphor', { method: 'POST', body: JSON.stringify(body) })

/** A client whose only call returns `reply` (or throws it). */
function fakeClient(reply: { stop_reason: string; text: string } | Error) {
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply
    return { stop_reason: reply.stop_reason, content: [{ type: 'text', text: reply.text }] }
  })
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create }
}

describe('/api/metaphor', () => {
  it('without a key answers 503 and calls nobody: the page picks locally', async () => {
    const { client, create } = fakeClient({ stop_reason: 'end_turn', text: '{}' })
    expect((await handle(post({ text: 'Идея' }), undefined, client)).status).toBe(503)
    expect(create).not.toHaveBeenCalled()
  })

  it('asks for JSON limited to the library ids and passes the answer on', async () => {
    const answer = { objects: [{ id: 'coin', reason: 'финансы' }, { id: 'book', reason: 'грамотность' }] }
    const { client, create } = fakeClient({ stop_reason: 'end_turn', text: JSON.stringify(answer) })
    const res = await handle(post({ text: '  Финансовая грамотность ' }), 'key', client)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(answer)
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, any>
    expect(params.messages).toEqual([{ role: 'user', content: 'Финансовая грамотность' }])
    expect(params.output_config.format.schema.properties.objects.items.properties.id.enum).toHaveLength(10)
    expect(params.system).toContain('coin: Монета')
  })

  it('answers 502 on a model error, a refusal or bad JSON; 400 on bad input', async () => {
    for (const reply of [new Error('timeout'), { stop_reason: 'refusal', text: '' }, { stop_reason: 'end_turn', text: 'не json' }]) {
      const { client } = fakeClient(reply)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await handle(post({ text: 'Идея' }), 'key', client)).status).toBe(502)
    }
    const { client } = fakeClient({ stop_reason: 'end_turn', text: '{}' })
    expect((await handle(post({ text: '' }), 'key', client)).status).toBe(400)
    expect((await handle(post({ text: 'x'.repeat(201) }), 'key', client)).status).toBe(400)
    expect((await handle(new Request('http://x', { method: 'GET' }), 'key', client)).status).toBe(405)
  })

  it('schema: no other fields, every item needs an id and a reason', () => {
    const schema = answerSchema(['a', 'b'])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.objects.items).toMatchObject({ required: ['id', 'reason'], additionalProperties: false })
  })
})
