-- OttoChain Reputation System Database Schema
-- PostgreSQL schema for agent reputation tracking and scoring

-- Agent reputation summary table
CREATE TABLE agent_reputation (
    agent_id VARCHAR(255) PRIMARY KEY,
    overall_score DECIMAL(5,4) NOT NULL CHECK (overall_score >= 0 AND overall_score <= 1),
    performance_score DECIMAL(5,4) NOT NULL CHECK (performance_score >= 0 AND performance_score <= 1),
    reliability_score DECIMAL(5,4) NOT NULL CHECK (reliability_score >= 0 AND reliability_score <= 1),
    specialization_score DECIMAL(5,4) NOT NULL CHECK (specialization_score >= 0 AND specialization_score <= 1),
    network_score DECIMAL(5,4) NOT NULL CHECK (network_score >= 0 AND network_score <= 1),
    task_count BIGINT NOT NULL DEFAULT 0 CHECK (task_count >= 0),
    active_streak INTEGER NOT NULL DEFAULT 0 CHECK (active_streak >= 0),
    decay_factor DECIMAL(5,4) NOT NULL DEFAULT 1.0 CHECK (decay_factor >= 0 AND decay_factor <= 1),
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Task completion records
CREATE TABLE task_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id VARCHAR(255) NOT NULL UNIQUE,
    agent_id VARCHAR(255) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    quality_score DECIMAL(5,4) NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
    efficiency_score DECIMAL(5,4) NOT NULL CHECK (efficiency_score >= 0 AND efficiency_score <= 1),
    domain VARCHAR(100) NOT NULL,
    complexity INTEGER NOT NULL CHECK (complexity >= 1 AND complexity <= 5),
    delegated_by VARCHAR(255),
    staking_amount DECIMAL(18,8) CHECK (staking_amount IS NULL OR staking_amount >= 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    FOREIGN KEY (agent_id) REFERENCES agent_reputation(agent_id) ON DELETE CASCADE
);

-- Reputation event audit log
CREATE TABLE reputation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(255) NOT NULL UNIQUE,
    agent_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    score_delta DECIMAL(5,4) NOT NULL CHECK (score_delta >= -1 AND score_delta <= 1),
    reason TEXT NOT NULL,
    source_task_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    FOREIGN KEY (agent_id) REFERENCES agent_reputation(agent_id) ON DELETE CASCADE,
    FOREIGN KEY (source_task_id) REFERENCES task_completions(task_id) ON DELETE SET NULL
);

-- Agent specialization areas
CREATE TABLE agent_specializations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(255) NOT NULL,
    domain VARCHAR(100) NOT NULL,
    expertise_level DECIMAL(5,4) NOT NULL CHECK (expertise_level >= 0 AND expertise_level <= 1),
    task_count BIGINT NOT NULL DEFAULT 0 CHECK (task_count >= 0),
    average_quality DECIMAL(5,4) NOT NULL DEFAULT 0 CHECK (average_quality >= 0 AND average_quality <= 1),
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(agent_id, domain),
    FOREIGN KEY (agent_id) REFERENCES agent_reputation(agent_id) ON DELETE CASCADE
);

-- Create indexes for query performance
CREATE INDEX idx_agent_reputation_overall_score ON agent_reputation(overall_score DESC);
CREATE INDEX idx_agent_reputation_last_updated ON agent_reputation(last_updated DESC);
CREATE INDEX idx_task_completions_agent_id ON task_completions(agent_id);
CREATE INDEX idx_task_completions_completed_at ON task_completions(completed_at DESC);
CREATE INDEX idx_task_completions_domain ON task_completions(domain);
CREATE INDEX idx_reputation_events_agent_id ON reputation_events(agent_id);
CREATE INDEX idx_reputation_events_timestamp ON reputation_events(timestamp DESC);
CREATE INDEX idx_reputation_events_event_type ON reputation_events(event_type);
CREATE INDEX idx_agent_specializations_agent_id ON agent_specializations(agent_id);
CREATE INDEX idx_agent_specializations_domain ON agent_specializations(domain);
CREATE INDEX idx_agent_specializations_expertise ON agent_specializations(expertise_level DESC);

-- Create enum types for event types
CREATE TYPE reputation_event_type AS ENUM (
    'TaskCompletion',
    'TaskFailure', 
    'SpecializationBonus',
    'NetworkCollaboration',
    'DecayApplication',
    'ManualAdjustment',
    'SlashingPenalty'
);

