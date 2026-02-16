-- =====================================================
-- SCRIPT DE MIGRAÇÃO MULTI-TENANT
-- Execute este script para garantir que todas as tabelas
-- existam em todos os schemas de entidades
-- 
-- Uso: psql -U supabase_admin -d postgres -f migration_multitenant.sql
-- =====================================================

DO $$
DECLARE
    schema_name TEXT;
    schemas TEXT[] := ARRAY(SELECT db_schema FROM public.entidades WHERE db_schema IS NOT NULL);
BEGIN
    FOREACH schema_name IN ARRAY schemas
    LOOP
        RAISE NOTICE 'Processando schema: %', schema_name;
        
        -- Tabela atendimentos_config
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.atendimentos_config (
                id SERIAL PRIMARY KEY,
                cargo_id INTEGER,
                lotacao_id INTEGER,
                funcionario_id INTEGER,
                tipo_atendimento VARCHAR(50) DEFAULT ''DOMICILIAR'',
                meta_diaria INTEGER DEFAULT 0,
                meta_semanal INTEGER DEFAULT 0,
                meta_mensal INTEGER DEFAULT 0,
                tempo_minimo_minutos INTEGER DEFAULT 5,
                tempo_maximo_minutos INTEGER DEFAULT 120,
                exige_foto BOOLEAN DEFAULT false,
                exige_gps BOOLEAN DEFAULT true,
                ativo BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )', schema_name);
        
        -- Tabela atendimentos
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.atendimentos (
                id SERIAL PRIMARY KEY,
                funcionario_id INTEGER NOT NULL,
                tipo_atendimento VARCHAR(50) DEFAULT ''DOMICILIAR'',
                status VARCHAR(20) DEFAULT ''EM_ANDAMENTO'',
                data_hora_inicio TIMESTAMP NOT NULL,
                data_hora_fim TIMESTAMP,
                latitude_inicio DECIMAL(10,8),
                longitude_inicio DECIMAL(11,8),
                latitude_fim DECIMAL(10,8),
                longitude_fim DECIMAL(11,8),
                endereco TEXT,
                nome_atendido VARCHAR(255),
                observacao TEXT,
                foto_inicio TEXT,
                foto_fim TEXT,
                duracao_minutos INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )', schema_name);
            
        -- Tabela notificacoes
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.notificacoes (
                id SERIAL PRIMARY KEY,
                titulo VARCHAR(255) NOT NULL,
                mensagem TEXT,
                tipo VARCHAR(50) DEFAULT ''INFO'',
                categoria VARCHAR(50) DEFAULT ''SISTEMA'',
                funcionario_id INTEGER,
                lida BOOLEAN DEFAULT false,
                lida_em TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )', schema_name);
            
        -- Tabela notificacoes_leituras
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.notificacoes_leituras (
                id SERIAL PRIMARY KEY,
                notificacao_id INTEGER NOT NULL,
                funcionario_id INTEGER NOT NULL,
                lida_em TIMESTAMP DEFAULT NOW(),
                oculta BOOLEAN DEFAULT false
            )', schema_name);
            
        -- Tabela escalas
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I.escalas (
                id SERIAL PRIMARY KEY,
                funcionario_id INTEGER NOT NULL,
                data DATE NOT NULL,
                tipo VARCHAR(50) DEFAULT ''PLANTAO'',
                turno VARCHAR(50),
                horario_inicio TIME,
                horario_fim TIME,
                status VARCHAR(20) DEFAULT ''ATIVO'',
                motivo TEXT,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )', schema_name);
            
        -- Permissões
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO supabase_admin', schema_name);
        EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO supabase_admin', schema_name);
        
        RAISE NOTICE 'Schema % processado com sucesso', schema_name;
    END LOOP;
END $$;

SELECT 'Migração multi-tenant concluída!' as resultado;
