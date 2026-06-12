export async function api(path, options) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch (err) {
    // A reused keep-alive socket the server already closed fails at the
    // network level ("Failed to fetch"); a fresh connection fixes it.
    if (options?.method && options.method !== "GET") throw err;
    await new Promise((r) => setTimeout(r, 400));
    res = await fetch(`/api${path}`, options);
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).detail || "";
    } catch {}
    throw new Error(`${path} -> ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

function post(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const saveLog = (date, payload) => post(`/log/${date}`, payload);
export const saveKit = (id, payload) => post(`/kit/${id}`, payload);
