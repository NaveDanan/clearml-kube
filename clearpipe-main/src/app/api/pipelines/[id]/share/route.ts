import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pipelinesRepository } from '@/lib/db/supabase-repositories';

// GET /api/pipelines/[id]/share - Get share settings for a pipeline
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get current user using the standard server client
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get pipeline directly to check ownership and get all details
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('*')
      .eq('id', id)
      .single();

    if (pipelineError || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found or access denied' },
        { status: 404 }
      );
    }

    // Check if user has access (owner, public, or in shared_with)
    const isOwner = pipeline.user_id === user.id;
    const isPublic = pipeline.is_public;
    const isSharedWith = pipeline.shared_with?.includes(user.email);

    if (!isOwner && !isPublic && !isSharedWith) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Get pipeline members
    const { data: members } = await supabase
      .from('pipeline_members')
      .select('*')
      .eq('pipeline_id', id)
      .order('invited_at', { ascending: false });

    // Get online users
    const { data: presence } = await supabase
      .from('pipeline_presence')
      .select('user_id, user_email, user_name, user_avatar, is_online')
      .eq('pipeline_id', id)
      .eq('is_online', true);

    // Build the share URL
    const baseUrl = request.nextUrl.origin;
    const shareUrl = pipeline.is_public && pipeline.share_token
      ? `${baseUrl}/canvas/${pipeline.id}?token=${pipeline.share_token}`
      : `${baseUrl}/canvas/${pipeline.id}`;

    // Format members for response
    const formattedMembers = members?.map(m => ({
      id: m.id,
      pipelineId: m.pipeline_id,
      userId: m.user_id,
      email: m.email,
      name: m.email.split('@')[0],
      role: m.role,
      status: m.status,
      invitedBy: m.invited_by,
      invitedAt: m.invited_at,
      joinedAt: m.joined_at,
      lastSeenAt: m.last_seen_at,
      isOnline: presence?.some(p => p.user_email === m.email),
    })) || [];

    // Format online users for response
    const onlineUsers = presence?.map(p => ({
      id: p.user_id,
      email: p.user_email,
      name: p.user_name,
      avatarUrl: p.user_avatar,
    })) || [];

    return NextResponse.json({
      id: pipeline.id,
      name: pipeline.name,
      isPublic: pipeline.is_public || false,
      shareMode: pipeline.share_mode || 'private',
      shareToken: pipeline.share_token,
      shareUrl,
      sharedWith: pipeline.shared_with || [],
      managerId: pipeline.user_id,
      members: formattedMembers,
      onlineUsers,
      isOwner,
    });
  } catch (error) {
    console.error('Error getting share settings:', error);
    return NextResponse.json(
      { error: 'Failed to get share settings' },
      { status: 500 }
    );
  }
}

// PATCH /api/pipelines/[id]/share - Update share settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get current user using the standard server client
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const body = await request.json();

    // Get pipeline directly
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('*')
      .eq('id', id)
      .single();

    if (pipelineError || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found or access denied' },
        { status: 404 }
      );
    }

    const isOwner = pipeline.user_id === user.id;

    // Check if user is a supervisor
    let isSupervisor = false;
    if (!isOwner) {
      const { data: memberRecord } = await supabase
        .from('pipeline_members')
        .select('role')
        .eq('pipeline_id', id)
        .eq('user_id', user.id)
        .single();
      
      isSupervisor = memberRecord?.role === 'supervisor';
    }

    // Only owner or supervisors can change share settings
    if (!isOwner && !isSupervisor) {
      return NextResponse.json(
        { error: 'Only the pipeline manager or supervisors can change share settings' },
        { status: 403 }
      );
    }

    // Update share settings
    if (typeof body.isPublic === 'boolean') {
      await pipelinesRepository.setPublicAccess(id, body.isPublic);
    }

    // Update share mode if provided
    if (body.shareMode && ['private', 'public', 'verified'].includes(body.shareMode)) {
      await pipelinesRepository.updateShareMode(id, body.shareMode);
    }

    // Regenerate share token if requested
    if (body.regenerateToken) {
      await pipelinesRepository.regenerateShareToken(id);
    }

    // Get updated pipeline
    const { data: updatedPipeline } = await supabase
      .from('pipelines')
      .select('*')
      .eq('id', id)
      .single();

    // Get pipeline members
    const { data: members } = await supabase
      .from('pipeline_members')
      .select('*')
      .eq('pipeline_id', id)
      .order('invited_at', { ascending: false });

    // Get online users
    const { data: presence } = await supabase
      .from('pipeline_presence')
      .select('user_id, user_email, user_name, user_avatar, is_online')
      .eq('pipeline_id', id)
      .eq('is_online', true);

    // Build the share URL
    const baseUrl = request.nextUrl.origin;
    const shareUrl = updatedPipeline?.is_public && updatedPipeline?.share_token
      ? `${baseUrl}/canvas/${updatedPipeline.id}?token=${updatedPipeline.share_token}`
      : `${baseUrl}/canvas/${updatedPipeline?.id}`;

    // Format members for response
    const formattedMembers = members?.map(m => ({
      id: m.id,
      pipelineId: m.pipeline_id,
      userId: m.user_id,
      email: m.email,
      name: m.email.split('@')[0],
      role: m.role,
      status: m.status,
      invitedBy: m.invited_by,
      invitedAt: m.invited_at,
      joinedAt: m.joined_at,
      lastSeenAt: m.last_seen_at,
      isOnline: presence?.some(p => p.user_email === m.email),
    })) || [];

    // Format online users for response
    const onlineUsers = presence?.map(p => ({
      id: p.user_id,
      email: p.user_email,
      name: p.user_name,
      avatarUrl: p.user_avatar,
    })) || [];

    return NextResponse.json({
      id: updatedPipeline?.id,
      name: updatedPipeline?.name,
      isPublic: updatedPipeline?.is_public || false,
      shareMode: updatedPipeline?.share_mode || 'private',
      shareToken: updatedPipeline?.share_token,
      shareUrl,
      sharedWith: updatedPipeline?.shared_with || [],
      managerId: updatedPipeline?.user_id,
      members: formattedMembers,
      onlineUsers,
      isOwner,
    });
  } catch (error) {
    console.error('Error updating share settings:', error);
    return NextResponse.json(
      { error: 'Failed to update share settings' },
      { status: 500 }
    );
  }
}
