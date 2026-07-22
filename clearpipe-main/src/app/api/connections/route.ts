import { NextRequest, NextResponse } from 'next/server';
import { connectionsRepository } from '@/lib/db/supabase-repositories';
import type { ConnectionRow } from '@/lib/db/supabase-repositories';

// Helper to parse connection row and include resolved secret references
function parseConnection(row: ConnectionRow | undefined | null) {
  if (!row) return null;
  
  // Config is already a JSON object from Supabase (JSONB)
  const config = row.config || {};
  
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    isConfigured: row.is_configured,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...config,
  };
}

// GET /api/connections - Get all connections
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    
    let connections;
    if (provider) {
      connections = await connectionsRepository.getByProvider(provider);
    } else {
      connections = await connectionsRepository.getAll();
    }
    
    const parsed = connections.map(parseConnection);
    
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Error fetching connections:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connections' },
      { status: 500 }
    );
  }
}

// POST /api/connections - Create a new connection
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, provider, isConfigured, ...config } = body;
    
    if (!name || !provider) {
      return NextResponse.json(
        { error: 'Name and provider are required' },
        { status: 400 }
      );
    }
    
    const connection = await connectionsRepository.create({ 
      name, 
      provider, 
      config,
      isConfigured: isConfigured ?? false,
    });
    
    return NextResponse.json(parseConnection(connection), { status: 201 });
  } catch (error) {
    console.error('Error creating connection:', error);
    return NextResponse.json(
      { error: 'Failed to create connection' },
      { status: 500 }
    );
  }
}
