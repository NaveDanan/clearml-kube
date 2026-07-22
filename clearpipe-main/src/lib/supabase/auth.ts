import { createClient } from './server';
import { redirect } from 'next/navigation';

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
};

/**
 * Get the current authenticated user from the server
 * Returns null if not authenticated
 */
export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return null;
  }
  
  return {
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.full_name || user.user_metadata?.name,
    avatarUrl: user.user_metadata?.avatar_url,
  };
}

/**
 * Require authentication - redirects to login if not authenticated
 */
export async function requireAuth(redirectTo = '/login'): Promise<AuthUser> {
  const user = await getUser();
  
  if (!user) {
    redirect(redirectTo);
  }
  
  return user;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
