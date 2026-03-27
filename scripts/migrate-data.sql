-- ============================================================
-- Argus → Digicap 데이터 마이그레이션 (SQL 버전)
--
-- 사전 조건:
--   1. Digicap DB에 스키마가 생성되어 있어야 함 (Go 서버 실행 시 자동)
--   2. dblink 확장이 필요함
--
-- 사용법:
--   psql -h localhost -U digicap -d digicap -f scripts/migrate-data.sql
--
-- 또는 변수 설정 후 실행:
--   psql -d digicap -v src_connstr="'host=localhost dbname=argus user=argus'" -f scripts/migrate-data.sql
-- ============================================================

-- dblink 확장 설치
CREATE EXTENSION IF NOT EXISTS dblink;

-- 소스 DB 연결 문자열 (필요시 수정)
-- \set src_connstr 'host=localhost port=5432 dbname=argus user=argus'
DO $$
DECLARE
  src TEXT := 'host=localhost port=5432 dbname=argus user=argus';
  tbl TEXT;
  cnt BIGINT;
  total_rows BIGINT := 0;
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  Argus → Digicap 데이터 마이그레이션 시작';
  RAISE NOTICE '============================================================';

  -- ── 연결 테스트 ──
  PERFORM dblink_connect('argus_conn', src);
  RAISE NOTICE '소스 DB 연결 성공: %', src;

  -- ============================================================
  -- 1. 대상 테이블 정리 (역순)
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '[1/4] 대상 DB 기존 데이터 정리...';

  -- FK 비활성화 후 TRUNCATE
  SET session_replication_role = 'replica';

  TRUNCATE alert_notifications CASCADE;
  TRUNCATE report_history CASCADE;
  TRUNCATE incident_timeline CASCADE;
  TRUNCATE llm_feature_assignments CASCADE;
  TRUNCATE alerts CASCADE;
  TRUNCATE rack_units CASCADE;
  TRUNCATE ip_allocations CASCADE;
  TRUNCATE service_check_results CASCADE;
  TRUNCATE virtual_machines CASCADE;
  TRUNCATE topology_edges CASCADE;
  TRUNCATE software_installations CASCADE;
  TRUNCATE device_mac_table CASCADE;
  TRUNCATE discovery_logs CASCADE;
  TRUNCATE report_definitions CASCADE;
  TRUNCATE custom_dashboards CASCADE;
  TRUNCATE llm_predictions CASCADE;
  TRUNCATE llm_call_logs CASCADE;
  TRUNCATE llm_providers CASCADE;
  TRUNCATE incidents CASCADE;
  TRUNCATE escalation_policies CASCADE;
  TRUNCATE alert_rules CASCADE;
  TRUNCATE racks CASCADE;
  TRUNCATE ip_subnets CASCADE;
  TRUNCATE config_changes CASCADE;
  TRUNCATE asset_changes CASCADE;
  TRUNCATE ssl_domains CASCADE;
  TRUNCATE ssl_certificates CASCADE;
  TRUNCATE service_checks CASCADE;
  TRUNCATE virtual_hosts CASCADE;
  TRUNCATE storage_volume_history CASCADE;
  TRUNCATE storage_connections CASCADE;
  TRUNCATE storage_volumes CASCADE;
  TRUNCATE disk_smart CASCADE;
  TRUNCATE hw_health CASCADE;
  TRUNCATE hw_inventory CASCADE;
  TRUNCATE topology_nodes CASCADE;
  TRUNCATE wwn_entries CASCADE;
  TRUNCATE mac_addresses CASCADE;
  TRUNCATE network_port_history CASCADE;
  TRUNCATE network_ports CASCADE;
  TRUNCATE agent_versions CASCADE;
  TRUNCATE agent_tokens CASCADE;
  TRUNCATE bmc_sel CASCADE;
  TRUNCATE bmc_metrics CASCADE;
  TRUNCATE bmc_credentials CASCADE;
  TRUNCATE server_logs CASCADE;
  TRUNCATE syslog_entries CASCADE;
  TRUNCATE disk_metrics CASCADE;
  TRUNCATE metrics_1h CASCADE;
  TRUNCATE metrics_5m CASCADE;
  TRUNCATE metrics CASCADE;
  TRUNCATE maintenance_contracts CASCADE;
  TRUNCATE syslog_parse_patterns CASCADE;
  TRUNCATE audit_logs CASCADE;
  TRUNCATE assets CASCADE;
  TRUNCATE organizations CASCADE;
  TRUNCATE system_settings CASCADE;
  TRUNCATE users CASCADE;

  SET session_replication_role = 'origin';
  RAISE NOTICE '  정리 완료';

  -- ============================================================
  -- 2. 데이터 복사 (FK 의존성 순서)
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '[2/4] 데이터 복사 중...';

  -- FK 체크 임시 비활성화
  SET session_replication_role = 'replica';

  -- ── users ──
  INSERT INTO users SELECT * FROM dblink('argus_conn',
    'SELECT id, username, email, password_hash, role, is_active, failed_attempts, locked_until, last_login, created_at FROM users'
  ) AS t(id INT, username VARCHAR, email VARCHAR, password_hash TEXT, role VARCHAR, is_active BOOLEAN, failed_attempts INT, locked_until TIMESTAMPTZ, last_login TIMESTAMPTZ, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  users: % rows', cnt; total_rows := total_rows + cnt;

  -- ── organizations ──
  INSERT INTO organizations SELECT * FROM dblink('argus_conn',
    'SELECT id, name, parent_id, org_type, manager_name, contact, sort_order, is_active, created_at FROM organizations'
  ) AS t(id INT, name VARCHAR, parent_id INT, org_type VARCHAR, manager_name VARCHAR, contact VARCHAR, sort_order INT, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  organizations: % rows', cnt; total_rows := total_rows + cnt;

  -- ── system_settings ──
  INSERT INTO system_settings SELECT * FROM dblink('argus_conn',
    'SELECT key, value, description, updated_at FROM system_settings'
  ) AS t(key VARCHAR, value TEXT, description VARCHAR, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  system_settings: % rows', cnt; total_rows := total_rows + cnt;

  -- ── syslog_parse_patterns ──
  INSERT INTO syslog_parse_patterns SELECT * FROM dblink('argus_conn',
    'SELECT id, name, vendor, event_type, pattern, wwn_group, mac_group, port_group, priority, is_active FROM syslog_parse_patterns'
  ) AS t(id INT, name VARCHAR, vendor VARCHAR, event_type VARCHAR, pattern TEXT, wwn_group INT, mac_group INT, port_group INT, priority INT, is_active BOOLEAN);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  syslog_parse_patterns: % rows', cnt; total_rows := total_rows + cnt;

  -- ── assets ──
  INSERT INTO assets SELECT * FROM dblink('argus_conn',
    'SELECT id, name, hostname, ip_address, type, os, os_version, arch, location, group_tag,
            manufacturer, model, serial_number, bmc_ip, bmc_type, bmc_enabled, monitoring_enabled,
            agent_version, agent_url, node_type, manager, user_name, user_team, org_id,
            registration_source, status, lifecycle_status, decommission_at, decommission_note,
            last_seen, introduced_at, is_active, created_at, updated_at
     FROM assets'
  ) AS t(id INT, name VARCHAR, hostname VARCHAR, ip_address INET, type VARCHAR, os VARCHAR, os_version VARCHAR, arch VARCHAR,
         location VARCHAR, group_tag VARCHAR, manufacturer VARCHAR, model VARCHAR, serial_number VARCHAR,
         bmc_ip INET, bmc_type VARCHAR, bmc_enabled BOOLEAN, monitoring_enabled BOOLEAN,
         agent_version VARCHAR, agent_url VARCHAR, node_type VARCHAR, manager VARCHAR, user_name VARCHAR,
         user_team VARCHAR, org_id INT, registration_source VARCHAR, status VARCHAR, lifecycle_status VARCHAR,
         decommission_at DATE, decommission_note TEXT, last_seen TIMESTAMPTZ, introduced_at DATE,
         is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  assets: % rows', cnt; total_rows := total_rows + cnt;

  -- ── audit_logs ──
  INSERT INTO audit_logs SELECT * FROM dblink('argus_conn',
    'SELECT id, user_id, action, target_type, target_id, detail, ip_address, occurred_at FROM audit_logs'
  ) AS t(id BIGINT, user_id INT, action VARCHAR, target_type VARCHAR, target_id INT, detail JSONB, ip_address INET, occurred_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  audit_logs: % rows', cnt; total_rows := total_rows + cnt;

  -- ── maintenance_contracts ──
  INSERT INTO maintenance_contracts SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, has_contract, contract_type, vendor, contract_start, contract_end,
            contact_name, contact_phone, contact_email, software_name, software_version,
            license_count, notes, is_active, updated_at
     FROM maintenance_contracts'
  ) AS t(id INT, asset_id INT, has_contract BOOLEAN, contract_type VARCHAR, vendor VARCHAR,
         contract_start DATE, contract_end DATE, contact_name VARCHAR, contact_phone VARCHAR,
         contact_email VARCHAR, software_name VARCHAR, software_version VARCHAR, license_count INT,
         notes TEXT, is_active BOOLEAN, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  maintenance_contracts: % rows', cnt; total_rows := total_rows + cnt;

  -- ── software_installations ──
  INSERT INTO software_installations SELECT * FROM dblink('argus_conn',
    'SELECT id, contract_id, asset_id, installed_at, notes FROM software_installations'
  ) AS t(id INT, contract_id INT, asset_id INT, installed_at TIMESTAMPTZ, notes TEXT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  software_installations: % rows', cnt; total_rows := total_rows + cnt;

  -- ── bmc_credentials ──
  INSERT INTO bmc_credentials SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, username, password, updated_at FROM bmc_credentials'
  ) AS t(id INT, asset_id INT, username VARCHAR, password TEXT, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  bmc_credentials: % rows', cnt; total_rows := total_rows + cnt;

  -- ── agent_tokens ──
  INSERT INTO agent_tokens SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, token, label, last_seen, revoked, created_at FROM agent_tokens'
  ) AS t(id INT, asset_id INT, token VARCHAR, label VARCHAR, last_seen TIMESTAMPTZ, revoked BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  agent_tokens: % rows', cnt; total_rows := total_rows + cnt;

  -- ── agent_versions ──
  INSERT INTO agent_versions SELECT * FROM dblink('argus_conn',
    'SELECT id, version, os, arch, file_path, checksum, release_notes, is_stable, released_at FROM agent_versions'
  ) AS t(id INT, version VARCHAR, os VARCHAR, arch VARCHAR, file_path VARCHAR, checksum VARCHAR, release_notes TEXT, is_stable BOOLEAN, released_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  agent_versions: % rows', cnt; total_rows := total_rows + cnt;

  -- ── metrics (대용량 — 배치 처리) ──
  INSERT INTO metrics SELECT * FROM dblink('argus_conn',
    'SELECT asset_id, collected_at, cpu_usage, mem_usage, mem_total_mb, mem_used_mb,
            disk_read_bps, disk_write_bps, disk_usage_pct, net_rx_bps, net_tx_bps,
            load_avg_1m, process_count
     FROM metrics'
  ) AS t(asset_id INT, collected_at TIMESTAMPTZ, cpu_usage FLOAT, mem_usage FLOAT, mem_total_mb BIGINT, mem_used_mb BIGINT,
         disk_read_bps BIGINT, disk_write_bps BIGINT, disk_usage_pct FLOAT, net_rx_bps BIGINT, net_tx_bps BIGINT,
         load_avg_1m FLOAT, process_count INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  metrics: % rows', cnt; total_rows := total_rows + cnt;

  -- ── metrics_5m ──
  INSERT INTO metrics_5m SELECT * FROM dblink('argus_conn',
    'SELECT asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
            disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count
     FROM metrics_5m'
  ) AS t(asset_id INT, bucket TIMESTAMPTZ, cpu_avg FLOAT, cpu_max FLOAT, mem_avg FLOAT, mem_max FLOAT,
         disk_read_avg BIGINT, disk_write_avg BIGINT, net_rx_avg BIGINT, net_tx_avg BIGINT, sample_count INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  metrics_5m: % rows', cnt; total_rows := total_rows + cnt;

  -- ── metrics_1h ──
  INSERT INTO metrics_1h SELECT * FROM dblink('argus_conn',
    'SELECT asset_id, bucket, cpu_avg, cpu_max, mem_avg, mem_max,
            disk_read_avg, disk_write_avg, net_rx_avg, net_tx_avg, sample_count
     FROM metrics_1h'
  ) AS t(asset_id INT, bucket TIMESTAMPTZ, cpu_avg FLOAT, cpu_max FLOAT, mem_avg FLOAT, mem_max FLOAT,
         disk_read_avg BIGINT, disk_write_avg BIGINT, net_rx_avg BIGINT, net_tx_avg BIGINT, sample_count INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  metrics_1h: % rows', cnt; total_rows := total_rows + cnt;

  -- ── disk_metrics ──
  INSERT INTO disk_metrics SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, mount_point, device, filesystem, total_gb, used_gb, collected_at FROM disk_metrics'
  ) AS t(id BIGINT, asset_id INT, mount_point VARCHAR, device VARCHAR, filesystem VARCHAR, total_gb NUMERIC, used_gb NUMERIC, collected_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  disk_metrics: % rows', cnt; total_rows := total_rows + cnt;

  -- ── bmc_metrics ──
  INSERT INTO bmc_metrics SELECT * FROM dblink('argus_conn',
    'SELECT asset_id, collected_at, power_watts, psu1_status, psu2_status,
            cpu1_temp_c, cpu2_temp_c, inlet_temp_c, outlet_temp_c, fan_speeds, overall_health
     FROM bmc_metrics'
  ) AS t(asset_id INT, collected_at TIMESTAMPTZ, power_watts INT, psu1_status VARCHAR, psu2_status VARCHAR,
         cpu1_temp_c SMALLINT, cpu2_temp_c SMALLINT, inlet_temp_c SMALLINT, outlet_temp_c SMALLINT,
         fan_speeds JSONB, overall_health VARCHAR);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  bmc_metrics: % rows', cnt; total_rows := total_rows + cnt;

  -- ── hw_inventory ──
  INSERT INTO hw_inventory SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, bios_version, bmc_version, cpu_model, cpu_count, cpu_cores,
            mem_total_gb, mem_slots, disks, nics, collected_at
     FROM hw_inventory'
  ) AS t(id INT, asset_id INT, bios_version VARCHAR, bmc_version VARCHAR, cpu_model VARCHAR,
         cpu_count SMALLINT, cpu_cores SMALLINT, mem_total_gb INT, mem_slots JSONB, disks JSONB,
         nics JSONB, collected_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  hw_inventory: % rows', cnt; total_rows := total_rows + cnt;

  -- ── hw_health ──
  INSERT INTO hw_health SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, component, name, status, message, checked_at FROM hw_health'
  ) AS t(id INT, asset_id INT, component VARCHAR, name VARCHAR, status VARCHAR, message VARCHAR, checked_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  hw_health: % rows', cnt; total_rows := total_rows + cnt;

  -- ── bmc_sel ──
  INSERT INTO bmc_sel SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, event_id, occurred_at, severity, component, message, raw FROM bmc_sel'
  ) AS t(id BIGINT, asset_id INT, event_id VARCHAR, occurred_at TIMESTAMPTZ, severity VARCHAR, component VARCHAR, message TEXT, raw JSONB);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  bmc_sel: % rows', cnt; total_rows := total_rows + cnt;

  -- ── disk_smart ──
  INSERT INTO disk_smart SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, device, model, serial, collected_at, health_status,
            temperature_c, reallocated_sectors, pending_sectors, uncorrectable, power_on_hours, raw
     FROM disk_smart'
  ) AS t(id INT, asset_id INT, device VARCHAR, model VARCHAR, serial VARCHAR, collected_at TIMESTAMPTZ,
         health_status VARCHAR, temperature_c SMALLINT, reallocated_sectors INT, pending_sectors INT,
         uncorrectable INT, power_on_hours INT, raw JSONB);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  disk_smart: % rows', cnt; total_rows := total_rows + cnt;

  -- ── syslog_entries ──
  INSERT INTO syslog_entries SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, received_at, severity, facility, hostname, program, message, raw, event_type, parsed_data
     FROM syslog_entries'
  ) AS t(id BIGINT, asset_id INT, received_at TIMESTAMPTZ, severity SMALLINT, facility SMALLINT,
         hostname VARCHAR, program VARCHAR, message TEXT, raw TEXT, event_type VARCHAR, parsed_data JSONB);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  syslog_entries: % rows', cnt; total_rows := total_rows + cnt;

  -- ── server_logs ──
  INSERT INTO server_logs SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, collected_at, level, source, message FROM server_logs'
  ) AS t(id BIGINT, asset_id INT, collected_at TIMESTAMPTZ, level VARCHAR, source VARCHAR, message TEXT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  server_logs: % rows', cnt; total_rows := total_rows + cnt;

  -- ── network_ports ──
  INSERT INTO network_ports SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, port_name, link_status, speed_mbps, if_index, duplex, vlan_id, description, last_changed, updated_at
     FROM network_ports'
  ) AS t(id INT, asset_id INT, port_name VARCHAR, link_status VARCHAR, speed_mbps INT, if_index SMALLINT,
         duplex VARCHAR, vlan_id SMALLINT, description VARCHAR, last_changed TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  network_ports: % rows', cnt; total_rows := total_rows + cnt;

  -- ── network_port_history ──
  INSERT INTO network_port_history SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, port_name, status, changed_at FROM network_port_history'
  ) AS t(id BIGINT, asset_id INT, port_name VARCHAR, status VARCHAR, changed_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  network_port_history: % rows', cnt; total_rows := total_rows + cnt;

  -- ── mac_addresses ──
  INSERT INTO mac_addresses SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, mac, interface, ip_address, first_seen, last_seen FROM mac_addresses'
  ) AS t(id INT, asset_id INT, mac MACADDR, interface VARCHAR, ip_address INET, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  mac_addresses: % rows', cnt; total_rows := total_rows + cnt;

  -- ── wwn_entries ──
  INSERT INTO wwn_entries SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, wwn, wwn_type, port_name, first_seen, last_seen FROM wwn_entries'
  ) AS t(id INT, asset_id INT, wwn VARCHAR, wwn_type VARCHAR, port_name VARCHAR, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  wwn_entries: % rows', cnt; total_rows := total_rows + cnt;

  -- ── topology_nodes ──
  INSERT INTO topology_nodes SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, layer, node_type, label, pos_x, pos_y, meta, updated_at FROM topology_nodes'
  ) AS t(id INT, asset_id INT, layer VARCHAR, node_type VARCHAR, label VARCHAR, pos_x FLOAT, pos_y FLOAT, meta JSONB, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  topology_nodes: % rows', cnt; total_rows := total_rows + cnt;

  -- ── topology_edges ──
  INSERT INTO topology_edges SELECT * FROM dblink('argus_conn',
    'SELECT id, layer, source_node, target_node, source_port, target_port, link_type, method, confidence, is_active, detected_at, updated_at
     FROM topology_edges'
  ) AS t(id INT, layer VARCHAR, source_node INT, target_node INT, source_port VARCHAR, target_port VARCHAR,
         link_type VARCHAR, method VARCHAR, confidence SMALLINT, is_active BOOLEAN, detected_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  topology_edges: % rows', cnt; total_rows := total_rows + cnt;

  -- ── device_mac_table ──
  INSERT INTO device_mac_table SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, mac, port_name, vlan_id, entry_type, source, updated_at FROM device_mac_table'
  ) AS t(id INT, asset_id INT, mac MACADDR, port_name VARCHAR, vlan_id SMALLINT, entry_type VARCHAR, source VARCHAR, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  device_mac_table: % rows', cnt; total_rows := total_rows + cnt;

  -- ── discovery_logs ──
  INSERT INTO discovery_logs SELECT * FROM dblink('argus_conn',
    'SELECT id, discovery_type, status, nodes_created, edges_created, edges_updated, detail, created_at FROM discovery_logs'
  ) AS t(id INT, discovery_type VARCHAR, status VARCHAR, nodes_created INT, edges_created INT, edges_updated INT, detail JSONB, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  discovery_logs: % rows', cnt; total_rows := total_rows + cnt;

  -- ── storage_volumes ──
  INSERT INTO storage_volumes SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, volume_name, total_gb, used_gb, filesystem, raid_level, status, created_at, updated_at FROM storage_volumes'
  ) AS t(id INT, asset_id INT, volume_name VARCHAR, total_gb NUMERIC, used_gb NUMERIC, filesystem VARCHAR, raid_level VARCHAR, status VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  storage_volumes: % rows', cnt; total_rows := total_rows + cnt;

  -- ── storage_connections ──
  INSERT INTO storage_connections SELECT * FROM dblink('argus_conn',
    'SELECT id, storage_asset_id, server_asset_id, connection_type, mount_point, is_active, created_at FROM storage_connections'
  ) AS t(id INT, storage_asset_id INT, server_asset_id INT, connection_type VARCHAR, mount_point VARCHAR, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  storage_connections: % rows', cnt; total_rows := total_rows + cnt;

  -- ── storage_volume_history ──
  INSERT INTO storage_volume_history SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, volume_name, total_gb, used_gb, recorded_at FROM storage_volume_history'
  ) AS t(id INT, asset_id INT, volume_name VARCHAR, total_gb NUMERIC, used_gb NUMERIC, recorded_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  storage_volume_history: % rows', cnt; total_rows := total_rows + cnt;

  -- ── virtual_hosts ──
  INSERT INTO virtual_hosts SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, platform, hostname, ip_address, version, cpu_total, mem_total_gb, vm_count, status, last_seen, created_at, updated_at
     FROM virtual_hosts'
  ) AS t(id INT, asset_id INT, platform VARCHAR, hostname VARCHAR, ip_address INET, version VARCHAR,
         cpu_total SMALLINT, mem_total_gb NUMERIC, vm_count INT, status VARCHAR, last_seen TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  virtual_hosts: % rows', cnt; total_rows := total_rows + cnt;

  -- ── virtual_machines ──
  INSERT INTO virtual_machines SELECT * FROM dblink('argus_conn',
    'SELECT id, host_id, asset_id, vm_name, vm_uuid, guest_os, cpu_count, mem_mb, disk_gb, power_state,
            ip_address, tools_status, cpu_usage_pct, mem_usage_pct, created_at, updated_at
     FROM virtual_machines'
  ) AS t(id INT, host_id INT, asset_id INT, vm_name VARCHAR, vm_uuid VARCHAR, guest_os VARCHAR,
         cpu_count SMALLINT, mem_mb INT, disk_gb NUMERIC, power_state VARCHAR, ip_address INET,
         tools_status VARCHAR, cpu_usage_pct FLOAT, mem_usage_pct FLOAT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  virtual_machines: % rows', cnt; total_rows := total_rows + cnt;

  -- ── service_checks ──
  INSERT INTO service_checks SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, name, type, target, interval_s, timeout_s, expected_code, expected_body, is_active, created_at
     FROM service_checks'
  ) AS t(id INT, asset_id INT, name VARCHAR, type VARCHAR, target VARCHAR, interval_s INT, timeout_s INT,
         expected_code SMALLINT, expected_body VARCHAR, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  service_checks: % rows', cnt; total_rows := total_rows + cnt;

  -- ── service_check_results ──
  INSERT INTO service_check_results SELECT * FROM dblink('argus_conn',
    'SELECT check_id, checked_at, status, response_ms, message FROM service_check_results'
  ) AS t(check_id INT, checked_at TIMESTAMPTZ, status VARCHAR, response_ms INT, message VARCHAR);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  service_check_results: % rows', cnt; total_rows := total_rows + cnt;

  -- ── ssl_certificates ──
  INSERT INTO ssl_certificates SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, hostname, port, subject, issuer, not_before, not_after, last_checked, status, warn_days
     FROM ssl_certificates'
  ) AS t(id INT, asset_id INT, hostname VARCHAR, port SMALLINT, subject VARCHAR, issuer VARCHAR,
         not_before TIMESTAMPTZ, not_after TIMESTAMPTZ, last_checked TIMESTAMPTZ, status VARCHAR, warn_days INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  ssl_certificates: % rows', cnt; total_rows := total_rows + cnt;

  -- ── ssl_domains ──
  INSERT INTO ssl_domains SELECT * FROM dblink('argus_conn',
    'SELECT id, domain, domain_type, issuer, issued_at, expires_at, auto_renew, contact_name, contact_email, notes, is_active, created_at
     FROM ssl_domains'
  ) AS t(id INT, domain VARCHAR, domain_type VARCHAR, issuer VARCHAR, issued_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
         auto_renew BOOLEAN, contact_name VARCHAR, contact_email VARCHAR, notes TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  ssl_domains: % rows', cnt; total_rows := total_rows + cnt;

  -- ── asset_changes ──
  INSERT INTO asset_changes SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, asset_name, field_name, old_value, new_value, changed_by, note, changed_at FROM asset_changes'
  ) AS t(id INT, asset_id INT, asset_name VARCHAR, field_name VARCHAR, old_value TEXT, new_value TEXT, changed_by VARCHAR, note TEXT, changed_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  asset_changes: % rows', cnt; total_rows := total_rows + cnt;

  -- ── config_changes ──
  INSERT INTO config_changes SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, detected_at, change_type, summary, raw_log, source FROM config_changes'
  ) AS t(id BIGINT, asset_id INT, detected_at TIMESTAMPTZ, change_type VARCHAR, summary VARCHAR, raw_log TEXT, source VARCHAR);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  config_changes: % rows', cnt; total_rows := total_rows + cnt;

  -- ── ip_subnets ──
  INSERT INTO ip_subnets SELECT * FROM dblink('argus_conn',
    'SELECT id, subnet, name, vlan, location, description, is_active, created_at FROM ip_subnets'
  ) AS t(id INT, subnet CIDR, name VARCHAR, vlan SMALLINT, location VARCHAR, description TEXT, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  ip_subnets: % rows', cnt; total_rows := total_rows + cnt;

  -- ── ip_allocations ──
  INSERT INTO ip_allocations SELECT * FROM dblink('argus_conn',
    'SELECT id, subnet_id, ip_address, asset_id, hostname, purpose, status, notes, updated_at FROM ip_allocations'
  ) AS t(id INT, subnet_id INT, ip_address INET, asset_id INT, hostname VARCHAR, purpose VARCHAR, status VARCHAR, notes TEXT, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  ip_allocations: % rows', cnt; total_rows := total_rows + cnt;

  -- ── racks ──
  INSERT INTO racks SELECT * FROM dblink('argus_conn',
    'SELECT id, name, location, row_no, total_u, description, created_at FROM racks'
  ) AS t(id INT, name VARCHAR, location VARCHAR, row_no VARCHAR, total_u INT, description TEXT, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  racks: % rows', cnt; total_rows := total_rows + cnt;

  -- ── rack_units ──
  INSERT INTO rack_units SELECT * FROM dblink('argus_conn',
    'SELECT id, rack_id, asset_id, start_u, size_u, label, unit_type, created_at FROM rack_units'
  ) AS t(id INT, rack_id INT, asset_id INT, start_u INT, size_u INT, label VARCHAR, unit_type VARCHAR, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  rack_units: % rows', cnt; total_rows := total_rows + cnt;

  -- ── alert_rules ──
  INSERT INTO alert_rules SELECT * FROM dblink('argus_conn',
    'SELECT id, name, asset_id, group_tag, asset_type_filter, metric, operator, threshold, duration_s, severity, notify_channels, is_active, created_at
     FROM alert_rules'
  ) AS t(id INT, name VARCHAR, asset_id INT, group_tag VARCHAR, asset_type_filter VARCHAR, metric VARCHAR,
         operator VARCHAR, threshold FLOAT, duration_s INT, severity VARCHAR, notify_channels TEXT[], is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  alert_rules: % rows', cnt; total_rows := total_rows + cnt;

  -- ── alerts ──
  INSERT INTO alerts SELECT * FROM dblink('argus_conn',
    'SELECT id, rule_id, asset_id, severity, title, message, source, status, fired_at, resolved_at, acked_at, acked_by FROM alerts'
  ) AS t(id BIGINT, rule_id INT, asset_id INT, severity VARCHAR, title VARCHAR, message TEXT,
         source VARCHAR, status VARCHAR, fired_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ, acked_at TIMESTAMPTZ, acked_by INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  alerts: % rows', cnt; total_rows := total_rows + cnt;

  -- ── alert_notifications ──
  INSERT INTO alert_notifications SELECT * FROM dblink('argus_conn',
    'SELECT id, alert_id, channel, recipient, status, sent_at, error FROM alert_notifications'
  ) AS t(id BIGINT, alert_id BIGINT, channel VARCHAR, recipient VARCHAR, status VARCHAR, sent_at TIMESTAMPTZ, error TEXT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  alert_notifications: % rows', cnt; total_rows := total_rows + cnt;

  -- ── escalation_policies ──
  INSERT INTO escalation_policies SELECT * FROM dblink('argus_conn',
    'SELECT id, name, asset_id, group_tag, steps, is_active, created_at FROM escalation_policies'
  ) AS t(id INT, name VARCHAR, asset_id INT, group_tag VARCHAR, steps JSONB, is_active BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  escalation_policies: % rows', cnt; total_rows := total_rows + cnt;

  -- ── incidents ──
  INSERT INTO incidents SELECT * FROM dblink('argus_conn',
    'SELECT id, title, severity, status, asset_ids, alert_ids, assigned_to, root_cause, resolution, opened_at, resolved_at FROM incidents'
  ) AS t(id INT, title VARCHAR, severity VARCHAR, status VARCHAR, asset_ids INT[], alert_ids BIGINT[],
         assigned_to INT, root_cause TEXT, resolution TEXT, opened_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  incidents: % rows', cnt; total_rows := total_rows + cnt;

  -- ── incident_timeline ──
  INSERT INTO incident_timeline SELECT * FROM dblink('argus_conn',
    'SELECT id, incident_id, user_id, event_type, content, occurred_at FROM incident_timeline'
  ) AS t(id INT, incident_id INT, user_id INT, event_type VARCHAR, content TEXT, occurred_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  incident_timeline: % rows', cnt; total_rows := total_rows + cnt;

  -- ── llm_providers ──
  INSERT INTO llm_providers SELECT * FROM dblink('argus_conn',
    'SELECT id, name, provider_type, model, endpoint_url, api_key, extra_config, is_active, is_default, created_at FROM llm_providers'
  ) AS t(id INT, name VARCHAR, provider_type VARCHAR, model VARCHAR, endpoint_url VARCHAR, api_key TEXT,
         extra_config JSONB, is_active BOOLEAN, is_default BOOLEAN, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  llm_providers: % rows', cnt; total_rows := total_rows + cnt;

  -- ── llm_feature_assignments ──
  INSERT INTO llm_feature_assignments SELECT * FROM dblink('argus_conn',
    'SELECT feature, provider_id, fallback_id FROM llm_feature_assignments'
  ) AS t(feature VARCHAR, provider_id INT, fallback_id INT);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  llm_feature_assignments: % rows', cnt; total_rows := total_rows + cnt;

  -- ── llm_call_logs ──
  INSERT INTO llm_call_logs SELECT * FROM dblink('argus_conn',
    'SELECT id, provider_id, feature, model, prompt_tokens, completion_tokens, duration_ms, status, error_message, called_at
     FROM llm_call_logs'
  ) AS t(id BIGINT, provider_id INT, feature VARCHAR, model VARCHAR, prompt_tokens INT, completion_tokens INT,
         duration_ms INT, status VARCHAR, error_message TEXT, called_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  llm_call_logs: % rows', cnt; total_rows := total_rows + cnt;

  -- ── llm_predictions ──
  INSERT INTO llm_predictions SELECT * FROM dblink('argus_conn',
    'SELECT id, asset_id, predicted_at, issue_type, severity, confidence, summary, raw_response, alert_sent FROM llm_predictions'
  ) AS t(id INT, asset_id INT, predicted_at TIMESTAMPTZ, issue_type VARCHAR, severity VARCHAR,
         confidence FLOAT, summary TEXT, raw_response TEXT, alert_sent BOOLEAN);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  llm_predictions: % rows', cnt; total_rows := total_rows + cnt;

  -- ── report_definitions ──
  INSERT INTO report_definitions SELECT * FROM dblink('argus_conn',
    'SELECT id, name, type, schedule, asset_ids, format, recipients, is_active, last_run_at, created_at FROM report_definitions'
  ) AS t(id INT, name VARCHAR, type VARCHAR, schedule VARCHAR, asset_ids INT[], format VARCHAR,
         recipients TEXT[], is_active BOOLEAN, last_run_at TIMESTAMPTZ, created_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  report_definitions: % rows', cnt; total_rows := total_rows + cnt;

  -- ── report_history ──
  INSERT INTO report_history SELECT * FROM dblink('argus_conn',
    'SELECT id, def_id, generated_at, period_start, period_end, file_path, status FROM report_history'
  ) AS t(id INT, def_id INT, generated_at TIMESTAMPTZ, period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, file_path VARCHAR, status VARCHAR);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  report_history: % rows', cnt; total_rows := total_rows + cnt;

  -- ── custom_dashboards ──
  INSERT INTO custom_dashboards SELECT * FROM dblink('argus_conn',
    'SELECT id, user_id, name, layout, is_default, created_at, updated_at FROM custom_dashboards'
  ) AS t(id INT, user_id INT, name VARCHAR, layout JSONB, is_default BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RAISE NOTICE '  custom_dashboards: % rows', cnt; total_rows := total_rows + cnt;

  -- FK 체크 재활성화
  SET session_replication_role = 'origin';

  -- ============================================================
  -- 3. 시퀀스 리셋
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '[3/4] 시퀀스 재설정...';

  PERFORM setval(pg_get_serial_sequence('users', 'id'), COALESCE((SELECT MAX(id) FROM users), 1));
  PERFORM setval(pg_get_serial_sequence('organizations', 'id'), COALESCE((SELECT MAX(id) FROM organizations), 1));
  PERFORM setval(pg_get_serial_sequence('assets', 'id'), COALESCE((SELECT MAX(id) FROM assets), 1));
  PERFORM setval(pg_get_serial_sequence('maintenance_contracts', 'id'), COALESCE((SELECT MAX(id) FROM maintenance_contracts), 1));
  PERFORM setval(pg_get_serial_sequence('software_installations', 'id'), COALESCE((SELECT MAX(id) FROM software_installations), 1));
  PERFORM setval(pg_get_serial_sequence('bmc_credentials', 'id'), COALESCE((SELECT MAX(id) FROM bmc_credentials), 1));
  PERFORM setval(pg_get_serial_sequence('agent_tokens', 'id'), COALESCE((SELECT MAX(id) FROM agent_tokens), 1));
  PERFORM setval(pg_get_serial_sequence('agent_versions', 'id'), COALESCE((SELECT MAX(id) FROM agent_versions), 1));
  PERFORM setval(pg_get_serial_sequence('hw_inventory', 'id'), COALESCE((SELECT MAX(id) FROM hw_inventory), 1));
  PERFORM setval(pg_get_serial_sequence('hw_health', 'id'), COALESCE((SELECT MAX(id) FROM hw_health), 1));
  PERFORM setval(pg_get_serial_sequence('disk_smart', 'id'), COALESCE((SELECT MAX(id) FROM disk_smart), 1));
  PERFORM setval(pg_get_serial_sequence('network_ports', 'id'), COALESCE((SELECT MAX(id) FROM network_ports), 1));
  PERFORM setval(pg_get_serial_sequence('mac_addresses', 'id'), COALESCE((SELECT MAX(id) FROM mac_addresses), 1));
  PERFORM setval(pg_get_serial_sequence('wwn_entries', 'id'), COALESCE((SELECT MAX(id) FROM wwn_entries), 1));
  PERFORM setval(pg_get_serial_sequence('topology_nodes', 'id'), COALESCE((SELECT MAX(id) FROM topology_nodes), 1));
  PERFORM setval(pg_get_serial_sequence('topology_edges', 'id'), COALESCE((SELECT MAX(id) FROM topology_edges), 1));
  PERFORM setval(pg_get_serial_sequence('device_mac_table', 'id'), COALESCE((SELECT MAX(id) FROM device_mac_table), 1));
  PERFORM setval(pg_get_serial_sequence('discovery_logs', 'id'), COALESCE((SELECT MAX(id) FROM discovery_logs), 1));
  PERFORM setval(pg_get_serial_sequence('storage_volumes', 'id'), COALESCE((SELECT MAX(id) FROM storage_volumes), 1));
  PERFORM setval(pg_get_serial_sequence('storage_connections', 'id'), COALESCE((SELECT MAX(id) FROM storage_connections), 1));
  PERFORM setval(pg_get_serial_sequence('storage_volume_history', 'id'), COALESCE((SELECT MAX(id) FROM storage_volume_history), 1));
  PERFORM setval(pg_get_serial_sequence('virtual_hosts', 'id'), COALESCE((SELECT MAX(id) FROM virtual_hosts), 1));
  PERFORM setval(pg_get_serial_sequence('virtual_machines', 'id'), COALESCE((SELECT MAX(id) FROM virtual_machines), 1));
  PERFORM setval(pg_get_serial_sequence('service_checks', 'id'), COALESCE((SELECT MAX(id) FROM service_checks), 1));
  PERFORM setval(pg_get_serial_sequence('ssl_certificates', 'id'), COALESCE((SELECT MAX(id) FROM ssl_certificates), 1));
  PERFORM setval(pg_get_serial_sequence('ssl_domains', 'id'), COALESCE((SELECT MAX(id) FROM ssl_domains), 1));
  PERFORM setval(pg_get_serial_sequence('asset_changes', 'id'), COALESCE((SELECT MAX(id) FROM asset_changes), 1));
  PERFORM setval(pg_get_serial_sequence('ip_subnets', 'id'), COALESCE((SELECT MAX(id) FROM ip_subnets), 1));
  PERFORM setval(pg_get_serial_sequence('ip_allocations', 'id'), COALESCE((SELECT MAX(id) FROM ip_allocations), 1));
  PERFORM setval(pg_get_serial_sequence('racks', 'id'), COALESCE((SELECT MAX(id) FROM racks), 1));
  PERFORM setval(pg_get_serial_sequence('rack_units', 'id'), COALESCE((SELECT MAX(id) FROM rack_units), 1));
  PERFORM setval(pg_get_serial_sequence('alert_rules', 'id'), COALESCE((SELECT MAX(id) FROM alert_rules), 1));
  PERFORM setval(pg_get_serial_sequence('escalation_policies', 'id'), COALESCE((SELECT MAX(id) FROM escalation_policies), 1));
  PERFORM setval(pg_get_serial_sequence('incidents', 'id'), COALESCE((SELECT MAX(id) FROM incidents), 1));
  PERFORM setval(pg_get_serial_sequence('incident_timeline', 'id'), COALESCE((SELECT MAX(id) FROM incident_timeline), 1));
  PERFORM setval(pg_get_serial_sequence('llm_providers', 'id'), COALESCE((SELECT MAX(id) FROM llm_providers), 1));
  PERFORM setval(pg_get_serial_sequence('llm_predictions', 'id'), COALESCE((SELECT MAX(id) FROM llm_predictions), 1));
  PERFORM setval(pg_get_serial_sequence('syslog_parse_patterns', 'id'), COALESCE((SELECT MAX(id) FROM syslog_parse_patterns), 1));
  PERFORM setval(pg_get_serial_sequence('report_definitions', 'id'), COALESCE((SELECT MAX(id) FROM report_definitions), 1));
  PERFORM setval(pg_get_serial_sequence('report_history', 'id'), COALESCE((SELECT MAX(id) FROM report_history), 1));
  PERFORM setval(pg_get_serial_sequence('custom_dashboards', 'id'), COALESCE((SELECT MAX(id) FROM custom_dashboards), 1));

  RAISE NOTICE '  완료';

  -- ============================================================
  -- 4. admin 브랜딩 업데이트
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '[4/4] admin 브랜딩 업데이트 (argus → digicap)...';

  UPDATE users SET
    email = REPLACE(email, '@argus.local', '@digicap.local'),
    password_hash = crypt('digicap1234!', gen_salt('bf'))
  WHERE username = 'admin' AND email LIKE '%@argus.local';

  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN
    RAISE NOTICE '  admin 이메일/비밀번호 업데이트됨';
  END IF;

  -- 연결 종료
  PERFORM dblink_disconnect('argus_conn');

  RAISE NOTICE '';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '  마이그레이션 완료! 총 % rows 복사됨', total_rows;
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE '  기본 로그인: admin@digicap.local / digicap1234!';
  RAISE NOTICE '  프로덕션에서는 반드시 비밀번호를 변경하세요.';

END $$;
