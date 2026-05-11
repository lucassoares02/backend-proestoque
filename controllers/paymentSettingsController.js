const svc = require("../services/paymentSettingsService");

const ok = (res, data) => res.json({ success: true, data, error: null });
const fail = (res, err, code = 500) => res.status(code).json({ success: false, data: null, error: err.message });

// GET /payment-settings/:supplier
const getGeneral = async (req, res) => {
  try {
    const data = await svc.findGeneral(Number(req.params.supplier));
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// PUT /payment-settings/:supplier
const putGeneral = async (req, res) => {
  try {
    const data = await svc.upsertGeneral(Number(req.params.supplier), req.body);
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// GET /payment-settings/:supplier/customers
const listCustomers = async (req, res) => {
  try {
    const data = await svc.listCustomers(Number(req.params.supplier));
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// GET /payment-settings/:supplier/customers/:customer
const getCustomer = async (req, res) => {
  try {
    const data = await svc.findCustomer(Number(req.params.supplier), Number(req.params.customer));
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// PUT /payment-settings/:supplier/customers/:customer
const putCustomer = async (req, res) => {
  try {
    const data = await svc.upsertCustomer(Number(req.params.supplier), Number(req.params.customer), req.body);
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /payment-settings/:supplier/customers/:customer
const deleteCustomer = async (req, res) => {
  try {
    const data = await svc.removeCustomer(Number(req.params.supplier), Number(req.params.customer));
    if (!data) return res.status(404).json({ success: false, data: null, error: "Não encontrado" });
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// GET /payment-settings/resolve/:supplier/:customer
const resolve = async (req, res) => {
  try {
    const data = await svc.resolveForCheckout(Number(req.params.supplier), Number(req.params.customer));
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

// GET /payment-settings/:supplier/known-customers
const listKnownCustomers = async (req, res) => {
  try {
    const data = await svc.listSupplierCustomers(Number(req.params.supplier));
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

module.exports = { getGeneral, putGeneral, listCustomers, getCustomer, putCustomer, deleteCustomer, resolve, listKnownCustomers };
