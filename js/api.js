export async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
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
