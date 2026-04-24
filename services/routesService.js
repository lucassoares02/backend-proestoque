const pool = require("../db");
const axios = require("axios");

/**
 * Get All Routes
 */
const findAll = async (state, company) => {
  const query = `
    SELECT
      r.id,
      r.company_id,
      r.name,
      r.state,
      r.state_description,
      r.description,
      r.active,
      r.min_delivery_notice_days,
      r.type AS schedule_type,

      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', rc.city_id,
            'nome', rc.city_name
          )
        ) FILTER (WHERE rc.id IS NOT NULL),
        '[]'
      ) AS cities,

      COALESCE(
        json_agg(DISTINCT rd.route_day)
          FILTER (WHERE rd.route_day IS NOT NULL),
        '[]'
      ) AS days

    FROM routes r
    LEFT JOIN route_cities rc ON rc.route_id = r.id
    LEFT JOIN route_dates rd ON rd.route_id = r.id
    where r.state = $1 and r.company_id = $2
    GROUP BY r.id
    ORDER BY r.id;
  `;

  const result = await pool.query(query, [state, company]);
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM routes WHERE id = $1", [id]);
  return result.rows[0] || null;
};

const create = async (data) => {
  const client = await pool.connect();

  try {
    const { company_id, name, state, state_description, description, active, cities, schedule_type, days, min_delivery_notice_days } = data;

    await client.query("BEGIN");

    const routeResult = await client.query(
      `
      INSERT INTO routes 
        (company_id, name, state, state_description, description, active, type, min_delivery_notice_days)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [company_id, name, state, state_description, description, active, schedule_type, min_delivery_notice_days]
    );

    const route = routeResult.rows[0];
    const routeId = route.id;

    if (Array.isArray(cities) && cities.length > 0) {
      const cityInsertQuery = `
        INSERT INTO route_cities
          (route_id, city_id, city_name, order_index, created_at)
        VALUES
          ($1, $2, $3, $4, NOW())
      `;

      for (let i = 0; i < cities.length; i++) {
        await client.query(cityInsertQuery, [routeId, cities[i]["id"], cities[i]["nome"], i + 1]);
      }
    }

    const dateInsertQuery = `
      INSERT INTO route_dates
        (route_id, route_day, status, created_at)
      VALUES
        ($1, $2, true, NOW())
    `;

    if (schedule_type === 1 && Array.isArray(days)) {
      for (const day of days) {
        await client.query(dateInsertQuery, [routeId, day]);
      }
    }

    if (schedule_type === 2 && days.length === 2) {
      await client.query(dateInsertQuery, [routeId, days[0]]);
      await client.query(dateInsertQuery, [routeId, days[1]]);
    }

    await client.query("COMMIT");

    return route;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const update = async (data) => {
  const client = await pool.connect();

  try {
    const { id, company_id, name, state, state_description, description, active, cities, schedule_type, days, min_delivery_notice_days } = data;

    await client.query("BEGIN");

    // 1️⃣ Atualiza a rota
    const routeResult = await client.query(
      `
      UPDATE routes
      SET
        company_id = $1,
        name = $2,
        state = $3,
        state_description = $4,
        description = $5,
        active = $6,
        type = $7,
        min_delivery_notice_days = $8,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
      `,
      [company_id, name, state, state_description, description, active, schedule_type, min_delivery_notice_days, id]
    );

    const route = routeResult.rows[0];

    if (!route) {
      throw new Error("Rota não encontrada");
    }

    // 2️⃣ Remove cidades antigas
    await client.query("DELETE FROM route_cities WHERE route_id = $1", [id]);

    // 3️⃣ Insere novas cidades
    if (Array.isArray(cities) && cities.length > 0) {
      const cityInsertQuery = `
        INSERT INTO route_cities
          (route_id, city_id, city_name, order_index, created_at)
        VALUES
          ($1, $2, $3, $4, NOW())
      `;

      for (let i = 0; i < cities.length; i++) {
        await client.query(cityInsertQuery, [id, cities[i].id, cities[i].nome, i + 1]);
      }
    }

    // 4️⃣ Remove dias antigos
    await client.query("DELETE FROM route_dates WHERE route_id = $1", [id]);

    // 5️⃣ Insere novos dias
    const dateInsertQuery = `
      INSERT INTO route_dates
        (route_id, route_day, status, created_at)
      VALUES
        ($1, $2, true, NOW())
    `;

    // Tipo 1 → dias específicos
    if (schedule_type === 1 && Array.isArray(days)) {
      for (const day of days) {
        await client.query(dateInsertQuery, [id, day]);
      }
    }

    // Tipo 2 → intervalo (2 dias)
    if (schedule_type === 2 && Array.isArray(days) && days.length === 2) {
      await client.query(dateInsertQuery, [id, days[0]]);
      await client.query(dateInsertQuery, [id, days[1]]);
    }

    await client.query("COMMIT");

    return route;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM routes WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

/**
 * Get All States from IBGE API
 */
const findAllStates = async () => {
  const result = await axios.get(`https://servicodados.ibge.gov.br/api/v1/localidades/estados`);
  console.log("Passando por aqui");
  console.log(result.data);
  return result.data || null;
};

/**
 * Get All Cities by State ID from IBGE API
 */
const findAllCities = async (stateId) => {
  const result = await axios.get(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateId}/municipios`);
  return result.data || null;
};

/**
 * Get All Available Routes
 */
const findAllAvailableRoutes = async (supplier, company) => {
  const result = await pool.query(
    `
WITH params AS (
  SELECT
    CURRENT_DATE AS today,
    CURRENT_DATE + INTERVAL '14 days' AS end_date
),

-- Empresa cliente (municipio)
client_company AS (
  SELECT codigo_municipio_ibge
  FROM companies
  WHERE id = $2
),

-- Rotas válidas para a cidade da empresa
valid_routes_by_city AS (
  SELECT rc.route_id
  FROM route_cities rc
  JOIN client_company cc
    ON cc.codigo_municipio_ibge = rc.city_id
),

-- Gera os próximos 14 dias respeitando o min_delivery_notice_days
valid_calendar AS (
  SELECT
    r.id AS route_id,
    r.type,
    r.min_delivery_notice_days,
    gs::date AS delivery_date,
    EXTRACT(DOW FROM gs)::int AS dow
  FROM routes r
  CROSS JOIN params p
  CROSS JOIN generate_series(
    p.today + r.min_delivery_notice_days,
    p.end_date,
    INTERVAL '1 day'
  ) gs
  WHERE r.active = true
    AND r.company_id = $1
    AND r.id IN (SELECT route_id FROM valid_routes_by_city)
),

-- Dias permitidos conforme route_dates
route_days AS (
  SELECT
    rd.route_id,
    rd.route_day
  FROM route_dates rd
  WHERE rd.status = 'true'
),

-- Regra para type = 1 (dias específicos)
type_1_dates AS (
  SELECT
    vc.route_id,
    vc.delivery_date
  FROM valid_calendar vc
  JOIN route_days rd
    ON rd.route_id = vc.route_id
   AND rd.route_day = vc.dow
  WHERE vc.type = 1
),

-- Regra para type = 2 (range)
type_2_range AS (
  SELECT
    rd.route_id,
    MIN(rd.route_day) AS range_start,
    MAX(rd.route_day) AS range_end
  FROM route_dates rd
  WHERE rd.status = 'true'
  GROUP BY rd.route_id
),

type_2_base AS (
  SELECT
    vc.route_id,
    vc.delivery_date,
    vc.dow,
    r.range_start,
    r.range_end
  FROM valid_calendar vc
  JOIN type_2_range r
    ON r.route_id = vc.route_id
  WHERE vc.type = 2
),

-- Verifica se o primeiro dia do range é válido
type_2_valid_ranges AS (
  SELECT DISTINCT
    route_id
  FROM type_2_base
  WHERE dow = range_start
),

type_2_dates AS (
  SELECT
    t.route_id,
    t.delivery_date
  FROM type_2_base t
  JOIN type_2_valid_ranges vr
    ON vr.route_id = t.route_id
  WHERE t.dow BETWEEN t.range_start AND t.range_end
),

-- União de todas as datas válidas
all_delivery_dates AS (
  SELECT route_id, delivery_date FROM type_1_dates
  UNION ALL
  SELECT route_id, delivery_date FROM type_2_dates
)

-- Resultado final
SELECT
  r.id            AS route_id,
  r.name          AS route_name,
  r.type          AS route_type,
  r.state,
  r.state_description,
  r.description,
  d.delivery_date
FROM all_delivery_dates d
JOIN routes r
  ON r.id = d.route_id
ORDER BY d.delivery_date, r.name;
`,
    [supplier, company]
  );

  return result.rows || null;
};

/**
 * Get All Cities by State ID from IBGE API
 */
const findStatesSelected = async (id) => {
  const result = await pool.query(
    "select state as id, state_description as nome from routes where company_id = $1 group by state, state_description",
    [id]
  );

  return result.rows || null;
};

module.exports = { findAll, find, create, update, remove, findAllStates, findAllCities, findStatesSelected, findAllAvailableRoutes };
