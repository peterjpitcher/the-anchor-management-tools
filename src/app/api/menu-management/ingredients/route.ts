import { NextRequest, NextResponse } from 'next/server';
import {
  listMenuIngredients,
  createMenuIngredient,
} from '@/app/actions/menu-management';

export async function GET() {
  const result = await listMenuIngredients();
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest) {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const result = await createMenuIngredient(payload);
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
