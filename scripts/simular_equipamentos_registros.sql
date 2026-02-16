-- Script para criar equipamentos e simular registros de ponto
-- Execute no Supabase SQL Editor

-- =====================================================
-- 1. TABELA DE EQUIPAMENTOS (REP)
-- =====================================================
CREATE TABLE IF NOT EXISTS santo_andre.equipamentos (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    modelo VARCHAR(100),
    fabricante VARCHAR(100),
    numero_serie VARCHAR(100),
    ip VARCHAR(45),
    porta INTEGER DEFAULT 4370,
    lotacao_id INTEGER REFERENCES santo_andre.lotacoes(id),
    tipo VARCHAR(50) DEFAULT 'REP', -- REP, BIOMETRICO, FACIAL, CARTAO
    status VARCHAR(20) DEFAULT 'ONLINE', -- ONLINE, OFFLINE, MANUTENCAO
    ultima_comunicacao TIMESTAMP,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 2. TABELA DE REGISTROS DE PONTO
-- =====================================================
CREATE TABLE IF NOT EXISTS santo_andre.registros_ponto (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES santo_andre.funcionarios(id),
    equipamento_id INTEGER REFERENCES santo_andre.equipamentos(id),
    data_hora TIMESTAMP NOT NULL,
    tipo VARCHAR(20) DEFAULT 'BIOMETRIA', -- BIOMETRIA, CARTAO, SENHA, MANUAL, FACIAL
    sentido VARCHAR(10), -- ENTRADA, SAIDA (pode ser NULL se o sistema calcular)
    nsr VARCHAR(20), -- Número Sequencial de Registro (Portaria 671)
    pis VARCHAR(20),
    origem VARCHAR(20) DEFAULT 'EQUIPAMENTO', -- EQUIPAMENTO, MANUAL, IMPORTACAO
    justificativa TEXT,
    aprovado BOOLEAN DEFAULT TRUE,
    aprovado_por INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 3. TABELA DE ESPELHOS DE PONTO (resumo mensal)
-- =====================================================
CREATE TABLE IF NOT EXISTS santo_andre.espelhos_ponto (
    id SERIAL PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES santo_andre.funcionarios(id),
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    dias_trabalhados INTEGER DEFAULT 0,
    horas_trabalhadas INTERVAL DEFAULT '0:00',
    horas_extras INTERVAL DEFAULT '0:00',
    horas_falta INTERVAL DEFAULT '0:00',
    atrasos INTEGER DEFAULT 0,
    faltas INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ABERTO', -- ABERTO, FECHADO, APROVADO
    fechado_em TIMESTAMP,
    fechado_por INTEGER,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(funcionario_id, ano, mes)
);

-- =====================================================
-- 4. INSERIR EQUIPAMENTOS DE EXEMPLO
-- =====================================================

-- Primeiro, vamos pegar algumas lotações para vincular
DO $$
DECLARE
    v_lotacao_id INTEGER;
BEGIN
    -- Pegar primeira lotação disponível
    SELECT id INTO v_lotacao_id FROM santo_andre.lotacoes WHERE ativo = true LIMIT 1;
    
    -- Inserir equipamentos de exemplo
    INSERT INTO santo_andre.equipamentos (codigo, nome, modelo, fabricante, numero_serie, ip, lotacao_id, tipo, status, ultima_comunicacao)
    VALUES 
        ('REP001', 'REP Entrada Principal', 'iDClass', 'Control iD', 'CID2024001', '192.168.1.100', v_lotacao_id, 'BIOMETRICO', 'ONLINE', NOW()),
        ('REP002', 'REP Secretaria Admin', 'iDFlex', 'Control iD', 'CID2024002', '192.168.1.101', v_lotacao_id, 'BIOMETRICO', 'ONLINE', NOW() - INTERVAL '5 minutes'),
        ('REP003', 'REP Saúde', 'SS 710', 'Intelbras', 'INT2024001', '192.168.1.102', v_lotacao_id, 'FACIAL', 'ONLINE', NOW() - INTERVAL '2 minutes'),
        ('REP004', 'REP Educação', 'SS 710', 'Intelbras', 'INT2024002', '192.168.1.103', v_lotacao_id, 'FACIAL', 'OFFLINE', NOW() - INTERVAL '2 hours')
    ON CONFLICT DO NOTHING;
END $$;

-- =====================================================
-- 5. GERAR REGISTROS DE PONTO SIMULADOS
-- =====================================================

-- Função para gerar registros aleatórios
DO $$
DECLARE
    v_func RECORD;
    v_data DATE;
    v_equip_id INTEGER;
    v_hora_entrada TIME;
    v_hora_saida_almoco TIME;
    v_hora_volta_almoco TIME;
    v_hora_saida TIME;
    v_nsr INTEGER := 1;
    v_variacao INTEGER;
BEGIN
    -- Pegar um equipamento online
    SELECT id INTO v_equip_id FROM santo_andre.equipamentos WHERE status = 'ONLINE' LIMIT 1;
    
    -- Para cada funcionário ativo (limitado a 50 para não demorar)
    FOR v_func IN 
        SELECT id, pis FROM santo_andre.funcionarios 
        WHERE ativo = true 
        ORDER BY RANDOM() 
        LIMIT 50
    LOOP
        -- Para os últimos 7 dias úteis
        FOR v_data IN 
            SELECT d::date 
            FROM generate_series(
                CURRENT_DATE - INTERVAL '10 days', 
                CURRENT_DATE - INTERVAL '1 day', 
                '1 day'::interval
            ) d
            WHERE EXTRACT(DOW FROM d) NOT IN (0, 6) -- Excluir sábado e domingo
        LOOP
            -- Variação aleatória em minutos (-10 a +10)
            v_variacao := floor(random() * 21) - 10;
            
            -- Horários base com variação
            v_hora_entrada := '08:00:00'::time + (v_variacao || ' minutes')::interval;
            v_hora_saida_almoco := '12:00:00'::time + ((floor(random() * 11) - 5) || ' minutes')::interval;
            v_hora_volta_almoco := '13:00:00'::time + ((floor(random() * 11) - 5) || ' minutes')::interval;
            v_hora_saida := '17:00:00'::time + ((floor(random() * 21) - 10) || ' minutes')::interval;
            
            -- Inserir os 4 registros do dia (entrada, saída almoço, volta almoço, saída)
            -- 90% de chance de ter registro completo
            IF random() < 0.90 THEN
                -- Entrada
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_entrada, 'BIOMETRIA', 'ENTRADA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
                
                -- Saída almoço
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_saida_almoco, 'BIOMETRIA', 'SAIDA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
                
                -- Volta almoço
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_volta_almoco, 'BIOMETRIA', 'ENTRADA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
                
                -- Saída
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_saida, 'BIOMETRIA', 'SAIDA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
            ELSIF random() < 0.95 THEN
                -- 5% só tem entrada e saída (sem almoço registrado)
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_entrada, 'BIOMETRIA', 'ENTRADA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
                
                INSERT INTO santo_andre.registros_ponto 
                    (funcionario_id, equipamento_id, data_hora, tipo, sentido, nsr, pis, origem)
                VALUES 
                    (v_func.id, v_equip_id, v_data + v_hora_saida, 'BIOMETRIA', 'SAIDA', 
                     LPAD(v_nsr::text, 9, '0'), v_func.pis, 'EQUIPAMENTO');
                v_nsr := v_nsr + 1;
            END IF;
            -- 5% não tem registro (falta)
        END LOOP;
    END LOOP;
    
    RAISE NOTICE 'Registros gerados com sucesso! Total NSR: %', v_nsr - 1;
END $$;

-- =====================================================
-- 6. CRIAR ÍNDICES PARA PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_registros_funcionario ON santo_andre.registros_ponto(funcionario_id);
CREATE INDEX IF NOT EXISTS idx_registros_data ON santo_andre.registros_ponto(data_hora);
CREATE INDEX IF NOT EXISTS idx_registros_func_data ON santo_andre.registros_ponto(funcionario_id, data_hora);
CREATE INDEX IF NOT EXISTS idx_equipamentos_status ON santo_andre.equipamentos(status);
CREATE INDEX IF NOT EXISTS idx_espelhos_func_periodo ON santo_andre.espelhos_ponto(funcionario_id, ano, mes);

-- =====================================================
-- 7. VERIFICAR RESULTADOS
-- =====================================================
SELECT 'Equipamentos criados:' as info, COUNT(*) as total FROM santo_andre.equipamentos;
SELECT 'Registros de ponto gerados:' as info, COUNT(*) as total FROM santo_andre.registros_ponto;
SELECT 'Funcionários com registros:' as info, COUNT(DISTINCT funcionario_id) as total FROM santo_andre.registros_ponto;

-- Amostra dos últimos registros
SELECT 
    r.id,
    f.nome as funcionario,
    r.data_hora,
    r.sentido,
    r.tipo,
    e.nome as equipamento
FROM santo_andre.registros_ponto r
JOIN santo_andre.funcionarios f ON f.id = r.funcionario_id
LEFT JOIN santo_andre.equipamentos e ON e.id = r.equipamento_id
ORDER BY r.data_hora DESC
LIMIT 20;
