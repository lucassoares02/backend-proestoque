const pool = require("../db");

/**
 * Get All Products*/
const findAll = async (supplier, company, category) => {
  if (supplier == null || isNaN(supplier)) {
    console.log("Lista de produtos para Fornecedores");

    const query = `WITH product_items_qty AS (
    SELECT
        oi.product_id,
        oi.package_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS total_qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.supplier_id = $1
    GROUP BY oi.product_id, oi.package_id
),

product_total_qty AS (
    SELECT
        oi.product_id,
        CAST(SUM(oi.quantity) AS INTEGER) AS quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.supplier_id = $1
    GROUP BY oi.product_id
)

SELECT
    p.*,

    json_build_object(
        'id',        cat.id,
        'name',      cat.name,
        'slug',      cat.slug,
        'parent_id', cat.parent_id
    ) AS category,

    COALESCE(ptq.quantity, 0) AS quantity,

    COALESCE(imgs.images, '[]') AS images,
    COALESCE(prs.prices, '[]') AS prices

FROM products p

LEFT JOIN products_categories cat ON cat.id = p.category_id

LEFT JOIN product_total_qty ptq ON ptq.product_id = p.id

LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id',         id,
                'url',        url,
                'sort_order', sort_order,
                'type',       type
            )
            ORDER BY sort_order NULLS LAST
        ) AS images
    FROM products_images
    GROUP BY product_id
) imgs ON imgs.product_id = p.id

LEFT JOIN (
    SELECT
        t.product_id,
        json_agg(
            json_build_object(
                'pack',        t.pack,
                'description', t.description,
                'pack_units',  t.pack_units,
                'quantity',    t.client_quantity,
                'prices',      t.prices_list
            )
            ORDER BY t.pack
        ) AS prices
    FROM (
        SELECT
            pp.product_id,
            pk.package_id AS pack,
            pk.quantity    AS pack_units,
            pkg.title      AS description,

            COALESCE(piq.total_qty, 0) AS client_quantity,

            json_agg(
                json_build_object(
                    'id',         pp.id,
                    'qty_min',    pp.qty_min,
                    'qty_max',    pp.qty_max,
                    'unit_price', pp.unit_price
                )
                ORDER BY pp.qty_min
            ) AS prices_list
        FROM products_prices pp
        JOIN products_packages pk  ON pk.id  = pp.product_package_id
        JOIN packages pkg           ON pkg.id = pk.package_id
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
    AND p.deleted_at IS NULL
    ${category != 0 ? "AND p.category_id IN (SELECT id FROM products_categories WHERE id = $2 OR parent_id = $2)" : ""}
ORDER BY p.active DESC, p.id;`;

    const result = await pool.query(query, category != 0 ? [company, category] : [company]);
    return result.rows;
  } else {
    console.log("Lista de produtos para Clientes");
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
    COALESCE(prs.prices, '[]') AS prices,
    COALESCE(pvs.variants, '[]') AS variants

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

-- 🔹 variações ativas + qty por variante no carrinho do cliente
LEFT JOIN (
    SELECT pv.product_id,
      json_agg(json_build_object(
        'id', pv.id, 'name', pv.name, 'sku', pv.sku, 'ean', pv.ean,
        'weight', pv.weight, 'content', pv.content, 'price', pv.price,
        'image_url', pv.image_url, 'active', pv.active, 'sort_order', pv.sort_order,
        'quantity_in_cart', COALESCE(vqty.qty, 0)
      ) ORDER BY pv.sort_order, pv.id) AS variants
    FROM product_variants pv
    LEFT JOIN (
        SELECT oi.variant_id, SUM(oi.quantity)::INTEGER AS qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.company_id = $2 AND o.status = 'DRAFT'
        GROUP BY oi.variant_id
    ) vqty ON vqty.variant_id = pv.id
    WHERE pv.active = true
    GROUP BY pv.product_id
) pvs ON pvs.product_id = p.id

WHERE
    p.company_id = $1
    AND p.active = true
    ${category != 0 ? "AND p.category_id IN (SELECT id FROM products_categories WHERE id = $3 OR parent_id = $3)" : ""}
ORDER BY
    p.id;

  `;

    const result = await pool.query(query, category != 0 ? [company, supplier, category] : [company, supplier]);
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
        COALESCE(pps.packages, '[]') AS packages,
        COALESCE(pvs.variants, '[]') AS variants
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

    -- VARIANTES (com quantidade do cliente por variante)
    LEFT JOIN (
        SELECT
            pv.product_id,
            json_agg(
                json_build_object(
                    'id',               pv.id,
                    'name',             pv.name,
                    'sku',              pv.sku,
                    'ean',              pv.ean,
                    'weight',           pv.weight,
                    'content',          pv.content,
                    'price',            pv.price,
                    'image_url',        pv.image_url,
                    'active',           pv.active,
                    'sort_order',       pv.sort_order,
                    'quantity_in_cart', COALESCE(vqty.qty, 0)
                )
                ORDER BY pv.sort_order, pv.id
            ) AS variants
        FROM product_variants pv
        LEFT JOIN (
            SELECT oi.variant_id, SUM(oi.quantity)::INTEGER AS qty
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.company_id = $2 AND o.status = 'DRAFT'
            GROUP BY oi.variant_id
        ) vqty ON vqty.variant_id = pv.id
        WHERE pv.active = true
        GROUP BY pv.product_id
    ) pvs ON pvs.product_id = p.id

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
    COALESCE(pps.packages, '[]') AS packages,
    COALESCE(pvs.variants, '[]') AS variants
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

-- VARIANTES
LEFT JOIN (
    SELECT
        product_id,
        json_agg(
            json_build_object(
                'id',         id,
                'name',       name,
                'sku',        sku,
                'ean',        ean,
                'weight',     weight,
                'content',    content,
                'price',      price,
                'image_url',  image_url,
                'active',     active,
                'sort_order', sort_order
            )
            ORDER BY sort_order, id
        ) AS variants
    FROM product_variants
    WHERE active = true
    GROUP BY product_id
) pvs ON pvs.product_id = p.id

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
    active,
    visibility,
    deletedAt,
    categoryId,
    companyId,
    image,
    content,
    masterPackage,
    prices: packagePriceTiers,
    packages: packageList,
  } = data;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Update core product row (content + master_package now included)
    const { rows: productRows } = await client.query(
      `UPDATE products
       SET sku = $1, ean = $2, name = $3, description = $4, complement = $5, brand = $6,
           package_type = $7, units_per_package = $8, unit_of_measure = $9, weight = $10,
           active = $11, visibility = $12, updated_at = NOW(), deleted_at = $13,
           category_id = $14, company_id = $15, content = $16, master_package = $17
       WHERE id = $18
       RETURNING *`,
      [
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
        deletedAt,
        categoryId,
        companyId,
        content,
        masterPackage,
        id,
      ],
    );
    const product = productRows[0];

    // 2. Image
    if (image) {
      await client.query("DELETE FROM products_images WHERE product_id = $1 AND type = $2", [id, "main"]);
      await client.query(`INSERT INTO products_images (product_id, url, sort_order, type) VALUES ($1, $2, $3, $4)`, [id, image, 1, "main"]);
    }

    // 3. Packages — upsert by package_id, delete removed ones
    // packageMap: package_id (string) → products_packages.id
    const packageMap = new Map();
    if (Array.isArray(packageList) && packageList.length > 0) {
      const { rows: existingPkgs } = await client.query(`SELECT id, package_id FROM products_packages WHERE product_id = $1`, [id]);
      const existingPkgMap = new Map(existingPkgs.map((p) => [String(p.package_id), p.id]));

      const sentPackageIds = new Set();
      for (const p of packageList) {
        const packId = String(p.pack ?? p.package_id);
        const units = p.units ?? p.quantity;
        const wt = p.weight ?? p.wt ?? null;
        if (!packId || units == null) continue;
        sentPackageIds.add(packId);

        if (existingPkgMap.has(packId)) {
          const pkgRowId = existingPkgMap.get(packId);
          await client.query(`UPDATE products_packages SET quantity = $1, weight = $2 WHERE id = $3`, [units, wt, pkgRowId]);
          packageMap.set(packId, pkgRowId);
        } else {
          const { rows } = await client.query(
            `INSERT INTO products_packages (product_id, package_id, quantity, weight) VALUES ($1, $2, $3, $4) RETURNING id`,
            [id, parseInt(packId), units, wt],
          );
          packageMap.set(packId, rows[0].id);
        }
      }

      // Delete packages removed by the user (delete their prices first for FK safety)
      for (const [pkgId, pkgRowId] of existingPkgMap) {
        if (!sentPackageIds.has(pkgId)) {
          await client.query(`DELETE FROM products_prices WHERE product_package_id = $1`, [pkgRowId]);
          await client.query(`DELETE FROM products_packages WHERE id = $1`, [pkgRowId]);
        }
      }
    }

    // 4. Prices — upsert by id presence, delete removed ones, then sync variants
    if (Array.isArray(packagePriceTiers) && packagePriceTiers.length > 0) {
      // Snapshot existing prices before any modification
      const { rows: existingPrices } = await client.query(`SELECT id, unit_price FROM products_prices WHERE product_id = $1`, [id]);
      const existingPriceMap = new Map(existingPrices.map((p) => [p.id, Number(p.unit_price)]));

      const sentPriceIds = new Set();
      const newPrices = []; // { id, unitPrice } — newly inserted
      const changedPrices = []; // { id, unitPrice } — unit_price changed

      console.log("[PRODUCT PRICES DB RESULT]", JSON.stringify(existingPrices));
      console.log("[PRODUCT PRICES SAVE PAYLOAD]", JSON.stringify(packagePriceTiers));

      // Normalize: Flutter sends either a flat list (PriceTier[]) where each entry has
      // qty_min at the top level, or a hierarchical list (PackagePriceTier[]) where each
      // entry has a nested `prices` array. Flatten to a uniform format.
      const flatPrices = [];
      for (const item of packagePriceTiers) {
        const packId = String(item.pack ?? item.package_id ?? "");
        if (Array.isArray(item.prices)) {
          // Hierarchical (PackagePriceTier)
          for (const tier of item.prices) {
            flatPrices.push({ ...tier, _packId: packId });
          }
        } else {
          // Flat (PriceTier) — pack is the package_id
          flatPrices.push({ ...item, _packId: packId });
        }
      }

      for (const price of flatPrices) {
        const packId = price._packId;
        let productPackageId = packageMap.get(packId);
        if (!productPackageId) {
          const { rows } = await client.query(`SELECT id FROM products_packages WHERE product_id = $1 AND package_id = $2 LIMIT 1`, [
            id,
            parseInt(packId),
          ]);
          if (rows.length > 0) {
            productPackageId = rows[0].id;
            packageMap.set(packId, productPackageId);
          }
        }
        if (!productPackageId) {
          console.warn(`[update] No products_packages found for product_id=${id} package_id=${packId} — skipping price`);
          continue;
        }

        const qtyMin = price.qty_min ?? price.minQty ?? 1;
        const qtyMax = price.qty_max ?? price.maxQty ?? null;
        const unitPrice = Number(Number(price.unit_price ?? price.priceCents ?? 0).toFixed(2));
        const priceId = price.id;

        if (priceId && existingPriceMap.has(priceId)) {
          sentPriceIds.add(priceId);
          const oldUnitPrice = existingPriceMap.get(priceId);
          await client.query(
            `UPDATE products_prices SET qty_min = $1, qty_max = $2, unit_price = $3,
             product_package_id = $4 WHERE id = $5`,
            [qtyMin, qtyMax, unitPrice, productPackageId, priceId],
          );
          console.log(`OldUnitPrice: ${oldUnitPrice}`);
          console.log(`NewUnitPrice: ${unitPrice}`);
          if (Math.abs(oldUnitPrice - unitPrice) > 0.001) {
            changedPrices.push({ id: priceId, unitPrice, oldUnitPrice });
          }
        } else {
          const { rows } = await client.query(
            `INSERT INTO products_prices (product_id, product_package_id, qty_min, qty_max, unit_price)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [id, productPackageId, qtyMin, qtyMax, unitPrice],
          );
          newPrices.push({ id: rows[0].id, unitPrice });
        }
      }

      // Delete prices not in the sent payload
      for (const existingPriceId of existingPriceMap.keys()) {
        if (!sentPriceIds.has(existingPriceId)) {
          await client.query(`DELETE FROM products_prices WHERE id = $1`, [existingPriceId]);
        }
      }

      // 5. Variant sync (only if product_variant_prices table exists)
      const { rows: tableCheck } = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'product_variant_prices' LIMIT 1`,
      );
      console.log(`Passando por aqui -------------------------------------- ${tableCheck.length}`);
      if (tableCheck.length > 0) {
        // Propagate unit_price changes only to variants whose price still matches the old
        // product price — those are inherited prices; custom prices are left untouched.
        console.log(`${changedPrices}`);
        for (const { id: priceId, unitPrice, oldUnitPrice } of changedPrices) {
          console.log("------------------------------------");
          console.log(`Price ID ${priceId} changed from ${oldUnitPrice} to ${unitPrice}`);
          console.log("------------------------------------");
          await client.query(
            `UPDATE product_variant_prices SET unit_price = $1, updated_at = NOW()
             WHERE product_price_id = $2 and is_overridden = false`,
            [unitPrice, priceId],
          );
        }

        // Add new price tiers to all existing variants
        if (newPrices.length > 0) {
          const { rows: variantRows } = await client.query(`SELECT id FROM product_variants WHERE product_id = $1`, [id]);
          for (const variant of variantRows) {
            for (const { id: priceId, unitPrice } of newPrices) {
              await client.query(
                `INSERT INTO product_variant_prices (variant_id, product_price_id, unit_price, is_overridden)
                 VALUES ($1, $2, $3, false)
                 ON CONFLICT (variant_id, product_price_id) DO NOTHING`,
                [variant.id, priceId, unitPrice],
              );
            }
          }
        }
      }
    }

    await client.query("COMMIT");

    const { rows: savedPrices } = await pool.query(`SELECT id, qty_min, qty_max, unit_price FROM products_prices WHERE product_id = $1`, [id]);
    console.log("[PRODUCT PRICES RESPONSE]", JSON.stringify(savedPrices));

    product.images = [];
    return product;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM products WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove };
