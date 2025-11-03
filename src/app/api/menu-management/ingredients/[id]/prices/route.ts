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
  const payload = await request.json();
  const result = await recordMenuIngredientPrice({ ...payload, ingredient_id: id });
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
