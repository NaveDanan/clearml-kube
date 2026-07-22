import { NextRequest, NextResponse } from 'next/server';
import { teamMembersRepository } from '@/lib/db/supabase-repositories';

// DELETE /api/team-members/[id] - Remove a team member
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    console.log('Deleting team member with id:', id);
    
    const deleted = await teamMembersRepository.delete(id);
    
    if (!deleted) {
      console.log('Team member not found:', id);
      return NextResponse.json(
        { error: 'Team member not found' },
        { status: 404 }
      );
    }

    console.log('Team member deleted successfully:', id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting team member:', error);
    return NextResponse.json(
      { error: 'Failed to remove team member' },
      { status: 500 }
    );
  }
}
