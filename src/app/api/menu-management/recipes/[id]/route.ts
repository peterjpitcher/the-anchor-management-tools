import { NextRequest, NextResponse } from 'next/server';
import {
  deleteMenuRecipe,
  getMenuRecipeDetail,
  updateMenuRecipe,
} from '@/app/actions/menu-management';

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await getMenuRecipeDetail(id);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json();
  const result = await updateMenuRecipe(id, payload);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await deleteMenuRecipe(id);
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}
