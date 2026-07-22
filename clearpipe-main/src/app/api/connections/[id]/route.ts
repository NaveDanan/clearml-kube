import { NextRequest, NextResponse } from 'next/server';
import { connectionsRepository } from '@/lib/db/supabase-repositories';
import type { ConnectionRow } from '@/lib/db/supabase-repositories';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Helper to parse connection row
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

// GET /api/connections/[id] - Get a connection by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const connection = await connectionsRepository.getById(id);
    
    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(parseConnection(connection));
  } catch (error) {
    console.error('Error fetching connection:', error);
    return NextResponse.json(
      { error: 'Failed to fetch connection' },
      { status: 500 }
    );
  }
}

// PUT /api/connections/[id] - Update a connection
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, provider, isConfigured, ...config } = body;
    
    const updates: Parameters<typeof connectionsRepository.update>[1] = {};
    
    if (name !== undefined) updates.name = name;
    if (provider !== undefined) updates.provider = provider;
    if (isConfigured !== undefined) updates.isConfigured = isConfigured;
    if (Object.keys(config).length > 0) updates.config = config;
    
    const connection = await connectionsRepository.update(id, updates);
    
    if (!connection) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(parseConnection(connection));
  } catch (error) {
    console.error('Error updating connection:', error);
    return NextResponse.json(
      { error: 'Failed to update connection' },
      { status: 500 }
    );
  }
}

// DELETE /api/connections/[id] - Delete a connection
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = await connectionsRepository.delete(id);
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Connection not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting connection:', error);
    return NextResponse.json(
      { error: 'Failed to delete connection' },
      { status: 500 }
    );
  }
}
