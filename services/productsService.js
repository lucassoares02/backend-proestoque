const pool = require("../db");

/**
 * Get All Products*/
const findAll = async (supplier, company) => {
  if (supplier == null || isNaN(supplier)) {
    console.log("Dentro do if supplier nulo");
    const query = `
      WITH product_items_qty AS (
    -- 🔹 Quantidade por produto + pack
    SELECT
        oi.product_id,
        oi.package_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS total_qty
    FROM order_items oi
    GROUP BY oi.product_id, oi.package_id
),

product_total_qty AS (
    -- 🔹 Quantidade total do produto (todos os packs)
    SELECT
        oi.product_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS quantity
    FROM order_items oi
    GROUP BY oi.product_id
)

SELECT
    p.*,

    -- 🔹 quantidade total do produto
    COALESCE(ptq.quantity, 0) AS quantity,

    COALESCE(imgs.images, '[]') AS images,
    COALESCE(prs.prices, '[]') AS prices

FROM products p

-- 🔹 quantidade total do produto
LEFT JOIN product_total_qty ptq
    ON ptq.product_id = p.id

-- 🔹 imagens
LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id', id,
                'url', url,
                'sort_order', sort_order,
                'type', type
            )
            ORDER BY sort_order NULLS LAST
        ) AS images
    FROM products_images
    GROUP BY product_id
) imgs ON imgs.product_id = p.id

-- 🔹 preços no novo formato (por pack)
LEFT JOIN (
    SELECT
        t.product_id,
        json_agg(
            json_build_object(
                'pack', t.pack,
                'description', t.description,
                'pack_units', t.pack_units,
                'quantity', t.client_quantity,
                'prices', t.prices_list
            )
            ORDER BY t.pack
        ) AS prices
    FROM (
        SELECT
            pp.product_id,
            pk.package_id AS pack,
            pk.quantity AS pack_units,
            pkg.title AS description,

            -- 🔹 quantidade nesse pack
            COALESCE(piq.total_qty, 0) AS client_quantity,

            json_agg(
                json_build_object(
                    'id', pp.id,
                    'qty_min', pp.qty_min,
                    'qty_max', pp.qty_max,
                    'unit_price', pp.unit_price
                )
                ORDER BY pp.qty_min
            ) AS prices_list
        FROM products_prices pp
        JOIN products_packages pk
            ON pk.id = pp.product_package_id
        JOIN packages pkg
            ON pkg.id = pk.package_id
        LEFT JOIN product_items_qty piq
            ON piq.product_id = pp.product_id
           AND piq.package_id = pk.package_id
        GROUP BY
            pp.product_id,
            pk.package_id,
            pk.quantity,
            pkg.title,
            piq.total_qty
    ) t
    GROUP BY t.product_id
) prs ON prs.product_id = p.id

WHERE
    p.company_id = $1
ORDER BY
    p.id;

    `;

    const result = await pool.query(query, [company]);
    return result.rows;
  } else {
    console.log("Dentro do else supplier com valor");
    const query = `
    WITH client_draft_items AS (
    -- 🔹 Quantidade do cliente por produto + pack
    SELECT
        oi.product_id,
        oi.package_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS total_qty
    FROM order_items oi
    JOIN orders o
        ON o.id = oi.order_id
    WHERE o.company_id = $2
      AND o.status = 'DRAFT'
    GROUP BY oi.product_id, oi.package_id
)

SELECT
    p.*,

    -- 🔹 quantidade total do produto no draft (soma de todos os packs)
    COALESCE(oi.quantity, 0) AS quantity,

    COALESCE(imgs.images, '[]') AS images,
    COALESCE(prs.prices, '[]') AS prices

FROM products p

-- 🔹 quantidade total do produto (independente do pack)
LEFT JOIN (
    SELECT
        oi.product_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS quantity
    FROM order_items oi
    JOIN orders o
        ON o.id = oi.order_id
    WHERE o.company_id = $2
      AND o.status = 'DRAFT'
    GROUP BY oi.product_id
) oi ON oi.product_id = p.id

-- 🔹 imagens
LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id', id,
                'url', url,
                'sort_order', sort_order,
                'type', type
            )
            ORDER BY sort_order NULLS LAST
        ) AS images
    FROM products_images
    GROUP BY product_id
) imgs ON imgs.product_id = p.id

-- 🔹 preços no NOVO FORMATO (por pack)
LEFT JOIN (
    SELECT
        t.product_id,
        json_agg(
            json_build_object(
                'pack', t.pack,
                'description', t.description,
                'pack_units', t.pack_units,
                'quantity', t.client_quantity,
                'prices', t.prices_list
            )
            ORDER BY t.pack
        ) AS prices
    FROM (
        SELECT
            pp.product_id,
            pk.package_id AS pack,
            pk.quantity AS pack_units,
            pkg.title AS description,

            -- 🔹 quantidade do cliente nesse pack
            COALESCE(cdi.total_qty, 0) AS client_quantity,

            json_agg(
                json_build_object(
                    'id', pp.id,
                    'qty_min', pp.qty_min,
                    'qty_max', pp.qty_max,
                    'unit_price', pp.unit_price
                )
                ORDER BY pp.qty_min
            ) AS prices_list
        FROM products_prices pp
        JOIN products_packages pk
            ON pk.id = pp.product_package_id
        JOIN packages pkg
            ON pkg.id = pk.package_id
        LEFT JOIN client_draft_items cdi
            ON cdi.product_id = pp.product_id
           AND cdi.package_id = pk.package_id
        GROUP BY
            pp.product_id,
            pk.package_id,
            pkg.title,
            pk.quantity,
            cdi.total_qty
    ) t
    GROUP BY t.product_id
) prs ON prs.product_id = p.id

WHERE
    p.company_id = $1
ORDER BY
    p.id;

  `;

    const result = await pool.query(query, [company, supplier]);
    return result.rows;
  }
};

