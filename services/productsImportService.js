const pool = require("../db");

// ─── column introspection ────────────────────────────────────────────────────
// Retorna { column_name: data_type } para as colunas pedidas
const _getColumnMeta = async (client, columns) => {
  const { rows } = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'products'
       AND column_name  = ANY($1)`,
    [columns],
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
};

// Converte um booleano JS para o tipo correto conforme o banco
// Se a coluna for integer/smallint → envia 1/0; caso contrário → envia true/false
const _boolVal = (bool, dataType) =>
  dataType && /int/.test(dataType) ? (bool ? 1 : 0) : bool;

// ─── helpers ─────────────────────────────────────────────────────────────────
const _resolveActive = (val) => {
  if (val === undefined || val === null || val === "") return true;
  return ["true", "1", "yes", "sim", "ativo", "active"].includes(String(val).toLowerCase().trim());
};

// Validação de estrutura e tipos — retorna array de { field, value, message }
const _validateRow = (row, { hasWeight }) => {
  const errors = [];

  const err = (field, value, message) => errors.push({ field, value, message });

  // name: obrigatório (tipo: texto)
  if (!row.name || String(row.name).trim() === "") {
    err("name", row.name ?? "", `campo obrigatório (tipo: texto)`);
  }

  // ean: somente dígitos, 8–14 caracteres (tipo: numérico)
  const ean = row.ean ? String(row.ean).trim() : "";
  if (ean) {
    if (!/^\d+$/.test(ean)) {
      err("ean", ean, `valor "${ean}" inválido (tipo esperado: somente dígitos) — letras e símbolos não são permitidos`);
    } else if (ean.length < 8 || ean.length > 14) {
      err("ean", ean, `valor "${ean}" tem ${ean.length} dígito(s) (tipo esperado: 8–14 dígitos)`);
    }
  }

  // weight: número decimal (tipo: numeric)
  if (hasWeight && row.weight !== undefined && row.weight !== null && row.weight !== "") {
    const raw = String(row.weight).trim();
    if (isNaN(parseFloat(raw)) || !/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(raw)) {
      err("weight", raw, `valor "${raw}" inválido (tipo esperado: número decimal) — use ponto como separador (ex: 1.5, 0.250)`);
    }
  }

  // category_id: número inteiro (tipo: integer)
  if (row.category_id !== undefined && row.category_id !== null && row.category_id !== "") {
    const raw = String(row.category_id).trim();
    if (!/^\d+$/.test(raw)) {
      err("category_id", raw, `valor "${raw}" inválido (tipo esperado: número inteiro)`);
    }
  }

  // active: booleano (tipo: boolean)
  const activeRaw = row.active !== undefined && row.active !== null ? String(row.active).trim().toLowerCase() : "";
  const validActive = ["true", "false", "1", "0", "sim", "não", "nao", "ativo", "inativo", "active", "inactive", ""];
  if (activeRaw && !validActive.includes(activeRaw)) {
    err("active", activeRaw, `valor "${activeRaw}" inválido (tipo esperado: booleano) — use: true, false, 1, 0, sim ou não`);
  }

  return errors;
};

// Formata erros de validação para a mensagem final
const _formatValidationErrors = (errors) =>
  errors.map((e) => `campo "${e.field}" → ${e.message}`).join(" | ");

// Traduz erros do PostgreSQL — se ainda chegar algum
const _pgErrorToMessage = (err, row) => {
  if (err.code === "23505") {
    if (err.constraint?.includes("ean")) return `ean: EAN duplicado — "${row.ean}" já existe no catálogo`;
    if (err.constraint?.includes("sku")) return `sku: SKU duplicado — "${row.sku}" já existe no catálogo`;
    return "Registro duplicado — verifique EAN ou SKU";
  }
  if (err.code === "23502") {
    const col = err.column ?? "desconhecido";
    return `${col}: Campo obrigatório ausente`;
  }
  if (err.code === "22P02") {
    // PostgreSQL informa o tipo e o valor na mensagem, ex:
    // "invalid input syntax for type integer: \"12.0\""
    // "invalid input syntax for type boolean: \"sim\""
    const match = err.message.match(/type (\w+):\s*"([^"]+)"/i);
    if (match) {
      const [, pgType, value] = match;
      const typeMap = { integer: "número inteiro", numeric: "número decimal", boolean: "booleano (true/false)", float4: "número decimal", float8: "número decimal" };
      const readableType = typeMap[pgType.toLowerCase()] ?? pgType;
      return `valor "${value}" é inválido para o tipo ${readableType} — verifique qual campo contém esse dado e corrija o formato`;
    }
    return `Tipo de dado inválido: ${err.message}`;
  }
  if (err.code === "42703") {
    return `Coluna não encontrada no banco: ${err.message}`;
  }
  if (err.code === "23503") {
    return `category_id: Categoria referenciada não existe`;
  }
  return err.message;
};

// ─── main ─────────────────────────────────────────────────────────────────────
const importProducts = async ({ products, companyId }) => {
  const connCheck = await pool.connect();
  const colMeta = await _getColumnMeta(connCheck, ["brand_id", "weight", "visibility", "active"]);
  connCheck.release();

  const hasBrandId   = "brand_id"   in colMeta;
  const hasWeight    = "weight"     in colMeta;
  const hasVisibility = "visibility" in colMeta;
  const activeType   = colMeta["active"]     ?? "boolean";
  const visibilityType = colMeta["visibility"] ?? "boolean";

  const success_items = [];
  const failed_items = [];

  for (let i = 0; i < products.length; i++) {
    const row = products[i];
    const lineNumber = row._line ? parseInt(row._line, 10) : i + 2;

    // Validação completa de tipos antes de qualquer chamada ao banco
    const validationErrors = _validateRow(row, { hasWeight });
    if (validationErrors.length > 0) {
      failed_items.push({
        line_number: lineNumber,
        name: row.name || `Linha ${lineNumber}`,
        product_data: row,
        error_message: _formatValidationErrors(validationErrors),
      });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Resolve brand
      let resolvedBrand = row.brand ? String(row.brand).trim() : null;
      let resolvedBrandId = null;
      if (resolvedBrand) {
        const { rows: brandRows } = await client.query(
          `SELECT id, name FROM brands WHERE LOWER(name) = LOWER($1) AND company_id = $2 LIMIT 1`,
          [resolvedBrand, companyId],
        );
        if (brandRows.length > 0) {
          resolvedBrand = brandRows[0].name;
          resolvedBrandId = brandRows[0].id;
        }
      }

      // Resolve category
      let categoryId = null;
      if (row.category_id && !isNaN(row.category_id)) {
        categoryId = parseInt(row.category_id, 10);
      } else if (row.category) {
        const { rows: catRows } = await client.query(
          `SELECT id FROM products_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [String(row.category).trim()],
        );
        if (catRows.length > 0) {
          categoryId = catRows[0].id;
        } else {
          throw Object.assign(new Error(`category: Categoria "${row.category}" não encontrada`), { _field: "category" });
        }
      }

      // Colunas sempre presentes
      const cols = ["sku", "ean", "name", "brand", "description", "content", "unit_of_measure", "active", "category_id", "company_id"];
      const vals = [
        row.sku || null,
        row.ean || null,
        String(row.name).trim(),
        resolvedBrand,
        row.description || null,
        row.content || null,
        row.unit_of_measure || null,
        _boolVal(_resolveActive(row.active), activeType),   // respeita o tipo real da coluna
        categoryId,
        companyId,
      ];

      // Colunas opcionais — somente se existirem no banco
      if (hasWeight) {
        cols.push("weight");
        vals.push(row.weight !== undefined && row.weight !== null && row.weight !== "" ? parseFloat(row.weight) : null);
      }
      if (hasVisibility) {
        cols.push("visibility");
        vals.push(_boolVal(true, visibilityType));           // respeita o tipo real da coluna
      }
      if (hasBrandId) {
        cols.push("brand_id");
        vals.push(resolvedBrandId);
      }

      const placeholders = vals.map((_, idx) => `$${idx + 1}`).join(", ");
      const { rows: productRows } = await client.query(
        `INSERT INTO products (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id, name`,
        vals,
      );
      const product = productRows[0];

      const imageUrl = row.image_url || row.image || null;
      if (imageUrl) {
        await client.query(
          `INSERT INTO products_images (product_id, url, sort_order, type) VALUES ($1, $2, 1, 'main')`,
          [product.id, imageUrl],
        );
      }

      await client.query("COMMIT");
      success_items.push({ line_number: lineNumber, id: product.id, name: product.name });
    } catch (err) {
      await client.query("ROLLBACK");
      failed_items.push({
        line_number: lineNumber,
        name: row.name || `Linha ${lineNumber}`,
        product_data: row,
        error_message: _pgErrorToMessage(err, row),
      });
    } finally {
      client.release();
    }
  }

  return { success_items, failed_items };
};

module.exports = { importProducts };
