import { NextRequest, NextResponse } from 'next/server';
import { createMenuRecipe, listMenuRecipes } from '@/app/actions/menu-management';

export async function GET(request: NextRequest) {
  const summary = request.nextUrl.searchParams.get('summary');
  const includeExtras = summary !== '1' && summary !== 'true';
  const result = await listMenuRecipes({
    includeIngredients: includeExtras,
    includeAssignments: includeExtras,
  });
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const result = await createMenuRecipe(payload);
  const status = result.error ? 400 : 201;
  return NextResponse.json(result, { status });
}