const find = async (id, client) => {
  console.log("Finding product with ID:", id);

  if (client != null && client != "null") {
    const result = await pool.query(
      `WITH client_draft_items AS (
        -- 🔹 Busca isolada do que o cliente tem no carrinho por pacote
        SELECT
            oi.product_id,
            oi.package_id,
            CAST(SUM(oi.quantity) AS INTEGER) AS total_qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.company_id = $2 
          AND o.status = 'DRAFT'
        GROUP BY oi.product_id, oi.package_id
    )

    SELECT
        p.*,
        COALESCE(imgs.images, '[]') AS images,
        COALESCE(prs.prices, '[]') AS prices,
        COALESCE(pps.packages, '[]') AS packages
    FROM products p

    -- IMAGENS
    LEFT JOIN (
        SELECT
            product_id,
            json_agg(
                json_build_object(
                    'id', id,
                    'url', url,
                    'sort_order', sort_order,
                    'type', type
                )
                ORDER BY sort_order NULLS LAST
            ) AS images
        FROM products_images
        GROUP BY product_id
    ) imgs ON imgs.product_id = p.id

    -- PREÇOS AGRUPADOS POR PACKAGE + QUANTITY DO CLIENTE
    LEFT JOIN (
        SELECT
            t.product_id,
            json_agg(
                json_build_object(
                    'pack', t.pack,
                    'pack_units', t.pack_units,
                    'description', t.description,
                    'quantity', t.client_quantity, -- 🔹 Quantidade do cliente no nível do pack
                    'prices', t.prices_list
                )
                ORDER BY t.pack
            ) AS prices
        FROM (
            SELECT
                ppz.product_id,
                pk.package_id AS pack,
                pk.quantity AS pack_units,
                pkg.title AS description,
                -- Busca o valor da CTE ou retorna 0
                COALESCE(cdi.total_qty, 0) AS client_quantity,
                json_agg(
                    json_build_object(
                        'id', ppz.id,
                        'qty_min', ppz.qty_min,
                        'qty_max', ppz.qty_max,
                        'unit_price', ppz.unit_price
                    )
                    ORDER BY ppz.qty_min
                ) AS prices_list
            FROM products_prices ppz
            JOIN products_packages pk ON pk.id = ppz.product_package_id
            JOIN packages pkg ON pkg.id = pk.package_id
            -- Link com a CTE de quantidades
            LEFT JOIN client_draft_items cdi 
                ON cdi.product_id = ppz.product_id 
                AND cdi.package_id = pk.package_id
            GROUP BY
                ppz.product_id,
                pk.package_id,
                pkg.title,
                pk.quantity,
                cdi.total_qty
        ) t
        GROUP BY t.product_id
    ) prs ON prs.product_id = p.id

    -- PACKAGES
    LEFT JOIN (
        SELECT
            product_id,
            json_agg(
                json_build_object(
                    'id', id,
                    'pack', package_id,
                    'units', quantity,
                    'weight', weight
                )
                ORDER BY id
            ) AS packages
        FROM products_packages
        GROUP BY product_id
    ) pps ON pps.product_id = p.id

    WHERE
        p.id = $1
    ORDER BY
        p.id;`,
      [id, client],
    );
    return result.rows[0] || null;
  } else {
    const result = await pool.query(
      `
       WITH product_items_qty AS (
    -- 🔹 Quantidade total por produto + pacote (independente de cliente)
    SELECT
        oi.product_id,
        oi.package_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS total_qty
    FROM order_items oi
    WHERE oi.product_id = $1
    GROUP BY oi.product_id, oi.package_id
)

SELECT
    p.*,
    COALESCE(imgs.images, '[]') AS images,
    COALESCE(prs.prices, '[]') AS prices,
    COALESCE(pps.packages, '[]') AS packages
FROM products p

-- IMAGENS
LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id', id,
                'url', url,
                'sort_order', sort_order,
                'type', type
            )
            ORDER BY sort_order NULLS LAST
        ) AS images
    FROM products_images
    GROUP BY product_id
) imgs ON imgs.product_id = p.id

-- PREÇOS AGRUPADOS POR PACKAGE + QUANTITY
LEFT JOIN (
    SELECT
        t.product_id,
        json_agg(
            json_build_object(
                'pack', t.pack,
                'pack_units', t.pack_units,
                'description', t.description,
                'quantity', t.client_quantity,
                'prices', t.prices_list
            )
            ORDER BY t.pack
        ) AS prices
    FROM (
        SELECT
            ppz.product_id,
            pk.package_id AS pack,
            pk.quantity AS pack_units,
            pkg.title AS description,
            COALESCE(piq.total_qty, 0) AS client_quantity,
            json_agg(
                json_build_object(
                    'id', ppz.id,
                    'qty_min', ppz.qty_min,
                    'qty_max', ppz.qty_max,
                    'unit_price', ppz.unit_price
                )
                ORDER BY ppz.qty_min
            ) AS prices_list
        FROM products_prices ppz
        JOIN products_packages pk 
            ON pk.id = ppz.product_package_id
        JOIN packages pkg 
            ON pkg.id = pk.package_id
        LEFT JOIN product_items_qty piq
            ON piq.product_id = ppz.product_id
           AND piq.package_id = pk.package_id
        GROUP BY
            ppz.product_id,
            pk.package_id,
            pk.quantity,
            pkg.title,
            piq.total_qty
    ) t
    GROUP BY t.product_id
) prs ON prs.product_id = p.id

-- PACKAGES
LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id', id,
                'pack', package_id,
                'units', quantity,
                'weight', weight
            )
            ORDER BY id
        ) AS packages
    FROM products_packages
    GROUP BY product_id
) pps ON pps.product_id = p.id

WHERE
    p.id = $1
ORDER BY
    p.id;

`,
      [id],
    );
    return result.rows[0] || null;
  }
};

