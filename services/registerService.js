const pool = require("../db");
const { hashPassword } = require("../helpers/hash");
const axios = require("axios");
/**
 * Get All users
 */
const findAll = async () => {
  const result = await pool.query("SELECT * FROM users ORDER BY id");
  return result.rows;
};

const find = async (cnpj) => {
  const result = await axios.get(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);

  return result.data || null;
};

const create = async (data) => {
  const { name, email, password } = data;
  const hashedPassword = await hashPassword(password);
  const result = await pool.query("INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING *", [name, email, hashedPassword]);
  return result.rows[0];
};

const createCompanies = async (data) => {
  const {
    user,
    type,
    uf,
    cep,
    cnpj,
    pais,
    email,
    porte,
    bairro,
    numero,
    municipio,
    logradouro,
    cnae_fiscal,
    codigo_pais,
    complemento,
    codigo_porte,
    razao_social,
    nome_fantasia,
    capital_social,
    opcao_pelo_mei,
    codigo_municipio,
    natureza_juridica,
    situacao_especial,
    opcao_pelo_simples,
    situacao_cadastral,
    data_opcao_pelo_mei,
    codigo_municipio_ibge,
    data_inicio_atividade,
    data_situacao_especial,
    data_opcao_pelo_simples,
    data_situacao_cadastral,
    nome_cidade_no_exterior,
    codigo_natureza_juridica,
    ente_federativo_responsavel,
    identificador_matriz_filial,
    qualificacao_do_responsavel,
    descricao_situacao_cadastral,
    descricao_tipo_de_logradouro,
  } = data;
  const result = await pool.query(
    "INSERT INTO companies (uf,cep,cnpj,pais,email,porte,bairro,numero,municipio,logradouro,cnae_fiscal,codigo_pais,complemento,codigo_porte,razao_social,nome_fantasia,capital_social,opcao_pelo_mei,codigo_municipio,natureza_juridica,situacao_especial,opcao_pelo_simples,situacao_cadastral,data_opcao_pelo_mei,codigo_municipio_ibge,data_inicio_atividade,data_situacao_especial,data_opcao_pelo_simples,data_situacao_cadastral,nome_cidade_no_exterior,codigo_natureza_juridica,ente_federativo_responsavel,identificador_matriz_filial,qualificacao_do_responsavel,descricao_situacao_cadastral,descricao_tipo_de_logradouro) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36) RETURNING *",
    [
      uf,
      cep,
      cnpj,
      pais,
      email,
      porte,
      bairro,
      numero,
      municipio,
      logradouro,
      cnae_fiscal,
      codigo_pais,
      complemento,
      codigo_porte,
      razao_social,
      nome_fantasia,
      capital_social,
      opcao_pelo_mei,
      codigo_municipio,
      natureza_juridica,
      situacao_especial,
      opcao_pelo_simples,
      situacao_cadastral,
      data_opcao_pelo_mei,
      codigo_municipio_ibge,
      data_inicio_atividade,
      data_situacao_especial,
      data_opcao_pelo_simples,
      data_situacao_cadastral,
      nome_cidade_no_exterior,
      codigo_natureza_juridica,
      ente_federativo_responsavel,
      identificador_matriz_filial,
      qualificacao_do_responsavel,
      descricao_situacao_cadastral,
      descricao_tipo_de_logradouro,
    ]
  );

  console.log(result.rows[0]);
  console.log(result.rows[0].id);
  console.log(result.rows[0]["id"]);

  // add user-company relation if sucess
  await pool.query("INSERT INTO users_companies (user_id, company_id, relation_type) VALUES ($1, $2, $3)", [user, result.rows[0].id, type]);

  return result.rows[0];
};

const update = async (data) => {
  // espera um objeto com propriedades em camelCase + id
  const { name, email, password, type } = data;
  const result = await pool.query("UPDATE users SET name = $1, email = $2, password = $3, type = $4 WHERE id = $5 RETURNING *", [
    name,
    email,
    password,
    type,
    id,
  ]);
  return result.rows[0];
};

const remove = async (id) => {
  const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [id]);
  return result.rows[0];
};

module.exports = { findAll, find, create, update, remove, createCompanies };
