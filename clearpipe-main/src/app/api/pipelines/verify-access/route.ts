import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { pipelinesRepository } from '@/lib/db/supabase-repositories';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// POST /api/pipelines/verify-access - Verify access to a pipeline
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pipelineId, shareToken, userEmail } = body;

    console.log('verify-access called with:', { pipelineId, shareToken: shareToken ? '***' : undefined });

    if (!pipelineId) {
      return NextResponse.json(
        { error: 'Pipeline ID is required' },
        { status: 400 }
      );
    }

    // Get current user if Supabase is configured
    let userId: string | undefined;
    let userEmailFromAuth: string | undefined;
    
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll() {
              // Not needed for this read-only operation
            },
          },
        }
      );

      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
      userEmailFromAuth = user?.email;

      // Check if user is a pipeline member
      if (userId) {
        const { data: memberRecord } = await supabase
          .from('pipeline_members')
          .select('role, status')
          .eq('pipeline_id', pipelineId)
          .eq('user_id', userId)
          .single();

        if (memberRecord && memberRecord.status === 'active') {
          // Update last_seen_at
          await supabase
            .from('pipeline_members')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('pipeline_id', pipelineId)
            .eq('user_id', userId);
        }
      }
    }

    console.log('verify-access userId:', userId || 'none');

    // Get the pipeline details
    // Use getByIdPublic to fetch the pipeline
    const pipeline = await pipelinesRepository.getByIdPublic(pipelineId);
    if (!pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }

    // Check if user is the owner
    const isOwner = userId && pipeline.user_id === userId;

    // Check share mode restrictions
    const shareMode = pipeline.share_mode || 'private';
    const currentUserEmail = userEmailFromAuth || userEmail;

    // If private, only owner can access
    if (shareMode === 'private' && !isOwner) {
      // Check if user is in pipeline_members
      if (supabaseUrl && supabaseAnonKey && userId) {
        const supabase = createServerClient(
          supabaseUrl,
          supabaseAnonKey,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {},
            },
          }
        );

        const { data: memberRecord } = await supabase
          .from('pipeline_members')
          .select('role, status')
          .eq('pipeline_id', pipelineId)
          .eq('user_id', userId)
          .single();

        if (!memberRecord || memberRecord.status !== 'active') {
          return NextResponse.json(
            { error: 'Access denied - private pipeline' },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Access denied - private pipeline' },
          { status: 403 }
        );
      }
    }

    // If share mode is 'verified', check if user is in the invited team members list
    if (shareMode === 'verified' && !isOwner) {
      if (!currentUserEmail) {
        return NextResponse.json(
          { error: 'Authentication required for verified sharing' },
          { status: 401 }
        );
      }

      // Check if user email is in the shared_with list or pipeline_members
      const isUserInvited = pipeline.shared_with?.includes(currentUserEmail) || false;
      
      // Also check pipeline_members table
      let isMember = false;
      if (supabaseUrl && supabaseAnonKey && userId) {
        const supabase = createServerClient(
          supabaseUrl,
          supabaseAnonKey,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll() {},
            },
          }
        );

        const { data: memberRecord } = await supabase
          .from('pipeline_members')
          .select('id')
          .eq('pipeline_id', pipelineId)
          .or(`user_id.eq.${userId},email.eq.${currentUserEmail}`)
          .single();

        isMember = !!memberRecord;
      }

      if (!isUserInvited && !isMember) {
        return NextResponse.json(
          { error: 'Access denied - not in invited members' },
          { status: 403 }
        );
      }
    }

    // Determine user's role
    let userRole = 'member';
    if (isOwner) {
      userRole = 'manager';
    } else if (supabaseUrl && supabaseAnonKey && userId) {
      const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll() {},
          },
        }
      );

      const { data: memberRecord } = await supabase
        .from('pipeline_members')
        .select('role')
        .eq('pipeline_id', pipelineId)
        .eq('user_id', userId)
        .single();

      if (memberRecord) {
        userRole = memberRecord.role;
      }
    }

    // Return pipeline metadata (not the full pipeline for security)
    return NextResponse.json({
      id: pipeline.id,
      name: pipeline.name,
      isPublic: pipeline.is_public,
      shareMode: shareMode,
      isOwner,
      userRole,
      canEdit: isOwner || userRole === 'supervisor' || userRole === 'member',
      canChangeSettings: isOwner || userRole === 'supervisor',
      canInviteMembers: isOwner || userRole === 'supervisor',
    });
  } catch (error) {
    console.error('Error verifying pipeline access:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500 }
    );
  }
}
