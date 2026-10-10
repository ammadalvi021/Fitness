import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@fitfusion/db';
import { requireUser } from '@/lib/auth';
import { apiError, apiOk, readJson, zodMessage } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const CreateConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
});

export async function GET(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const conversations = await prisma.coachConversation.findMany({
    where: { userId: s.user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
    },
  });
  return apiOk({ conversations });
}

export async function POST(req: NextRequest) {
  const s = await requireUser(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (!body.ok) return body.res;
  const parsed = CreateConversationSchema.safeParse(body.data ?? {});
  if (!parsed.success) {
    return apiError('validation_error', 'Invalid request', 400, zodMessage(parsed.error));
  }
  const conversation = await prisma.coachConversation.create({
    data: { userId: s.user.id, title: parsed.data.title ?? null },
  });
  return apiOk({ conversation }, 201);
}
