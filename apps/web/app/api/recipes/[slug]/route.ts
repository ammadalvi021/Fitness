import { NextRequest } from 'next/server';
import { prisma } from '@fitfusion/db';
import { apiError, apiOk } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const recipe = await prisma.recipe.findUnique({
    where: { slug: params.slug },
    include: { cuisine: { select: { id: true, name: true, region: true } } },
  });
  if (!recipe) {
    return apiError('not_found', 'Recipe not found', 404);
  }
  return apiOk({ recipe });
}
