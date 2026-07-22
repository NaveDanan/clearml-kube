-- ============================================================================
-- ClearPipe Database Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================================

-- ============================================================================
-- 1. Create team_members table (if not exists)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    avatar_url TEXT,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, email)
);

-- ============================================================================
-- 2. Ensure pipelines table has sharing columns
-- ============================================================================
DO $$ 
BEGIN
    -- Add is_public column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pipelines' 
        AND column_name = 'is_public'
    ) THEN
        ALTER TABLE public.pipelines ADD COLUMN is_public BOOLEAN DEFAULT FALSE;
    END IF;

    -- Add share_token column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pipelines' 
        AND column_name = 'share_token'
    ) THEN
        ALTER TABLE public.pipelines ADD COLUMN share_token TEXT;
    END IF;

    -- Add shared_with column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pipelines' 
        AND column_name = 'shared_with'
    ) THEN
        ALTER TABLE public.pipelines ADD COLUMN shared_with TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- ============================================================================
-- 3. Enable RLS on all tables
-- ============================================================================
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. Drop existing policies (to recreate them cleanly)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Users can view public pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Users can view shared pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Users can create own pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Users can update own pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Users can delete own pipelines" ON public.pipelines;

DROP POLICY IF EXISTS "Users can view own secrets" ON public.secrets;
DROP POLICY IF EXISTS "Users can create own secrets" ON public.secrets;
DROP POLICY IF EXISTS "Users can update own secrets" ON public.secrets;
DROP POLICY IF EXISTS "Users can delete own secrets" ON public.secrets;

DROP POLICY IF EXISTS "Users can view own connections" ON public.connections;
DROP POLICY IF EXISTS "Users can create own connections" ON public.connections;
DROP POLICY IF EXISTS "Users can update own connections" ON public.connections;
DROP POLICY IF EXISTS "Users can delete own connections" ON public.connections;

DROP POLICY IF EXISTS "Users can view own team_members" ON public.team_members;
DROP POLICY IF EXISTS "Users can create own team_members" ON public.team_members;
DROP POLICY IF EXISTS "Users can update own team_members" ON public.team_members;
DROP POLICY IF EXISTS "Users can delete own team_members" ON public.team_members;

-- ============================================================================
-- 5. Create RLS Policies for PIPELINES
-- ============================================================================

-- Users can view their own pipelines
CREATE POLICY "Users can view own pipelines" ON public.pipelines
    FOR SELECT
    USING (auth.uid() = user_id);

-- Anyone can view public pipelines (for share links to work)
CREATE POLICY "Users can view public pipelines" ON public.pipelines
    FOR SELECT
    USING (is_public = TRUE);

-- Users in shared_with array can view the pipeline
CREATE POLICY "Users can view shared pipelines" ON public.pipelines
    FOR SELECT
    USING (auth.uid()::text = ANY(shared_with));

-- Users can create their own pipelines
CREATE POLICY "Users can create own pipelines" ON public.pipelines
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own pipelines
CREATE POLICY "Users can update own pipelines" ON public.pipelines
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own pipelines
CREATE POLICY "Users can delete own pipelines" ON public.pipelines
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 6. Create RLS Policies for SECRETS
-- ============================================================================

CREATE POLICY "Users can view own secrets" ON public.secrets
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own secrets" ON public.secrets
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own secrets" ON public.secrets
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own secrets" ON public.secrets
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 7. Create RLS Policies for CONNECTIONS
-- ============================================================================

CREATE POLICY "Users can view own connections" ON public.connections
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own connections" ON public.connections
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections" ON public.connections
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own connections" ON public.connections
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 8. Create RLS Policies for TEAM_MEMBERS
-- ============================================================================

CREATE POLICY "Users can view own team_members" ON public.team_members
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own team_members" ON public.team_members
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own team_members" ON public.team_members
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own team_members" ON public.team_members
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- 9. Create indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_pipelines_user_id ON public.pipelines(user_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_share_token ON public.pipelines(share_token);
CREATE INDEX IF NOT EXISTS idx_pipelines_is_public ON public.pipelines(is_public);
CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON public.secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON public.connections(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON public.team_members(email);
