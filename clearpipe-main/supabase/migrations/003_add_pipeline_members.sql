-- ============================================================================
-- Add Pipeline Members table for robust role-based sharing
-- ============================================================================

-- Create pipeline_members table for managing access and roles
CREATE TABLE IF NOT EXISTS public.pipeline_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'supervisor', 'member')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
    invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pipeline_id, email)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_pipeline_members_pipeline_id ON public.pipeline_members(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_members_user_id ON public.pipeline_members(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_members_email ON public.pipeline_members(email);
CREATE INDEX IF NOT EXISTS idx_pipeline_members_role ON public.pipeline_members(role);
CREATE INDEX IF NOT EXISTS idx_pipeline_members_status ON public.pipeline_members(status);

-- Create pipeline_presence table for real-time presence tracking
CREATE TABLE IF NOT EXISTS public.pipeline_presence (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    user_name TEXT,
    user_avatar TEXT,
    cursor_x FLOAT,
    cursor_y FLOAT,
    is_online BOOLEAN DEFAULT TRUE,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pipeline_id, user_id)
);

-- Create index for presence queries
CREATE INDEX IF NOT EXISTS idx_pipeline_presence_pipeline_id ON public.pipeline_presence(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_presence_is_online ON public.pipeline_presence(is_online);
CREATE INDEX IF NOT EXISTS idx_pipeline_presence_last_heartbeat ON public.pipeline_presence(last_heartbeat);

-- Add manager_id column to pipelines table (the creator)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pipelines' 
        AND column_name = 'manager_id'
    ) THEN
        ALTER TABLE public.pipelines ADD COLUMN manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
        -- Set existing pipelines manager_id to user_id
        UPDATE public.pipelines SET manager_id = user_id WHERE manager_id IS NULL;
    END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE public.pipeline_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_presence ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies for PIPELINE_MEMBERS
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Pipeline members viewable by pipeline owner" ON public.pipeline_members;
DROP POLICY IF EXISTS "Pipeline members viewable by members" ON public.pipeline_members;
DROP POLICY IF EXISTS "Pipeline owner can manage members" ON public.pipeline_members;
DROP POLICY IF EXISTS "Supervisors can manage members" ON public.pipeline_members;

-- Pipeline owner can view all members
CREATE POLICY "Pipeline members viewable by pipeline owner" ON public.pipeline_members
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pipelines 
            WHERE pipelines.id = pipeline_members.pipeline_id 
            AND pipelines.user_id = auth.uid()
        )
    );

-- Members can view other members of the same pipeline
CREATE POLICY "Pipeline members viewable by members" ON public.pipeline_members
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pipeline_members pm
            WHERE pm.pipeline_id = pipeline_members.pipeline_id 
            AND pm.user_id = auth.uid()
            AND pm.status = 'active'
        )
    );

-- Pipeline owner can manage (insert, update, delete) members
CREATE POLICY "Pipeline owner can manage members" ON public.pipeline_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.pipelines 
            WHERE pipelines.id = pipeline_members.pipeline_id 
            AND pipelines.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.pipelines 
            WHERE pipelines.id = pipeline_members.pipeline_id 
            AND pipelines.user_id = auth.uid()
        )
    );

-- Supervisors can manage members (except other supervisors and manager)
CREATE POLICY "Supervisors can manage members" ON public.pipeline_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.pipeline_members pm
            WHERE pm.pipeline_id = pipeline_members.pipeline_id 
            AND pm.user_id = auth.uid()
            AND pm.role = 'supervisor'
            AND pm.status = 'active'
        )
        AND pipeline_members.role = 'member' -- Can only manage regular members
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.pipeline_members pm
            WHERE pm.pipeline_id = pipeline_members.pipeline_id 
            AND pm.user_id = auth.uid()
            AND pm.role = 'supervisor'
            AND pm.status = 'active'
        )
        AND pipeline_members.role = 'member' -- Can only manage regular members
    );

-- ============================================================================
-- RLS Policies for PIPELINE_PRESENCE
-- ============================================================================

DROP POLICY IF EXISTS "Presence viewable by pipeline members" ON public.pipeline_presence;
DROP POLICY IF EXISTS "Users can manage own presence" ON public.pipeline_presence;

-- Anyone with pipeline access can view presence
CREATE POLICY "Presence viewable by pipeline members" ON public.pipeline_presence
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.pipelines 
            WHERE pipelines.id = pipeline_presence.pipeline_id 
            AND (
                pipelines.user_id = auth.uid()
                OR pipelines.is_public = TRUE
                OR auth.uid()::text = ANY(pipelines.shared_with)
            )
        )
        OR EXISTS (
            SELECT 1 FROM public.pipeline_members pm
            WHERE pm.pipeline_id = pipeline_presence.pipeline_id 
            AND pm.user_id = auth.uid()
            AND pm.status = 'active'
        )
    );

-- Users can manage their own presence
CREATE POLICY "Users can manage own presence" ON public.pipeline_presence
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- Function to clean up stale presence records
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
    -- Mark users as offline if no heartbeat in last 2 minutes
    UPDATE public.pipeline_presence
    SET is_online = FALSE, updated_at = NOW()
    WHERE is_online = TRUE 
    AND last_heartbeat < NOW() - INTERVAL '2 minutes';
    
    -- Delete presence records older than 24 hours
    DELETE FROM public.pipeline_presence
    WHERE last_heartbeat < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Trigger to update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_pipeline_members_updated_at ON public.pipeline_members;
CREATE TRIGGER update_pipeline_members_updated_at
    BEFORE UPDATE ON public.pipeline_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipeline_presence_updated_at ON public.pipeline_presence;
CREATE TRIGGER update_pipeline_presence_updated_at
    BEFORE UPDATE ON public.pipeline_presence
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

