const { getPaymentOptions, validatePaymentChoice } = require("../services/checkoutPaymentService");

const ok = (res, data) => res.json({ success: true, data, error: null });
const fail = (res, err, code = 500) => res.status(code).json({ success: false, data: null, error: err.message });

// GET /checkout/payment-options/:supplier/:company?total=xxx
const paymentOptions = async (req, res) => {
  try {
    const supplierId = Number(req.params.supplier);
    const companyId = Number(req.params.company);
    const orderTotal = req.query.total ? Number(req.query.total) : null;

    if (!supplierId || !companyId) {
      return res.status(400).json({ success: false, data: null, error: "supplier e company são obrigatórios" });
    }

    const data = await getPaymentOptions(supplierId, companyId, orderTotal);
    ok(res, data);
  } catch (err) {
    fail(res, err);
  }
};

module.exports = { paymentOptions };
