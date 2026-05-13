const pool = require("../db");

const verifyOrderOwnership = async (uuid, supplierId) => {
  const result = await pool.query(
    `SELECT id, status FROM orders WHERE public_id = $1 AND supplier_id = $2`,
    [uuid, supplierId],
  );
  return result.rows[0] || null;
};

const saveInvoice = async (uuid, url, originalName) => {
  const result = await pool.query(
    `UPDATE orders
     SET invoice_file_url = $1, invoice_file_name = $2, invoice_uploaded_at = NOW()
     WHERE public_id = $3
     RETURNING invoice_file_url, invoice_file_name, invoice_uploaded_at`,
    [url, originalName, uuid],
  );
  return result.rows[0];
};

const saveBoleto = async (uuid, url, originalName) => {
  const result = await pool.query(
    `UPDATE orders
     SET boleto_file_url = $1, boleto_file_name = $2, boleto_uploaded_at = NOW()
     WHERE public_id = $3
     RETURNING boleto_file_url, boleto_file_name, boleto_uploaded_at`,
    [url, originalName, uuid],
  );
  return result.rows[0];
};

const clearInvoice = async (uuid) => {
  await pool.query(
    `UPDATE orders
     SET invoice_file_url = NULL, invoice_file_name = NULL, invoice_uploaded_at = NULL
     WHERE public_id = $1`,
    [uuid],
  );
};

const clearBoleto = async (uuid) => {
  await pool.query(
    `UPDATE orders
     SET boleto_file_url = NULL, boleto_file_name = NULL, boleto_uploaded_at = NULL
     WHERE public_id = $1`,
    [uuid],
  );
};

module.exports = { verifyOrderOwnership, saveInvoice, saveBoleto, clearInvoice, clearBoleto };
