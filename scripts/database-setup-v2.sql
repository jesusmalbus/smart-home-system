-- ============================================
-- SMART HOME - Database Setup v2
-- Con soporte para cámaras remotas (DDNS/P2P)
-- ============================================
-- 
-- INSTRUCCIONES:
-- 1. Entra a tu proyecto Supabase en https://supabase.com
-- 2. Ve a "SQL Editor"
-- 3. Copia y pega TODO el código de este archivo
-- 4. Ejecuta (Run)
--
-- ============================================

-- Eliminar tablas existentes (CUIDADO: esto borra datos)
-- Comenta estas líneas si quieres mantener datos existentes
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS cameras CASCADE;
DROP TABLE IF EXISTS motion_sensors CASCADE;
DROP TABLE IF EXISTS thermostats CASCADE;
DROP TABLE IF EXISTS locks CASCADE;
DROP TABLE IF EXISTS lights CASCADE;

-- ============================================
-- TABLA: LUCES
-- ============================================
CREATE TABLE lights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    is_online BOOLEAN DEFAULT true,
    is_on BOOLEAN DEFAULT false,
    brightness INTEGER DEFAULT 100 CHECK (brightness >= 0 AND brightness <= 100),
    color VARCHAR(10) DEFAULT '#FFFFFF',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: CERRADURAS
-- ============================================
CREATE TABLE locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    is_online BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT true,
    auto_lock BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: TERMOSTATOS
