import { NextResponse } from 'next/server';
import { listMenusWithCategories } from '@/app/actions/menu-management';

export async function GET() {
  const result = await listMenusWithCategories();
  const status = result.error ? 400 : 200;
  return NextResponse.json(result, { status });
}
