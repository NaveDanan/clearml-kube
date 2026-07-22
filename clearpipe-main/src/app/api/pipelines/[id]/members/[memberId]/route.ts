import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/pipelines/[id]/members/[memberId] - Get a specific member
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: pipelineId, memberId } = await params;
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: member, error } = await supabase
      .from('pipeline_members')
      .select('*')
      .eq('id', memberId)
      .eq('pipeline_id', pipelineId)
      .single();

    if (error || !member) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: member.id,
      pipelineId: member.pipeline_id,
      userId: member.user_id,
      email: member.email,
      role: member.role,
      status: member.status,
      invitedBy: member.invited_by,
      invitedAt: member.invited_at,
      joinedAt: member.joined_at,
      lastSeenAt: member.last_seen_at,
    });
  } catch (error) {
    console.error('Error getting member:', error);
    return NextResponse.json(
      { error: 'Failed to get member' },
      { status: 500 }
    );
  }
}

// PATCH /api/pipelines/[id]/members/[memberId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: pipelineId, memberId } = await params;
    const body = await request.json();
    const { role, status } = body;
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate role if provided
    if (role && !['member', 'supervisor'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be member or supervisor' },
        { status: 400 }
      );
    }

    // Validate status if provided
    if (status && !['pending', 'active', 'revoked'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Get the pipeline and verify ownership
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('id, user_id')
      .eq('id', pipelineId)
      .single();

    if (pipelineError || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
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
        .eq('pipeline_id', pipelineId)
        .eq('user_id', user.id)
        .single();
      
      isSupervisor = memberRecord?.role === 'supervisor';
    }

    // Get the member being updated
    const { data: targetMember } = await supabase
      .from('pipeline_members')
      .select('role')
      .eq('id', memberId)
      .eq('pipeline_id', pipelineId)
      .single();

    if (!targetMember) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Only the owner can change roles to/from supervisor
    if (role === 'supervisor' || targetMember.role === 'supervisor') {
      if (!isOwner) {
        return NextResponse.json(
          { error: 'Only the pipeline manager can modify supervisor roles' },
          { status: 403 }
        );
      }
    }

    // Supervisors can only modify regular members
    if (!isOwner && isSupervisor && targetMember.role !== 'member') {
      return NextResponse.json(
        { error: 'Supervisors can only modify regular members' },
        { status: 403 }
      );
    }

    // Non-owners/non-supervisors cannot modify members
    if (!isOwner && !isSupervisor) {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (role) updateData.role = role;
    if (status) updateData.status = status;

    const { data: updatedMember, error: updateError } = await supabase
      .from('pipeline_members')
      .update(updateData)
      .eq('id', memberId)
      .eq('pipeline_id', pipelineId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating member:', updateError);
      return NextResponse.json(
        { error: 'Failed to update member' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: updatedMember.id,
      pipelineId: updatedMember.pipeline_id,
      email: updatedMember.email,
      role: updatedMember.role,
      status: updatedMember.status,
    });
  } catch (error) {
    console.error('Error updating member:', error);
    return NextResponse.json(
      { error: 'Failed to update member' },
      { status: 500 }
    );
  }
}

// DELETE /api/pipelines/[id]/members/[memberId] - Remove a member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: pipelineId, memberId } = await params;
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the pipeline and verify ownership
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('id, user_id, shared_with')
      .eq('id', pipelineId)
      .single();

    if (pipelineError || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
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
        .eq('pipeline_id', pipelineId)
        .eq('user_id', user.id)
        .single();
      
      isSupervisor = memberRecord?.role === 'supervisor';
    }

    // Get the member being removed
    const { data: targetMember } = await supabase
      .from('pipeline_members')
      .select('email, role')
      .eq('id', memberId)
      .eq('pipeline_id', pipelineId)
      .single();

    if (!targetMember) {
      return NextResponse.json(
        { error: 'Member not found' },
        { status: 404 }
      );
    }

    // Cannot remove supervisors unless owner
    if (targetMember.role === 'supervisor' && !isOwner) {
      return NextResponse.json(
        { error: 'Only the pipeline manager can remove supervisors' },
        { status: 403 }
      );
    }

    // Non-owners/non-supervisors cannot remove members
    if (!isOwner && !isSupervisor) {
      return NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      );
    }

    // Remove the member
    const { error: deleteError } = await supabase
      .from('pipeline_members')
      .delete()
      .eq('id', memberId)
      .eq('pipeline_id', pipelineId);

    if (deleteError) {
      console.error('Error deleting member:', deleteError);
      return NextResponse.json(
        { error: 'Failed to remove member' },
        { status: 500 }
      );
    }

    // Also remove from shared_with array for backward compatibility
    const sharedWith = (pipeline.shared_with || []).filter(
      (email: string) => email !== targetMember.email
    );
    
    await supabase
      .from('pipelines')
      .update({ shared_with: sharedWith })
      .eq('id', pipelineId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json(
      { error: 'Failed to remove member' },
      { status: 500 }
    );
  }
}
