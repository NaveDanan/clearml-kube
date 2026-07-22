import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { sendInviteEmail } from '@/lib/email';

// GET /api/pipelines/[id]/members - Get all members for a pipeline
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pipelineId } = await params;
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the pipeline to verify access and ownership
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('id, user_id, manager_id, is_public, share_mode')
      .eq('id', pipelineId)
      .single();

    if (pipelineError || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }

    const isOwner = pipeline.user_id === user.id;

    // Get pipeline members
    const { data: members, error: membersError } = await supabase
      .from('pipeline_members')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('invited_at', { ascending: false });

    if (membersError) {
      // Table might not exist yet
      console.error('Error fetching members:', membersError);
      return NextResponse.json({
        members: [],
        isOwner,
        currentUserRole: isOwner ? 'manager' : 'member',
      });
    }

    // Get online users from presence
    const { data: presence } = await supabase
      .from('pipeline_presence')
      .select('user_id, user_email, is_online')
      .eq('pipeline_id', pipelineId)
      .eq('is_online', true);

    const onlineUserIds = new Set(presence?.map(p => p.user_id) || []);
    const onlineUserEmails = new Set(presence?.map(p => p.user_email) || []);

    // Find current user's role
    const currentUserMember = members?.find(m => m.user_id === user.id || m.email === user.email);
    const currentUserRole = isOwner ? 'manager' : currentUserMember?.role || 'member';

    // Get the pipeline manager's details using admin client
    let managerEmail = '';
    let managerName = 'Pipeline Manager';
    let managerAvatarUrl: string | undefined = undefined;

    // If current user is the owner, use their info directly
    if (isOwner) {
      managerEmail = user.email || '';
      managerName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Pipeline Manager';
      managerAvatarUrl = user.user_metadata?.avatar_url;
    } else {
      // Use admin client to get the owner's info
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data: managerUser, error: adminError } = await adminClient.auth.admin.getUserById(pipeline.user_id);
        if (managerUser && !adminError) {
          managerEmail = managerUser.user?.email || '';
          managerName = managerUser.user?.user_metadata?.full_name || 
                        managerUser.user?.user_metadata?.name || 
                        managerUser.user?.email?.split('@')[0] || 
                        'Pipeline Manager';
          managerAvatarUrl = managerUser.user?.user_metadata?.avatar_url;
        }
      }
    }

    // Format members for response
    const formattedMembers = members?.map(m => ({
      id: m.id,
      pipelineId: m.pipeline_id,
      userId: m.user_id,
      email: m.email,
      name: m.email.split('@')[0], // Default name from email
      role: m.role,
      status: m.status,
      invitedBy: m.invited_by,
      invitedAt: m.invited_at,
      joinedAt: m.joined_at,
      lastSeenAt: m.last_seen_at,
      isOnline: m.user_id ? onlineUserIds.has(m.user_id) : onlineUserEmails.has(m.email),
    })) || [];

    // Add the pipeline manager at the beginning of the list
    const managerMember = {
      id: `manager-${pipeline.user_id}`,
      pipelineId: pipelineId,
      userId: pipeline.user_id,
      email: managerEmail || '',
      name: managerName || 'Pipeline Manager',
      avatarUrl: managerAvatarUrl,
      role: 'manager',
      status: 'active',
      invitedBy: null,
      invitedAt: null,
      joinedAt: null,
      lastSeenAt: null,
      isOnline: onlineUserIds.has(pipeline.user_id),
    };

    // Ensure manager is not duplicated if they're also in pipeline_members
    const membersWithoutManager = formattedMembers.filter(
      m => m.userId !== pipeline.user_id && m.email !== managerEmail
    );

    return NextResponse.json({
      members: [managerMember, ...membersWithoutManager],
      isOwner,
      currentUserRole,
    });
  } catch (error) {
    console.error('Error getting pipeline members:', error);
    return NextResponse.json(
      { error: 'Failed to get pipeline members' },
      { status: 500 }
    );
  }
}

// POST /api/pipelines/[id]/members - Invite a new member
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pipelineId } = await params;
    const body = await request.json();
    const { email, role = 'member' } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate role
    if (!['member', 'supervisor'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be member or supervisor' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the pipeline and verify ownership or supervisor role
    const { data: pipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .select('id, user_id, name, is_public, share_token')
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

    if (!isOwner && !isSupervisor) {
      return NextResponse.json(
        { error: 'Only the pipeline manager or supervisors can invite members' },
        { status: 403 }
      );
    }

    // Only owners can assign supervisor role
    if (role === 'supervisor' && !isOwner) {
      return NextResponse.json(
        { error: 'Only the pipeline manager can assign supervisors' },
        { status: 403 }
      );
    }

    // Check if already a member
    const { data: existingMember } = await supabase
      .from('pipeline_members')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .eq('email', email.toLowerCase())
      .single();

    if (existingMember) {
      return NextResponse.json(
        { error: 'This email is already a member of this pipeline' },
        { status: 409 }
      );
    }

    // Check if the email belongs to an existing user using admin client
    let existingUserId: string | null = null;
    const adminClient = createAdminClient();
    if (adminClient) {
      const { data: usersData } = await adminClient.auth.admin.listUsers();
      const existingUser = usersData?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      existingUserId = existingUser?.id || null;
    }

    // Create the member record
    const { data: member, error: insertError } = await supabase
      .from('pipeline_members')
      .insert({
        pipeline_id: pipelineId,
        user_id: existingUserId,
        email: email.toLowerCase(),
        role,
        status: existingUserId ? 'active' : 'pending',
        invited_by: user.id,
        invited_at: new Date().toISOString(),
        joined_at: existingUserId ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating member:', insertError);
      return NextResponse.json(
        { error: 'Failed to invite member' },
        { status: 500 }
      );
    }

    // Also add to shared_with array for backward compatibility
    const { data: currentPipeline } = await supabase
      .from('pipelines')
      .select('shared_with')
      .eq('id', pipelineId)
      .single();

    const sharedWith = currentPipeline?.shared_with || [];
    if (!sharedWith.includes(email.toLowerCase())) {
      await supabase
        .from('pipelines')
        .update({ shared_with: [...sharedWith, email.toLowerCase()] })
        .eq('id', pipelineId);
    }

    // Build share URL
    const baseUrl = request.nextUrl.origin;
    const shareUrl = pipeline.is_public && pipeline.share_token
      ? `${baseUrl}/canvas/${pipelineId}?token=${pipeline.share_token}`
      : `${baseUrl}/canvas/${pipelineId}`;

    // Send invitation email
    const inviterName = user.user_metadata?.full_name || 
                        user.user_metadata?.name || 
                        user.email?.split('@')[0] || 
                        'A ClearPipe user';

    const emailResult = await sendInviteEmail({
      to: email,
      inviterName,
      inviterEmail: user.email || '',
      pipelineName: pipeline.name,
      shareUrl,
    });

    // Log email result for debugging
    if (!emailResult.success) {
      console.warn('Failed to send invitation email:', emailResult.error);
    }

    return NextResponse.json({
      id: member.id,
      pipelineId: member.pipeline_id,
      email: member.email,
      role: member.role,
      status: member.status,
      invitedAt: member.invited_at,
      emailSent: emailResult.success,
      emailError: emailResult.notConfigured 
        ? 'Email service not configured' 
        : emailResult.error,
    }, { status: 201 });
  } catch (error) {
    console.error('Error inviting member:', error);
    return NextResponse.json(
      { error: 'Failed to invite member' },
      { status: 500 }
    );
  }
}
