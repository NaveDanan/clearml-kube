import { NextRequest, NextResponse } from 'next/server';
import { teamMembersRepository } from '@/lib/db/supabase-repositories';
import { createClient } from '@/lib/supabase/server';
import { sendInviteEmail } from '@/lib/email';

// GET /api/team-members - Get all team members
export async function GET() {
  try {
    const members = await teamMembersRepository.getAll();
    // Map to frontend format
    return NextResponse.json(members.map(m => ({
      id: m.id,
      name: m.name,
      email: m.email,
      avatarUrl: m.avatar_url,
      invitedAt: m.invited_at,
    })));
  } catch (error) {
    console.error('Error fetching team members:', error);
    // Return empty array if table doesn't exist or other error
    return NextResponse.json([]);
  }
}

// POST /api/team-members - Invite a new team member
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, pipelineId, shareUrl } = body;

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

    // Get current user info for the invitation email
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if already invited
    const existing = await teamMembersRepository.getByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'This email has already been invited' },
        { status: 409 }
      );
    }

    // Generate name from email
    const name = email.split('@')[0]
      .replace(/[._-]/g, ' ')
      .split(' ')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Create team member record
    const member = await teamMembersRepository.create({
      name,
      email,
    });

    // Get inviter info from user metadata or email
    const inviterName = user.user_metadata?.full_name || 
                        user.user_metadata?.name || 
                        user.email?.split('@')[0] || 
                        'A ClearPipe user';
    const inviterEmail = user.email || '';

    // Determine the share URL
    const baseUrl = request.nextUrl.origin;
    const inviteUrl = shareUrl || (pipelineId 
      ? `${baseUrl}/canvas/${pipelineId}` 
      : `${baseUrl}/signup?invited_by=${user.id}`);

    // Send invitation email
    const emailResult = await sendInviteEmail({
      to: email,
      inviterName,
      inviterEmail,
      pipelineName: undefined, // Could fetch pipeline name if pipelineId provided
      shareUrl: inviteUrl,
    });

    // Log email result for debugging
    console.log('Email send result:', emailResult);

    // Return in frontend format with email status
    return NextResponse.json({
      id: member.id,
      name: member.name,
      email: member.email,
      avatarUrl: member.avatar_url,
      invitedAt: member.invited_at,
      emailSent: emailResult.success,
      emailError: emailResult.error,
      emailNotConfigured: emailResult.notConfigured,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating team member:', error);
    return NextResponse.json(
      { error: 'Failed to invite team member' },
      { status: 500 }
    );
  }
}
