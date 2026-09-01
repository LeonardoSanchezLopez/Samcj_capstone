export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function cleanSearch(value = '') {
  return String(value).trim().replace(/[,%()]/g, ' ');
}

export function apiError(message, status = 400, details = null) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

export function ensureData(result, message = 'Error de base de datos') {
  if (result.error) throw apiError(message, 400, result.error.message);
  return result.data;
}
