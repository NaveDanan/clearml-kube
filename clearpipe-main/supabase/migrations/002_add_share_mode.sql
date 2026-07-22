-- ============================================================================
-- Add share_mode to pipelines table
-- ============================================================================

-- Add share_mode column if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'pipelines' 
        AND column_name = 'share_mode'
    ) THEN
        -- share_mode can be: 'private', 'public' (anyone with link), 'verified' (only invited team members)
        ALTER TABLE public.pipelines ADD COLUMN share_mode TEXT DEFAULT 'private' CHECK (share_mode IN ('private', 'public', 'verified'));
    END IF;
END $$;

-- Create index for share_mode for query performance
CREATE INDEX IF NOT EXISTS idx_pipelines_share_mode ON public.pipelines(share_mode);
