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
  const payload = await request.json();
  const result = await createMenuIngredient(payload);
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
