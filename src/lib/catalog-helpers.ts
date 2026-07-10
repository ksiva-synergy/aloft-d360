import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

// Supported catalog tables mapped to their Prisma delegate.
// Add new entries here when new catalog models are added to schema.prisma.
const CATALOG_DELEGATES = {
  agent_catalog: prisma.agent_catalog,
  bus_contract_catalog: prisma.bus_contract_catalog,
  bus_module_catalog: prisma.bus_module_catalog,
  prompt_catalog: prisma.prompt_catalog,
  schema_catalog: prisma.schema_catalog,
  tool_catalog: prisma.tool_catalog,
} as const;

type CatalogTable = keyof typeof CATALOG_DELEGATES;

function getDelegate(table: string) {
  const delegate = CATALOG_DELEGATES[table as CatalogTable];
  if (!delegate) {
    throw new Error(`Unknown catalog table: ${table}`);
  }
  return delegate as any;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ListOptions {
  table: string;
  searchParams: URLSearchParams;
  allowedFilters?: string[];
}

export async function handleCatalogList({ table, searchParams, allowedFilters = [] }: ListOptions) {
  try {
    const delegate = getDelegate(table);

    const where: Record<string, any> = {};

    const status = searchParams.get('status');
    if (status) where.status = status;

    const type = searchParams.get('type');
    if (type) where.type = type;

    const search = searchParams.get('search');
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const tag = searchParams.get('tag');
    if (tag) where.tags = { has: tag };

    for (const filter of allowedFilters) {
      const val = searchParams.get(filter);
      if (val) where[filter] = val;
    }

    const orderBy = searchParams.get('orderBy') || 'updated_at';
    const orderDir = searchParams.get('orderDir') === 'asc' ? 'asc' : 'desc';

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const [items, count] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: { [orderBy]: orderDir },
        skip: offset,
        take: limit,
      }),
      delegate.count({ where }),
    ]);

    return NextResponse.json({ items: items ?? [], count });
  } catch (err: any) {
    console.error(`[${table} GET]`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

interface CreateOptions {
  table: string;
  body: Record<string, any>;
  requiredFields: string[];
}

export async function handleCatalogCreate({ table, body, requiredFields }: CreateOptions) {
  const missing = requiredFields.filter((f) => !body[f]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 }
    );
  }

  if (!body.slug && body.name) {
    body.slug = slugify(body.name) + '-' + Date.now().toString(36);
  }

  try {
    const delegate = getDelegate(table);
    const item = await delegate.create({ data: body });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'An entry with this slug already exists' }, { status: 409 });
    }
    console.error(`[${table} POST]`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function handleCatalogGet(table: string, id: string) {
  try {
    const delegate = getDelegate(table);
    const item = await delegate.findUnique({ where: { id } });

    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function handleCatalogUpdate(table: string, id: string, body: Record<string, any>) {
  const immutableFields = ['id', 'created_at'];
  const updates: Record<string, any> = { updated_at: new Date() };

  for (const [key, val] of Object.entries(body)) {
    if (!immutableFields.includes(key) && val !== undefined) {
      updates[key] = val;
    }
  }

  try {
    const delegate = getDelegate(table);
    const item = await delegate.update({ where: { id }, data: updates });
    return NextResponse.json({ item });
  } catch (err: any) {
    console.error(`[${table} PATCH]`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function handleCatalogDelete(table: string, id: string, softDelete = true) {
  try {
    const delegate = getDelegate(table);

    if (softDelete) {
      const item = await delegate.update({
        where: { id },
        data: { status: 'deprecated', updated_at: new Date() },
      });
      return NextResponse.json({ item });
    }

    await delegate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