-- Update reputation_events table to use enum
ALTER TABLE reputation_events 
    ALTER COLUMN event_type TYPE reputation_event_type 
    USING event_type::reputation_event_type;

-- Trigger to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agent_reputation_updated_at 
    BEFORE UPDATE ON agent_reputation 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_specializations_updated_at 
    BEFORE UPDATE ON agent_specializations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate agent leaderboard
CREATE OR REPLACE FUNCTION get_reputation_leaderboard(
    p_limit INTEGER DEFAULT 25,
    p_domain VARCHAR DEFAULT NULL
) RETURNS TABLE (
    rank INTEGER,
    agent_id VARCHAR(255),
    overall_score DECIMAL(5,4),
    task_count BIGINT,
    specialization_domains TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ROW_NUMBER() OVER (ORDER BY ar.overall_score DESC)::INTEGER as rank,
        ar.agent_id,
        ar.overall_score,
        ar.task_count,
        ARRAY_AGG(DISTINCT asp.domain) FILTER (WHERE asp.domain IS NOT NULL) as specialization_domains
    FROM agent_reputation ar
    LEFT JOIN agent_specializations asp ON ar.agent_id = asp.agent_id
    LEFT JOIN task_completions tc ON ar.agent_id = tc.agent_id 
        AND (p_domain IS NULL OR tc.domain = p_domain)
    WHERE p_domain IS NULL OR EXISTS (
        SELECT 1 FROM task_completions tc2 
        WHERE tc2.agent_id = ar.agent_id AND tc2.domain = p_domain
    )
    GROUP BY ar.agent_id, ar.overall_score, ar.task_count
    ORDER BY ar.overall_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get agent recommendations based on criteria
CREATE OR REPLACE FUNCTION get_agent_recommendations(
    p_required_score DECIMAL DEFAULT 0.5,
    p_domain VARCHAR DEFAULT NULL,
    p_max_candidates INTEGER DEFAULT 10,
    p_exclude_agents VARCHAR[] DEFAULT '{}',
    p_require_active BOOLEAN DEFAULT true
) RETURNS TABLE (
    agent_id VARCHAR(255),
    overall_score DECIMAL(5,4),
    specialization_score DECIMAL(5,4),
    task_count BIGINT,
    last_activity TIMESTAMP WITH TIME ZONE,
    domain_expertise DECIMAL(5,4)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ar.agent_id,
        ar.overall_score,
        ar.specialization_score,
        ar.task_count,
        ar.last_updated as last_activity,
        COALESCE(asp.expertise_level, 0.0) as domain_expertise
    FROM agent_reputation ar
    LEFT JOIN agent_specializations asp ON ar.agent_id = asp.agent_id 
        AND (p_domain IS NULL OR asp.domain = p_domain)
    WHERE ar.overall_score >= p_required_score
        AND (NOT p_require_active OR ar.last_updated > NOW() - INTERVAL '90 days')
        AND NOT (ar.agent_id = ANY(p_exclude_agents))
        AND (p_domain IS NULL OR asp.domain IS NOT NULL)
    ORDER BY 
        ar.overall_score DESC,
        COALESCE(asp.expertise_level, 0.0) DESC,
        ar.task_count DESC
    LIMIT p_max_candidates;
END;
$$ LANGUAGE plpgsql;

-- Sample data for testing (optional)
/*
INSERT INTO agent_reputation (
    agent_id, overall_score, performance_score, reliability_score, 
    specialization_score, network_score, task_count, active_streak
) VALUES 
('agent_scala_expert', 0.92, 0.95, 0.88, 0.95, 0.85, 50, 12),
('agent_typescript_pro', 0.87, 0.85, 0.92, 0.90, 0.80, 35, 8),
('agent_generalist', 0.75, 0.78, 0.85, 0.60, 0.75, 25, 5),
('agent_newbie', 0.45, 0.50, 0.40, 0.35, 0.55, 8, 3);

INSERT INTO agent_specializations (agent_id, domain, expertise_level, task_count, average_quality, last_activity) VALUES
('agent_scala_expert', 'scala', 0.95, 30, 0.93, NOW()),
('agent_scala_expert', 'functional-programming', 0.88, 20, 0.90, NOW() - INTERVAL '2 days'),
('agent_typescript_pro', 'typescript', 0.90, 25, 0.87, NOW() - INTERVAL '1 day'),
('agent_typescript_pro', 'react', 0.85, 15, 0.82, NOW() - INTERVAL '3 days'),
('agent_generalist', 'documentation', 0.60, 10, 0.65, NOW() - INTERVAL '5 days');
*/