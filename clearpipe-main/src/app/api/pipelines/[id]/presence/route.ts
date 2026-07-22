import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/pipelines/[id]/presence - Get online users for a pipeline
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

    // Get online users from presence table
    const { data: presence, error } = await supabase
      .from('pipeline_presence')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .eq('is_online', true)
      .order('connected_at', { ascending: false });

    if (error) {
      console.error('Error fetching presence:', error);
      // Table might not exist
      return NextResponse.json({ onlineUsers: [] });
    }

    // Clean up stale presence (users who haven't sent heartbeat in 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await supabase
      .from('pipeline_presence')
      .update({ is_online: false })
      .eq('pipeline_id', pipelineId)
      .lt('last_heartbeat', twoMinutesAgo)
      .eq('is_online', true);

    const onlineUsers = presence?.map(p => ({
      id: p.id,
      userId: p.user_id,
      userEmail: p.user_email,
      userName: p.user_name,
      userAvatar: p.user_avatar,
      cursorX: p.cursor_x,
      cursorY: p.cursor_y,
      isOnline: p.is_online,
      lastHeartbeat: p.last_heartbeat,
      connectedAt: p.connected_at,
    })) || [];

    return NextResponse.json({ onlineUsers });
  } catch (error) {
    console.error('Error getting presence:', error);
    return NextResponse.json(
      { error: 'Failed to get presence' },
      { status: 500 }
    );
  }
}

// POST /api/pipelines/[id]/presence - Update presence (heartbeat, connect, disconnect)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pipelineId } = await params;
    const body = await request.json();
    const { action, cursorX, cursorY } = body;
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();

    if (action === 'disconnect') {
      // Mark user as offline
      await supabase
        .from('pipeline_presence')
        .update({ 
          is_online: false,
          updated_at: now,
        })
        .eq('pipeline_id', pipelineId)
        .eq('user_id', user.id);

      return NextResponse.json({ success: true });
    }

    // For connect or heartbeat, upsert presence record
    const presenceData = {
      pipeline_id: pipelineId,
      user_id: user.id,
      user_email: user.email || '',
      user_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
      user_avatar: user.user_metadata?.avatar_url,
      is_online: true,
      last_heartbeat: now,
      updated_at: now,
    };

    // Add cursor position if provided
    if (typeof cursorX === 'number' && typeof cursorY === 'number') {
      Object.assign(presenceData, {
        cursor_x: cursorX,
        cursor_y: cursorY,
      });
    }

    // Check if presence record exists
    const { data: existingPresence } = await supabase
      .from('pipeline_presence')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .eq('user_id', user.id)
      .single();

    if (existingPresence) {
      // Update existing record
      await supabase
        .from('pipeline_presence')
        .update(presenceData)
        .eq('pipeline_id', pipelineId)
        .eq('user_id', user.id);
    } else {
      // Insert new record
      await supabase
        .from('pipeline_presence')
        .insert({
          ...presenceData,
          connected_at: now,
          created_at: now,
        });
    }

    // Also update member's last_seen_at if they are a member
    await supabase
      .from('pipeline_members')
      .update({ last_seen_at: now })
      .eq('pipeline_id', pipelineId)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating presence:', error);
    return NextResponse.json(
      { error: 'Failed to update presence' },
      { status: 500 }
    );
  }
}
