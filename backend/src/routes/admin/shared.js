import { apiError } from "../../utils/http.js";
function includesText(value, search) {
  return String(value ?? '').toLowerCase().includes(search.toLowerCase());
}

function filterAny(rows, search, keys) {
  if (!search) return rows;
  return rows.filter(row => keys.some(key => {
    const value = key.split('.').reduce((acc, part) => acc?.[part], row);
    return includesText(value, search);
  }));
}

const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,99}$/u;
const DNI_RE = /^\d{8}$/;
const PHONE_RE = /^9\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateCustomerPayload({ nombres, apellidos, dni, telefono, correo }) {
  if (!nombres || !apellidos || !dni || !telefono) throw apiError('Completa nombres, apellidos, DNI y teléfono');
  if (!NAME_RE.test(String(nombres).trim())) throw apiError('Los nombres solo pueden contener letras');
  if (!NAME_RE.test(String(apellidos).trim())) throw apiError('Los apellidos solo pueden contener letras');
  if (!DNI_RE.test(String(dni))) throw apiError('El DNI debe contener exactamente 8 números');
  if (!PHONE_RE.test(String(telefono))) throw apiError('El celular debe tener 9 dígitos y comenzar por 9');
  if (correo && !EMAIL_RE.test(String(correo))) throw apiError('Ingresa un correo electrónico válido');
}

