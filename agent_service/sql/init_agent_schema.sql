CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY,
  mrn TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  sex_at_birth TEXT NOT NULL,
  phone TEXT,
  call_trigger_phone TEXT,
  email TEXT,
  condition_summary TEXT NOT NULL,
  home_visit_address TEXT,
  home_latitude DOUBLE PRECISION,
  home_longitude DOUBLE PRECISION,
  status TEXT NOT NULL,
  adherence NUMERIC(5,2) NOT NULL,
  last_visit DATE,
  next_appointment DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS call_trigger_phone TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_visit_address TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_latitude DOUBLE PRECISION;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_longitude DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  appointment_type TEXT NOT NULL,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS next_visit_rules (
  rule_id BIGSERIAL PRIMARY KEY,
  program_code TEXT NOT NULL,
  service_type TEXT NOT NULL,
  interval_days INT NOT NULL CHECK (interval_days >= 0),
  window_before_days INT NOT NULL DEFAULT 0 CHECK (window_before_days >= 0),
  window_after_days INT NOT NULL DEFAULT 3 CHECK (window_after_days >= 0),
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  preferred_days INT[] DEFAULT NULL,
  preferred_time_start TIME DEFAULT NULL,
  preferred_time_end TIME DEFAULT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_next_visit_rules_lookup
  ON next_visit_rules (program_code, service_type, is_active, priority);

CREATE TABLE IF NOT EXISTS visit_events (
  event_id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  patient_id UUID NOT NULL,
  clinic_id TEXT NOT NULL,
  program_code TEXT NOT NULL,
  service_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_events_patient_time
  ON visit_events (patient_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_appointment_holds (
  hold_id UUID PRIMARY KEY,
  patient_id UUID NOT NULL,
  visit_id TEXT NOT NULL,
  clinic_id TEXT NOT NULL,
  appointment_type TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  selected_start_at TIMESTAMPTZ NOT NULL,
  selected_end_at TIMESTAMPTZ NOT NULL,
  option_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_holds_patient
  ON agent_appointment_holds (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  conversation_id BIGSERIAL PRIMARY KEY,
  wa_phone TEXT NOT NULL,
  patient_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_phone
  ON whatsapp_conversations (wa_phone);

CREATE TABLE IF NOT EXISTS agent_audit_log (
  audit_id BIGSERIAL PRIMARY KEY,
  patient_id UUID NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS appointment_reminder_workflows (
  reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  scheduled_start TIMESTAMPTZ NOT NULL,
  stage TEXT NOT NULL DEFAULT 'stage1_text',
  status TEXT NOT NULL DEFAULT 'pending_ack',
  last_sent_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_via TEXT,
  auto_call_at TIMESTAMPTZ,
  nurse_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_workflows_status_next
  ON appointment_reminder_workflows (status, next_action_at);

INSERT INTO next_visit_rules (program_code, service_type, interval_days, window_before_days, window_after_days, priority)
SELECT 'DEFAULT', 'follow_up', 28, 0, 3, 100
WHERE NOT EXISTS (
  SELECT 1 FROM next_visit_rules WHERE program_code = 'DEFAULT' AND service_type = 'follow_up'
);
