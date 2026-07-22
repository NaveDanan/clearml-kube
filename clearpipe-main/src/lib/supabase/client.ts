import { createBrowserClient } from '@supabase/ssr';

// These are injected at build time from GitHub secrets
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Return a mock client during build time when env vars aren't available
    // This allows static generation to complete
    console.warn('Supabase credentials not configured. Auth features will not work.');
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
