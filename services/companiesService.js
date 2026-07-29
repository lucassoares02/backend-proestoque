const pool = require("../db");

const find = async (id) => {
  const result = await pool.query(
    "select c.id, c.razao_social, c.nome_fantasia, c.cnpj, uc.relation_type from companies c join users_companies uc on uc.company_id = c.id where uc.user_id = $1",
    [id],
  );
  return result.rows || null;
};

const findId = async (id, company) => {
  const result = await pool.query(
    "select c.*, uc.relation_type from companies c join users_companies uc on uc.company_id = c.id where uc.user_id = $1 and uc.company_id = $2",
    [id, company],
  );
  return result.rows || null;
};

// const findProvidersCity = async (company) => {
//   const result = await pool.query(
//     "SELECT DISTINCT c.* FROM companies c JOIN routes r ON r.company_id = c.id JOIN route_cities rc ON rc.route_id = r.id JOIN companies c2 ON c2.codigo_municipio_ibge = rc.city_id WHERE c2.id = $1",
//     [company]
//   );
//   return result.rows || null;
// };

const findProvidersCity = async (company) => {
  // Oculta fornecedores sem produtos: só retorna empresas que possuem ao menos
  // um produto ativo e não excluído.
  //
  // Ordena dando prioridade para quem está aberto e tem identidade configurada:
  //   1) abertos primeiro (fechados vão para o fim da lista)
  //   2) com banner configurado
  //   3) com logo/foto configurada
  //   4) ordem alfabética como desempate
  const result = await pool.query(
    `SELECT c.*, MAX(o.id) AS order_id
       FROM companies c
       JOIN routes r ON r.company_id = c.id
       JOIN route_cities rc ON rc.route_id = r.id
       JOIN companies c2 ON c2.codigo_municipio_ibge = rc.city_id
       LEFT JOIN orders o ON o.supplier_id = c.id AND o.company_id = c2.id AND o.status = 'DRAFT'
      WHERE c2.id = $1
        AND EXISTS (
          SELECT 1 FROM products p
           WHERE p.company_id = c.id AND p.active = true AND p.deleted_at IS NULL
        )
      GROUP BY c.id
      ORDER BY COALESCE(c.is_open, true) DESC,
               (c.banner IS NOT NULL AND c.banner <> '') DESC,
               (c.logo IS NOT NULL AND c.logo <> '') DESC,
               COALESCE(NULLIF(c.nome_fantasia, ''), c.razao_social) ASC;`,
    [company],
  );
  return result.rows || null;
};

// update company — dynamic: only updates fields present in the payload
const update = async (company) => {
  const fields = [];
  const values = [];
  let idx = 1;

  if (company.nome_fantasia !== undefined) {
    fields.push(`nome_fantasia = $${idx++}`);
    values.push(company.nome_fantasia);
  }
  if (company.logo !== undefined) {
    fields.push(`logo = $${idx++}`);
    values.push(company.logo || null);
  }
  if (company.color !== undefined) {
    fields.push(`color = $${idx++}`);
    values.push(company.color ? company.color.replace("#", "") : null);
  }
  if (company.banner !== undefined) {
    fields.push(`banner = $${idx++}`);
    values.push(company.banner || null);
  }
  if (company.is_open !== undefined) {
    fields.push(`is_open = $${idx++}`);
    values.push(company.is_open === true || company.is_open === "true");
  }

  if (fields.length === 0) throw new Error("Nenhum campo para atualizar");

  values.push(company.id);
  const result = await pool.query(`UPDATE companies SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`, values);
  return result.rows[0];
};

module.exports = { find, findId, findProvidersCity, update };
