async function resolveResponse(response, fallback = {}) {
  const result = await response.json().catch(() => fallback);
  return { response, result };
}

export { resolveResponse };
