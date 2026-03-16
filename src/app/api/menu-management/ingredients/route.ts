import { NextRequest, NextResponse } from 'next/server';
import {
  listMenuIngredients,
  createMenuIngredient,
} from '@/app/actions/menu-management';

function getStatusCode(result: { error?: string }, successStatus = 200): number {
  if (!result.error) return successStatus;
  const msg = result.error.toLowerCase();
  if (msg.includes('not authenticated') || msg.includes('unauthorized') || msg.includes('session')) return 401;
  if (msg.includes('permission') || msg.includes('forbidden') || msg.includes('access denied')) return 403;
  if (msg.includes('not found')) return 404;
  return 400;
}

export async function GET() {
  const result = await listMenuIngredients();
  return NextResponse.json(result, { status: getStatusCode(result) });
}

export async function POST(request: NextRequest) {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const result = await createMenuIngredient(payload);
  return NextResponse.json(result, { status: getStatusCode(result, 201) });
}
