-- Digicap Monitoring System
-- Migration 000001: Unified Initial Schema
-- PostgreSQL 16+
-- Merged from Argus v2.x migrations 001-016

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS & RBAC
-- ============================================================

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(100) UNIQUE NOT NULL,
  email           VARCHAR(200) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL DEFAULT 'readonly',  -- admin / operator / readonly
  is_active       BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL NOT NULL,
  user_id     INT REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id   INT,
  detail      JSONB,
  ip_address  INET,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE organizations (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  parent_id     INT REFERENCES organizations(id) ON DELETE SET NULL,
  org_type      VARCHAR(20) NOT NULL DEFAULT 'team',  -- company / division / team
  manager_name  VARCHAR(100),
  contact       VARCHAR(200),
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ASSETS
-- ============================================================

CREATE TABLE assets (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  hostname            VARCHAR(100),
  ip_address          INET,
  type                VARCHAR(20) NOT NULL,  -- server / switch / router / firewall / fc_switch / storage
  os                  VARCHAR(50),
  os_version          VARCHAR(100),
  arch                VARCHAR(10),           -- amd64 / arm64
  location            VARCHAR(100),
  group_tag           VARCHAR(50),
  -- 제조사/모델
  manufacturer        VARCHAR(100),
  model               VARCHAR(100),
  serial_number       VARCHAR(100),
  -- BMC
  bmc_ip              INET,
  bmc_type            VARCHAR(20),           -- idrac / ilo / ipmi / xcc / irmc
  bmc_enabled         BOOLEAN NOT NULL DEFAULT false,
  -- 모니터링
  monitoring_enabled  BOOLEAN NOT NULL DEFAULT true,
  -- Agent
  agent_version       VARCHAR(30),
  agent_url           VARCHAR(200),          -- pull agent URL
  node_type           VARCHAR(20),           -- baremetal / vm / cloud
  -- 관리자/사용자
  manager             VARCHAR(100),
  user_name           VARCHAR(100),
  user_team           VARCHAR(100),
  -- 조직
  org_id              INT REFERENCES organizations(id) ON DELETE SET NULL,
  -- 등록 출처
  registration_source VARCHAR(20) DEFAULT 'manual',  -- manual / agent / discovery
  -- 상태
  status              VARCHAR(10) NOT NULL DEFAULT 'unknown',  -- online / offline / warning / unknown
  lifecycle_status    VARCHAR(20) DEFAULT 'active',  -- active / eol / decommissioned
  decommission_at     DATE,
  decommission_note   TEXT,
  last_seen           TIMESTAMPTZ,
  introduced_at       DATE,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_ip ON assets(ip_address);

-- ============================================================
-- MAINTENANCE CONTRACTS
-- ============================================================

CREATE TABLE maintenance_contracts (
  id              SERIAL PRIMARY KEY,
  asset_id        INT REFERENCES assets(id) ON DELETE CASCADE,
  has_contract    BOOLEAN NOT NULL DEFAULT false,
  contract_type   VARCHAR(20) NOT NULL DEFAULT 'maintenance',
  vendor          VARCHAR(100),
  contract_start  DATE,
  contract_end    DATE,
  contact_name    VARCHAR(100),
  contact_phone   VARCHAR(50),
  contact_email   VARCHAR(100),
  -- SW 라이선스
  software_name   VARCHAR(200),
  software_version VARCHAR(50),
  license_count   INT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_asset ON maintenance_contracts(asset_id);
CREATE INDEX idx_maintenance_end ON maintenance_contracts(contract_end);
CREATE INDEX idx_maintenance_active ON maintenance_contracts(asset_id, is_active);

-- SW 설치 내역
CREATE TABLE software_installations (
  id          SERIAL PRIMARY KEY,
  contract_id INT NOT NULL REFERENCES maintenance_contracts(id) ON DELETE CASCADE,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  installed_at TIMESTAMPTZ DEFAULT now(),
  notes       TEXT,
  UNIQUE(contract_id, asset_id)
);

CREATE INDEX idx_sw_inst_contract ON software_installations(contract_id);
CREATE INDEX idx_sw_inst_asset ON software_installations(asset_id);

-- ============================================================
-- BMC CREDENTIALS
-- ============================================================

CREATE TABLE bmc_credentials (
  id          SERIAL PRIMARY KEY,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
  username    VARCHAR(100) NOT NULL,
  password    TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- AGENT TOKENS
-- ============================================================

CREATE TABLE agent_tokens (
  id          SERIAL PRIMARY KEY,
  asset_id    INT REFERENCES assets(id) ON DELETE CASCADE,
  token       VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  label       VARCHAR(100),
  last_seen   TIMESTAMPTZ,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_tokens_token ON agent_tokens(token);
CREATE INDEX idx_agent_tokens_asset ON agent_tokens(asset_id);

-- Agent 버전 관리
CREATE TABLE agent_versions (
  id            SERIAL PRIMARY KEY,
  version       VARCHAR(20) NOT NULL,
  os            VARCHAR(10) NOT NULL,
  arch          VARCHAR(10) NOT NULL,
  file_path     VARCHAR(500),
  checksum      VARCHAR(64),
  release_notes TEXT,
  is_stable     BOOLEAN NOT NULL DEFAULT false,
  released_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- METRICS (시계열, 파티셔닝)
-- ============================================================

CREATE TABLE metrics (
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  collected_at    TIMESTAMPTZ NOT NULL,
  cpu_usage       FLOAT,
  mem_usage       FLOAT,
  mem_total_mb    BIGINT,
  mem_used_mb     BIGINT,
  disk_read_bps   BIGINT,
  disk_write_bps  BIGINT,
  disk_usage_pct  FLOAT,
  net_rx_bps      BIGINT,
  net_tx_bps      BIGINT,
  load_avg_1m     FLOAT,
  process_count   INT
) PARTITION BY RANGE (collected_at);

CREATE TABLE metrics_default PARTITION OF metrics DEFAULT;

CREATE INDEX idx_metrics_asset_time ON metrics(asset_id, collected_at DESC);

-- 5분 집계
CREATE TABLE metrics_5m (
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  bucket          TIMESTAMPTZ NOT NULL,
  cpu_avg         FLOAT,
  cpu_max         FLOAT,
  mem_avg         FLOAT,
  mem_max         FLOAT,
  disk_read_avg   BIGINT,
  disk_write_avg  BIGINT,
  net_rx_avg      BIGINT,
  net_tx_avg      BIGINT,
  sample_count    INT,
  PRIMARY KEY (asset_id, bucket)
);

-- 1시간 집계
CREATE TABLE metrics_1h (
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  bucket          TIMESTAMPTZ NOT NULL,
  cpu_avg         FLOAT,
  cpu_max         FLOAT,
  mem_avg         FLOAT,
  mem_max         FLOAT,
  disk_read_avg   BIGINT,
  disk_write_avg  BIGINT,
  net_rx_avg      BIGINT,
  net_tx_avg      BIGINT,
  sample_count    INT,
  PRIMARY KEY (asset_id, bucket)
);

-- 디스크 마운트포인트별 메트릭
CREATE TABLE disk_metrics (
  id           BIGSERIAL,
  asset_id     INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  mount_point  VARCHAR(255) NOT NULL,
  device       VARCHAR(100),
  filesystem   VARCHAR(50),
  total_gb     NUMERIC(10,2),
  used_gb      NUMERIC(10,2),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, collected_at)
) PARTITION BY RANGE (collected_at);

CREATE TABLE disk_metrics_default PARTITION OF disk_metrics DEFAULT;
CREATE INDEX idx_disk_metrics_asset_time ON disk_metrics(asset_id, collected_at DESC);

-- ============================================================
-- BMC MONITORING
-- ============================================================

CREATE TABLE bmc_metrics (
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  collected_at    TIMESTAMPTZ NOT NULL,
  power_watts     INT,
  psu1_status     VARCHAR(10),
  psu2_status     VARCHAR(10),
  cpu1_temp_c     SMALLINT,
  cpu2_temp_c     SMALLINT,
  inlet_temp_c    SMALLINT,
  outlet_temp_c   SMALLINT,
  fan_speeds      JSONB,
  overall_health  VARCHAR(10),
  PRIMARY KEY (asset_id, collected_at)
) PARTITION BY RANGE (collected_at);

CREATE TABLE bmc_metrics_default PARTITION OF bmc_metrics DEFAULT;

CREATE TABLE hw_inventory (
  id              SERIAL PRIMARY KEY,
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
  bios_version    VARCHAR(50),
  bmc_version     VARCHAR(50),
  cpu_model       VARCHAR(100),
  cpu_count       SMALLINT,
  cpu_cores       SMALLINT,
  mem_total_gb    INT,
  mem_slots       JSONB,
  disks           JSONB,
  nics            JSONB,
  collected_at    TIMESTAMPTZ
);

CREATE TABLE hw_health (
  id          SERIAL PRIMARY KEY,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  component   VARCHAR(50) NOT NULL,
  name        VARCHAR(100) NOT NULL,
  status      VARCHAR(10) NOT NULL,
  message     VARCHAR(200),
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hw_health_asset ON hw_health(asset_id, checked_at DESC);

CREATE TABLE bmc_sel (
  id          BIGSERIAL NOT NULL,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_id    VARCHAR(20),
  occurred_at TIMESTAMPTZ NOT NULL,
  severity    VARCHAR(10) NOT NULL,
  component   VARCHAR(50),
  message     TEXT,
  raw         JSONB,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE bmc_sel_default PARTITION OF bmc_sel DEFAULT;

-- ============================================================
-- DISK SMART
-- ============================================================

CREATE TABLE disk_smart (
  id              SERIAL PRIMARY KEY,
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  device          VARCHAR(50) NOT NULL,
  model           VARCHAR(100),
  serial          VARCHAR(100),
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  health_status   VARCHAR(10),
  temperature_c   SMALLINT,
  reallocated_sectors INT DEFAULT 0,
  pending_sectors INT DEFAULT 0,
  uncorrectable   INT DEFAULT 0,
  power_on_hours  INT,
  raw             JSONB
);

CREATE INDEX idx_disk_smart_asset ON disk_smart(asset_id, collected_at DESC);

-- ============================================================
-- LOGS
-- ============================================================

CREATE TABLE syslog_entries (
  id          BIGSERIAL NOT NULL,
  asset_id    INT REFERENCES assets(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity    SMALLINT,
  facility    SMALLINT,
  hostname    VARCHAR(100),
  program     VARCHAR(100),
  message     TEXT,
  raw         TEXT,
  event_type  VARCHAR(30),
  parsed_data JSONB,
  PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

CREATE TABLE syslog_entries_default PARTITION OF syslog_entries DEFAULT;
CREATE INDEX idx_syslog_asset_time ON syslog_entries(asset_id, received_at DESC);
CREATE INDEX idx_syslog_event_type ON syslog_entries(event_type);

CREATE TABLE server_logs (
  id            BIGSERIAL NOT NULL,
  asset_id      INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  collected_at  TIMESTAMPTZ NOT NULL,
  level         VARCHAR(10),
  source        VARCHAR(200),
  message       TEXT,
  PRIMARY KEY (id, collected_at)
) PARTITION BY RANGE (collected_at);

CREATE TABLE server_logs_default PARTITION OF server_logs DEFAULT;
CREATE INDEX idx_server_logs_asset_time ON server_logs(asset_id, collected_at DESC);

-- ============================================================
-- NETWORK
-- ============================================================

CREATE TABLE network_ports (
  id            SERIAL PRIMARY KEY,
  asset_id      INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  port_name     VARCHAR(50) NOT NULL,
  link_status   VARCHAR(10) NOT NULL DEFAULT 'unknown',
  speed_mbps    INT,
  if_index      SMALLINT,
  duplex        VARCHAR(10),
  vlan_id       SMALLINT,
  description   VARCHAR(200),
  last_changed  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, port_name)
);

CREATE INDEX idx_network_ports_asset ON network_ports(asset_id);

CREATE TABLE network_port_history (
  id          BIGSERIAL,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  port_name   VARCHAR(50) NOT NULL,
  status      VARCHAR(10) NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (changed_at);

CREATE TABLE network_port_history_default PARTITION OF network_port_history DEFAULT;

-- ============================================================
-- TOPOLOGY
-- ============================================================

CREATE TABLE mac_addresses (
  id          SERIAL PRIMARY KEY,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  mac         MACADDR NOT NULL,
  interface   VARCHAR(50),
  ip_address  INET,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, mac)
);

CREATE TABLE wwn_entries (
  id          SERIAL PRIMARY KEY,
  asset_id    INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  wwn         VARCHAR(23) NOT NULL,
  wwn_type    VARCHAR(10) NOT NULL,
  port_name   VARCHAR(50),
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, wwn)
);

CREATE TABLE topology_nodes (
  id          SERIAL PRIMARY KEY,
  asset_id    INT REFERENCES assets(id) ON DELETE CASCADE,
  layer       VARCHAR(10) NOT NULL,
  node_type   VARCHAR(20) NOT NULL,
  label       VARCHAR(100) NOT NULL,
  pos_x       FLOAT DEFAULT 0,
  pos_y       FLOAT DEFAULT 0,
  meta        JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_topology_nodes_layer ON topology_nodes(layer);
CREATE INDEX idx_topology_nodes_asset ON topology_nodes(asset_id);

CREATE TABLE topology_edges (
  id            SERIAL PRIMARY KEY,
  layer         VARCHAR(10) NOT NULL,
  source_node   INT NOT NULL REFERENCES topology_nodes(id) ON DELETE CASCADE,
  target_node   INT NOT NULL REFERENCES topology_nodes(id) ON DELETE CASCADE,
  source_port   VARCHAR(50),
  target_port   VARCHAR(50),
  link_type     VARCHAR(20),
  method        VARCHAR(20),
  confidence    SMALLINT DEFAULT 100,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_topology_edges_layer ON topology_edges(layer);
CREATE INDEX idx_topology_edges_source ON topology_edges(source_node);
CREATE INDEX idx_topology_edges_target ON topology_edges(target_node);

-- 네트워크 장비 MAC 테이블 (CAM/FDB)
CREATE TABLE device_mac_table (
  id         SERIAL PRIMARY KEY,
  asset_id   INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  mac        MACADDR NOT NULL,
  port_name  VARCHAR(50),
  vlan_id    SMALLINT,
  entry_type VARCHAR(10) DEFAULT 'dynamic',
  source     VARCHAR(20) DEFAULT 'manual',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (asset_id, mac, port_name)
);

CREATE INDEX idx_dev_mac_asset ON device_mac_table(asset_id);
CREATE INDEX idx_dev_mac_mac ON device_mac_table(mac);

-- 디스커버리 실행 로그
CREATE TABLE discovery_logs (
  id             SERIAL PRIMARY KEY,
  discovery_type VARCHAR(20) NOT NULL,
  status         VARCHAR(20) DEFAULT 'running',
  nodes_created  INT DEFAULT 0,
  edges_created  INT DEFAULT 0,
  edges_updated  INT DEFAULT 0,
  detail         JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- STORAGE
-- ============================================================

CREATE TABLE storage_volumes (
  id           SERIAL PRIMARY KEY,
  asset_id     INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  volume_name  VARCHAR(100) NOT NULL,
  total_gb     NUMERIC(10,2),
  used_gb      NUMERIC(10,2),
  filesystem   VARCHAR(50),
  raid_level   VARCHAR(20),
  status       VARCHAR(20) NOT NULL DEFAULT 'ok',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_storage_volumes_asset ON storage_volumes(asset_id);

CREATE TABLE storage_connections (
  id               SERIAL PRIMARY KEY,
  storage_asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  server_asset_id  INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  connection_type  VARCHAR(20) NOT NULL DEFAULT 'nfs',
  mount_point      VARCHAR(255),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(storage_asset_id, server_asset_id)
);

CREATE INDEX idx_storage_conn_storage ON storage_connections(storage_asset_id);
CREATE INDEX idx_storage_conn_server ON storage_connections(server_asset_id);

CREATE TABLE storage_volume_history (
  id          SERIAL PRIMARY KEY,
  asset_id    INT REFERENCES assets(id) ON DELETE CASCADE,
  volume_name VARCHAR(100) NOT NULL,
  total_gb    NUMERIC(10,2),
  used_gb     NUMERIC(10,2),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_svh_asset_time ON storage_volume_history(asset_id, recorded_at DESC);

-- ============================================================
-- VIRTUALIZATION
-- ============================================================

CREATE TABLE virtual_hosts (
  id            SERIAL PRIMARY KEY,
  asset_id      INT REFERENCES assets(id) ON DELETE CASCADE,
  platform      VARCHAR(20) NOT NULL DEFAULT 'vmware',
  hostname      VARCHAR(100),
  ip_address    INET,
  version       VARCHAR(50),
  cpu_total     SMALLINT,
  mem_total_gb  NUMERIC(8,2),
  vm_count      INT NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'online',
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_virtual_hosts_asset ON virtual_hosts(asset_id);

CREATE TABLE virtual_machines (
  id              SERIAL PRIMARY KEY,
  host_id         INT NOT NULL REFERENCES virtual_hosts(id) ON DELETE CASCADE,
  asset_id        INT REFERENCES assets(id),
  vm_name         VARCHAR(100) NOT NULL,
  vm_uuid         VARCHAR(64) UNIQUE,
  guest_os        VARCHAR(100),
  cpu_count       SMALLINT,
  mem_mb          INT,
  disk_gb         NUMERIC(10,2),
  power_state     VARCHAR(20) NOT NULL DEFAULT 'unknown',
  ip_address      INET,
  tools_status    VARCHAR(30),
  cpu_usage_pct   FLOAT,
  mem_usage_pct   FLOAT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vms_host ON virtual_machines(host_id);
CREATE INDEX idx_vms_uuid ON virtual_machines(vm_uuid);
CREATE INDEX idx_vms_asset ON virtual_machines(asset_id);
CREATE INDEX idx_vms_state ON virtual_machines(power_state);

-- ============================================================
-- SERVICE CHECKS
-- ============================================================

CREATE TABLE service_checks (
  id              SERIAL PRIMARY KEY,
  asset_id        INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(10) NOT NULL,
  target          VARCHAR(200) NOT NULL,
  interval_s      INT NOT NULL DEFAULT 60,
  timeout_s       INT NOT NULL DEFAULT 5,
  expected_code   SMALLINT,
  expected_body   VARCHAR(200),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_check_results (
  check_id      INT NOT NULL REFERENCES service_checks(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL,
  status        VARCHAR(10) NOT NULL,
  response_ms   INT,
  message       VARCHAR(500),
  PRIMARY KEY (check_id, checked_at)
) PARTITION BY RANGE (checked_at);

CREATE TABLE service_check_results_default PARTITION OF service_check_results DEFAULT;

-- ============================================================
-- SSL CERTIFICATES & DOMAINS
-- ============================================================

CREATE TABLE ssl_certificates (
  id            SERIAL PRIMARY KEY,
  asset_id      INT REFERENCES assets(id) ON DELETE SET NULL,
  hostname      VARCHAR(200) NOT NULL,
  port          SMALLINT NOT NULL DEFAULT 443,
  subject       VARCHAR(200),
  issuer        VARCHAR(200),
  not_before    TIMESTAMPTZ,
  not_after     TIMESTAMPTZ,
  last_checked  TIMESTAMPTZ,
  status        VARCHAR(10),
  warn_days     INT NOT NULL DEFAULT 30
);

CREATE TABLE ssl_domains (
  id              SERIAL PRIMARY KEY,
  domain          VARCHAR(200) NOT NULL,
  domain_type     VARCHAR(20) NOT NULL DEFAULT 'ssl',
  issuer          VARCHAR(200),
  issued_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  auto_renew      BOOLEAN NOT NULL DEFAULT false,
  contact_name    VARCHAR(100),
  contact_email   VARCHAR(200),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ssl_domains_expires ON ssl_domains(expires_at);

-- ============================================================
-- ASSET CHANGES & IPAM
-- ============================================================

CREATE TABLE asset_changes (
  id              SERIAL PRIMARY KEY,
  asset_id        INT REFERENCES assets(id) ON DELETE SET NULL,
  asset_name      VARCHAR(100),
  field_name      VARCHAR(100) NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  changed_by      VARCHAR(100),
  note            TEXT,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_asset_changes_asset ON asset_changes(asset_id, changed_at DESC);

CREATE TABLE config_changes (
  id            BIGSERIAL PRIMARY KEY,
  asset_id      INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_type   VARCHAR(50),
  summary       VARCHAR(500),
  raw_log       TEXT,
  source        VARCHAR(20)
);

CREATE INDEX idx_config_changes_asset ON config_changes(asset_id, detected_at DESC);

-- IP 서브넷 관리
CREATE TABLE ip_subnets (
  id              SERIAL PRIMARY KEY,
  subnet          CIDR NOT NULL,
  name            VARCHAR(100),
  vlan            SMALLINT,
  location        VARCHAR(100),
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ip_allocations (
  id              SERIAL PRIMARY KEY,
  subnet_id       INT REFERENCES ip_subnets(id) ON DELETE CASCADE,
  ip_address      INET NOT NULL UNIQUE,
  asset_id        INT REFERENCES assets(id) ON DELETE SET NULL,
  hostname        VARCHAR(100),
  purpose         VARCHAR(200),
  status          VARCHAR(20) NOT NULL DEFAULT 'used',
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ip_alloc_subnet ON ip_allocations(subnet_id);

-- ============================================================
-- RACKS
-- ============================================================

CREATE TABLE racks (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  location        VARCHAR(100),
  row_no          VARCHAR(20),
  total_u         INT NOT NULL DEFAULT 42,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rack_units (
  id              SERIAL PRIMARY KEY,
  rack_id         INT NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  asset_id        INT REFERENCES assets(id) ON DELETE SET NULL,
  start_u         INT NOT NULL,
  size_u          INT NOT NULL DEFAULT 1,
  label           VARCHAR(100) NOT NULL,
  unit_type       VARCHAR(20) NOT NULL DEFAULT 'server',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rack_units_rack ON rack_units(rack_id);
CREATE INDEX idx_rack_units_asset ON rack_units(asset_id);

-- ============================================================
-- ALERTS
-- ============================================================

CREATE TABLE alert_rules (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL,
  asset_id            INT REFERENCES assets(id) ON DELETE CASCADE,
  group_tag           VARCHAR(50),
  asset_type_filter   VARCHAR(20),
  metric              VARCHAR(50) NOT NULL,
  operator            VARCHAR(5) NOT NULL,
  threshold           FLOAT NOT NULL,
  duration_s          INT NOT NULL DEFAULT 60,
  severity            VARCHAR(10) NOT NULL DEFAULT 'warning',
  notify_channels     TEXT[] NOT NULL DEFAULT '{slack}',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id            BIGSERIAL PRIMARY KEY,
  rule_id       INT REFERENCES alert_rules(id),
  asset_id      INT REFERENCES assets(id) ON DELETE SET NULL,
  severity      VARCHAR(10) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  message       TEXT,
  source        VARCHAR(20) NOT NULL DEFAULT 'threshold',
  status        VARCHAR(10) NOT NULL DEFAULT 'active',
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  acked_at      TIMESTAMPTZ,
  acked_by      INT REFERENCES users(id)
);

CREATE INDEX idx_alerts_status ON alerts(status, fired_at DESC);
CREATE INDEX idx_alerts_asset ON alerts(asset_id, fired_at DESC);

CREATE TABLE alert_notifications (
  id          BIGSERIAL PRIMARY KEY,
  alert_id    BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel     VARCHAR(10) NOT NULL,
  recipient   VARCHAR(200),
  status      VARCHAR(10) NOT NULL DEFAULT 'pending',
  sent_at     TIMESTAMPTZ,
  error       TEXT
);

-- ============================================================
-- ESCALATION
-- ============================================================

CREATE TABLE escalation_policies (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  asset_id    INT REFERENCES assets(id) ON DELETE CASCADE,
  group_tag   VARCHAR(50),
  steps       JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INCIDENTS
-- ============================================================

CREATE TABLE incidents (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  severity      VARCHAR(10) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'open',
  asset_ids     INT[] DEFAULT '{}',
  alert_ids     BIGINT[] DEFAULT '{}',
  assigned_to   INT REFERENCES users(id),
  root_cause    TEXT,
  resolution    TEXT,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_incidents_status ON incidents(status, opened_at DESC);

CREATE TABLE incident_timeline (
  id            SERIAL PRIMARY KEY,
  incident_id   INT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id       INT REFERENCES users(id),
  event_type    VARCHAR(30) NOT NULL,
  content       TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- LLM PROVIDERS
-- ============================================================

CREATE TABLE llm_providers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  provider_type   VARCHAR(30) NOT NULL,
  model           VARCHAR(100) NOT NULL,
  endpoint_url    VARCHAR(500),
  api_key         TEXT,
  extra_config    JSONB DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_feature_assignments (
  feature         VARCHAR(50) PRIMARY KEY,
  provider_id     INT REFERENCES llm_providers(id),
  fallback_id     INT REFERENCES llm_providers(id)
);

CREATE TABLE llm_call_logs (
  id                BIGSERIAL,
  provider_id       INT REFERENCES llm_providers(id),
  feature           VARCHAR(50),
  model             VARCHAR(100),
  prompt_tokens     INT,
  completion_tokens INT,
  duration_ms       INT,
  status            VARCHAR(10) NOT NULL,
  error_message     TEXT,
  called_at         TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (called_at);

CREATE TABLE llm_call_logs_default PARTITION OF llm_call_logs DEFAULT;

CREATE TABLE llm_predictions (
  id           SERIAL PRIMARY KEY,
  asset_id     INT REFERENCES assets(id) ON DELETE CASCADE,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issue_type   VARCHAR(50),
  severity     VARCHAR(20),
  confidence   FLOAT,
  summary      TEXT,
  raw_response TEXT,
  alert_sent   BOOLEAN DEFAULT false
);

CREATE INDEX idx_llm_predictions_asset ON llm_predictions(asset_id, predicted_at DESC);

-- ============================================================
-- SYSLOG PARSE PATTERNS
-- ============================================================

CREATE TABLE syslog_parse_patterns (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  vendor      VARCHAR(50),
  event_type  VARCHAR(30) NOT NULL,
  pattern     TEXT NOT NULL,
  wwn_group   INT,
  mac_group   INT,
  port_group  INT,
  priority    INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO syslog_parse_patterns (name, vendor, event_type, pattern, wwn_group, port_group, priority) VALUES
  ('Brocade FLOGI', 'Brocade', 'FC_LOGIN', 'FLOGI.*?([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})', 1, NULL, 10),
  ('Cisco MDS FLOGI', 'Cisco', 'FC_LOGIN', 'pwwn\s+([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})', 1, NULL, 10),
  ('Generic WWN', 'generic', 'FC_LOGIN', '([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})', 1, NULL, 100),
  ('Cisco LLDP', 'Cisco', 'LLDP_NEIGHBOR', '%LLDP.*?neighbor.*?([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}).*?([A-Za-z0-9/.-]+)', 1, 2, 10),
  ('Juniper LLDP', 'Juniper', 'LLDP_NEIGHBOR', 'LLDP_NEIGHBOR.*?([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}).*?([a-z0-9/.-]+)', 1, 2, 10),
  ('Cisco Port Down', 'Cisco', 'PORT_STATUS', 'Interface\s+([A-Za-z0-9/.-]+),\s+changed state to down', NULL, 1, 10),
  ('Cisco Port Up', 'Cisco', 'PORT_STATUS', 'Interface\s+([A-Za-z0-9/.-]+),\s+changed state to up', NULL, 1, 10),
  ('Generic Port Down', 'generic', 'PORT_STATUS', '(linkdown|link down|link-down).*?([A-Za-z0-9/.-]+)', NULL, 2, 100),
  ('Generic Config Change', 'generic', 'CONFIG_CHANGE', '(config|configuration).{0,30}(changed|modified|saved|committed)', NULL, NULL, 100);

-- ============================================================
-- REPORTS
-- ============================================================

CREATE TABLE report_definitions (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(20) NOT NULL,
  schedule      VARCHAR(20),
  asset_ids     INT[] DEFAULT '{}',
  format        VARCHAR(10) NOT NULL DEFAULT 'pdf',
  recipients    TEXT[] DEFAULT '{}',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_history (
  id            SERIAL PRIMARY KEY,
  def_id        INT NOT NULL REFERENCES report_definitions(id) ON DELETE CASCADE,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start  TIMESTAMPTZ,
  period_end    TIMESTAMPTZ,
  file_path     VARCHAR(500),
  status        VARCHAR(10) NOT NULL
);

-- ============================================================
-- CUSTOM DASHBOARDS
-- ============================================================

CREATE TABLE custom_dashboards (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  layout      JSONB NOT NULL DEFAULT '[]',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SYSTEM SETTINGS
-- ============================================================

CREATE TABLE system_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT,
  description VARCHAR(300),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value, description) VALUES
  ('slack_webhook_url',   '',    'Slack Incoming Webhook URL'),
  ('smtp_host',           '',    'SMTP 서버 호스트'),
  ('smtp_port',           '587', 'SMTP 포트'),
  ('smtp_user',           '',    'SMTP 사용자'),
  ('smtp_password',       '',    'SMTP 비밀번호'),
  ('smtp_from',           '',    '발신 이메일'),
  ('alert_cooldown_s',    '300', '동일 알림 재발송 대기 시간(초)'),
  ('metrics_raw_days',    '7',   'Raw 메트릭 보관 일수'),
  ('metrics_5m_days',     '90',  '5분 집계 보관 일수'),
  ('metrics_1h_days',     '365', '1시간 집계 보관 일수'),
  ('syslog_port',         '514', 'Syslog 수신 포트'),
  ('agent_check_interval','5',   'Agent offline 판단 간격(분)'),
  ('bmc_collect_interval','5',   'BMC 수집 주기(분)'),
  ('ssl_check_interval',  '24',  'SSL 체크 주기(시간)'),
  ('llm_enabled',         'false', 'LLM 활성화 여부'),
  ('llm_provider',        'ollama', 'LLM 프로바이더'),
  ('llm_api_url',         'http://localhost:11434', 'LLM API URL'),
  ('llm_api_key',         '',    'LLM API Key'),
  ('llm_model',           'llama3.2', 'LLM 모델'),
  ('llm_predict_enabled', 'false', '예측 알림 활성 여부'),
  ('llm_predict_interval','5',   '예측 주기(분)');

-- ============================================================
-- LLM FEATURE ASSIGNMENTS
-- ============================================================

INSERT INTO llm_feature_assignments (feature) VALUES
  ('anomaly_detection'),
  ('log_summary'),
  ('chat'),
  ('root_cause'),
  ('trend'),
  ('alert_message');

-- ============================================================
-- DEFAULT ADMIN USER
-- ============================================================

INSERT INTO users (username, email, password_hash, role)
VALUES ('admin', 'admin@digicap.local',
        crypt('digicap1234!', gen_salt('bf')), 'admin');
