import { NextRequest, NextResponse } from 'next/server';
import {
  getMenuDishDetail,
  updateMenuDish,
  deleteMenuDish,
} from '@/app/actions/menu-management';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await getMenuDishDetail(id);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json();
  const result = await updateMenuDish(id, payload);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await deleteMenuDish(id);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}
