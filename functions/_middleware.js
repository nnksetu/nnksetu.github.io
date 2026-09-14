export async function onRequest(context) {
  const response = await context.next();

  if (new URL(context.request.url).pathname !== "/scripts/sw.js") {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Service-Worker-Allowed", "/");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
