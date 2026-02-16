import { NextRequest, NextResponse } from 'next/server';
import {
  getMenuIngredientPrices,
  recordMenuIngredientPrice,
} from '@/app/actions/menu-management';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await getMenuIngredientPrices(id);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
  const result = await recordMenuIngredientPrice({ ...normalizedPayload, ingredient_id: id });
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
