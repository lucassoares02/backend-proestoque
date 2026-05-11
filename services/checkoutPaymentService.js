const pool = require("../db");
const { resolveForCheckout } = require("./paymentSettingsService");

const FIRST_ORDER_STATUSES = ["CONFIRMED", "PENDING_SUPPLIER", "APPROVED"];

/**
 * Checks whether the given company has any previous completed order
 * with this supplier (i.e. not a first-order scenario).
 */
const _isFirstOrder = async (supplierId, companyId) => {
  const result = await pool.query(
    `SELECT 1 FROM orders
     WHERE company_id = $1 AND supplier_id = $2
       AND status = ANY($3::text[])
     LIMIT 1`,
    [companyId, supplierId, FIRST_ORDER_STATUSES],
  );
  return result.rowCount === 0;
};

/**
 * Builds the full payment options payload for a checkout session.
 * orderTotal is optional — used to pre-compute validation warnings.
 */
const getPaymentOptions = async (supplierId, companyId, orderTotal) => {
  const [resolved, firstOrder] = await Promise.all([
    resolveForCheckout(supplierId, companyId),
    _isFirstOrder(supplierId, companyId),
  ]);

  const isFirstOrder = firstOrder && !resolved.is_known_customer;

  const validationMessages = [];

  if (isFirstOrder) {
    if (resolved.first_order_required_method) {
      validationMessages.push({
        type: "first_order_method",
        message: `Primeiro pedido: pagamento obrigatório via ${resolved.first_order_required_method}`,
      });
    }
    if (resolved.first_order_max_amount != null && orderTotal != null) {
      if (Number(orderTotal) > Number(resolved.first_order_max_amount)) {
        validationMessages.push({
          type: "first_order_amount",
          message: `Valor máximo permitido no primeiro pedido: R$ ${Number(resolved.first_order_max_amount).toFixed(2).replace(".", ",")}`,
        });
      }
    }
  }

  if (resolved.minimum_order_amount != null && orderTotal != null) {
    if (Number(orderTotal) < Number(resolved.minimum_order_amount)) {
      validationMessages.push({
        type: "minimum_order_amount",
        message: `Este fornecedor aceita pedidos a partir de R$ ${Number(resolved.minimum_order_amount).toFixed(2).replace(".", ",")}`,
      });
    }
  }

  return {
    allowed_payment_methods: resolved.allowed_methods,
    boleto_terms: resolved.boleto_terms,
    is_first_order: isFirstOrder,
    is_known_customer: resolved.is_known_customer,
    credit_limit: resolved.credit_limit,
    first_order_required_payment_method: isFirstOrder ? resolved.first_order_required_method : null,
    first_order_max_amount: isFirstOrder ? resolved.first_order_max_amount : null,
    minimum_order_amount: resolved.minimum_order_amount ?? null,
    validation_messages: validationMessages,
  };
};

/**
 * Server-side validation of the submitted payment choice.
 * Returns { valid: bool, error: string | null }.
 */
const validatePaymentChoice = async (supplierId, companyId, paymentMethod, boletoTerm, orderTotal) => {
  const options = await getPaymentOptions(supplierId, companyId, orderTotal);

  if (!options.allowed_payment_methods.includes(paymentMethod)) {
    return { valid: false, error: `Método de pagamento '${paymentMethod}' não permitido para este fornecedor.` };
  }

  if (paymentMethod === "BOLETO") {
    if (boletoTerm == null || !options.boleto_terms.includes(Number(boletoTerm))) {
      return { valid: false, error: `Prazo de boleto inválido. Prazos permitidos: ${options.boleto_terms.join(", ")} dias.` };
    }
  }

  if (options.is_first_order) {
    if (options.first_order_required_payment_method && paymentMethod !== options.first_order_required_payment_method) {
      return { valid: false, error: `Primeiro pedido exige pagamento via ${options.first_order_required_payment_method}.` };
    }
    if (options.first_order_max_amount != null && Number(orderTotal) > Number(options.first_order_max_amount)) {
      return { valid: false, error: `Valor máximo para o primeiro pedido é R$ ${Number(options.first_order_max_amount).toFixed(2)}.` };
    }
  }

  if (options.minimum_order_amount != null && Number(orderTotal) < Number(options.minimum_order_amount)) {
    return { valid: false, error: `Este fornecedor aceita pedidos a partir de R$ ${Number(options.minimum_order_amount).toFixed(2).replace(".", ",")}.` };
  }

  if (paymentMethod === "CREDITO_COMERCIAL" && options.credit_limit != null) {
    if (Number(orderTotal) > Number(options.credit_limit)) {
      return { valid: false, error: `Pedido excede o limite de crédito disponível de R$ ${Number(options.credit_limit).toFixed(2)}.` };
    }
  }

  return { valid: true, error: null };
};

module.exports = { getPaymentOptions, validatePaymentChoice };
