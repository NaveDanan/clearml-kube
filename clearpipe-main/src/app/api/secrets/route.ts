import { NextRequest, NextResponse } from 'next/server';
import { secretsRepository } from '@/lib/db/supabase-repositories';

// GET /api/secrets - Get all secrets (values are masked)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    
    let secrets;
    if (provider) {
      secrets = await secretsRepository.getByProvider(provider);
    } else {
      secrets = await secretsRepository.getAll();
    }
    
    // Mask secret values for security - only show that they exist
    const maskedSecrets = secrets.map(s => ({
      id: s.id,
      name: s.name,
      provider: s.provider,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      // Never expose the actual value
      hasValue: !!s.value,
    }));
    
    return NextResponse.json(maskedSecrets);
  } catch (error) {
    console.error('Error fetching secrets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch secrets' },
      { status: 500 }
    );
  }
}

// POST /api/secrets - Create a new secret
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, provider, value } = body;
    
    if (!name || !provider || !value) {
      return NextResponse.json(
        { error: 'Name, provider, and value are required' },
        { status: 400 }
      );
    }
    
    const secret = await secretsRepository.create({ name, provider, value });
    
    // Return masked response
    return NextResponse.json({
      id: secret.id,
      name: secret.name,
      provider: secret.provider,
      createdAt: secret.created_at,
      hasValue: true,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating secret:', error);
    return NextResponse.json(
      { error: 'Failed to create secret' },
      { status: 500 }
    );
  }
}
