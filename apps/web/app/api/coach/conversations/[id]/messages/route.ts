import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@fitfusion/db';
import { CoachMessageSchema } from '@fitfusion/core';
import { coachReply } from '@fitfusion/ai';
import type { CoachMessage } from '@fitfusion/ai';
import { requireUser } from '@/lib/auth';
import { buildCoachContext } from '@/lib/coach-context';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const conversation = await prisma.coachConversation.findFirst({
    where: { id: params.id, userId: s.user.id },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
  });
  if (!conversation) {
    return apiError('not_found', 'Conversation not found', 404);
  }

  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CoachMessageSchema.safeParse(body.data);
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid message', 400, zodMessage(parsed.error));
  }

  const userMessage = await prisma.coachMessage.create({
    data: { conversationId: conversation.id, role: 'user', content: parsed.data.content },
  });

  const history: CoachMessage[] = [
    ...conversation.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
    { role: 'user' as const, content: parsed.data.content },
  ];
  const contextSummary = await buildCoachContext(s.user.id, s.profile);
  const result = await coachReply(history, contextSummary);

  if (result.status === 'not_configured') {
    return apiOk({
      userMessage,
      assistantMessage: null,
      reply: null,
      aiConfigured: false,
    });
  }
  if (result.status === 'error' || !result.reply) {
    return apiError('ai_error', result.error ?? 'Coach reply failed', 502);
  }

  const assistantMessage = await prisma.coachMessage.create({
    data: { conversationId: conversation.id, role: 'assistant', content: result.reply },
  });
  await prisma.coachConversation.update({
    where: { id: conversation.id },
    data: {
      updatedAt: new Date(),
      title: conversation.title ?? parsed.data.content.slice(0, 80),
    },
  });

  return apiOk({
    userMessage,
    assistantMessage,
    reply: result.reply,
    aiConfigured: true,
  });
}
