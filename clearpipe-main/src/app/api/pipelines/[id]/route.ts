import { NextRequest, NextResponse } from 'next/server';
import { pipelinesRepository } from '@/lib/db/supabase-repositories';
import type { PipelineRow } from '@/lib/db/supabase-repositories';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Helper to parse pipeline row
function parsePipeline(row: PipelineRow | undefined | null) {
  if (!row) return null;
  
  // Nodes and edges are already JSON arrays from Supabase (JSONB)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    nodes: row.nodes || [],
    edges: row.edges || [],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/pipelines/[id] - Get a pipeline by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const shareToken = request.nextUrl.searchParams.get('token');
    
    // Get current user using the standard server client
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Check if user has access via ownership, shared access, or valid share token
    const hasAccess = await pipelinesRepository.hasAccess(id, user?.id, shareToken || undefined);
    
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }
    
    // Access granted, get the pipeline using public method
    const pipeline = await pipelinesRepository.getByIdPublic(id);
    
    if (!pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(parsePipeline(pipeline));
  } catch (error) {
    console.error('Error fetching pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline' },
      { status: 500 }
    );
  }
}

// PUT /api/pipelines/[id] - Update a pipeline
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const pipeline = await pipelinesRepository.update(id, body);
    
    if (!pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(parsePipeline(pipeline));
  } catch (error) {
    console.error('Error updating pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to update pipeline' },
      { status: 500 }
    );
  }
}

// DELETE /api/pipelines/[id] - Delete a pipeline
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    // Check user authentication first
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Attempt to delete the pipeline
    const deleted = await pipelinesRepository.delete(id);
    
    // Whether the delete succeeded or not, return success
    // This handles the case where the pipeline was already deleted or doesn't exist
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to delete pipeline' },
      { status: 500 }
    );
  }
}
