const pool = require("../db");

/**
 * Title Case: primeira letra de cada palavra em maiúscula.
 * Ex.: "carne bovina" -> "Carne Bovina". Mesma regra do Flutter (capitalizeWords).
 */
const toTitleCase = (value) => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim().replace(/\s+/g, " ");
  if (str === "") return null;
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
};

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const parseIntOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : parseInt(n, 10);
};

/**
 * Get All products_categories (mantém comportamento legado: subcategorias).
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM products_categories where parent_id is not null ORDER BY id");
  return result.rows;
};

/**
 * Categorias de topo (parent_id IS NULL).
 */
const findRoots = async () => {
  const result = await pool.query(
    "SELECT * FROM products_categories WHERE parent_id IS NULL AND COALESCE(active, true) = true ORDER BY sort_order ASC NULLS LAST, name ASC",
  );
  return result.rows;
};

/**
 * Subcategorias de uma categoria (parent_id = :parentId).
 */
const findSubcategories = async (parentId) => {
  const result = await pool.query(
    "SELECT * FROM products_categories WHERE parent_id = $1 AND COALESCE(active, true) = true ORDER BY sort_order ASC NULLS LAST, name ASC",
    [parentId],
  );
  return result.rows;
};

const _productsSubCategoryColumnExists = async () => {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'sub_category_id' LIMIT 1`,
  );
  return rows.length > 0;
};

/**
 * Categorias relevantes para o fornecedor: categorias de topo e subcategorias
 * efetivamente usadas pelos produtos (via category_id e sub_category_id),
 * incluindo as categorias-pai das subcategorias usadas — assim o front monta
 * a navegação em dois níveis (categoria → subcategorias).
 */
const findCategoriesSupplier = async (id) => {
  const hasSub = await _productsSubCategoryColumnExists();
  const subUnion = hasSub
    ? `UNION
       SELECT p.sub_category_id AS cid FROM products p
       WHERE p.company_id = $1 AND p.active = true AND p.deleted_at IS NULL AND p.sub_category_id IS NOT NULL`
    : "";

  const result = await pool.query(
    `WITH used AS (
       SELECT DISTINCT p.category_id AS cid FROM products p
       WHERE p.company_id = $1 AND p.active = true AND p.deleted_at IS NULL AND p.category_id IS NOT NULL
       ${subUnion}
     ),
     relevant AS (
       SELECT cid FROM used WHERE cid IS NOT NULL
       UNION
       SELECT pc.parent_id FROM products_categories pc
       WHERE pc.id IN (SELECT cid FROM used WHERE cid IS NOT NULL) AND pc.parent_id IS NOT NULL
     )
     SELECT pc.id, pc.name, pc.slug, pc.description, pc.image_url, pc.sort_order, pc.parent_id,
            parent.name AS parent_name
     FROM products_categories pc
     LEFT JOIN products_categories parent ON parent.id = pc.parent_id
     WHERE pc.id IN (SELECT cid FROM relevant) AND pc.active = true
     ORDER BY (pc.parent_id IS NOT NULL), pc.sort_order ASC NULLS LAST, pc.name ASC`,
    [id],
  );
  return result.rows;
};

const find = async (id) => {
  const result = await pool.query("SELECT * FROM products_categories WHERE id = $1", [id]);
  return result.rows[0] || null;
};

/**
 * Procura uma categoria/subcategoria existente pelo nome (case-insensitive),
 * dentro do mesmo nível (mesmo parent_id). Evita duplicidade.
 */
const findByName = async (name, parentId) => {
  const result = await pool.query(
    `SELECT * FROM products_categories
     WHERE LOWER(name) = LOWER($1)
       AND parent_id IS NOT DISTINCT FROM $2
     LIMIT 1`,
    [name, parentId],
  );
  return result.rows[0] || null;
};

/**
 * Cria categoria (parentId null) ou subcategoria (parentId definido).
 * - Nome em Title Case
 * - Dedup case-insensitive por nível: se já existir, retorna a existente
 * - id auto-gerado (ignora id do body), slug gerado quando ausente
 */
const create = async (data) => {
  const name = toTitleCase(data.name);
  if (!name) {
    const err = new Error("Nome da categoria é obrigatório");
    err.statusCode = 400;
    throw err;
  }

  const parentId = parseIntOrNull(data.parentId ?? data.parent_id);

  // Dedup case-insensitive no mesmo nível.
  const existing = await findByName(name, parentId);
  if (existing) return existing;

  const slug = data.slug && String(data.slug).trim() !== "" ? data.slug : slugify(name);
  const description = data.description ?? null;
  const imageUrl = data.imageUrl ?? data.image_url ?? null;
  const sortOrder = parseIntOrNull(data.sortOrder ?? data.sort_order) ?? 0;
  const active = data.active === undefined || data.active === null ? true : data.active;

  const insertSql = `INSERT INTO products_categories (name, description, slug, parent_id, image_url, sort_order, active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`;
  const params = [name, description, slug, parentId, imageUrl, sortOrder, active];

  try {
    const result = await pool.query(insertSql, params);
    return result.rows[0];
  } catch (e) {
    // Sequência do id fora de sincronia (registros antigos inseridos com id
    // explícito não avançaram a sequence) → ressincroniza e tenta novamente.
    if (e && e.code === "23505") {
      await _resyncIdSequence();
      const retry = await pool.query(insertSql, params);
      return retry.rows[0];
    }
    throw e;
  }
};

/**
 * Alinha a sequence de products_categories.id ao MAX(id) atual, corrigindo
 * casos em que ids foram inseridos manualmente no passado.
 */
const _resyncIdSequence = async () => {
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('products_categories', 'id'),
       COALESCE((SELECT MAX(id) FROM products_categories), 0) + 1,
       false
     )`,
  );
};

const update = async (data) => {
  const { id } = data;
  const name = toTitleCase(data.name);
  const parentId = parseIntOrNull(data.parentId ?? data.parent_id);
  const slug = data.slug && String(data.slug).trim() !== "" ? data.slug : slugify(name);
  const result = await pool.query(
    `UPDATE products_categories
     SET name = $1, description = $2, slug = $3, parent_id = $4, image_url = $5,
         sort_order = $6, active = $7, updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [
      name,
      data.description ?? null,
      slug,
      parentId,
      data.imageUrl ?? data.image_url ?? null,
      parseIntOrNull(data.sortOrder ?? data.sort_order) ?? 0,
      data.active === undefined || data.active === null ? true : data.active,
      id,
    ],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM products_categories WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = {
  findAll,
  findRoots,
  findSubcategories,
  findCategoriesSupplier,
  find,
  findByName,
  create,
  update,
  remove,
  toTitleCase,
};
