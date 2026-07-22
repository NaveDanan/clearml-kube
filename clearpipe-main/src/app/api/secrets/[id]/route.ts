import { NextRequest, NextResponse } from 'next/server';
import { secretsRepository } from '@/lib/db/supabase-repositories';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/secrets/[id] - Get a secret by ID (value is masked)
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const secret = await secretsRepository.getById(id);
    
    if (!secret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      id: secret.id,
      name: secret.name,
      provider: secret.provider,
      createdAt: secret.created_at,
      updatedAt: secret.updated_at,
      hasValue: !!secret.value,
    });
  } catch (error) {
    console.error('Error fetching secret:', error);
    return NextResponse.json(
      { error: 'Failed to fetch secret' },
      { status: 500 }
    );
  }
}

// GET /api/secrets/[id]/value - Get the actual secret value (for internal use only)
// This endpoint should be used carefully - only for backend operations
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    const secret = await secretsRepository.update(id, body);
    
    if (!secret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      id: secret.id,
      name: secret.name,
      provider: secret.provider,
      createdAt: secret.created_at,
      updatedAt: secret.updated_at,
      hasValue: !!secret.value,
    });
  } catch (error) {
    console.error('Error updating secret:', error);
    return NextResponse.json(
      { error: 'Failed to update secret' },
      { status: 500 }
    );
  }
}

// DELETE /api/secrets/[id] - Delete a secret
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = await secretsRepository.delete(id);
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting secret:', error);
    return NextResponse.json(
      { error: 'Failed to delete secret' },
      { status: 500 }
    );
  }
}
