-- Script para criar tabela de feriados e gerar feriados automaticamente
-- Execute no Supabase SQL Editor

-- =====================================================
-- 1. CRIAR TABELA DE FERIADOS
-- =====================================================
CREATE TABLE IF NOT EXISTS santo_andre.feriados (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL,
    descricao VARCHAR(255) NOT NULL,
    tipo VARCHAR(50) DEFAULT 'MUNICIPAL', -- NACIONAL, ESTADUAL, MUNICIPAL, PONTO_FACULTATIVO
    recorrente BOOLEAN DEFAULT FALSE,
    ativo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índice para busca por data
CREATE INDEX IF NOT EXISTS idx_feriados_data ON santo_andre.feriados(data);
CREATE INDEX IF NOT EXISTS idx_feriados_ativo ON santo_andre.feriados(ativo);

-- =====================================================
-- 2. FUNÇÃO PARA CALCULAR PÁSCOA (Algoritmo de Meeus/Jones/Butcher)
-- =====================================================
CREATE OR REPLACE FUNCTION santo_andre.calcular_pascoa(ano INTEGER)
RETURNS DATE AS $$
DECLARE
    a INTEGER;
    b INTEGER;
    c INTEGER;
    d INTEGER;
    e INTEGER;
    f INTEGER;
    g INTEGER;
    h INTEGER;
    i INTEGER;
    k INTEGER;
    l INTEGER;
    m INTEGER;
    n INTEGER;
    p INTEGER;
    mes INTEGER;
    dia INTEGER;
BEGIN
    a := ano % 19;
    b := ano / 100;
    c := ano % 100;
    d := b / 4;
    e := b % 4;
    f := (b + 8) / 25;
    g := (b - f + 1) / 3;
    h := (19 * a + b - d - g + 15) % 30;
    i := c / 4;
    k := c % 4;
    l := (32 + 2 * e + 2 * i - h - k) % 7;
    m := (a + 11 * h + 22 * l) / 451;
    n := (h + l - 7 * m + 114) / 31;
    p := (h + l - 7 * m + 114) % 31;
    mes := n;
    dia := p + 1;
    RETURN make_date(ano, mes, dia);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. FUNÇÃO PARA GERAR FERIADOS DE UM ANO
-- =====================================================
CREATE OR REPLACE FUNCTION santo_andre.gerar_feriados_ano(p_ano INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_pascoa DATE;
    v_carnaval DATE;
    v_sexta_santa DATE;
    v_corpus_christi DATE;
    v_count INTEGER := 0;
BEGIN
    -- Calcula Páscoa e feriados móveis
    v_pascoa := santo_andre.calcular_pascoa(p_ano);
    v_carnaval := v_pascoa - INTERVAL '47 days'; -- 47 dias antes da Páscoa
    v_sexta_santa := v_pascoa - INTERVAL '2 days'; -- Sexta-feira Santa
    v_corpus_christi := v_pascoa + INTERVAL '60 days'; -- 60 dias após a Páscoa

    -- Remove feriados existentes do ano (para não duplicar)
    DELETE FROM santo_andre.feriados 
    WHERE EXTRACT(YEAR FROM data) = p_ano;

    -- Insere feriados NACIONAIS fixos
    INSERT INTO santo_andre.feriados (data, descricao, tipo, recorrente, ativo) VALUES
    (make_date(p_ano, 1, 1), 'Confraternização Universal', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 4, 21), 'Tiradentes', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 5, 1), 'Dia do Trabalho', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 9, 7), 'Independência do Brasil', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 10, 12), 'Nossa Senhora Aparecida', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 11, 2), 'Finados', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 11, 15), 'Proclamação da República', 'NACIONAL', TRUE, TRUE),
    (make_date(p_ano, 12, 25), 'Natal', 'NACIONAL', TRUE, TRUE);
    v_count := v_count + 8;

    -- Insere feriados NACIONAIS móveis
    INSERT INTO santo_andre.feriados (data, descricao, tipo, recorrente, ativo) VALUES
    (v_carnaval::date, 'Carnaval', 'PONTO_FACULTATIVO', TRUE, TRUE),
    ((v_carnaval + INTERVAL '1 day')::date, 'Carnaval', 'PONTO_FACULTATIVO', TRUE, TRUE),
    (v_sexta_santa::date, 'Sexta-feira Santa', 'NACIONAL', TRUE, TRUE),
    (v_pascoa::date, 'Páscoa', 'NACIONAL', TRUE, TRUE),
    (v_corpus_christi::date, 'Corpus Christi', 'PONTO_FACULTATIVO', TRUE, TRUE);
    v_count := v_count + 5;

    -- Feriados ESTADUAIS da Paraíba (exemplo - ajuste conforme necessário)
    INSERT INTO santo_andre.feriados (data, descricao, tipo, recorrente, ativo) VALUES
    (make_date(p_ano, 8, 5), 'Fundação do Estado da Paraíba', 'ESTADUAL', TRUE, TRUE),
    (make_date(p_ano, 7, 26), 'Dia da Avó (Homenagem a Sant''Ana)', 'ESTADUAL', TRUE, TRUE);
    v_count := v_count + 2;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. GERAR FERIADOS PARA O ANO ATUAL E PRÓXIMO
-- =====================================================
SELECT santo_andre.gerar_feriados_ano(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER) as feriados_ano_atual;
SELECT santo_andre.gerar_feriados_ano(EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1) as feriados_proximo_ano;

-- =====================================================
-- 5. VERIFICAR FERIADOS GERADOS
-- =====================================================
SELECT 
    data,
    descricao,
    tipo,
    CASE WHEN recorrente THEN 'Sim' ELSE 'Não' END as recorrente
FROM santo_andre.feriados 
WHERE ativo = true
ORDER BY data;

SELECT 'Feriados gerados com sucesso!' as resultado;