-- ============================================
CREATE TABLE thermostats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    is_online BOOLEAN DEFAULT true,
    is_on BOOLEAN DEFAULT false,
    current_temp NUMERIC(4,1) DEFAULT 20.0,
    target_temp NUMERIC(4,1) DEFAULT 22.0,
    mode VARCHAR(20) DEFAULT 'auto' CHECK (mode IN ('auto', 'cool', 'heat', 'fan')),
    humidity INTEGER DEFAULT 45 CHECK (humidity >= 0 AND humidity <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: SENSORES DE MOVIMIENTO
-- ============================================
CREATE TABLE motion_sensors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    is_online BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    motion_detected BOOLEAN DEFAULT false,
    sensitivity VARCHAR(20) DEFAULT 'medium' CHECK (sensitivity IN ('low', 'medium', 'high')),
    last_motion TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: CÁMARAS (CON SOPORTE REMOTO)
-- ============================================
CREATE TABLE cameras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    is_online BOOLEAN DEFAULT true,
    
    -- Configuración de streaming
    stream_url VARCHAR(500),
    snapshot_url VARCHAR(500),
    connection_type VARCHAR(20) DEFAULT 'webrtc' CHECK (connection_type IN ('webrtc', 'remote', 'local', 'snapshot')),
    
    -- Credenciales
    camera_username VARCHAR(255),
    camera_password VARCHAR(255),
    
    -- Info del dispositivo
    camera_brand VARCHAR(100) DEFAULT 'H-VIEW',
    resolution VARCHAR(10) DEFAULT '1080p' CHECK (resolution IN ('720p', '1080p', '2K', '4K')),
    
    -- Capacidades
    has_audio BOOLEAN DEFAULT false,
    has_mic BOOLEAN DEFAULT false,
    has_night_vision BOOLEAN DEFAULT false,
    is_recording BOOLEAN DEFAULT false,
    use_local_camera BOOLEAN DEFAULT false,
    
    -- NUEVO: Configuración para acceso REMOTO
    ddns_url VARCHAR(255),          -- URL DDNS (ej: mihogar.ddns.net)
    remote_port INTEGER DEFAULT 80,  -- Puerto HTTP remoto
    rtsp_port INTEGER DEFAULT 554,   -- Puerto RTSP remoto
    p2p_service VARCHAR(50),         -- Servicio P2P (hik-connect, dmss, xmeye, etc.)
    p2p_device_id VARCHAR(255),      -- ID del dispositivo P2P
    
    -- Configuración DVR
    dvr_ip VARCHAR(255),
    dvr_channel INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: LOGS DE ACTIVIDAD
-- ============================================
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_type VARCHAR(50) NOT NULL,
    device_id UUID NOT NULL,
    action VARCHAR(255) NOT NULL,
    previous_value JSONB,
    new_value JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- HABILITAR ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE lights ENABLE ROW LEVEL SECURITY;
ALTER TABLE locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE thermostats ENABLE ROW LEVEL SECURITY;
ALTER TABLE motion_sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POLÍTICAS RLS - Acceso público (anon)
-- ============================================

-- Lights
DROP POLICY IF EXISTS "lights_select" ON lights;
DROP POLICY IF EXISTS "lights_insert" ON lights;
DROP POLICY IF EXISTS "lights_update" ON lights;
DROP POLICY IF EXISTS "lights_delete" ON lights;

CREATE POLICY "lights_select" ON lights FOR SELECT USING (true);
CREATE POLICY "lights_insert" ON lights FOR INSERT WITH CHECK (true);
CREATE POLICY "lights_update" ON lights FOR UPDATE USING (true);
CREATE POLICY "lights_delete" ON lights FOR DELETE USING (true);

-- Locks
DROP POLICY IF EXISTS "locks_select" ON locks;
DROP POLICY IF EXISTS "locks_insert" ON locks;
DROP POLICY IF EXISTS "locks_update" ON locks;
DROP POLICY IF EXISTS "locks_delete" ON locks;

CREATE POLICY "locks_select" ON locks FOR SELECT USING (true);
CREATE POLICY "locks_insert" ON locks FOR INSERT WITH CHECK (true);
CREATE POLICY "locks_update" ON locks FOR UPDATE USING (true);
CREATE POLICY "locks_delete" ON locks FOR DELETE USING (true);

-- Thermostats
DROP POLICY IF EXISTS "thermostats_select" ON thermostats;
DROP POLICY IF EXISTS "thermostats_insert" ON thermostats;
DROP POLICY IF EXISTS "thermostats_update" ON thermostats;
DROP POLICY IF EXISTS "thermostats_delete" ON thermostats;

CREATE POLICY "thermostats_select" ON thermostats FOR SELECT USING (true);
CREATE POLICY "thermostats_insert" ON thermostats FOR INSERT WITH CHECK (true);
CREATE POLICY "thermostats_update" ON thermostats FOR UPDATE USING (true);
CREATE POLICY "thermostats_delete" ON thermostats FOR DELETE USING (true);

-- Motion Sensors
DROP POLICY IF EXISTS "sensors_select" ON motion_sensors;
DROP POLICY IF EXISTS "sensors_insert" ON motion_sensors;
DROP POLICY IF EXISTS "sensors_update" ON motion_sensors;
DROP POLICY IF EXISTS "sensors_delete" ON motion_sensors;

CREATE POLICY "sensors_select" ON motion_sensors FOR SELECT USING (true);
CREATE POLICY "sensors_insert" ON motion_sensors FOR INSERT WITH CHECK (true);
CREATE POLICY "sensors_update" ON motion_sensors FOR UPDATE USING (true);
CREATE POLICY "sensors_delete" ON motion_sensors FOR DELETE USING (true);

-- Cameras
DROP POLICY IF EXISTS "cameras_select" ON cameras;
DROP POLICY IF EXISTS "cameras_insert" ON cameras;
DROP POLICY IF EXISTS "cameras_update" ON cameras;
DROP POLICY IF EXISTS "cameras_delete" ON cameras;

CREATE POLICY "cameras_select" ON cameras FOR SELECT USING (true);
CREATE POLICY "cameras_insert" ON cameras FOR INSERT WITH CHECK (true);
CREATE POLICY "cameras_update" ON cameras FOR UPDATE USING (true);
CREATE POLICY "cameras_delete" ON cameras FOR DELETE USING (true);

-- Activity Logs
DROP POLICY IF EXISTS "logs_select" ON activity_logs;
DROP POLICY IF EXISTS "logs_insert" ON activity_logs;

CREATE POLICY "logs_select" ON activity_logs FOR SELECT USING (true);
CREATE POLICY "logs_insert" ON activity_logs FOR INSERT WITH CHECK (true);

-- ============================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ============================================
CREATE INDEX IF NOT EXISTS idx_lights_location ON lights(location);
CREATE INDEX IF NOT EXISTS idx_locks_location ON locks(location);
CREATE INDEX IF NOT EXISTS idx_thermostats_location ON thermostats(location);
CREATE INDEX IF NOT EXISTS idx_sensors_location ON motion_sensors(location);
CREATE INDEX IF NOT EXISTS idx_cameras_location ON cameras(location);
CREATE INDEX IF NOT EXISTS idx_cameras_connection_type ON cameras(connection_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_device ON activity_logs(device_type, device_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);

-- ============================================
-- DATOS DE EJEMPLO
-- ============================================

-- Luces de ejemplo
INSERT INTO lights (name, location, is_on, brightness, color) VALUES
('Luz Sala', 'Sala de estar', true, 80, '#FFFFFF'),
('Luz Cocina', 'Cocina', false, 100, '#FFF4E0'),
('Luz Dormitorio', 'Dormitorio principal', false, 50, '#FFE4B5');

-- Cerraduras de ejemplo
INSERT INTO locks (name, location, is_locked, auto_lock) VALUES
('Puerta Principal', 'Entrada', true, true),
('Puerta Garage', 'Garage', false, false);

-- Termostato de ejemplo
INSERT INTO thermostats (name, location, is_on, current_temp, target_temp, mode, humidity) VALUES
('Termostato Central', 'Sala de estar', true, 21.5, 22.0, 'auto', 48);

-- Sensores de ejemplo
INSERT INTO motion_sensors (name, location, is_active, motion_detected, sensitivity) VALUES
('Sensor Entrada', 'Entrada', true, false, 'high'),
('Sensor Patio', 'Patio', true, false, 'medium');

-- Cámara de ejemplo (local)
INSERT INTO cameras (name, location, connection_type, camera_brand, resolution, has_audio, has_night_vision) VALUES
('Cámara Webcam', 'Escritorio', 'local', 'Generic', '720p', true, false);

-- ============================================
-- VERIFICACIÓN
-- ============================================
SELECT 'Luces:' as tabla, COUNT(*) as total FROM lights
UNION ALL
SELECT 'Cerraduras:', COUNT(*) FROM locks
UNION ALL
SELECT 'Termostatos:', COUNT(*) FROM thermostats
UNION ALL
SELECT 'Sensores:', COUNT(*) FROM motion_sensors
UNION ALL
SELECT 'Cámaras:', COUNT(*) FROM cameras;

-- ============================================
-- NOTA: Para agregar columnas a tabla existente
-- sin borrar datos, usa ALTER TABLE:
-- ============================================
-- ALTER TABLE cameras ADD COLUMN IF NOT EXISTS ddns_url VARCHAR(255);
-- ALTER TABLE cameras ADD COLUMN IF NOT EXISTS remote_port INTEGER DEFAULT 80;
-- ALTER TABLE cameras ADD COLUMN IF NOT EXISTS rtsp_port INTEGER DEFAULT 554;
-- ALTER TABLE cameras ADD COLUMN IF NOT EXISTS p2p_service VARCHAR(50);
-- ALTER TABLE cameras ADD COLUMN IF NOT EXISTS p2p_device_id VARCHAR(255);