const create = async (data) => {
  const {
    sku,
    ean,
    name,
    description,
    complement,
    brand,
    packageType,
    unitsPerPackage,
    unitOfMeasure,
    weight,
    active,
    visibility,
    categoryId,
    companyId,
    image,
    content,
    masterPackage,
    prices,
    packages,
  } = data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const insertProductQuery = `
      INSERT INTO products
      (sku, ean, name, description, complement, brand, package_type, units_per_package, unit_of_measure,
       weight, active, visibility, category_id, company_id, content, master_package)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *;
    `;

    const productValues = [
      sku,
      ean,
      name,
      description,
      complement,
      brand,
      packageType,
      unitsPerPackage,
      unitOfMeasure,
      weight,
      active,
      visibility,
      categoryId,
      companyId,
      content,
      masterPackage,
    ];

    const productRes = await client.query(insertProductQuery, productValues);
    const product = productRes.rows[0];

    let imageRow = null;
    if (image) {
      const insertImageQuery = `
        INSERT INTO products_images (product_id, url, sort_order, type)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const imageValues = [product.id, image, 1, "main"];
      const imageRes = await client.query(insertImageQuery, imageValues);
      imageRow = imageRes.rows[0];
    }

    // Inserir packages na tabela products_packages (se existir array packages)
    const packagesRows = [];
    // Map para relacionar package_id -> products_packages.id
    const packageMap = new Map();

    if (packages && Array.isArray(packages) && packages.length > 0) {
      const insertPackageQuery = `
    INSERT INTO products_packages (product_id, package_id, quantity, weight)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;

      for (const p of packages) {
        // lidar com possíveis nomes de campo diferentes no payload
        const pack = p.pack ?? p.package_id ?? p.package ?? null;
        const units = p.units ?? p.quantity ?? null;
        const weight = p.weight ?? p.wt ?? null;

        // se algum campo essencial estiver faltando, pule esse registro
        if (pack == null || units == null || weight == null) {
          console.warn("Skipping invalid package entry:", p);
          continue;
        }

        const packagesValues = [product.id, pack, units, weight];
        const packageRes = await client.query(insertPackageQuery, packagesValues);
        const inserted = packageRes.rows[0];
        packagesRows.push(inserted);

        // assumimos que a coluna no resultado é package_id e o id gerado é id
        // armazena no map para usar depois na inserção de prices
        packageMap.set(String(inserted.package_id), inserted.id);

        console.log("Inserted package:", inserted);
      }
    }

    console.log("Prices to insert:", prices);
    const priceRows = [];
    if (prices && Array.isArray(prices) && prices.length > 0) {
      const insertPriceQuery = `
    INSERT INTO products_prices (product_id, qty_min, qty_max, unit_price, product_package_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;

      // query para fallback caso o package não tenha sido inserido agora, mas já exista no DB
      const findPackageQuery = `
    SELECT id FROM products_packages
    WHERE product_id = $1 AND package_id = $2
    LIMIT 1;
  `;

      for (const p of prices) {
        console.log("Inserting price entry:", p);

        // identificar o package referenciado no payload (pode ter chaves diferentes)
        const packIdentifier = p.pack ?? p.product_package_id ?? p.package_id ?? null;

        const qtyMin = p.min_qty ?? p.qty_min ?? p.qtyMin ?? null;
        const qtyMax = p.max_qty ?? p.qty_max ?? p.qtyMax ?? null;
        const rawPrice = p.price_cents ?? p.unit_price ?? p.price ?? null;

        // se algum campo essencial estiver faltando, pule esse registro
        if (qtyMin == null || qtyMax == null || rawPrice == null || packIdentifier == null) {
          console.warn("Skipping invalid price entry (missing fields):", p);
          continue;
        }

        // tenta pegar o id do products_packages via map (inserções que fizemos acima)
        let productsPackageId = packageMap.get(String(packIdentifier)) ?? null;

        // fallback: se não estiver no map, tenta buscar no DB (por exemplo, package já existia)
        if (!productsPackageId) {
          const fallbackRes = await client.query(findPackageQuery, [product.id, packIdentifier]);
          if (fallbackRes.rows.length > 0) {
            productsPackageId = fallbackRes.rows[0].id;
            // salva no map para próximas iterações
            packageMap.set(String(packIdentifier), productsPackageId);
            console.log(`Found existing products_packages.id=${productsPackageId} for package_id=${packIdentifier}`);
          }
        }

        // se ainda não encontrou, pulamos (ou, opcional: inserir automaticamente um products_packages)
        if (!productsPackageId) {
          console.warn(`Skipping price entry because no products_packages entry found for package identifier: ${packIdentifier}`, p);
          continue;
        }

        // Converter para number com 2 casas decimais (assumindo que rawPrice já representa o valor em moeda)
        const unitPrice = Number(Number(rawPrice).toFixed(2));

        const priceValues = [product.id, qtyMin, qtyMax, unitPrice, productsPackageId];
        const priceRes = await client.query(insertPriceQuery, priceValues);
        priceRows.push(priceRes.rows[0]);
      }
    }

    await client.query("COMMIT");

    // Se quiser retornar o produto já com a imagem e prices embutidos:
    product.images = imageRow ? [imageRow] : [];
    product.prices = priceRows;
    product.packages = packagesRows;

    return product;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err; // deixe o chamador decidir o que fazer com o erro
  } finally {
    client.release();
  }
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const {
    id,
    sku,
    ean,
    name,
    description,
    complement,
    brand,
    packageType,
    unitsPerPackage,
    unitOfMeasure,
    weight,
    volume,
    active,
    visibility,
    createdAt,
    updatedAt,
    deletedAt,
    categoryId,
    companyId,
  } = data;
  const result = await pool.query(
    "UPDATE products SET id = $1, sku = $2, ean = $3, name = $4, description = $5, complement = $6, brand = $7, package_type = $8, units_per_package = $9, unit_of_measure = $10, weight = $11, volume = $12, active = $13, visibility = $14, created_at = $15, updated_at = $16, deleted_at = $17, category_id = $18, company_id = $19 WHERE id = $20 RETURNING *",
    [
      id,
      sku,
      ean,
      name,
      description,
      complement,
      brand,
      packageType,
      unitsPerPackage,
      unitOfMeasure,
      weight,
      volume,
      active,
      visibility,
      createdAt,
      updatedAt,
      deletedAt,
      categoryId,
      companyId,
      id,
    ],
  );
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove };
