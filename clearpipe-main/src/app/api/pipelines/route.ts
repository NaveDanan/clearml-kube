import { NextRequest, NextResponse } from 'next/server';
import { pipelinesRepository } from '@/lib/db/supabase-repositories';
import type { PipelineRow } from '@/lib/db/supabase-repositories';

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

// GET /api/pipelines - Get all pipelines
export async function GET() {
  try {
    const pipelines = await pipelinesRepository.getAll();
    const parsed = pipelines.map(parsePipeline);
    
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Error fetching pipelines:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipelines' },
      { status: 500 }
    );
  }
}

// POST /api/pipelines - Create or update a pipeline
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, nodes, edges, version } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    
    // Use upsert to handle both create and update
    const pipeline = await pipelinesRepository.upsert({ 
      id,
      name, 
      description,
      nodes: nodes || [],
      edges: edges || [],
      version,
    });
    
    return NextResponse.json(parsePipeline(pipeline), { status: 201 });
  } catch (error) {
    console.error('Error saving pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to save pipeline' },
      { status: 500 }
    );
  }
}
